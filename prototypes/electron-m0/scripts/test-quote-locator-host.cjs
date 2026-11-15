// Production host methods, with only the Electron import/native transport stubbed.
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const test = require('node:test');
const load = Module._load; let BrowserTab;
try { Module._load = function (name, ...args) { return name === 'electron' ? {} : load.call(this, name, ...args); }; ({ BrowserTab } = require('../dist/browser/window-registry.js')); }
finally { Module._load = load; }
const { QuoteLocator } = require('../dist/application/quote-locator.js');
const quote = 'Unique host-only synthetic quote for race regression.';
const citation = { id: 'citation', title: 'Synthetic', quote, url: 'https://example.com/source', readingId: 'reading', fetchedAt: '2026-11-15', truncated: false };
const binding = { ownerId: 'owner', entryId: 'source', documentId: 'window-owner-epoch', webContentsId: 1, frameToken: 'frame', nativeVisitId: 'visit', url: citation.url };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
function context() {
  const cleared = [];
  const web = { isDestroyed: () => false, isLoadingMainFrame: () => false, executeJavaScriptInIsolatedWorld: async (_world, scripts) => { cleared.push(scripts[0].code); return 'unsupported'; } };
  const target = { quoteLocator: new QuoteLocator(() => {}), quoteBinding: () => binding, clearQuoteToken: BrowserTab.prototype.clearQuoteToken, quoteToken: { token: 'original', web } };
  target.quoteLocator.start(citation, binding, 'original');
  return { target, web, cleared, id: target.quoteLocator.state().id };
}
test('duplicate/stale locate calls cannot revoke the current in-flight token', async () => {
  const { target, id, cleared } = context(); const pending = deferred(); let applies = 0;
  target.quoteCommand = command => command.kind === 'prepare' ? pending.promise : (applies++, Promise.resolve('found'));
  const first = BrowserTab.prototype.locateQuote.call(target, id);
  await assert.rejects(BrowserTab.prototype.locateQuote.call(target, id));
  await assert.rejects(BrowserTab.prototype.locateQuote.call(target, 'foreign'));
  assert.equal(target.quoteToken.token, 'original'); assert.equal(cleared.length, 0);
  pending.resolve('prepared'); await first; assert.equal(applies, 1); assert.equal(target.quoteLocator.state().status, 'found'); assert.equal(cleared.length, 1);
});
test('late old locate cleanup cannot clear a newer locator token/state', async () => {
  const { target, id, web, cleared } = context(); const pending = deferred();
  target.quoteCommand = command => command.kind === 'prepare' ? pending.promise : assert.fail('old effect must not run');
  const old = BrowserTab.prototype.locateQuote.call(target, id);
  target.quoteLocator.clear(); target.quoteToken = { token: 'newer', web };
  target.quoteLocator.start(citation, { ...binding, entryId: 'newer-source' }, 'newer'); const latest = target.quoteLocator.state();
  pending.resolve('prepared'); await old;
  assert.strictEqual(target.quoteLocator.state(), latest); assert.equal(target.quoteToken.token, 'newer'); assert.equal(cleared.length, 0);
});
function openingContext(redirected = false) {
  const { target, web, cleared } = context(); target.quoteLocator.clear(); target.quoteToken = undefined;
  let state = { ownerId: binding.ownerId, entryId: 'judgment', mode: 'judgment', path: {}, judgment: { status: 'draft', citations: [citation], citationIds: [] } };
  target.browsing = { snapshot: () => state }; target.view = { webContents: web }; target.waitQuoteIdle = BrowserTab.prototype.waitQuoteIdle;
  target.open = async url => { assert.equal(url, citation.url); state = { ...state, mode: 'page', entryId: 'source' }; target.operation = { redirected }; };
  return { target, web, cleared };
}
test('first source open only arms the exact document and never sends a quote or runs lookup', async () => {
  const { target } = openingContext(); const commands = [];
  target.quoteCommand = async command => { commands.push(command); return 'prepared'; };
  await BrowserTab.prototype.openJudgmentCitation.call(target, citation.id);
  assert.equal(target.quoteLocator.state().status, 'ready'); assert.equal(commands.length, 1); assert.equal(commands[0].kind, 'arm'); assert.equal('quote' in commands[0], false);
});
test('any redirect, even exact original final URL, refuses locating and never arms', async () => {
  const { target } = openingContext(true);
  target.quoteCommand = async () => assert.fail('redirect must not arm');
  await BrowserTab.prototype.openJudgmentCitation.call(target, citation.id);
  assert.equal(target.quoteLocator.state().status, 'unsupported'); assert.equal(target.quoteToken, undefined);
});
test('blur/switch during asynchronous arm cannot resurrect ready on return to same URL/document', async () => {
  const { target, cleared } = openingContext(); const pending = deferred(); target.quoteCommand = () => pending.promise;
  const open = BrowserTab.prototype.openJudgmentCitation.call(target, citation.id); await Promise.resolve(); await Promise.resolve();
  target.quoteOpening = undefined; target.quoteLocator.clear(); target.clearQuoteToken();
  pending.resolve('prepared'); await open; assert.equal(target.quoteLocator.state(), undefined); assert.equal(cleared.length, 1);
});
test('late old arm cleanup cannot revoke a new document token', async () => {
  const { target, web, cleared } = openingContext(); const pending = deferred(); target.quoteCommand = () => pending.promise;
  const old = BrowserTab.prototype.openJudgmentCitation.call(target, citation.id); await Promise.resolve(); await Promise.resolve();
  target.quoteOpening = {}; target.quoteToken = { token: 'newer', web };
  target.quoteLocator.start(citation, binding, 'newer'); const newest = target.quoteLocator.state();
  pending.resolve('prepared'); await old;
  assert.equal(target.quoteToken.token, 'newer'); assert.strictEqual(target.quoteLocator.state(), newest); assert.equal(cleared.length, 0);
});

test('load completion waits for stop-loading without weakening loading identity, and cancels stale openings', async () => {
  for (const changed of [false, true]) {
    const web = new EventEmitter(); let loading = true;
    web.isDestroyed = () => false; web.isLoadingMainFrame = () => loading;
    const opening = {}; const target = { quoteOpening: opening, view: { webContents: web }, browsing: { snapshot: () => ({ entryId: 'source' }) } };
    const wait = BrowserTab.prototype.waitQuoteIdle.call(target, opening, 'source');
    assert.equal(web.listenerCount('did-stop-loading'), 1);
    if (changed) target.quoteOpening = undefined;
    loading = false; web.emit('did-stop-loading');
    assert.equal(await wait, !changed); assert.equal(web.listenerCount('did-stop-loading'), 0); assert.equal(web.listenerCount('destroyed'), 0);
  }
});
