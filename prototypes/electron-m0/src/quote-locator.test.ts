import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import { judgmentCitation, judgmentQuoteOrigin, QuoteLocator, sameQuoteBinding, type QuoteBinding, type QuoteDomResult } from './application/quote-locator';
import type { JudgmentCitation } from './contracts/judgment';
import type { BrowsingState } from './contracts/browsing';
const quote = 'A unique synthetic quotation, for local tests only.';
const citation: JudgmentCitation = { id: 'citation', title: 'Synthetic', url: 'https://example.com/source', readingId: 'reading', fetchedAt: '2026-11-15', quote, truncated: false };
const initial: QuoteBinding = { ownerId: 'owner', entryId: 'source-entry', documentId: 'doc-epoch', webContentsId: 123, frameToken: 'frame', nativeVisitId: 'visit', url: citation.url };
function deferred<T>() { let resolve!: (result: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup() { let current: QuoteBinding | undefined = { ...initial }; const locator = new QuoteLocator(() => {}); locator.start(citation, initial, 'private-document-token'); return { locator, get: () => current, set: (v: QuoteBinding | undefined) => { current = v; }, id: locator.state()!.id }; }
const provider: BrowsingProvider = { search: async () => [], read: async () => ({ title: 'Synthetic', content: quote }), extract: async () => ({ text: '', truncated: false }), model: async () => ({ text: 'Synthetic only', insufficient: false, citations: [{ source: 1, title: citation.title, url: citation.url, quote }] }) };
async function draft() { const s = new BrowsingSession(provider, () => {}); await s.read(citation.url); s.beginQuestion(); await s.ask('Synthetic?', s.snapshot().question!.id); s.beginJudgment(); return s; }

test('only current host-owned draft evidence or selected saved evidence resolves', async () => {
  const s = await draft(); const before = s.snapshot(); const c = before.judgment!.citations[0];
  assert.equal(before.judgment!.citationIds.length, 0); assert.strictEqual(judgmentCitation(before, c.id), c);
  assert.throws(() => judgmentCitation(before, 'foreign'), /引用/);
  assert.throws(() => judgmentCitation({ ...before, mode: 'page' }, c.id), /引用/);
  assert.throws(() => judgmentCitation({ ...before, pending: { id: 'pending', nodeId: before.entryId, kind: 'judgment' } }, c.id), /引用/);
  s.editJudgment({ draftId: before.judgment!.draftId, revision: 1, text: 'My synthetic decision', checks: '', citationIds: [] });
  s.saveJudgment({ draftId: before.judgment!.draftId, revision: 1 });
  assert.throws(() => judgmentCitation(s.snapshot(), c.id), /引用/);
  const saved = s.snapshot();
  assert.strictEqual(judgmentCitation({ ...saved, judgment: { ...saved.judgment!, citationIds: [c.id] } }, c.id).quote, quote);
});
test('empty/malformed citations and removed judgments cannot initiate navigation', async () => {
  const s = await draft(); const state = s.snapshot(), c = state.judgment!.citations[0];
  for (const patch of [{ quote: '' }, { quote: 'x'.repeat(1001) }, { url: 'file:///private' }, { url: 'https://example.com' }]) {
    assert.throws(() => judgmentCitation({ ...state, judgment: { ...state.judgment!, citations: [{ ...c, ...patch }] } }, c.id));
  }
  s.removeNode(state.entryId); assert.throws(() => judgmentCitation(s.snapshot(), c.id));
});
test('ordinary source navigation preserves exact edited draft and saved-version Back contexts', async () => {
  const s = await draft(); const j = s.snapshot().judgment!, c = j.citations[0];
  s.editJudgment({ draftId: j.draftId, revision: 1, text: 'Synthetic personal note', checks: 'Keep this draft', citationIds: [c.id] });
  const before = s.snapshot(); const resolved = judgmentCitation(before, c.id);
  s.open(resolved.url); assert.equal(s.snapshot().mode, 'page'); s.back();
  assert.equal(s.snapshot().entryId, before.entryId); assert.strictEqual(s.snapshot().judgment, before.judgment);
  s.saveJudgment({ draftId: j.draftId, revision: 1 }); const saved = s.snapshot();
  s.open(judgmentCitation(saved, c.id).url); s.back(); assert.equal(s.snapshot().entryId, saved.entryId); assert.strictEqual(s.snapshot().judgment, saved.judgment);
  assert.equal(JSON.stringify(s.exportTask()).includes('quoteLocator'), false);
});
test('every owner, entry, document, main frame, webcontents, visit, and URL component is required', () => {
  assert.equal(sameQuoteBinding(initial, { ...initial }), true); assert.equal(sameQuoteBinding(undefined, initial), false);
  for (const key of Object.keys(initial) as (keyof QuoteBinding)[]) assert.equal(sameQuoteBinding(initial, { ...initial, [key]: key === 'webContentsId' ? 124 : 'changed' }), false, key);
});
test('opening only creates ready chrome metadata, with no quote or private capability in state', () => {
  const { locator } = setup(); assert.equal(locator.state()!.status, 'ready');
  const serialized = JSON.stringify(locator.state()); assert.ok(!serialized.includes(quote)); assert.ok(!serialized.includes('private-document-token')); assert.ok(!serialized.includes('doc-epoch'));
});
test('explicit locate prepares, rechecks, then applies once', async () => {
  const { locator, get, id } = setup(); let prepared = 0, applied = 0;
  await locator.locate(id, get, async (token, literal) => { prepared++; assert.equal(token, 'private-document-token'); assert.equal(literal, quote); return 'prepared'; }, async () => { applied++; return 'found'; });
  assert.equal(locator.state()!.status, 'found'); assert.equal(prepared, 1); assert.equal(applied, 1);
  await assert.rejects(locator.locate(id, get, async () => 'prepared', async () => 'found'));
});
for (const result of ['ambiguous', 'missing', 'unsupported'] as const) test(`${result} measurement never dispatches scroll`, async () => {
  const { locator, get, id } = setup(); await locator.locate(id, get, async () => result, async () => { assert.fail('effect should not be called'); }); assert.equal(locator.state()!.status, result);
});
test('same-URL changed main document or visit before effect refuses the effect', async () => {
  for (const key of ['documentId', 'nativeVisitId', 'frameToken', 'entryId'] as const) {
    const { locator, get, set, id } = setup(); const wait = deferred<QuoteDomResult>();
    const lookup = locator.locate(id, get, () => wait.promise, async () => { assert.fail('stale effect'); });
    set({ ...initial, [key]: 'different' }); wait.resolve('prepared'); await lookup; assert.equal(locator.state()!.status, 'unsupported');
  }
});
test('switch/reload/dismiss during measurement rejects late result and repeated clicks', async () => {
  for (const action of ['clear', 'dismiss'] as const) {
    const { locator, get, id } = setup(); const wait = deferred<QuoteDomResult>();
    const lookup = locator.locate(id, get, () => wait.promise, async () => { assert.fail('cleared effect'); });
    await assert.rejects(locator.locate(id, get, async () => 'prepared', async () => 'found'));
    if (action === 'clear') locator.clear(); else locator.dismiss(id);
    wait.resolve('prepared'); await lookup; assert.equal(locator.state(), undefined);
  }
});
test('a result changed after effect dispatch is uncertain, never an invented success', async () => {
  const { locator, get, set, id } = setup(); const wait = deferred<QuoteDomResult>(); let sent = false;
  const lookup = locator.locate(id, get, async () => 'prepared', () => { sent = true; return wait.promise; });
  await Promise.resolve(); assert.equal(sent, true); set(undefined); wait.resolve('found'); await lookup; assert.equal(locator.state()!.status, 'uncertain');
});
test('effect exception is uncertain; measurement exception is unsupported; neither retries', async () => {
  for (const during of ['prepare', 'apply']) {
    const { locator, get, id } = setup();
    await locator.locate(id, get, async () => { if (during === 'prepare') throw Error('synthetic'); return 'prepared'; }, async () => { throw Error('synthetic'); });
    assert.equal(locator.state()!.status, during === 'prepare' ? 'unsupported' : 'uncertain');
    await assert.rejects(locator.locate(id, get, async () => 'prepared', async () => 'found'));
  }
});
test('stale/forged/unsupported locator IDs and changed binding never inspect the native document', async () => {
  const { locator, get, set, id } = setup(); const noPrepare = async (): Promise<QuoteDomResult> => { assert.fail('must not inspect'); };
  await assert.rejects(locator.locate('foreign', get, noPrepare, noPrepare)); set({ ...initial, ownerId: 'foreign' });
  await assert.rejects(locator.locate(id, get, noPrepare, noPrepare));
  locator.start(citation, initial, 'token', false); await assert.rejects(locator.locate(locator.state()!.id, get, noPrepare, noPrepare));
});


test('context return captures an exact edited draft or saved version, with presentation and ordinary Back intact', async () => {
  const s = await draft(); const j = s.snapshot().judgment!, c = j.citations[0];
  s.editJudgment({ draftId: j.draftId, revision: 1, text: 'Private synthetic decision', checks: 'Private check', citationIds: [c.id] });
  for (const saved of [false, true]) {
    if (saved) s.saveJudgment({ draftId: j.draftId, revision: 1 });
    const original = s.snapshot();
    s.savePresentation(original.entryId, { ...original.presentation, scrollTop: 240, addressDraft: 'Synthetic local draft' });
    const origin = judgmentQuoteOrigin(s.snapshot(), c.id), expected = s.snapshot();
    s.open(c.url); const page = s.snapshot();
    assert.equal(s.hasJudgmentQuoteOrigin(origin), true);
    const locator = new QuoteLocator(() => {});
    locator.start(c, initial, 'private-token', true, origin);
    assert.strictEqual(locator.returnOrigin(locator.state()!.id, initial), origin);
    assert.equal(locator.state()!.returnLabel, '返回判断');
    const projection = JSON.stringify(locator.state());
    for (const privateValue of [origin.entryId, origin.recordId, 'private-token', c.quote, expected.judgment!.text, expected.judgment!.checks]) assert.equal(projection.includes(privateValue), false);
    assert.equal(s.jump(origin.entryId), true);
    assert.strictEqual(s.snapshot().judgment, expected.judgment); assert.deepEqual(s.snapshot().presentation, expected.presentation);
    assert.equal(s.navigationTarget(1), page.entryId, 'context return leaves the normal Forward branch intact');
    s.forward(); s.back(); assert.equal(s.snapshot().entryId, expected.entryId); assert.strictEqual(s.snapshot().judgment, expected.judgment);
    assert.equal(JSON.stringify(s.exportTask()).includes('returnLabel'), false);
    assert.equal(JSON.stringify(s.exportTask()).includes('quoteOrigin'), false);
  }
});

test('origin checks refuse revisions, removed nodes, foreign entries and unavailable saved references', async () => {
  const s = await draft(), before = s.snapshot(), j = before.judgment!, c = j.citations[0];
  const origin = judgmentQuoteOrigin(before, c.id);
  assert.equal(s.hasJudgmentQuoteOrigin(origin), true);
  for (const patch of [{entryId:'foreign'}, {recordId:'foreign'}, {revision:99}, {citationId:'foreign'}]) assert.equal(s.hasJudgmentQuoteOrigin({...origin,...patch}),false);
  s.editJudgment({draftId:j.draftId,revision:1,text:'Newer revision',checks:'',citationIds:[c.id]});
  assert.equal(s.hasJudgmentQuoteOrigin(origin),false);
  const revised = judgmentQuoteOrigin(s.snapshot(), c.id); s.removeNode(before.entryId); assert.equal(s.hasJudgmentQuoteOrigin(revised),false);
});

test('context return requires the full existing visit binding and disappears on any invalidation', () => {
  const origin = { entryId:'judgment-origin',recordId:'exact-version',revision:3,citationId:citation.id };
  const locator = new QuoteLocator(() => {}); locator.start(citation,initial,'private-token',true,origin);
  const id = locator.state()!.id;
  assert.throws(()=>locator.returnOrigin('foreign',initial)); assert.throws(()=>locator.returnOrigin(id,undefined));
  for(const key of Object.keys(initial) as (keyof QuoteBinding)[]) assert.throws(()=>locator.returnOrigin(id,{...initial,[key]:key==='webContentsId'?999:'changed'}),key);
  locator.dismiss(id); assert.throws(()=>locator.returnOrigin(id,initial));
  locator.start(citation,initial,'new-token'); assert.throws(()=>locator.returnOrigin(locator.state()!.id,initial),'ordinary website opens have no return origin');
});
