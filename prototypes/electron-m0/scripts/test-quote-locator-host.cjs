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


test('context return uses only the host-owned exact origin and consumes the old lease', async () => {
  const { target, id } = context();
  const origin = {entryId:'exact-judgment-entry',recordId:'exact-saved-version',revision:3,citationId:citation.id};
  target.quoteLocator.start(citation,binding,'token',true,origin); const currentId=target.quoteLocator.state().id;
  const jumps=[]; target.browsing={hasJudgmentQuoteOrigin:expected=>{assert.strictEqual(expected,origin);return true;}};
  target.jump=async entry=>{jumps.push(entry);target.quoteLocator.clear();};
  await assert.rejects(BrowserTab.prototype.returnQuote.call(target,id));
  await BrowserTab.prototype.returnQuote.call(target,currentId);
  assert.deepEqual(jumps,[origin.entryId]); await assert.rejects(BrowserTab.prototype.returnQuote.call(target,currentId));
});

test('context return refuses stale visits and unavailable origin versions without falling back or opening anything', async () => {
  for(const stale of ['binding','origin']){
    const {target}=context(); const origin={entryId:'origin',recordId:'version',revision:0,citationId:citation.id};
    target.quoteLocator.start(citation,binding,'token',true,origin); const id=target.quoteLocator.state().id;
    target.browsing={hasJudgmentQuoteOrigin:()=>stale!=='origin'};
    if(stale==='binding')target.quoteBinding=()=>({...binding,nativeVisitId:'same-url-different-visit'});
    target.jump=()=>assert.fail('stale return must not navigate');
    assert.equal(BrowserTab.prototype.quoteState.call(target).returnLabel,undefined);
    await assert.rejects(BrowserTab.prototype.returnQuote.call(target,id));
  }
});

test('returning during a locate invalidates the lease before a late prepare can dispatch a scroll', async () => {
  const {target}=context(); const origin={entryId:'origin',recordId:'version',revision:0,citationId:citation.id};
  target.quoteLocator.start(citation,binding,'token',true,origin); const id=target.quoteLocator.state().id;
  const wait=deferred();target.quoteCommand=command=>command.kind==='prepare'?wait.promise:assert.fail('return cancelled the effect');
  target.browsing={hasJudgmentQuoteOrigin:()=>true};target.jump=async()=>target.quoteLocator.clear();
  const locating=BrowserTab.prototype.locateQuote.call(target,id);
  await BrowserTab.prototype.returnQuote.call(target,id);wait.resolve('prepared');await locating;
  assert.equal(target.quoteLocator.state(),undefined);
});


test('production host return restores the exact draft/saved object and reading position without any native or provider call', async () => {
  const {judgmentQuoteOrigin}=require('../dist/application/quote-locator.js');
  const requests=[];let tab;
  const host={refresh(){},tabs:{active:()=>tab},registry:{target:undefined,bridge:()=>undefined,changed(){}}};
  tab=new BrowserTab(host,{
    search:async()=>assert.fail('unexpected search'),
    read:async()=>{requests.push('read');return {title:citation.title,content:quote};},
    extract:async()=>assert.fail('unexpected extraction'),
    model:async()=>{requests.push('model');return {text:'Synthetic only',insufficient:false,citations:[{source:1,title:citation.title,url:citation.url,quote}]};}
  });
  await tab.browsing.read(citation.url);tab.browsing.beginQuestion();await tab.browsing.ask('Synthetic?',tab.browsing.snapshot().question.id);tab.browsing.beginJudgment();
  let j=tab.browsing.snapshot().judgment;const c=j.citations[0];
  tab.browsing.editJudgment({draftId:j.draftId,revision:1,text:'Synthetic private judgment',checks:'Synthetic private checks',citationIds:[c.id]});
  for(const saved of [false,true]){
    if(saved)tab.browsing.saveJudgment({draftId:j.draftId,revision:1});
    const before=tab.browsing.snapshot();tab.browsing.savePresentation(before.entryId,{...before.presentation,scrollTop:333});
    const original=tab.browsing.snapshot(),origin=judgmentQuoteOrigin(original,c.id);
    tab.browsing.open(c.url);const source=tab.browsing.snapshot();
    tab.quoteBinding=()=>({...binding,ownerId:source.ownerId,entryId:source.entryId});
    tab.quoteLocator.start(c,tab.quoteBinding(),'synthetic-token',true,origin);
    const id=tab.quoteLocator.state().id;assert.equal(tab.quoteState().returnLabel,'返回判断');
    tab.ensureView=()=>assert.fail('return must never create or load native content');
    await tab.returnQuote(id);
    const after=tab.browsing.snapshot();assert.equal(after.entryId,original.entryId);assert.strictEqual(after.judgment,original.judgment);assert.deepEqual(after.presentation,original.presentation);
    assert.equal(tab.recovery,undefined);assert.equal(tab.quoteState(),undefined);assert.equal(tab.browsing.navigationTarget(1),source.entryId);
    await assert.rejects(tab.returnQuote(id));
  }
  assert.deepEqual(requests,['read','model']);
});
