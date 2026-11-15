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
    const state = { mode: 'page', value: 'https://example.com/', nativeVisitId: 'visit' };
    const visit = method && { id: 'visit', method };
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
