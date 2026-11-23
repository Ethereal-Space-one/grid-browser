// Build first. Exercise the production host without a native Electron window.
// Only the Electron import is stubbed; page/session behavior stays production code.
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const load = Module._load;
let BrowserTab;
try {
  Module._load = function (name, ...args) {
    return name === 'electron' ? {} : load.call(this, name, ...args);
  };
  ({ BrowserTab } = require('../dist/browser/window-registry.js'));
} finally { Module._load = load; }

const hit = { title: 'Synthetic result', url: 'https://example.com/', snippet: 'Synthetic', site: 'example.com', date: null };
const provider = { search: async () => [hit], read: async () => ({ title: 'Synthetic', content: 'Synthetic source' }), extract: async () => ({ text: 'Synthetic', truncated: false }) };

test('Home reload leaves the pending search and its completion intact; explicit Stop still cancels', async () => {
  let signal, finish;
  const tab = new BrowserTab({ refresh() {} }, { ...provider,
    search: (_request, currentSignal) => { signal = currentSignal; return new Promise(resolve => { finish = resolve; }); }
  });
  const pending = tab.browsing.search('Synthetic Home query', 'learning', false);
  const before = tab.browsing.snapshot();
  assert.equal(before.mode, 'home');
  assert.equal(before.pending.kind, 'search');
  await tab.reload(); await tab.reload();
  assert.equal(signal.aborted, false);
  assert.strictEqual(tab.browsing.snapshot(), before, 'reload is a true non-page no-op');
  finish([hit]);
  assert.equal((await pending).query, 'Synthetic Home query');
  assert.equal(tab.browsing.snapshot().mode, 'results');
  const stopped = tab.browsing.search('Synthetic stopped query', 'learning', false);
  const stoppedNode = tab.browsing.snapshot().entryId;
  tab.browsing.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(await stopped, undefined);
  finish([hit]); await Promise.resolve();
  assert.equal(tab.browsing.snapshot().search.query, 'Synthetic Home query');
  assert.equal(tab.browsing.snapshot().path.nodes.find(node => node.id === stoppedNode).status, 'cancelled');
});

for (const mode of ['home', 'results', 'reading', 'question', 'comparison', 'judgment']) {
  test(`${mode} reload does not cancel requests or inspect a retained native page`, async () => {
    const unchanged = { mode, pending: { id: 'pending', kind: 'search' } };
    const noOp = {
      browsing: { snapshot: () => unchanged, cancel() { assert.fail('non-page reload cancelled browsing'); } },
      position() { assert.fail('non-page reload inspected native history'); }
    };
    await BrowserTab.prototype.reload.call(noOp);
  });
}

for (const method of ['GET', 'HEAD', 'OTHER', 'UNKNOWN', undefined]) {
  test(`page reload preserves ${method ?? 'missing visit'} handling`, async () => {
    let cancelled = 0, reloaded = 0, begun = 0, aborted = 0, invalidated = 0, refreshed = 0;
    const state = { mode: 'page', value: 'https://example.com/', entryId: 'page', nativeVisitId: 'visit' };
    const visit = method && { id: 'visit', method, index: 0, nodeId: state.entryId, url: state.value };
    const page = {
      browsing: { snapshot: () => state, cancel() { cancelled++; } },
      position: () => ({ index: 0, url: state.value, length: 1 }),
      visits: { resolve: () => visit },
      begin(kind, url, selected) { assert.equal(kind, 'reload'); assert.equal(url, state.value); assert.strictEqual(selected, visit); begun++; return { done: Promise.resolve() }; },
      view: { webContents: { reload() { reloaded++; } } },
      abortOperation() { aborted++; }, invalidateDocument() { invalidated++; },
      message: kind => ({ kind }), host: { refresh() { refreshed++; } }
    };
    await BrowserTab.prototype.reload.call(page);
    assert.equal(cancelled, 1, 'page reload retains cancellation of page-owned work');
    const safe = method === 'GET' || method === 'HEAD';
    assert.equal(reloaded, Number(safe)); assert.equal(begun, Number(safe));
    assert.equal(aborted, Number(!safe)); assert.equal(invalidated, Number(!safe)); assert.equal(refreshed, Number(!safe));
    if (!safe) assert.equal(page.recovery.kind, visit ? 'submission' : 'history-lost');
  });
}

test('reload after Home continuation never reloads a different retained visit, even at the same URL', async () => {
  const host = { refresh() {}, registry: { bridge: () => undefined }, tabs: { active: () => tab } };
  const tab = new BrowserTab(host, provider); const url = 'https://example.invalid/repeat';
  const s = tab.browsing;
  const first = {index:0, length:1, url}, second = {index:1, length:2, url};
  s.open(url); const a = s.snapshot().entryId;
  s.navigated(url, first.index, true, tab.visits.record(first, a, 'GET').id);
  s.home(); const home = s.snapshot().entryId;
  s.jump(a); s.open(url); const b = s.snapshot().entryId;
  s.navigated(url, second.index, true, tab.visits.record(second, b, 'GET').id);
  tab.position = () => second;
  tab.view = {webContents:{isDestroyed:()=>false,isLoadingMainFrame:()=>false,reload(){ assert.fail('reloaded the other native visit'); }}};
  s.jump(home); tab.resumeStoredNode(a); assert.equal(tab.recovery.kind,'history-lost');
  await tab.reload(); assert.equal(tab.recovery.kind,'history-lost'); assert.equal(tab.recovery.nodeId,a);
  assert.equal(s.snapshot().entryId,a); assert.equal(s.snapshot().path.nodes.length,4);
});

test('a redirect records the final page; a changed destination on explicit reopen keeps the old evidence on Back', async () => {
  const start = 'https://example.invalid/start', first = 'https://example.invalid/one', next = 'https://example.invalid/two';
  const requests = [], reads = [];
  const sources = {...provider, read:async url=>{reads.push(url);return {title:'Source one',content:'Only page one says this.'};},
    model:async()=>({text:'Only page one says this.',insufficient:false,citations:[]})};
  function fixture(destination, restored) {
    const host = {refresh(){},registry:{bridge:()=>undefined,changed(){}},tabs:{active:()=>tab}};
    const tab = new BrowserTab(host, sources, true, restored);
    let liveUrl = '';
    tab.view = {webContents:{isDestroyed:()=>false,isLoadingMainFrame:()=>false,getURL:()=>liveUrl,getTitle:()=>'Synthetic page',
      navigationHistory:{getActiveIndex:()=>0,length:()=>1},loadURL:async url=>{
        requests.push(url); liveUrl=destination; tab.committed(false); tab.finished();
      }}};
    return tab;
  }
  const original = fixture(first); await original.open(start);
  const page = original.browsing.snapshot(); const node = page.path.nodes.find(n => n.id === page.entryId);
  assert.equal(node.target,first); assert.equal(page.path.nodes.length,2);
  await original.browsing.summarizePage();
  const old = original.browsing.snapshot(); assert.equal(old.summary.pageSource.url,first);
  const resumed = fixture(next, original.browsing.exportTask()); const receipt = resumed.recovery;
  await resumed.reopen(old.entryId,receipt.id);
  const current = resumed.browsing.snapshot(); assert.equal(current.value,next); assert.notEqual(current.entryId,old.entryId);
  assert.equal(current.summary,undefined); assert.equal(current.path.nodes.length,3);
  await resumed.traverse(-1); const prior = resumed.browsing.snapshot();
  assert.equal(prior.entryId,old.entryId); assert.equal(prior.value,first); assert.equal(prior.summary.id,old.summary.id);
  assert.equal(resumed.recovery.kind,'history-lost');
  await resumed.traverse(1); assert.equal(resumed.browsing.snapshot().entryId,current.entryId); assert.equal(resumed.recovery,undefined);
  assert.deepEqual(requests,[start,first]); assert.deepEqual(reads,[first]);
});

test('return to a failed reading does not move native history to its retained parent document', async () => {
  const host={refresh(){},registry:{bridge:()=>undefined,changed(){}},tabs:{active:()=>tab}};
  const tab=new BrowserTab(host,{...provider,read:async()=>{throw Error('synthetic unavailable');}});
  const s=tab.browsing, a='https://example.invalid/a', b='https://example.invalid/b';
  const first={url:a,index:0,length:1}, second={url:b,index:1,length:2};
  s.open(a); s.navigated(a,0,true,tab.visits.record(first,s.snapshot().entryId,'GET').id);
  await assert.rejects(s.read(a)); const failed=s.snapshot().entryId;
  s.open(b); s.navigated(b,1,true,tab.visits.record(second,s.snapshot().entryId,'GET').id);
  tab.position=()=>second;
  let traversals=0;
  tab.view={webContents:{isDestroyed:()=>false,isLoadingMainFrame:()=>false,navigationHistory:{
    goToIndex(){traversals++;throw Error('unexpected native traversal');}
  }}};
  await tab.jump(failed);
  assert.equal(traversals,0); assert.equal(tab.recovery.kind,'history-lost'); assert.equal(tab.recovery.nodeId,failed);
});
