import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import { TabRegistry, TAB_LIMIT } from './application/tab-registry';
import { HISTORY_LIMIT, HISTORY_TEXT_BUDGET, NavigationStore } from './application/navigation-store';

const provider: BrowsingProvider = {
  search: async () => [{ title: 'Result', url: 'https://example.com/', snippet: '', site: 'example.com', date: null }],
  read: async () => ({ title: 'Reading', content: 'Source' }), extract: async () => ({ text: 'Extract', truncated: false })
};
const presentation = { scrollTop: 420, addressDraft: null, homeQuery: 'draft', contextual: false };

test('back/forward restores query, reading identity and position without new service calls', async () => {
  let calls = 0;
  const session = new BrowsingSession({ ...provider, read: async () => { calls++; return { title: 'Reading', content: 'Source' }; } }, () => {});
  await session.search('Question A', 'learning', true);
  const results = session.snapshot(); session.savePresentation(results.entryId, presentation);
  const reading = (await session.read('https://example.com/'))!;
  session.savePresentation(session.snapshot().entryId, { ...presentation, scrollTop: 700 });
  session.back(); assert.equal(session.snapshot().search?.query, 'Question A');
  assert.equal(session.snapshot().mode, 'results'); assert.equal(session.snapshot().presentation.scrollTop, 420);
  assert.equal(session.savePresentation('old-entry-id', presentation), false);
  session.forward(); assert.equal(session.snapshot().reading?.id, reading.id);
  assert.equal(session.snapshot().presentation.scrollTop, 700); assert.equal(calls, 1);
  session.back(); await session.search('Question B', 'living', false);
  assert.equal(session.snapshot().canGoForward, false);
});

test('native page entries interleave with results and reading; restoration does not create duplicates', async () => {
  const session = new BrowsingSession(provider, () => {});
  await session.search('Question', 'professional', false);
  await session.read('https://example.com/article');
  const reading = session.snapshot().entryId;
  session.open('https://example.com/a'); session.navigated('https://example.com/a', 0, true);
  session.navigated('https://example.com/b', 1);
  session.back(); assert.equal(session.snapshot().value, 'https://example.com/a');
  session.navigated('https://example.com/a', 0, true);
  session.back(); assert.equal(session.snapshot().entryId, reading);
  session.forward(); assert.equal(session.snapshot().nativeIndex, 0);
  session.forward(); assert.equal(session.snapshot().value, 'https://example.com/b');
  session.results(); assert.equal(session.snapshot().mode, 'results');
  session.forward(); assert.equal(session.snapshot().entryId, reading);
});

test('branch navigation preserves old futures, selected forward routes and immutable snapshots', () => {
  const store = new NavigationStore();
  const root = store.current().id;
  const b = store.visit({ mode: 'page', value: 'https://example.com/b', scene: 'learning' });
  const c = store.visit({ mode: 'page', value: 'https://example.com/same', scene: 'living' });
  const saved = store.snapshot();
  store.move(-1);
  const d = store.visit({ mode: 'page', value: 'https://example.com/same', scene: 'entertainment' });
  assert.notEqual(c, d, 'same URL does not mean same visited document');
  assert.equal(store.get(c)?.content.scene, 'living');
  assert.deepEqual(store.snapshot().nodes.find(n => n.id === b)?.childIds, [c, d]);
  store.move(-1); store.move(1); assert.equal(store.current().id, d);
  store.jump(c); store.move(-1); store.move(1); assert.equal(store.current().id, c);
  assert.equal(store.snapshot().nodes.length, 4);
  assert.equal(saved.nodes.find(n => n.id === b)?.selectedChildId, c, 'prior snapshots do not mutate');
  assert.equal(store.jump('foreign-node'), false);
  store.jump(root); assert.equal(store.canBack(), false);
  assert.equal(store.current().content.searchContext, undefined);
  assert.ok(Object.isFrozen(store.snapshot().nodes[0].childIds));
});

test('node capacity keeps recorded branches and exposes a bounded unrecorded continuation', () => {
  const store = new NavigationStore();
  const root = store.current().id;
  const recorded = [];
  for (let n = 0; n < HISTORY_LIMIT - 1; n++) recorded.push(store.visit({ mode: 'page', value: `https://example.com/${n}` }));
  const oldest = recorded[0];
  const temporary = store.visit({ mode: 'page', value: 'https://example.com/temporary' });
  store.visit({ mode: 'page', value: 'https://example.com/latest' });
  const path = store.snapshot();
  assert.equal(path.nodes.length, HISTORY_LIMIT + 1);
  assert.equal(path.nodes.filter(n => n.recorded).length, HISTORY_LIMIT);
  assert.ok(path.notice?.includes('上限'));
  assert.equal(store.get(temporary), undefined, 'only the explicitly unrecorded continuation can be replaced');
  assert.ok(store.get(root)); assert.ok(store.get(oldest));
  store.move(-1); assert.equal(store.current().id, recorded.at(-1));
  store.move(1); assert.equal(store.current().content.value, 'https://example.com/latest');
});

test('content eviction keeps tree, scene and position; shared payloads consume one cache slot', () => {
  const reading = { id: 'shared', title: 'Source', url: 'https://example.com/', content: 'x'.repeat(600), fetchedAt: '' };
  const shared = new NavigationStore({ textBudget: 1200 });
  for (let n = 0; n < 10; n++) shared.visit({ mode: 'reading', value: reading.url, reading });
  assert.equal(shared.snapshot().nodes.length, 11);
  assert.ok(shared.snapshot().nodes.every(n => n.missingContent.length === 0));
  reading.content = 'mutated caller object';
  assert.equal(shared.current().content.reading?.content, 'x'.repeat(600));
  const bounded = new NavigationStore({ textBudget: 1200 });
  const first = bounded.visit({ mode: 'reading', value: reading.url, scene: 'learning', reading: { ...reading, id: 'first', content: 'a'.repeat(600) } });
  bounded.save(first, presentation);
  for (let n = 0; n < 5; n++) bounded.visit({ mode: 'reading', value: reading.url, reading: { ...reading, id: String(n), content: 'b'.repeat(600) } });
  bounded.jump(first);
  assert.equal(bounded.current().content.reading, undefined);
  assert.equal(bounded.current().content.scene, 'learning');
  assert.equal(bounded.current().presentation.scrollTop, 420);
  assert.deepEqual(bounded.snapshot().nodes.find(n => n.id === first)?.missingContent, ['reading']);
  assert.ok(bounded.snapshot().notice?.includes('释放'));
  assert.equal(bounded.snapshot().nodes.length, 7);
  const oversized = new NavigationStore({ textBudget: 0 });
  oversized.visit({ mode: 'reading', value: reading.url, reading });
  assert.deepEqual(oversized.snapshot().nodes.at(-1)?.missingContent, ['reading']);
  assert.equal(HISTORY_TEXT_BUDGET, 8 * 1024 * 1024);
});

test('tabs dispose only the closed resource; background close leaves the active target alone', () => {
  let next = 0; const events: string[] = [];
  const registry = new TabRegistry(() => {
    const id = String(++next); return { id, deactivate: () => events.push('deactivate:' + id), dispose: () => events.push('dispose:' + id) };
  }, () => {});
  const a = registry.open(); const b = registry.open(); events.length = 0;
  registry.close(a.id); assert.deepEqual(events, ['dispose:' + a.id]); assert.equal(registry.active(), b);
  assert.throws(() => registry.select(a.id), /关闭/);
  while (registry.all().length < TAB_LIMIT) registry.open();
  assert.throws(() => registry.open(), /最多/);
  registry.dispose(); assert.equal(registry.active(), undefined); assert.equal(registry.all().length, 0);
});

test('background completion stays with its tab and closing a tab aborts its pending request', async () => {
  let finish!: (value: Awaited<ReturnType<BrowsingProvider['read']>>) => void;
  let signal!: AbortSignal;
  const a = new BrowsingSession({ ...provider, read: (_url, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); } }, () => {});
  const b = new BrowsingSession(provider, () => {});
  const pending = a.read('https://example.com/a');
  await b.search('B', 'living', false);
  a.dispose(); assert.equal(signal.aborted, true); assert.equal(await pending, undefined);
  finish({ title: 'Late A', content: 'A' }); await Promise.resolve();
  assert.equal(b.snapshot().search?.query, 'B'); assert.equal(b.snapshot().reading, undefined);
});

test('companion stays with the actual source visit, not an older page above a new search', async () => {
  const s = new BrowsingSession(provider, () => {});
  const a = 'https://example.invalid/a', b = 'https://example.invalid/b';
  s.open(a); s.navigated(a, 0, true, 'visit-a'); const page = s.snapshot().entryId;
  await s.read(a); assert.equal(s.pageAncestor()?.id, page);
  s.beginQuestion(); assert.equal(s.pageAncestor()?.id, page);
  s.jump(page); await s.search('New research', 'learning', false); await s.read(b);
  assert.equal(s.pageAncestor(), undefined);
  s.beginQuestion(); assert.equal(s.pageAncestor(), undefined);
  s.jump(page); await s.search('Another search result for A', 'professional', false); await s.read(a);
  assert.equal(s.pageAncestor(), undefined, 'matching URLs do not bridge independent searches');
  s.jump(page); await s.read(b); assert.equal(s.pageAncestor(), undefined, 'explicitly reading source B is not a panel for A');
  s.jump(page); s.open(a); s.beginQuestion();
  assert.equal(s.pageAncestor(), undefined, 'a second page without a live visit must not fall back to the first visit');
});

test('comparison and judgment companions require the source selection’s exact page visit', async () => {
  const a = 'https://example.com/', b = 'https://example.invalid/second';
  const s = new BrowsingSession({...provider, compare:async () => ({overview:'Synthetic',rows:[],limitations:''})}, () => {});
  s.open(a); s.navigated(a,0,true,'visit-a1'); const a1=s.snapshot().entryId;
  const readingA=(await s.read(a))!; s.chooseComparison({kind:'reading',readingId:readingA.id});
  s.open(b); s.navigated(b,1,true,'visit-b1'); const b1=s.snapshot().entryId;
  const readingB=(await s.read(b))!; s.chooseComparison({kind:'reading',readingId:readingB.id});
  await s.startComparison(); assert.equal(s.pageAncestor()?.id,b1);
  s.beginJudgment(); assert.equal(s.pageAncestor()?.id,b1);
  s.open(a); s.navigated(a,2,true,'visit-a2'); await s.startComparison();
  assert.equal(s.pageAncestor(),undefined,'A2 is not selected A1 even when the addresses match');
  s.jump(a1); await s.startComparison(); assert.equal(s.pageAncestor()?.id,a1);
  const [selectedA] = s.snapshot().comparisonSelection; s.removeComparison(selectedA.id);
  const results=(await s.search('Result-only source', 'learning', false))!; s.chooseComparison({kind:'result',searchId:results.id,index:0});
  s.open(a); s.navigated(a,3,true,'visit-a3'); await s.startComparison();
  assert.equal(s.pageAncestor(),undefined,'selecting a result did not select a live visit');
});
