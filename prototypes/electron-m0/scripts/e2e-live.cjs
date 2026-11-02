// Run with Electron, using the production UI, IPC and network client.
const { app, BrowserWindow, webContents } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

if (!(process.env.DEEPSEEK_API_KEY || process.env.DeepSeek_ApiKeyN)) {
  console.error('请先在本机终端导出 DEEPSEEK_API_KEY 或 DeepSeek_ApiKeyN。');
  app.exit(1);
} else {
  app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-live-e2e-')));
  require('../dist/main.js');
  const report = [];
  const keepOpen = process.argv.includes('--keep-open');
  let finished = false;
  function finish(status, reason) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const result = { status, ...(reason ? { reason } : {}), report };
    const directory = path.join(__dirname, '../.local');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'e2e-live-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    console.log('测试报告已保存至 .local/e2e-live-report.json');
    process.exitCode = status === 'passed' ? 0 : 1;
    if (keepOpen) {
      console.log('测试已结束，窗口保留供检查；关闭窗口即可退出。');
      app.once('window-all-closed', () => app.quit());
    } else {
      console.log('测试已结束，正在正常关闭测试窗口。继续试用请运行 npm start。');
      app.quit();
    }
  }
  const timer = setTimeout(() => {
    finish('failed', 'overall timeout');
  }, 90000);

  async function until(check, label, timeout = 22000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${label}: timeout`);
  }

  app.whenReady().then(async () => {
    try {
      const win = BrowserWindow.getAllWindows()[0];
      const ui = code => win.webContents.executeJavaScript(code);
      await until(async () => {
        try { return await ui('Boolean(window.grid && document.querySelector("#input"))'); }
        catch { return false; }
      }, 'UI startup');
      assert.equal((await ui('window.grid.state()')).keyReady, true);
      report.push({ stage: 'startup', status: 'passed' });

      const query = 'Electron WebContentsView site:electronjs.org';
      await ui(`document.querySelector('#input').value = ${JSON.stringify(query)}; document.querySelector('#input-form').requestSubmit();`);
      await until(async () => {
        const error = await ui(`!document.querySelector('#error').classList.contains('hidden') && document.querySelector('#error').textContent`);
        if (error) throw new Error(`Search: ${error}`);
        return await ui(`document.querySelectorAll('.result').length > 0`);
      }, 'Search result rendering');
      const count = await ui(`document.querySelectorAll('.result').length`);
      report.push({ stage: 'search-render', status: 'passed', count });

      await ui(`document.querySelector('.result-actions button:nth-child(2)').click()`);
      await until(async () => {
        const error = await ui(`!document.querySelector('#error').classList.contains('hidden') && document.querySelector('#error').textContent`);
        if (error) throw new Error(`Fetch: ${error}`);
        return await ui(`!document.querySelector('#reading').classList.contains('hidden') && document.querySelector('#reading-content').textContent.length > 0`);
      }, 'Fetch reading view');
      const source = await ui(`document.querySelector('#reading-source').textContent`);
      report.push({ stage: 'fetch-reading', status: 'passed', source });

      await ui(`document.querySelector('#open-reading-source').click()`);
      const page = await until(() => webContents.getAllWebContents().find(item => item.id !== win.webContents.id && item.getURL().startsWith(source) && !item.isLoadingMainFrame()), 'Original page');
      const length = await page.executeJavaScript('document.body.innerText.length');
      assert.ok(length > 0, 'Original page should contain readable text');
      assert.equal(await page.executeJavaScript('typeof process'), 'undefined');
      report.push({ stage: 'original-page', status: 'passed', characters: length });

      await ui(`document.querySelector('#return-results').click()`);
      await until(async () => (await ui('window.grid.state()')).mode === 'results', 'Return to results');
      assert.equal(await ui(`document.querySelector('#results').classList.contains('hidden')`), false);
      assert.equal(await ui(`document.querySelector('#input').value`), query);
      assert.equal(await ui(`document.querySelectorAll('.result').length`), count);
      report.push({ stage: 'return-results', status: 'passed' });
      finish('passed');
    } catch (error) {
      finish('failed', error.message);
    }
  });
}
