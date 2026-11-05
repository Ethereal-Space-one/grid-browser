// Production UI/IPC; synthetic provider data, isolated profile, no live model or website.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-path-state-')));
process.env.DEEPSEEK_API_KEY = 'synthetic-path-key';
delete process.env.DeepSeek_ApiKeyN;
const directory = path.join(__dirname, '../.local');
const report = []; let held; let fetchCalls = 0;
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const results = query => ({ results: [{ title: query, url: 'https://example.com/article', snippet: '合成来源' }] });
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (url.endsWith('/search')) {
    if (held) { const waiting = held; held = undefined; waiting.started = true; return waiting.promise; }
    return response(results(body.query));
  }
  assert.ok(url.endsWith('/fetch'), 'this test makes no model calls');
  fetchCalls++;
  return response({ title: '合成来源 ' + body.url, content: 'fixture paragraph. '.repeat(37000) });
};
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const deadline = setTimeout(() => app.exit(1), 60000);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check, label) {
  for (let n = 0; n < 240; n++) { if (await check()) return; await pause(); }
  throw new Error(label || 'path UI timeout');
}
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const ui = code => win.webContents.executeJavaScript(code);
  const state = () => ui('window.grid.state()');
  try {
    await until(async () => { try { return await ui('Boolean(window.grid)'); } catch { return false; } });
    mkdirSync(directory, { recursive: true });
    await ui('window.grid.submit("场景上下文",{scene:"learning",contextual:false})');
    const search = (await state()).entryId;
    await ui('window.grid.read("https://example.com/a")');
    const a = (await state()).entryId;
    await ui('window.grid.setScene("living")');
    await ui('window.grid.back()');
    assert.equal((await state()).scene, 'learning');
    await ui('window.grid.read("https://example.com/b")');
    const b = (await state()).entryId;
    const branched = await state();
    assert.deepEqual(branched.path.nodes.find(n => n.id === search).childIds, [a, b]);
    assert.equal(branched.path.nodes.find(n => n.id === a).scene, 'living');
    report.push('real-IPC-preserves-old-reading-branch-and-node-scenes');
    const calls = fetchCalls;
    await ui('window.grid.back()'); await ui('window.grid.forward()');
    assert.equal((await state()).entryId, b); assert.equal(fetchCalls, calls);
    report.push('forward-uses-selected-branch-without-refetch');

    let resolve;
    const waiting = { promise: new Promise(yes => { resolve = yes; }) };
    held = waiting;
    const pending = ui('window.grid.submit("提交的问题",{scene:"professional",contextual:true})');
    await until(() => waiting.started);
    const started = await state();
    const intent = started.path.nodes.find(n => n.id === started.entryId).context;
    assert.equal(intent.query, '提交的问题'); assert.equal(intent.scene, 'professional');
    await ui('document.querySelector("#input").value="等待时写的下一题";document.querySelector("#input").dispatchEvent(new Event("input"))');
    await until(async () => (await state()).presentation.addressDraft === '等待时写的下一题');
    resolve(response(results('提交的问题'))); await pending;
    const ready = await state();
    assert.equal(ready.entryId, started.entryId);
    assert.equal(ready.path.nodes.length, started.path.nodes.length);
    assert.equal(ready.pending, undefined);
    assert.equal(ready.search.query, '提交的问题');
    assert.deepEqual(ready.path.nodes.find(n => n.id === ready.entryId).context, intent);
    await until(async () => await ui('document.querySelector("#input").value === "等待时写的下一题"'));
    report.push('pending-and-ready-share-a-node-and-preserve-user-draft');

    const cacheNodes = [];
    for (let n = 0; n < 14; n++) {
      await ui(`window.grid.read("https://example.com/cache-${n}")`);
      const current = await state(); cacheNodes.push(current.entryId);
      if (n === 0) await ui(`window.grid.savePresentation(${JSON.stringify(current.ownerId)},${JSON.stringify(current.entryId)},{scrollTop:180,addressDraft:null,homeQuery:"保留草稿",contextual:false})`);
    }
    const beforeBack = fetchCalls;
    for (let n = 0; n < 13; n++) await ui('window.grid.back()');
    const missing = await state();
    assert.equal(missing.entryId, cacheNodes[0]);
    assert.equal(missing.reading, undefined);
    assert.equal(missing.presentation.scrollTop, 180);
    assert.ok(missing.path.nodes.find(n => n.id === missing.entryId).missingContent.includes('reading'));
    assert.equal(fetchCalls, beforeBack);
    await until(async () => await ui('document.querySelector("#reading-content").textContent.includes("释放")'));
    assert.equal(await ui('document.querySelector("#extract-scene").disabled'), true);
    assert.equal(await ui('document.querySelector("#extract-notice").textContent.includes("释放")'), true);
    assert.equal(await ui('document.querySelector("#reading-source").textContent'), 'https://example.com/cache-0');
    assert.equal(await ui('document.querySelector("#open-reading-source").disabled'), false);
    writeFileSync(path.join(directory, 'path-state-cache-preview.png'), (await win.capturePage()).toPNG());
    report.push('evicted-reading-retains-position-source-and-explicit-fallback');

    for (let n = 0; n < 40 && !(await state()).path.recordingPaused; n++) await ui(`window.grid.submit("容量检查${n}",{contextual:false})`);
    for (let n = 0; n < 3; n++) await ui(`window.grid.submit("临时后续${n}",{contextual:false})`);
    const limited = await state();
    assert.equal(limited.path.nodes.filter(n => n.recorded).length, 32);
    assert.equal(limited.path.nodes.filter(n => !n.recorded).length, 1);
    assert.ok(limited.path.nodes.some(n => n.id === a));
    assert.ok(limited.path.nodes.some(n => n.id === b));
    await until(async () => await ui('!document.querySelector("#busy").classList.contains("hidden") && document.querySelector("#busy-label").textContent.includes("上限")'));
    assert.equal(await ui('document.querySelector("#cancel-request").hidden'), true);
    for (const width of [720, 768, 1180]) {
      win.setContentSize(width, 820); await pause();
      assert.equal(await ui('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await ui('["new-tab","new-window"].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})'), true);
    }
    writeFileSync(path.join(directory, 'path-state-cap-preview.png'), (await win.capturePage()).toPNG());
    report.push('node-limit-keeps-recorded-branches-and-shows-bounded-continuation');
    report.push('capacity-notice-does-not-obscure-native-window-controls');
    writeFileSync(path.join(directory, 'path-state-e2e-report.json'), JSON.stringify({ status: 'passed', report,
      network: 'synthetic provider; no live model or original website', scope: 'step 1 in-memory state; no map UI, arbitrary UI jump or persistence' }, null, 2));
    console.log(JSON.stringify({ status: 'passed', report }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(deadline); app.quit(); }
});
