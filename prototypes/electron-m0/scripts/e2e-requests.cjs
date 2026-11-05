// Production Electron UI/IPC with controllable, synthetic provider responses.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = path.join(__dirname, '../.local');
const profile = mkdtempSync(path.join(tmpdir(), 'grid-request-e2e-'));
app.setPath('userData', profile);
process.env.DEEPSEEK_API_KEY = 'synthetic-request-test-key';
delete process.env.DeepSeek_ApiKeyN;
const report = [];
const requests = [];
let held;
let failNext = false;
const response = payload => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
const searchResponse = query => ({ results: [{ title: query, url: 'https://example.com/article', snippet: '合成资料' }] });
function hold(kind) {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  const entry = { kind, promise, resolve };
  held = entry;
  return entry;
}
global.fetch = async (url, options) => {
  const kind = url.endsWith('/search') ? 'search' : url.endsWith('/fetch') ? 'reading' : 'extraction';
  const record = { kind, body: JSON.parse(options.body), signal: options.signal };
  requests.push(record);
  if (held?.kind === kind) {
    const entry = held; held = undefined; entry.record = record;
    return entry.promise; // Deliberately ignores abort to test host commit fences.
  }
  if (failNext) { failNext = false; return new Response('{invalid-json'); }
  return response(kind === 'search' ? searchResponse(record.body.query) : kind === 'reading'
    ? { title: '合成正文', content: '原文保留：预算 100 元。' }
    : { choices: [{ message: { content: '合成提取：预算 100 元。' } }] });
};
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const deadline = setTimeout(() => app.exit(1), 45000);
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await pause(); }
  throw new Error('Request regression timed out');
}
app.whenReady().then(async () => {
  let foreign;
  let win = BrowserWindow.getAllWindows()[0];
  const ui = code => win.webContents.executeJavaScript(code);
  const ready = () => until(async () => { try { return await ui('Boolean(window.grid && document.querySelector("#cancel-request"))'); } catch { return false; } });
  const state = () => ui('window.grid.state()');
  try {
    await ready();
    await ui('document.querySelector("#home-query").value="基线问题";document.querySelector("#home-search").requestSubmit()');
    await until(async () => (await state()).search?.query === '基线问题');
    const old = hold('search');
    const pendingOld = ui('window.grid.submit("旧慢请求")');
    await until(() => old.record);
    const submittedOld = await state();
    assert.equal(submittedOld.pending.nodeId, submittedOld.entryId);
    assert.equal(submittedOld.path.nodes.find(n => n.id === submittedOld.entryId).status, 'pending');
    assert.equal(await ui('document.querySelector("#results-title").textContent'), '基线问题');
    await ui('window.grid.submit("新问题",{scene:"learning",contextual:false})');
    assert.equal((await pendingOld).kind, 'cancelled');
    assert.equal(old.record.signal.aborted, true);
    old.resolve(response(searchResponse('不应出现的旧结果'))); await pause();
    assert.equal((await state()).search.query, '新问题');
    assert.equal(await ui('document.querySelector("#results-title").textContent'), '新问题');
    report.push('latest-search-wins-and-previous-results-stay-visible');
    assert.equal((await state()).path.nodes.find(n => n.id === submittedOld.entryId).status, 'cancelled');
    report.push('submitted-node-is-cancelled-without-late-response-revival');

    const fetch = hold('reading');
    const pendingRead = ui('window.grid.read("https://example.com/article")');
    await until(() => fetch.record);
    const submittedRead = await state();
    await ui('window.grid.home()');
    assert.equal(await pendingRead, undefined);
    assert.equal(fetch.record.signal.aborted, true);
    fetch.resolve(response({ title: 'Late', content: '旧正文' })); await pause();
    assert.equal((await state()).mode, 'home');
    assert.equal((await state()).reading, undefined);
    assert.equal((await state()).path.nodes.find(n => n.id === submittedRead.entryId).status, 'cancelled');
    report.push('cancelled-fetch-cannot-reopen-reading');

    await ui('window.grid.results()');
    const first = await ui('window.grid.read("https://example.com/article")');
    await ui('window.grid.setScene("living")');
    const second = await ui('window.grid.read("https://example.com/article")');
    await assert.rejects(ui(`window.grid.extract(${JSON.stringify(first.url)},"learning",${JSON.stringify(first.id)})`));
    assert.equal(second.context.query, '新问题');
    assert.equal(second.context.scene, 'learning');
    const oldExtract = hold('extraction');
    const pendingExtract = ui(`window.grid.extract(${JSON.stringify(second.url)},"living",${JSON.stringify(second.id)})`);
    await until(() => oldExtract.record);
    const prompt = JSON.parse(oldExtract.record.body.messages[1].content);
    assert.equal(prompt.question, '新问题');
    assert.equal(prompt.scene, '生活');
    await ui('window.grid.setScene("learning")');
    assert.equal(await pendingExtract, undefined);
    const latest = hold('extraction');
    const latestExtract = ui(`window.grid.extract(${JSON.stringify(second.url)},"learning",${JSON.stringify(second.id)})`);
    await until(() => latest.record);
    oldExtract.resolve(response({ choices: [{ message: { content: '过期提取' } }] })); await pause();
    assert.equal(await ui('document.querySelector("#busy").classList.contains("hidden")'), false);
    assert.equal(await ui('document.querySelector("#extract-scene").disabled'), true);
    latest.resolve(response({ choices: [{ message: { content: '学习重点：预算 100 元。' } }] })); await latestExtract;
    await until(async () => await ui('document.querySelector("#extraction-content").textContent.includes("学习重点")'));
    assert.equal(await ui('document.querySelector("#reading-content").textContent'), '原文保留：预算 100 元。');
    report.push('immutable-reading-context-and-old-handle-denied');
    report.push('late-extraction-cannot-hide-new-progress-or-replace-text');

    const readyNode = await state();
    assert.equal(readyNode.path.currentId, readyNode.entryId);
    assert.equal(readyNode.path.nodes.find(n => n.id === readyNode.entryId).status, 'ready');
    assert.equal(readyNode.path.nodes.find(n => n.id === readyNode.entryId).scene, 'learning');
    report.push('ready-reading-and-extraction-stay-in-the-owned-path-node');

    await ui('window.grid.results()');
    const cancelled = hold('search');
    const pendingCancel = ui('window.grid.submit("可取消问题")');
    await until(() => cancelled.record);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'request-cancel-preview.png'), (await win.capturePage()).toPNG());
    win.focus(); win.webContents.focus();
    await ui('document.querySelector("#cancel-request").focus()');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    assert.equal((await pendingCancel).kind, 'cancelled');
    await until(async () => await ui('document.activeElement.id === "input"'));
    assert.equal(cancelled.record.signal.aborted, true);
    cancelled.resolve(response(searchResponse('取消后的晚到结果'))); await pause();
    assert.equal((await state()).search.query, '新问题');
    assert.equal(await ui('document.querySelector("#busy").classList.contains("hidden")'), true);
    report.push('visible-cancel-stops-current-request');

    const before = (await state()).revision;
    await assert.rejects(ui('window.grid.submit("bad",{scene:"living",contextual:"yes"})'));
    assert.equal((await state()).revision, before);
    failNext = true;
    await assert.rejects(ui('window.grid.submit("格式错误")'));
    assert.equal((await state()).search.query, '新问题');
    assert.ok((await state()).issue.message.includes('格式无效'));
    assert.equal(await ui('document.querySelector("#results-title").textContent'), '新问题');
    report.push('malformed-arguments-and-provider-response-preserve-results');

    win.webContents.reload(); await ready();
    await until(async () => await ui('document.querySelector("#results-title").textContent === "新问题"'));
    assert.equal((await state()).search.query, '新问题');
    report.push('UI-reload-restores-host-results');

    const oldState = await state();
    await ui('window.grid.agentPanel(true)');
    assert.ok((await state()).revision > oldState.revision);
    win.webContents.send('grid:state', oldState);
    await pause();
    assert.equal(await ui('document.querySelector("#agent-toggle").getAttribute("aria-expanded")'), 'true');
    await ui('window.grid.agentPanel(false)');
    report.push('host-revision-also-orders-agent-and-settings-state');

    foreign = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../dist/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await foreign.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
    await assert.rejects(foreign.webContents.executeJavaScript('window.grid.configureKey("synthetic-foreign-value")'));
    await assert.rejects(foreign.webContents.executeJavaScript('window.grid.home()'));
    assert.equal(existsSync(path.join(profile, 'provider-key.bin')), false);
    assert.equal((await state()).mode, 'results');
    foreign.destroy(); foreign = undefined;
    report.push('foreign-window-with-identical-UI-URL-has-no-privilege');

    const crash = hold('search');
    const pendingCrash = ui('window.grid.submit("崩溃前请求")').catch(() => undefined);
    await until(() => crash.record);
    await new Promise(resolve => { win.webContents.once('render-process-gone', resolve); win.webContents.forcefullyCrashRenderer(); });
    assert.equal(crash.record.signal.aborted, true);
    win.webContents.reload(); await ready();
    await pendingCrash;
    crash.resolve(response(searchResponse('崩溃后的过期结果'))); await pause();
    assert.equal((await state()).pending, undefined);
    assert.equal((await state()).search.query, '新问题');
    report.push('renderer-crash-aborts-work-and-reload-keeps-committed-results');

    if (process.platform === 'darwin') {
      const closed = hold('reading');
      const pendingClosed = ui('window.grid.read("https://example.com/article")').catch(() => undefined);
      await until(() => closed.record);
      const closing = new Promise(resolve => win.once('closed', resolve));
      win.close(); await closing; app.emit('activate');
      win = BrowserWindow.getAllWindows()[0];
      assert.ok(win); await ready(); await pendingClosed;
      assert.equal(closed.record.signal.aborted, true);
      closed.resolve(response({ title: 'Late', content: '已关闭窗口的旧正文' })); await pause();
      assert.equal((await state()).mode, 'home');
      assert.equal((await state()).search, undefined);
      assert.equal((await state()).reading, undefined);
      report.push('macOS-close-reopen-gets-new-owner-without-late-data');
    }
    writeFileSync(path.join(directory, 'request-e2e-report.json'), JSON.stringify({ status: 'passed', report, network: 'synthetic provider responses; production UI/IPC' }, null, 2));
    console.log(JSON.stringify({ status: 'passed', report }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { foreign?.destroy(); clearTimeout(deadline); app.quit(); }
});
