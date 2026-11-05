import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import type { ReadingDocument, SearchHit } from './contracts/browsing';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const hit = (title: string): SearchHit => ({ title, url: 'https://example.com/article', site: 'example.com', snippet: '', date: null });
const provider = (overrides: Partial<BrowsingProvider> = {}): BrowsingProvider => ({
  search: async () => [hit('baseline')], read: async () => ({ title: 'Article', content: 'Original content' }),
  extract: async () => ({ text: 'Summary', truncated: false }), ...overrides
});

test('replacement aborts transport, settles promptly and ignores late success or failure', async () => {
  const old = deferred<SearchHit[]>();
  const latest = deferred<SearchHit[]>();
  const signals: AbortSignal[] = [];
  const session = new BrowsingSession(provider({ search: (_body, signal) => { signals.push(signal); return signals.length === 1 ? old.promise : latest.promise; } }), () => {});
  const first = session.search('old', 'professional', false);
  const second = session.search('new', 'learning', true);
  assert.equal(signals[0].aborted, true);
  assert.equal(await first, undefined, 'does not wait for an uncooperative old adapter');
  latest.resolve([hit('new result')]);
  await second;
  const committed = session.snapshot();
  old.reject(new Error('late failure must not become a current issue'));
  await old.promise.catch(() => {});
  assert.equal(session.snapshot(), committed);
  assert.equal(committed.search?.query, 'new');
  assert.equal(committed.search?.scene, 'learning');
  assert.equal(committed.pending, undefined);
  assert.equal(committed.issue, undefined);
});

test('new search retains old results; cancel/home/scene/disposal cannot be undone by late work', async () => {
  for (const interrupt of ['cancel', 'home', 'scene', 'dispose'] as const) {
    const late = deferred<SearchHit[]>();
    let slow = false;
    let signal!: AbortSignal;
    const session = new BrowsingSession(provider({ search: async (_body, s) => { signal = s; return slow ? late.promise : [hit('retained')]; } }), () => {});
    await session.search('baseline', 'professional', false);
    slow = true;
    const pending = session.search('replacement', 'learning', true);
    assert.equal(session.snapshot().search?.query, 'baseline');
    if (interrupt === 'scene') session.setScene('living');
    else session[interrupt]();
    assert.equal(signal.aborted, true);
    assert.equal(await pending, undefined);
    const final = session.snapshot();
    late.resolve([hit('late')]); await late.promise;
    assert.equal(session.snapshot(), final);
    assert.equal(final.search?.query, 'baseline');
    assert.equal(final.pending, undefined);
    if (interrupt === 'home') assert.equal(final.mode, 'home');
    if (interrupt === 'dispose') await assert.rejects(session.search('closed', 'professional', false), /关闭/);
  }
});

test('reading keeps its query snapshot; same URL with a new document rejects the old handle', async () => {
  let supplied: ReadingDocument | undefined;
  const session = new BrowsingSession(provider({ extract: async reading => { supplied = reading; return { text: 'Summary', truncated: false }; } }), () => {});
  await session.search('original question', 'professional', true);
  const first = (await session.read('https://example.com/article'))!;
  session.setScene('learning');
  assert.equal(first.context?.query, 'original question');
  assert.equal(first.context?.scene, 'professional');
  const second = (await session.read(first.url))!;
  await assert.rejects(session.extract(first.url, 'learning', first.id), /正文已变化/);
  await session.extract(second.url, 'learning', second.id);
  assert.equal(supplied, second);
  assert.equal(session.snapshot().extraction?.scene, 'learning');
  assert.equal(second.context?.query, 'original question');
  assert.equal(Object.isFrozen(second), true);
  assert.equal(Object.isFrozen(second.context), true);
});

test('late Fetch and extraction cannot reopen a surface after navigation', async () => {
  const read = deferred<{ title: string; content: string }>();
  const extraction = deferred<{ text: string; truncated: boolean }>();
  const session = new BrowsingSession(provider({ read: () => read.promise, extract: () => extraction.promise }), () => {});
  const pendingRead = session.read('https://example.com/article');
  session.home(); assert.equal(await pendingRead, undefined);
  read.resolve({ title: 'Late', content: 'Old document' }); await read.promise;
  assert.equal(session.snapshot().mode, 'home');
  assert.equal(session.snapshot().reading, undefined);
  const document = (await session.read('https://example.com/article'))!;
  const pendingExtraction = session.extract(document.url, 'living', document.id);
  session.open('https://example.org/'); assert.equal(await pendingExtraction, undefined);
  extraction.resolve({ text: 'Late extraction', truncated: false }); await extraction.promise;
  assert.equal(session.snapshot().mode, 'page');
  assert.equal(session.snapshot().extraction, undefined);
});

test('a reopened surface cannot reuse another owner\'s document handle', async () => {
  const first = new BrowsingSession(provider(), () => {});
  const old = (await first.read('https://example.com/article'))!;
  first.dispose();
  const second = new BrowsingSession(provider(), () => {});
  const current = (await second.read(old.url))!;
  assert.notEqual(first.snapshot().ownerId, second.snapshot().ownerId);
  assert.notEqual(old.id, current.id);
  await assert.rejects(second.extract(current.url, 'living', old.id), /正文已变化/);
});

test('a submitted request owns one node through pending, ready and failed states', async () => {
  const held = deferred<SearchHit[]>();
  let slow = false;
  const session = new BrowsingSession(provider({ search: () => slow ? held.promise : Promise.resolve([hit('baseline')]) }), () => {});
  await session.search('baseline', 'professional', false);
  const parent = session.snapshot().entryId;
  slow = true;
  const pending = session.search('new question', 'learning', true);
  const started = session.snapshot();
  assert.notEqual(started.entryId, parent);
  assert.equal(started.pending?.nodeId, started.entryId);
  assert.equal(started.path.nodes.at(-1)?.status, 'pending');
  assert.equal(started.path.nodes.at(-1)?.label, 'new question');
  assert.equal(started.search?.query, 'baseline', 'last usable view remains visible while waiting');
  held.resolve([hit('new')]); await pending;
  assert.equal(session.snapshot().entryId, started.entryId);
  assert.equal(session.snapshot().path.nodes.length, started.path.nodes.length);
  assert.equal(session.snapshot().path.nodes.at(-1)?.status, 'ready');
  assert.equal(session.snapshot().scene, 'learning');
  assert.equal(session.snapshot().presentation.contextual, true);
  const failed = new BrowsingSession(provider({ search: async () => { throw new Error('synthetic failure'); } }), () => {});
  await assert.rejects(failed.search('broken', 'living', false), /synthetic failure/);
  const failedId = failed.snapshot().entryId;
  failed.back(); failed.forward();
  assert.equal(failed.snapshot().entryId, failedId);
  assert.equal(failed.snapshot().path.nodes.at(-1)?.status, 'failed');
  assert.equal(failed.snapshot().issue?.message, 'synthetic failure');
});

test('returning to a cancelled node never revives its request or overwrites another branch', async () => {
  const old = deferred<SearchHit[]>();
  let signal!: AbortSignal;
  let calls = 0;
  const session = new BrowsingSession(provider({ search: (_body, s) => { signal = s; calls++; return old.promise; } }), () => {});
  const root = session.snapshot().entryId;
  const pending = session.search('old branch', 'learning', false);
  const cancelled = session.snapshot().entryId;
  assert.equal(session.jump('not-owned'), false);
  assert.equal(signal.aborted, false, 'an invalid jump does not cancel the active request');
  session.back(); assert.equal(await pending, undefined); assert.equal(signal.aborted, true);
  session.open('https://example.org/new-branch');
  const branch = session.snapshot().entryId;
  assert.equal(session.jump(cancelled), true);
  const before = session.snapshot();
  old.resolve([hit('late')]); await old.promise; await Promise.resolve();
  assert.equal(session.snapshot(), before);
  assert.equal(before.pending, undefined);
  assert.equal(before.path.nodes.find(n => n.id === cancelled)?.status, 'cancelled');
  assert.equal(before.search, undefined);
  session.back(); assert.equal(session.snapshot().entryId, root);
  session.forward(); assert.equal(session.snapshot().entryId, cancelled);
  assert.equal(session.jump(branch), true); assert.equal(calls, 1);
});

test('branches restore their own scene, optimization and draft; another tab cannot jump into them', async () => {
  const session = new BrowsingSession(provider(), () => {});
  await session.search('A', 'learning', false);
  const a = session.snapshot().entryId;
  session.savePresentation(a, { scrollTop: 230, addressDraft: 'draft A', homeQuery: 'question A', contextual: false });
  const reading = (await session.read('https://example.com/a'))!;
  const c = session.snapshot().entryId;
  session.setScene('living');
  session.savePresentation(c, { scrollTop: 710, addressDraft: 'draft C', homeQuery: 'question C', contextual: true });
  session.back(); await session.search('D', 'entertainment', true);
  const d = session.snapshot().entryId;
  assert.equal(session.jump(c), true);
  assert.equal(session.snapshot().scene, 'living');
  assert.equal(session.snapshot().reading?.id, reading.id);
  assert.equal(session.snapshot().presentation.addressDraft, 'draft C');
  assert.equal(session.snapshot().presentation.scrollTop, 710);
  session.back(); assert.equal(session.snapshot().scene, 'learning');
  assert.equal(session.snapshot().presentation.addressDraft, 'draft A');
  assert.equal(session.snapshot().presentation.contextual, false);
  session.forward(); assert.equal(session.snapshot().entryId, c);
  session.jump(d); session.back(); session.forward(); assert.equal(session.snapshot().entryId, d);
  const other = new BrowsingSession(provider(), () => {});
  assert.equal(other.jump(a), false);
  assert.notEqual(other.snapshot().path.id, session.snapshot().path.id);
});

test('evicted content stays missing after scene edits, without losing source context or making requests', async () => {
  let calls = 0;
  const session = new BrowsingSession(provider({ read: async url => { calls++; return { title: url, content: 'body'.repeat(200) }; } }), () => {}, { textBudget: 1400 });
  await session.search('original', 'learning', false);
  await session.read('https://example.com/first');
  const first = session.snapshot().entryId;
  await session.read('https://example.com/second');
  session.jump(first);
  assert.equal(session.snapshot().reading, undefined);
  assert.ok(session.snapshot().path.notice?.includes('释放'));
  session.setScene('living');
  assert.deepEqual(session.snapshot().path.nodes.find(n => n.id === first)?.missingContent, ['reading']);
  assert.equal(session.snapshot().searchContext?.query, 'original');
  assert.equal(calls, 2);
  session.results(); assert.equal(session.snapshot().mode, 'results');
  assert.equal(session.snapshot().search?.query, 'original');
});

test('synchronous cancellation on the pending notification starts no provider work', async () => {
  let calls = 0;
  const session: BrowsingSession = new BrowsingSession(provider({ search: async () => { calls++; return [hit('unexpected')]; } }), () => {
    if (session.snapshot().pending) session.cancel();
  });
  assert.equal(await session.search('cancel immediately', 'learning', false), undefined);
  assert.equal(calls, 0);
  assert.equal(session.snapshot().path.nodes.at(-1)?.status, 'cancelled');
  assert.equal(session.snapshot().pending, undefined);
});

test('a completed request preserves a draft edited while waiting, without changing its query context', async () => {
  const held = deferred<SearchHit[]>();
  const session = new BrowsingSession(provider({ search: () => held.promise }), () => {});
  const pending = session.search('submitted question', 'learning', true);
  const id = session.snapshot().entryId;
  session.savePresentation(id, { scrollTop: 90, addressDraft: 'next question draft', homeQuery: 'another idea', contextual: false });
  held.resolve([hit('result')]); await pending;
  assert.equal(session.snapshot().presentation.addressDraft, 'next question draft');
  assert.equal(session.snapshot().presentation.homeQuery, 'another idea');
  assert.equal(session.snapshot().presentation.contextual, false);
  assert.equal(session.snapshot().searchContext?.query, 'submitted question');
  assert.equal(session.snapshot().searchContext?.contextual, true);
  assert.equal(session.snapshot().entryId, id);
});

test('cancelled steps retain the submitted intent separately from later scene and draft choices', async () => {
  const held = deferred<SearchHit[]>();
  const session = new BrowsingSession(provider({ search: () => held.promise }), () => {});
  const pending = session.search('original intent', 'learning', true);
  const id = session.snapshot().entryId;
  const submitted = session.snapshot().path.nodes.find(n => n.id === id)!;
  assert.equal(submitted.target, 'original intent');
  assert.equal(submitted.context?.scene, 'learning');
  assert.ok(submitted.context?.actualQuery.includes('入门教程'));
  assert.equal(submitted.context?.id, submitted.runId);
  session.setScene('living'); await pending;
  const cancelled = session.snapshot().path.nodes.find(n => n.id === id)!;
  assert.equal(cancelled.scene, 'living', 'the local selection can be edited for future work');
  assert.equal(cancelled.context?.scene, 'learning', 'the submitted request does not change');
  assert.equal(cancelled.context?.contextual, true);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(Object.isFrozen(cancelled.context));
  held.resolve([hit('late')]); await held.promise;
});
