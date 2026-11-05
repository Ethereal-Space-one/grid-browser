const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const [profile, mode] = process.argv.slice(2);
app.setPath('userData', profile);
let keychainCalls = 0, legacyReads = 0, requests = 0;
for (const name of Object.keys(safeStorage)) {
  if (typeof safeStorage[name] === 'function') safeStorage[name] = () => {
    keychainCalls++;
    throw new Error('Keychain must not be accessed');
  };
}
assert.equal(typeof safeStorage.decryptStringAsync, 'function');
const read = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (file === path.join(profile, 'provider-key.bin')) { legacyReads++; throw new Error('Legacy credential must not be read'); }
  return read.call(this, file, ...args);
};
const manualKey = 'synthetic-session-key-only';
const expectedKey = mode === 'environment' ? process.env.DEEPSEEK_API_KEY || process.env.DeepSeek_ApiKeyN : manualKey;
global.fetch = async (_url, options) => {
  requests++;
  assert.ok(options.headers.Authorization === 'Bearer ' + expectedKey, 'Provider uses the configured credential');
  return new Response(JSON.stringify({ results: [{ title: '合成结果', url: 'https://example.com/', snippet: '只验证连接流程' }] }), { headers: { 'Content-Type': 'application/json' } });
};
const server = http.createServer((_req, res) => { res.end('<title>Local browsing</title><h1>No provider key needed</h1>'); });
const deadline = setTimeout(() => app.exit(1), 25000);
require('../dist/main.js');
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check) {
  for (let n = 0; n < 150; n++) { if (await check()) return; await pause(); }
  throw new Error('Session key check timed out');
}
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const ui = code => win.webContents.executeJavaScript(code);
  const state = () => ui('window.grid.state()');
  try {
    await until(async () => { try { return await ui('Boolean(window.grid && document.querySelector("#provider-enable"))'); } catch { return false; } });
    assert.equal((await state()).keyReady, mode === 'environment');
    assert.equal(keychainCalls, 0); assert.equal(legacyReads, 0);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await ui(`window.grid.open('http://127.0.0.1:${server.address().port}/')`);
    assert.equal((await state()).mode, 'page');
    assert.equal(requests, 0);
    const page = win.contentView.children.find(view => view.webContents?.getURL().startsWith('http://127.0.0.1:'));
    assert.ok(page);
    await until(async () => await page.webContents.executeJavaScript('document.readyState === "complete" && document.title === "Local browsing"'));
    assert.equal(await page.webContents.executeJavaScript('typeof window.grid'), 'undefined');
    await ui('window.grid.home()');
    await until(async () => (await state()).mode === 'home' && await ui('document.querySelector("#welcome").getBoundingClientRect().height > 0'));
    if (mode === 'configure') {
      await assert.rejects(ui('window.grid.configureKey("short")'));
      assert.equal((await state()).keyReady, false);
      await ui(`document.querySelector('.provider-settings').open=true;document.querySelector('#provider-key').value=${JSON.stringify(manualKey)};document.querySelector('#provider-form').requestSubmit()`);
      await until(async () => (await state()).keyReady);
      assert.equal(await ui('document.querySelector("#provider-key").value'), '');
      assert.ok((await ui('document.querySelector("#provider-status").textContent')).includes('仅本次运行'));
      assert.equal(await ui('document.querySelector("#provider-enable").textContent'), '更换本次密钥');
      assert.ok(!JSON.stringify(await state()).includes(manualKey));
      const output = path.join(__dirname, '../.local');
      fs.mkdirSync(output, { recursive: true });
      win.webContents.setBackgroundThrottling(false);
      await ui('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(output, 'session-key-settings.png'), (await win.webContents.capturePage()).toPNG());
      await assert.rejects(ui('window.grid.configureKey("short")'));
      assert.equal((await state()).keyReady, true, 'Invalid replacement retains the working key');
      await ui('window.grid.windowNew()');
      await until(async () => {
        try { return await BrowserWindow.getAllWindows().find(other => other !== win).webContents.executeJavaScript('window.grid.state().then(s=>s.keyReady)'); } catch { return false; }
      });
      win.webContents.reload();
      await until(async () => { try { return (await state()).keyReady; } catch { return false; } });
      assert.equal(await ui('document.querySelector("#provider-key").value'), '');
    }
    if (mode !== 'restart') {
      await ui('window.grid.submit("会话凭据合成检查")');
      assert.equal((await state()).mode, 'results'); assert.equal(requests, 1);
    } else {
      await ui('window.grid.submit("重启后未配置")').catch(() => {});
      assert.equal(requests, 0); assert.equal((await state()).keyReady, false);
    }
    assert.equal(keychainCalls, 0); assert.equal(legacyReads, 0);
    await ui('window.grid.storageFlush()');
    console.log(JSON.stringify({ status: 'passed', keychainCalls, legacyReads }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(deadline); server.close(); app.quit(); }
});
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
