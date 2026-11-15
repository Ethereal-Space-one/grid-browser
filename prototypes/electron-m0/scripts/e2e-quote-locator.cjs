/*
 * Deterministic real-Electron quote-locator regression.
 * Run from an interactive X desktop, not ELECTRON_RUN_AS_NODE:
 * npm run test:e2e:quotes
 *
 * Tests production built UI/preload/IPC/BrowserTab and native WebContentsView.
 * All provider calls are synthetic. HTTPS fixture is fulfilled in-process by
 * Electron's session protocol handler; there is no external HTTP, model or MCP.
 * Reports and screenshots remain in GRID_QA_OUT (default .local/quote-locator).
 */
'use strict';
const { app, BrowserWindow, session, nativeTheme, webContents } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');

const target = process.env.GRID_QA_APP || path.resolve(__dirname, '..');
if (!target || !path.isAbsolute(target) || !fs.existsSync(path.join(target, 'dist/main.js'))) {
  throw new Error('GRID_QA_APP must be an absolute built prototype directory containing dist/main.js');
}
const output = path.resolve(process.env.GRID_QA_OUT || path.join(__dirname, '../.local/quote-locator'));
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-quote-qa-'));
app.setPath('userData', path.join(temporary, 'profile'));
process.env.DEEPSEEK_API_KEY = 'synthetic-local-qa-key';
delete process.env.DeepSeek_ApiKeyN;
delete process.env.GRID_UI;
const ORIGIN = 'https://grid-quote-qa.invalid';
const QUOTE = 'The blue lighthouse keeps one quiet ledger for every returning vessel.';
const BODY = `Synthetic archived paragraph.\n${QUOTE}\nArchived source ends here.`;
const AUTHORED = 'Synthetic QA judgment. Keep the original quotation and selected source unchanged.';
const CHECKS = 'Verify the current original, without sending this private text to the provider.';
const report = [];
const providerCalls = [];
const networkRequests = [];
const holds = new Map();
const redirectCount = new Map();
let win;
let stage = 'startup';
let deadline;
let observedHost;
const browserEvents = [];
const started = new Date().toISOString();

// Never start the unrelated MCP socket or expose a bridge connection file.
const bridgeFile = require.resolve(path.join(target, 'dist/local-bridge.js'));
const bridgeModule = new Module(bridgeFile);
bridgeModule.filename = bridgeFile;
bridgeModule.loaded = true;
bridgeModule.exports = { LocalBridge: class DisabledQaBridge {
  async start() {} close() {} revoke() {} authorized() { return false; }
  state() { return { connections: [], receiptCount: 0 }; }
  exportReceipts() { return JSON.stringify({ receipts: [] }); }
  grant() { throw new Error('MCP is intentionally disabled in quote QA'); }
} };
require.cache[bridgeFile] = bridgeModule;
// Read-only instrumentation: retain the production host instance for bounded,
// synthetic-only timeout diagnostics. No implementation or state is replaced.
const hostExports = require(path.join(target, 'dist/browser/window-registry.js'));
const originalHostState = hostExports.WindowHost.prototype.state;
hostExports.WindowHost.prototype.state = function(...args) { observedHost = this; return originalHostState.apply(this, args); };
app.on('web-contents-created', (_event, web) => {
  const event = (name, extra = {}) => {
    const url = web.isDestroyed() ? '[destroyed]' : web.getURL();
    if (url.startsWith(ORIGIN) || name === 'did-fail-load') {
      browserEvents.push({ stage, name, id: web.id, url, ...extra });
      if (browserEvents.length > 60) browserEvents.shift();
    }
  };
  web.on('did-start-navigation', details => { if (details.isMainFrame) event('did-start-navigation', { next: details.url }); });
  web.on('did-finish-load', () => event('did-finish-load'));
  web.on('did-stop-loading', () => event('did-stop-loading'));
  web.on('will-redirect', details => { if (details.isMainFrame) event('will-redirect', { next: details.url }); });
  web.on('did-fail-load', (_e, code, description, url, mainFrame) => { if (mainFrame) event('did-fail-load', { code, description, failedUrl: url }); });
  web.on('focus', () => event('focus'));
  web.on('blur', () => event('blur'));
});

const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (input, options = {}) => {
  const url = String(input);
  const body = JSON.parse(options.body || '{}');
  providerCalls.push({ url, body });
  if (url === 'https://api.deepseek.com/v1/tools/search') {
    return json({ results: [0, 1].map(i => ({ title: 'Synthetic quote source ' + i, url: ORIGIN + ['/unique', '/comparison-second'][i], snippet: BODY })) });
  }
  if (url === 'https://api.deepseek.com/v1/tools/fetch') {
    assert.ok(body.url.startsWith(ORIGIN + '/'), 'Only synthetic fixture URLs may reach synthetic Fetch');
    return json({ title: 'Synthetic quote source · ' + new URL(body.url).pathname, content: BODY });
  }
  assert.equal(url, 'https://api.deepseek.com/chat/completions', 'Unexpected main-process fetch');
  const inputData = JSON.parse(body.messages[1].content);
  if (inputData.left) {
    assert.ok(inputData.left.text.includes(QUOTE) && inputData.right.text.includes(QUOTE));
    const side = { status: 'supported', text: 'Archived synthetic source supports the quotation.', quotes: [QUOTE] };
    return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ overview: 'Synthetic source comparison.', limitations: 'Archived only; not checked against current originals.', rows: [{ aspect: 'Exact quotation', relation: 'agreement', left: side, right: side }] }) } }] });
  }
  assert.ok(inputData.sources?.[0]?.text.includes(QUOTE));
  return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    text: 'Synthetic answer grounded in an archived quotation.', insufficient: false, citations: [{ source: 1, quote: QUOTE }]
  }) } }] });
};

const html = name => {
  const targetParagraph = `<p id="quote-target">${QUOTE}</p>`;
  const same = `<p class="quote-copy">${QUOTE}</p>`;
  let content = `<div class="spacer">Synthetic material above the target.</div>${targetParagraph}<div class="spacer">Synthetic material below the target.</div>`;
  if (name === 'duplicate') content += same;
  if (name === 'inserted-before') content = `<div style="height:300px"></div>${same}` + content;
  if (name === 'missing') content = '<div class="spacer">The archived quotation is no longer present.</div><p id="replacement">A different current paragraph.</p><div class="spacer"></div>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic local quote · ${name}</title>
  <style>html{scroll-behavior:auto}body{margin:20px;font:18px/1.6 sans-serif;color:#111;background:white}.spacer{height:1500px}p{margin:20px 0;max-width:600px}</style>
  <h1>Local-only quotation fixture</h1>${content}<script>window.fixtureReady=true;history.scrollRestoration='manual';</script></html>`;
};
function armFixtureHold(name) {
  let release;
  const done = new Promise(resolve => { release = resolve; });
  const hold = { requested: false, done, release };
  holds.set('/' + name, hold);
  return hold;
}
async function fixture(request) {
  const url = new URL(request.url);
  networkRequests.push({ url: request.url, method: request.method });
  if (url.origin !== ORIGIN) return new Response('External network blocked by synthetic QA', { status: 403 });
  if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
  const held = holds.get(url.pathname);
  if (held) { held.requested = true; await held.done; holds.delete(url.pathname); }
  if (url.pathname === '/redirect-different') return Response.redirect(ORIGIN + '/redirect-final', 302);
  if (url.pathname === '/redirect-same') {
    const seen = redirectCount.get(url.pathname) || 0;
    redirectCount.set(url.pathname, seen + 1);
    if (!seen) return Response.redirect(ORIGIN + '/redirect-intermediate', 302);
  }
  if (url.pathname === '/redirect-intermediate') return Response.redirect(ORIGIN + '/redirect-same', 302);
  return new Response(html(url.pathname.slice(1)), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { if (await check()) return; } catch (e) { last = e; }
    await pause(30);
  }
  if (win && !win.isDestroyed()) await diagnostic(label).catch(() => {});
  throw new Error(`${label}: timeout${last ? ' (' + last.message + ')' : ''}`);
}
const ui = script => win.webContents.executeJavaScript(script);
const state = () => ui('window.grid.state()');
const api = (method, ...args) => ui(`window.grid[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
const paint = () => ui('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
async function settled() { await paint(); await ui('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))'); await paint(); }
const click = selector => ui(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('Missing control '+${JSON.stringify(selector)});n.click()})()`);
const input = (id, value) => ui(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
async function diagnostic(label) {
  const s = await state().catch(() => ({}));
  const tab = observedHost?.active;
  const web = tab?.view?.webContents;
  const operation = tab?.operation;
  const dom = await ui(`(()=>{const ids=['quote-locator-bar','quote-locator-message','quote-locate','quote-dismiss','judgment-status','status','error'];return{focused:document.hasFocus(),active:document.activeElement?.id,bodyMode:document.body.dataset.mode,controls:ids.flatMap(id=>{const n=document.getElementById(id);if(!n)return[];const r=n.getBoundingClientRect();return[{id,hidden:n.hidden,text:n.textContent?.slice(0,220),disabled:!!n.disabled,ariaDisabled:n.getAttribute('aria-disabled'),box:{x:r.x,y:r.y,w:r.width,h:r.height}}]})}})()`).catch(e => ({ error:e.message }));
  let page;
  if (web && !web.isDestroyed() && web.getURL().startsWith(ORIGIN)) {
    page = await web.executeJavaScript('({ready:document.readyState,fixture:window.fixtureReady===true,title:document.title,bodyStart:document.body?.textContent.slice(0,160),scrollY,innerWidth,innerHeight,visibility:document.visibilityState})').catch(e => ({ error:e.message }));
  }
  const result = { diagnostic:label, stage, state:{mode:s.mode,value:s.value,entryId:s.entryId,quoteLocator:s.quoteLocator,pageRecovery:s.pageRecovery,pending:s.pending},
    window:{focused:win.isFocused(),visible:win.isVisible(),minimized:win.isMinimized(),contentsFocused:win.webContents.isFocused(),size:win.getContentSize()},
    host:{ready:observedHost?.ready,pageVisible:observedHost?.quotePageVisible,settingsOpen:observedHost?.settingsOpen,storagePanelOpen:observedHost?.storagePanelOpen,target:observedHost?.registry?.target===observedHost,attached:observedHost?.attached===tab?.view},
    native:web&&!web.isDestroyed()?{id:web.id,url:web.getURL(),title:web.getTitle(),loading:web.isLoadingMainFrame(),focused:web.isFocused(),bounds:tab.view.getBounds(),identity:tab.identity(),operation:operation&&{kind:operation.kind,url:operation.url,started:operation.started,committed:operation.committed},page}:undefined,
    dom,fixtureRequests:networkRequests.slice(-8),events:browserEvents.slice(-14) };
  console.log(JSON.stringify(result));
  fs.writeFileSync(path.join(output, stage + '-diagnostic.json'),JSON.stringify(result,null,2));
}
const snapshotJudgment = s => ({ ownerId:s.ownerId, activeTabId:s.activeTabId, entryId:s.entryId, tabs:s.tabs.length, judgment:s.judgment });
function nativeView() {
  const v = win.contentView.children.find(v => v.webContents && v.webContents.getURL().startsWith(ORIGIN));
  assert.ok(v, 'Active local fixture must have a real native WebContentsView');
  return v;
}
async function record(name, fn) {
  if (process.env.GRID_QA_FILTER && !new RegExp(process.env.GRID_QA_FILTER).test(name)) return;
  stage = name;
  const at = Date.now();
  try {
    const detail = await fn();
    report.push({ name, status: 'passed', ms: Date.now() - at, ...(detail ? { detail } : {}) });
  } catch (e) {
    report.push({ name, status: 'failed', ms: Date.now() - at, message: e.stack || e.message });
    await diagnostic('failed assertion').catch(() => {});
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, name + '-failure.png'), (await win.capturePage()).toPNG());
  }
  console.log(JSON.stringify(report.at(-1)));
  fs.writeFileSync(path.join(output, 'quote-locator-report.json'), JSON.stringify({ started, target, partial: true, report }, null, 2));
}
async function freshPath() {
  const old = (await state()).tabs.map(t => t.id);
  const id = await api('temporaryPath');
  await until(async () => (await state()).activeTabId === id, 'fresh isolated temporary path');
  for (const oldId of old) await api('tabClose', oldId);
}
async function finishJudgment(saved) {
  await until(async () => (await state()).mode === 'judgment', 'judgment draft');
  await paint();
  await input('judgment-text', AUTHORED);
  await input('judgment-checks', CHECKS);
  await ui('document.querySelector("#judgment-citation-options").open=true');
  await click('#judgment-citation-0');
  await until(async () => (await state()).judgment.citationIds.length === 1, 'selected citation');
  await until(async () => (await state()).judgment.text === AUTHORED && (await state()).judgment.checks === CHECKS, 'authored text');
  if (saved) {
    await click('#judgment-save');
    await until(async () => (await state()).judgment?.status === 'saved', 'saved judgment');
  }
  await settled();
  return snapshotJudgment(await state());
}
async function makeComparisonJudgment(saved = false) {
  await freshPath();
  await api('submit', 'Synthetic quote comparison', { contextual: false });
  let s = await state();
  for (const index of [0, 1]) await api('comparisonChoose', { kind: 'result', searchId: s.search.id, index }, s.ownerId, s.entryId);
  await click('#comparison-start');
  await until(async () => Boolean((await state()).comparison?.analysis), 'synthetic comparison analysis');
  await paint();
  await click('#judgment-from-comparison');
  return finishJudgment(saved);
}
async function removeOrigin(j) {
  await until(() => webContents.getAllWebContents().some(w => /\/renderer\/map(?:-svelte)?\.html$/.test(w.getURL())), 'real floating map preload');
  const map = webContents.getAllWebContents().find(w => /\/renderer\/map(?:-svelte)?\.html$/.test(w.getURL()));
  await map.executeJavaScript(`(async()=>{const s=await window.gridMap.state();await window.gridMap.command({ownerId:s.ownerId,entryId:s.entryId,kind:'remove',nodeId:${JSON.stringify(j.judgment.originEntryId)}})})()`);
  await until(async () => !(await state()).path.nodes.some(n => n.id === j.judgment.originEntryId), 'origin node removed');
  assert.equal((await state()).entryId, j.entryId);
  assert.deepEqual((await state()).judgment, j.judgment, 'Frozen judgment and citations must survive origin removal');
  await settled();
}
async function makeJudgment(name = 'unique', saved = false) {
  await freshPath();
  await api('read', ORIGIN + '/' + name);
  await until(async () => (await state()).mode === 'reading' && !(await state()).pending, 'reading fixture');
  let s = await state();
  await api('beginQuestion', s.ownerId, s.entryId);
  s = await state();
  await api('ask', 'Which exact archived paragraph supports this synthetic judgment?', s.ownerId, s.entryId, s.question.id);
  await until(async () => Boolean((await state()).question?.answer), 'synthetic question answer');
  await paint();
  await click('#judgment-from-question');
  return finishJudgment(saved);
}
async function openCitation(j, expected = 'ready') {
  win.focus();
  const before = await state();
  assert.equal(before.entryId, j.entryId);
  const id = j.judgment.citations[0].id;
  assert.equal(await ui(`document.querySelectorAll('.judgment-open-citation[data-citation-id="'+${JSON.stringify(id)}+'"]').length`), 1);
  await click(`.judgment-open-citation[data-citation-id="${id}"]`);
  await until(async () => { const s = await state(); return s.mode === 'page' && !s.pageRecovery && s.quoteLocator && (!expected || s.quoteLocator.status === expected); }, 'explicit citation original open');
  const s = await state();
  assert.equal(s.ownerId, j.ownerId);
  assert.equal(s.activeTabId, j.activeTabId);
  assert.equal(s.tabs.length, j.tabs);
  assert.equal(s.path.nodes.length, before.path.nodes.length + 1, 'Explicit open adds exactly one page path node');
  assert.equal(s.path.nodes.find(n => n.id === s.entryId).parentId, j.entryId);
  assert.equal(await nativeView().webContents.executeJavaScript('scrollY'), 0, 'Opening a citation must not auto-locate');
  await settled();
  return s;
}
async function locate(expected) {
  await click('#quote-locate');
  await until(async () => (await state()).quoteLocator?.status === expected, 'locate status ' + expected);
  await settled();
}
async function backTo(j) {
  await api('back', j.ownerId);
  await until(async () => (await state()).entryId === j.entryId, 'Back to exact judgment');
  const after = await state();
  assert.deepEqual(snapshotJudgment(after), j, 'Back must preserve the exact authored judgment and citation version');
  assert.equal(after.quoteLocator, undefined, 'Quote state must not leak into judgment');
  await settled();
}
const pathIdentity = s => JSON.stringify(s.path);
const navIdentity = web => JSON.stringify(web.navigationHistory.getAllEntries());
async function focus(id) { win.focus(); win.webContents.focus(); await ui(`document.getElementById(${JSON.stringify(id)}).focus({preventScroll:true})`); await paint(); }
async function focusSnapshot() { return ui('({id:document.activeElement?.id,focused:document.hasFocus()})'); }
function gateScan(web, kind = 'prepare') {
  const original = web.executeJavaScriptInIsolatedWorld;
  let release, entered = false;
  const held = new Promise(resolve => { release = resolve; });
  web.executeJavaScriptInIsolatedWorld = async function(world, scripts, ...rest) {
    const result = await original.call(this, world, scripts, ...rest);
    const code = scripts.map(s => s.code).join('\n');
    if (code.includes('Grid local quote locator v1') && new RegExp('"kind"\\s*:\\s*"' + kind + '"').test(code)) { entered = true; await held; }
    return result;
  };
  return { entered: () => entered, release, restore() { web.executeJavaScriptInIsolatedWorld = original; release(); } };
}

async function run() {
  await app.whenReady();
  await session.fromPartition('persist:grid-m0').protocol.handle('https', fixture);
  // Fail closed for accidental unhandled external browser requests, including HTTP.
  session.fromPartition('persist:grid-m0').webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: new URL(details.url).origin !== ORIGIN });
  });
  require(path.join(target, 'dist/main.js'));
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return Boolean(win); }, 'production BrowserWindow');
  await until(async () => Boolean(await state()), 'production preload and state');
  for (const name of ['judgmentOpenCitation', 'quoteLocate', 'quoteDismiss']) assert.equal(await ui(`typeof window.grid[${JSON.stringify(name)}]`), 'function', 'Required contract ' + name);
  nativeTheme.themeSource = 'light';
  win.setMinimumSize(320, 480);
  win.setContentSize(1180, 820);

  await record('draft-and-saved-explicit-open-same-tab-exact-back', async () => {
    const draft = await makeJudgment('unique');
    await openCitation(draft);
    await backTo(draft);
    const before = providerCalls.length;
    await click('#judgment-save');
    await until(async () => (await state()).judgment?.status === 'saved', 'save after returning draft');
    const saved = snapshotJudgment(await state());
    await settled();
    await openCitation(saved);
    await backTo(saved);
    assert.equal(providerCalls.length, before, 'Open/Back/save must not regenerate provider content');
    assert.deepEqual(saved.judgment.citations, draft.judgment.citations);
    assert.deepEqual(saved.judgment.citationIds, draft.judgment.citationIds);
  });
  for (const origin of ['question', 'comparison']) {
    for (const saved of [false, true]) {
      await record(`removed-${origin}-origin-${saved ? 'saved' : 'draft'}-citation-open-and-exact-back`, async () => {
        const j = origin === 'question' ? await makeJudgment('unique', saved) : await makeComparisonJudgment(saved);
        await removeOrigin(j);
        const calls = providerCalls.length;
        await openCitation(j);
        await backTo(j);
        assert.equal(providerCalls.length, calls, 'Frozen citation open must not refetch or regenerate removed origin');
        assert.ok(!(await state()).path.nodes.some(n => n.id === j.judgment.originEntryId));
      });
    }
  }
  await record('unique-explicit-visible-quote-scroll-no-path-or-history-side-effects', async () => {
    const j = await makeJudgment('unique', true);
    await openCitation(j);
    const web = nativeView().webContents;
    const before = await state(), history = navIdentity(web);
    await locate('found');
    const result = await web.executeJavaScript(`(()=>{const p=document.querySelector('#quote-target'),r=p.getBoundingClientRect();return{text:p.textContent,top:r.top,bottom:r.bottom,h:innerHeight,y:scrollY}})()`);
    assert.equal(result.text, QUOTE);
    assert.ok(result.y > 500, 'Unique match must actually scroll far down the fixture');
    assert.ok(result.top >= -1 && result.bottom <= result.h + 1, 'Exact quote paragraph must be visible');
    assert.equal(pathIdentity(await state()), pathIdentity(before));
    assert.equal(navIdentity(web), history);
    assert.equal(await web.executeJavaScript('getSelection().toString()'), '', 'Locator must not overwrite page selection');
    fs.writeFileSync(path.join(output, 'unique-found.png'), (await win.capturePage()).toPNG());
    return result;
  });
  for (const name of ['duplicate', 'inserted-before', 'missing']) {
    await record(name + '-safe-no-scroll', async () => {
      const j = await makeJudgment(name, true);
      await openCitation(j);
      const web = nativeView().webContents;
      const before = await state(), history = navIdentity(web);
      await web.executeJavaScript('scrollTo(0,240)');
      const start = await web.executeJavaScript('scrollY');
      await locate(name === 'missing' ? 'missing' : 'ambiguous');
      assert.equal(await web.executeJavaScript('scrollY'), start, 'Unsafe match must not scroll');
      assert.equal(pathIdentity(await state()), pathIdentity(before));
      assert.equal(navIdentity(web), history);
      assert.ok(await ui('document.querySelector("#quote-locator-message").textContent.trim().length>0'));
      return { scrollY: start, status: (await state()).quoteLocator.status };
    });
  }
  await record('735x560-and-regular-native-bar-sidebar-geometry', async () => {
    const j = await makeJudgment('unique', true);
    await openCitation(j);
    const measurements = [];
    for (const [width, height] of [[735, 560], [1180, 820]]) {
      win.setContentSize(width, height);
      await settled();
      // Make the sidebar visible through its real user control if collapsed.
      const open = await ui('(()=>{const sidebar=document.querySelector("#exploration-sidebar");if(sidebar?.getBoundingClientRect().width>0)return null;return ["#sidebar-open","#sidebar-toggle"].find(sel=>{const n=document.querySelector(sel);return !!n&&!n.hidden&&n.getBoundingClientRect().width>0})||null})()');
      if (open) { await click(open); await settled(); }
      await until(async () => nativeView().getBounds().height > 0, 'measured native bounds');
      const dom = await ui(`(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return{bar:rect('quote-locator-bar'),sidebar:rect('exploration-sidebar'),controls:['quote-locate','quote-dismiss'].map(rect),w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
      const bounds = nativeView().getBounds();
      assert.ok(dom.bar.width > 0 && dom.bar.height > 0);
      assert.ok(dom.bar.left >= -1 && dom.bar.right <= dom.w + 1 && dom.bar.top >= 0 && dom.bar.bottom < dom.h);
      assert.ok(dom.sidebar.width > 0, 'Sidebar must be visible for overlap regression');
      assert.ok(dom.bar.left >= dom.sidebar.right - 1, 'Locator must not cover the exploration sidebar');
      for (const r of dom.controls) assert.ok(r.width > 0 && r.left >= dom.bar.left - 1 && r.right <= dom.w + 1 && r.bottom <= dom.h, 'Locator controls must remain visible');
      assert.ok(bounds.y >= Math.ceil(dom.bar.bottom) - 1, 'Native page must begin below measured locator chrome');
      assert.ok(bounds.x >= Math.ceil(dom.sidebar.right) - 1, 'Native page must not cover sidebar');
      assert.ok(bounds.width > 100 && bounds.height > 100, 'Native page must remain usable');
      assert.equal(dom.overflow, false);
      measurements.push({ width, height, dom, bounds });
      fs.writeFileSync(path.join(output, `geometry-${width}x${height}.png`), (await win.capturePage()).toPNG());
    }
    return measurements;
  });
  await record('close-from-bar-logical-visible-focus-return', async () => {
    const j = await makeJudgment('unique', true); await openCitation(j);
    const before = await state(), web = nativeView().webContents, history = navIdentity(web);
    await focus('quote-dismiss');
    assert.deepEqual(await focusSnapshot(), { id: 'quote-dismiss', focused: true });
    await click('#quote-dismiss');
    await until(async () => !(await state()).quoteLocator, 'locator dismissed');
    await settled();
    const f = await ui('(()=>{const n=document.activeElement,r=n.getBoundingClientRect();return{id:n.id,visible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight,disabled:!!n.disabled}})()');
    assert.ok(['summarize-page', 'back', 'input'].includes(f.id), 'Dismissal must return to a logical stable control, not hidden/body');
    assert.ok(f.visible && !f.disabled);
    assert.equal(pathIdentity(await state()), pathIdentity(before)); assert.equal(navIdentity(web), history);
    return f;
  });
  await record('close-does-not-steal-focus-already-away', async () => {
    const j = await makeJudgment('unique', true); await openCitation(j);
    await focus('input');
    const s = await state(); await api('quoteDismiss', s.quoteLocator.id, s.ownerId, s.entryId);
    await until(async () => !(await state()).quoteLocator, 'locator dismissed away');
    assert.deepEqual(await focusSnapshot(), { id: 'input', focused: true });
  });
  await record('held-original-ready-result-keeps-focus-away', async () => {
    const j = await makeJudgment('held-ready', true);
    const held = armFixtureHold('held-ready');
    try {
      await click(`.judgment-open-citation[data-citation-id="${j.judgment.citations[0].id}"]`);
      await until(() => held.requested, 'held local original request');
      await focus('input');
      held.release();
      await until(async () => (await state()).quoteLocator?.status === 'ready' && !(await state()).pageRecovery, 'held original ready');
      await settled();
      assert.deepEqual(await focusSnapshot(), { id: 'input', focused: true }, 'Asynchronous original-ready result must not focus locator');
    } finally { held.release(); }
  });
  await record('held-locate-result-keeps-focus-moved-away', async () => {
    const j = await makeJudgment('unique', true); await openCitation(j);
    const web = nativeView().webContents, gate = gateScan(web);
    try {
      await focus('quote-locate'); await click('#quote-locate');
      await until(gate.entered, 'controlled prepare-result barrier');
      await focus('input'); gate.release();
      await until(async () => (await state()).quoteLocator?.status === 'found', 'held locate result');
      await settled();
      assert.deepEqual(await focusSnapshot(), { id: 'input', focused: true }, 'Asynchronous locate result must not restore stale focus');
    } finally { gate.restore(); }
  });
  await record('mutation-after-prepare-cannot-scroll-stale-match', async () => {
    const j = await makeJudgment('unique', true); await openCitation(j);
    const web = nativeView().webContents, gate = gateScan(web);
    try {
      await click('#quote-locate'); await until(gate.entered, 'held prepared DOM result');
      const before = await web.executeJavaScript('scrollY');
      await web.executeJavaScript('document.querySelector("#quote-target").textContent="A changed paragraph, not the archived quote."');
      gate.release();
      await until(async () => ['unsupported', 'missing', 'uncertain'].includes((await state()).quoteLocator?.status), 'changed DOM terminal status');
      assert.equal(await web.executeJavaScript('scrollY'), before, 'DOM mutation before dispatch must not use stale target geometry');
    } finally { gate.restore(); }
  });
  await record('stale-citation-owner-entry-and-forged-id-rejected', async () => {
    const j = await makeJudgment('unique', true), id = j.judgment.citations[0].id;
    const before = await state();
    for (const args of [[id, 'wrong-owner', j.entryId], [id, j.ownerId, 'wrong-entry'], ['forged-citation', j.ownerId, j.entryId]]) {
      const rejected = await ui(`window.grid.judgmentOpenCitation(...${JSON.stringify(args)}).then(()=>false,()=>true)`);
      assert.equal(rejected, true, 'Stale/forged citation action must reject');
      assert.equal(pathIdentity(await state()), pathIdentity(before));
    }
    await openCitation(j);
    const s = await state();
    for (const method of ['quoteLocate', 'quoteDismiss']) {
      for (const args of [[s.quoteLocator.id, 'wrong-owner', s.entryId], [s.quoteLocator.id, s.ownerId, 'wrong-entry'], ['forged-locator', s.ownerId, s.entryId]]) {
        assert.equal(await ui(`window.grid[${JSON.stringify(method)}](...${JSON.stringify(args)}).then(()=>false,()=>true)`), true);
        assert.equal((await state()).quoteLocator.id, s.quoteLocator.id);
      }
    }
  });
  await record('tab-switch-invalidates-held-result-and-cannot-scroll-background-page', async () => {
    const j = await makeJudgment('unique', true); const opened = await openCitation(j);
    const web = nativeView().webContents, gate = gateScan(web), history = navIdentity(web), scroll = await web.executeJavaScript('scrollY');
    try {
      await click('#quote-locate'); await until(gate.entered, 'held scan before tab switch');
      const otherId = await api('tabNew'); await until(async () => (await state()).ownerId !== opened.ownerId, 'other tab active');
      gate.release(); await pause(150);
      assert.equal((await state()).quoteLocator, undefined);
      assert.equal(await web.executeJavaScript('scrollY'), scroll, 'Cancelled background locator must not scroll');
      assert.equal(navIdentity(web), history);
      await api('tabSelect', opened.activeTabId); await paint();
      const old = (await state()).quoteLocator;
      assert.ok(!old || ['uncertain', 'unsupported'].includes(old.status), 'Switch-back must not revive a ready/found locator token');
      await api('tabClose', otherId);
    } finally { gate.restore(); }
  });
  await record('reload-invalidates-held-result-and-does-not-scroll-new-document', async () => {
    const j = await makeJudgment('unique', true); const opened = await openCitation(j);
    const web = nativeView().webContents, gate = gateScan(web);
    try {
      await click('#quote-locate'); await until(gate.entered, 'held scan before reload');
      const reloading = api('reload', opened.ownerId); gate.release(); await reloading;
      await until(async () => !(await state()).pageRecovery, 'reload complete'); await settled();
      const q = (await state()).quoteLocator;
      assert.ok(!q || ['uncertain', 'unsupported'].includes(q.status), 'Reload must not retain stale ready/found result');
      assert.equal(await web.executeJavaScript('scrollY'), 0);
    } finally { gate.restore(); }
  });
  for (const name of ['redirect-different', 'redirect-same']) {
    await record(name + '-must-not-be-falsely-ready', async () => {
      redirectCount.clear();
      const j = await makeJudgment(name, true);
      await openCitation(j, null);
      const q = (await state()).quoteLocator;
      assert.ok(['uncertain', 'unsupported'].includes(q.status), 'Any original-open redirect, including back to the same URL, must fail closed');
      const web = nativeView().webContents;
      assert.equal(await web.executeJavaScript('scrollY'), 0);
      return { locator: q.status, finalUrl: web.getURL() };
    });
  }
  await record('synthetic-boundary-no-personal-text-or-external-network', async () => {
    assert.ok(providerCalls.length > 0);
    assert.ok(providerCalls.every(c => !JSON.stringify(c.body).includes(AUTHORED) && !JSON.stringify(c.body).includes(CHECKS)));
    assert.ok(networkRequests.length > 0 && networkRequests.every(r => new URL(r.url).origin === ORIGIN));
    assert.equal(fs.existsSync(path.join(temporary, 'profile', 'mcp-connection.json')), false);
    return { providerCalls: providerCalls.length, localFixtureRequests: networkRequests.length, bridge: 'disabled' };
  });
}

app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
deadline = setTimeout(() => { console.error('Global QA deadline exceeded at ' + stage); app.exit(2); }, 240000);
run().catch(async e => {
  report.push({ name: stage, status: 'blocked', message: e.stack || e.message });
  console.error(e.stack || e);
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'fatal.png'), (await win.capturePage()).toPNG());
}).finally(async () => {
  clearTimeout(deadline);
  for (const hold of holds.values()) hold.release();
  const failed = report.some(r => r.status !== 'passed');
  const final = { status: failed ? 'failed' : 'passed', started, finished: new Date().toISOString(), target,
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform },
    scope: 'Actual built Grid Electron UI/preload/IPC/native WebContentsView; isolated profile; synthetic in-process provider and HTTPS local protocol only; no live website, real provider, user data, production, or macOS validation.',
    report };
  fs.writeFileSync(path.join(output, 'quote-locator-report.json'), JSON.stringify(final, null, 2));
  console.log(JSON.stringify({ status: final.status, passed: report.filter(r => r.status === 'passed').length, total: report.length, output }));
  process.exitCode = failed ? 1 : 0;
  // Exit isolated harness directly. Do not invoke app-save/close warning flows.
  app.exit(process.exitCode);
});
