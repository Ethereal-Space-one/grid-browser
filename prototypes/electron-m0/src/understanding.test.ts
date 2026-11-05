import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import { groundedCompletion, understandingBody } from './providers/understanding';
import { questionSource, summarySources, type ModelRequest } from './contracts/understanding';
import { deepSeekProvider } from './providers/deepseek';
const hit = { title: '合成来源', url: 'https://example.com/source', snippet: '只有用户明确操作才会发送内容。', site: 'example.com', date: null };
const answer = Object.freeze({ text: '需要用户明确操作。', insufficient: false, citations: Object.freeze([Object.freeze({ source: 1, quote: '用户明确操作', title: hit.title, url: hit.url })]) });
const provider = (overrides: Partial<BrowsingProvider> = {}): BrowsingProvider => ({ search: async () => [hit], read: async () => ({ title: hit.title, content: hit.snippet }), extract: async () => ({ text: '重点', truncated: false }), model: async () => answer, ...overrides });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const request: ModelRequest = { kind: 'question', scene: 'learning', question: '何时发送？', sources: [{ id: 1, title: hit.title, url: hit.url, text: hit.snippet }] };
const payload = (data: object, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content: JSON.stringify(data) } }] });

test('model accepts exact supplied evidence, rejects invented sources, mismatched quotes and incomplete output', () => {
  const value = { text: '需明确操作', insufficient: false, citations: [{ source: 1, quote: '用户明确操作' }] };
  assert.equal(groundedCompletion(payload(value), request).citations[0].url, hit.url);
  for (const v of [{ ...value, citations: [] }, { ...value, citations: [{ source: 2, quote: '用户明确操作' }] }, { ...value, citations: [{ source: 1, quote: '任何内容都自动发送' }] }]) assert.throws(() => groundedCompletion(payload(v), request));
  for (const reason of ['length', 'content_filter', 'tool_calls', 'aborted']) assert.throws(() => groundedCompletion(payload(value, reason), request));
  assert.equal(groundedCompletion(payload({ text: '此资料没有说明', insufficient: true, citations: [] }), request).insufficient, true);
});
test('model input is bounded, scene-specific and no-tools; unsupported API output never becomes an answer', async () => {
  const body = understandingBody(request);
  assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.thinking.type, 'disabled'); assert.ok(!('tools' in body)); assert.ok(body.messages[0].content.includes('前置知识'));
  const document = questionSource({ id: 'version-1', title: hit.title, url: hit.url, fetchedAt: 'now', content: '😀'.repeat(17000) });
  assert.equal(Array.from(document.text).length, 16000); assert.equal(document.truncated, true);
  const sources = summarySources({ id: 'search', query: 'q', actualQuery: 'q', scene: 'learning', contextual: false, results: Array.from({ length: 12 }, () => ({ ...hit, snippet: '字'.repeat(1800) })) });
  assert.equal(sources.length, 10); assert.equal(sources[0].text.length, 1600);
  const p = deepSeekProvider(() => 'synthetic-test-key', async () => new Response(JSON.stringify(payload({ text: 'bad', insufficient: false, citations: [] }))));
  await assert.rejects(p.model!(request, new AbortController().signal), /依据/);
});
test('summary stays on its search node, cannot hide results, is cached and rejects stale search handles', async () => {
  let calls = 0;
  const s = new BrowsingSession(provider({ model: async r => { calls++; assert.equal(r.kind, 'summary'); return answer; } }), () => {});
  const search = (await s.search('何时发送', 'learning', false))!; const before = s.snapshot();
  await s.summarize(search.id); assert.equal(s.snapshot().entryId, before.entryId); assert.equal(s.snapshot().path.nodes.length, before.path.nodes.length);
  assert.equal(s.snapshot().search, search); await s.summarize(search.id); assert.equal(calls, 1);
  s.open(hit.url); s.back(); assert.equal(s.snapshot().summary?.text, answer.text); assert.equal(calls, 1);
  await assert.rejects(s.summarize('old-id'), /变化/);
});
test('question submit owns one node, retains source version, restores its own draft and branches without model replay', async () => {
  let fetches = 0; let models = 0;
  const s = new BrowsingSession(provider({ read: async () => { fetches++; return { title: hit.title, content: hit.snippet }; }, model: async () => { models++; return answer; } }), () => {});
  const doc = (await s.read(hit.url))!; const origin = s.snapshot().entryId;
  s.beginQuestion(); const draft = s.snapshot(); assert.equal(models, 0); assert.equal(draft.question?.source?.readingId, doc.id);
  await s.ask('何时发送？', draft.question!.id); const first = s.snapshot();
  assert.equal(first.path.nodes.at(-1)?.status, 'ready'); assert.equal(first.question?.source?.readingId, doc.id);
  s.savePresentation(first.entryId, { ...first.presentation, questionDraft: '下一个草稿' });
  s.jump(draft.entryId); await s.ask('另一问题？', s.snapshot().question!.id); const second = s.snapshot();
  s.jump(first.entryId); assert.equal(s.snapshot().presentation.questionDraft, '下一个草稿');
  assert.equal(s.snapshot().question?.question, '何时发送？'); assert.equal(models, 2); assert.equal(fetches, 1);
  assert.ok(s.snapshot().path.nodes.some(n => n.id === second.entryId)); s.jump(origin); assert.equal(s.snapshot().reading?.id, doc.id);
});
test('cancellation during public Fetch prevents a model call and late navigation; HTTPS and stale handles are enforced', async () => {
  const held = deferred<{ title: string; content: string }>(); let models = 0; let signal!: AbortSignal;
  const s = new BrowsingSession(provider({ read: (_u, sig) => { signal = sig; return held.promise; }, model: async () => { models++; return answer; } }), () => {});
  s.open(hit.url); const origin = s.snapshot().entryId; s.beginQuestion();
  await assert.rejects(s.ask('question', 'wrong'), /变化/);
  const pending = s.ask('何时发送？', s.snapshot().question!.id); const node = s.snapshot().entryId;
  s.jump(origin); assert.equal(await pending, undefined); assert.ok(signal.aborted);
  held.resolve({ title: hit.title, content: hit.snippet }); await new Promise(r => setImmediate(r));
  assert.equal(models, 0); assert.equal(s.snapshot().entryId, origin); s.jump(node); assert.equal(s.snapshot().question?.answer, undefined);
  s.open('http://127.0.0.1/'); assert.throws(() => s.beginQuestion(), /HTTPS/);
});
test('late summary/answer responses cannot revive cancelled nodes or cross scene/disposal boundaries', async () => {
  for (const kind of ['summary', 'question'] as const) for (const interrupt of ['cancel', 'scene', 'dispose'] as const) {
    const held = deferred<typeof answer>(); let signal!: AbortSignal;
    const s = new BrowsingSession(provider({ model: (_r, sig) => { signal = sig; return held.promise; } }), () => {});
    let pending: Promise<void>;
    if (kind === 'summary') { const search = (await s.search('何时发送', 'learning', false))!; pending = s.summarize(search.id); }
    else { await s.read(hit.url); s.beginQuestion(); pending = s.ask('何时发送', s.snapshot().question!.id); }
    if (interrupt === 'scene') s.setScene('living'); else s[interrupt]();
    await pending; assert.ok(signal.aborted); const final = s.snapshot(); held.resolve(answer); await new Promise(r => setImmediate(r));
    assert.equal(s.snapshot(), final); assert.equal(s.snapshot().summary, undefined); assert.equal(s.snapshot().question?.answer, undefined);
  }
});
test('Fetch failure never reaches a model; old question cache eviction retains path and does not implicitly refetch', async () => {
  let calls = 0;
  const broken = new BrowsingSession(provider({ read: async () => { throw new Error('没有公开正文'); }, model: async () => { calls++; return answer; } }), () => {});
  broken.open(hit.url); broken.beginQuestion(); await assert.rejects(broken.ask('q', broken.snapshot().question!.id), /没有公开正文/); assert.equal(calls, 0);
  const s = new BrowsingSession(provider(), () => {}, { textBudget: 1500 }); await s.read(hit.url); s.beginQuestion();
  await s.ask('何时发送', s.snapshot().question!.id); const old = s.snapshot().entryId;
  for (let i = 0; i < 5; i++) await s.read(hit.url + '/' + i);
  s.jump(old); assert.equal(s.snapshot().question, undefined); assert.ok(s.snapshot().path.nodes.find(n => n.id === old)?.missingContent.includes('question'));
});
