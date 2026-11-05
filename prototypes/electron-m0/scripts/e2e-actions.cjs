const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { app, BrowserWindow, clipboard, dialog } = require('electron');
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-action-e2e-')));
delete process.env.DEEPSEEK_API_KEY; delete process.env.DeepSeek_ApiKeyN;
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const report = [];
let client;
const fixture = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(path.join(__dirname, '../../../fixtures/web/actions.html'))); });
const deadline = setTimeout(() => app.exit(1), 45000);
app.whenReady().then(async () => {
  try {
    await new Promise(r => fixture.listen(0, '127.0.0.1', r));
    const win = BrowserWindow.getAllWindows()[0];
    const ui = code => win.webContents.executeJavaScript(code);
    for (let n = 0; n < 100; n++) { try { if (await ui('Boolean(window.grid)')) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    const url = `http://127.0.0.1:${fixture.address().port}`;
    await ui(`window.grid.open(${JSON.stringify(url + '/actions.html')})`);
    await ui('window.grid.agentPanel(true)');
    const content = win.contentView.children.find(v => v.webContents && /^https?:/.test(v.webContents.getURL())).webContents;
    const value = () => content.executeJavaScript('document.querySelector("input[name=task]").value');
    const preview = () => ui('window.grid.actionPreview("合成任务-42")');
    const confirm = () => ui('window.grid.state().then(s => window.grid.actionConfirm(s.action.id))');
    await ui('document.querySelector(".form-action details").open = true; document.querySelector("#action-value").value = "合成任务-42"; document.querySelector("#action-preview").click()');
    for (let n = 0; n < 100; n++) {
      if (await ui('document.querySelector("#action-content").textContent.includes("合成任务-42")')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(await ui('document.querySelector("#action-content").textContent.includes("合成任务-42")'));
    assert.equal(await value(), ''); report.push('preview-does-not-mutate');
    await ui('window.grid.actionPause()'); await assert.rejects(confirm()); assert.equal(await value(), ''); report.push('pause-blocks-confirm');
    await ui('window.grid.actionResume()'); assert.equal(await value(), '');
    mkdirSync(path.join(__dirname, '../.local'), { recursive: true });
    await new Promise(r => setTimeout(r, 300));
    writeFileSync(path.join(__dirname, '../.local/actions-preview.png'), (await win.capturePage()).toPNG());
    for (let n = 0; n < 100; n++) {
      if (await ui('!document.querySelector("#action-confirm").disabled')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    win.focus(); win.webContents.focus();
    await ui('document.querySelector("#action-confirm").focus()');
    assert.equal(await ui('document.activeElement.id'), 'action-confirm');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    for (let n = 0; n < 100; n++) {
      if ((await ui('window.grid.state()')).action?.status === 'completed') break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(await value(), '合成任务-42');
    assert.equal(await content.executeJavaScript('document.querySelector("#result").textContent'), '');
    await assert.rejects(confirm()); report.push('confirm-fills-once-without-submit');
    await preview(); await ui('window.grid.actionCancel()'); await assert.rejects(confirm()); report.push('takeover-invalidates-draft');
    await preview(); await content.executeJavaScript('document.querySelector("input[name=task]").value = "human-edit"');
    await assert.rejects(confirm()); assert.equal(await value(), 'human-edit'); report.push('human-edit-preserved');
    await preview(); await content.executeJavaScript('document.querySelector("input[name=task]").outerHTML = \'<input name="task">\'');
    await assert.rejects(confirm()); report.push('replaced-target-rejected');
    await preview(); await ui(`window.grid.open(${JSON.stringify(url + '/actions.html?new=1')})`); await assert.rejects(confirm()); report.push('navigation-invalidates-draft');
    await ui(`window.grid.open(${JSON.stringify(url + '/other.html')})`); await assert.rejects(preview()); report.push('other-routes-denied');
    await ui(`window.grid.open(${JSON.stringify(url + '/actions.html')})`);
    await ui('window.grid.agentCopyConfig()');
    const config = JSON.parse(await clipboard.readText()).mcpServers.grid;
    client = new Client({ name: 'Form proposal test client', version: '1.0' });
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, stderr: 'pipe' }));
    const call = (name, args = {}) => client.callTool({ name, arguments: args });
    await call('grid_connection_status');
    assert.equal((await call('grid_form_propose', { value: 'external-plan' })).isError, true);
    await ui('window.grid.state().then(s => window.grid.agentGrant(s.agent.connections[0].id,s.agent.page?.documentId))');
    const proposal = await call('grid_form_propose', { value: 'external-plan' });
    assert.ok(!proposal.isError);
    assert.equal(await value(), '');
    assert.equal((await call('grid_form_propose', { value: 'overwrite' })).isError, true);
    assert.equal((await call('grid_form_propose', { value: 'x', confirm: true })).isError, true);
    await confirm(); assert.equal(await value(), 'external-plan');
    assert.equal(JSON.parse((await call('grid_form_status')).content[0].text).status, 'completed');
    report.push('stdio-proposal-only-user-confirms-and-no-overwrite');
    await call('grid_form_propose', { value: 'revoke-test' });
    await ui('window.grid.state().then(s => window.grid.agentRevoke(s.agent.connections[0].id))');
    await assert.rejects(confirm());
    report.push('revoke-cancels-external-plan');
    await ui('window.grid.state().then(s => window.grid.agentGrant(s.agent.connections[0].id,s.agent.page?.documentId))');
    await call('grid_form_propose', { value: 'disconnect-test' });
    await client.close(); client = undefined;
    for (let n = 0; n < 100; n++) {
      if (!(await ui('window.grid.state()')).agent.connections.length) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await assert.rejects(confirm()); report.push('disconnect-cancels-external-plan');
    const receiptPath = path.join(__dirname, '../.local/actions-receipts.json');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: receiptPath });
    await ui('window.grid.agentExport()');
    const exported = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.ok(exported.formActions.some(r => r.status === 'completed' && r.connectionId));
    assert.doesNotMatch(JSON.stringify(exported), /external-plan|revoke-test|disconnect-test|合成任务/);
    report.push('export-action-metadata-without-values');
    writeFileSync(path.join(__dirname, '../.local/actions-e2e-report.json'), JSON.stringify({ status: 'passed', report }, null, 2));
    console.log(JSON.stringify({ status: 'passed', report }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (client) await client.close(); clearTimeout(deadline); fixture.close(); app.quit(); }
});
