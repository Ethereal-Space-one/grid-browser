const { app, BrowserWindow, clipboard, dialog } = require('electron');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const directory = path.join(__dirname, '../.local');
mkdirSync(directory, { recursive: true });
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-mcp-e2e-')));
delete process.env.DEEPSEEK_API_KEY;
delete process.env.DeepSeek_ApiKeyN;
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const report = [];
let client;
const fixture = http.createServer((request, response) => {
  if (request.url === '/private' && !request.headers.cookie?.includes('grid_mcp_session=fixture')) {
    response.writeHead(401); response.end('missing test session'); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Set-Cookie', 'grid_mcp_session=fixture; HttpOnly; SameSite=Strict; Path=/');
  response.end(`<!doctype html><html lang="zh-CN"><title>MCP session fixture</title><body>
    <h1>Grid MCP test</h1><p>橘色风筝 / session-shared-ok</p>
    <label>Private input<input value="DO_NOT_EXPORT_INPUT"></label>
    <label>Password<input type="password" value="DO_NOT_EXPORT_PASSWORD"></label>
    <div contenteditable="true">DO_NOT_EXPORT_EDITABLE</div>
    <button>Test button</button></body></html>`);
});
const deadline = setTimeout(() => { console.error('MCP end-to-end timeout'); app.exit(1); }, 60000);
async function until(check, name) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${name}: timeout`);
}

app.whenReady().then(async () => {
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${fixture.address().port}`;
    const win = BrowserWindow.getAllWindows()[0];
    const ui = script => win.webContents.executeJavaScript(script);
    await until(async () => {
      try { return Boolean(await ui('window.grid && window.grid.state().then(s => s.agent)')); }
      catch { return false; }
    }, 'startup');
    await ui(`window.grid.open(${JSON.stringify(url)})`);
    await ui(`window.grid.open(${JSON.stringify(url + '/private')})`);
    await ui(`window.grid.agentCopyConfig()`);
    const config = JSON.parse(await clipboard.readText()).mcpServers.grid;
    assert.equal(config.command, process.env.npm_node_execpath || 'node');
    assert.ok(!JSON.stringify(config).includes('token'));
    const started = Date.now();
    client = new Client({ name: 'Grid E2E coding-tool client', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: config.command, args: config.args, stderr: 'pipe' });
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(tools, ['grid_connection_status', 'grid_page_snapshot']);
    const status = await client.callTool({ name: 'grid_connection_status', arguments: {} });
    assert.equal(JSON.parse(status.content[0].text).authorized, false);
    report.push({ stage: 'stdio-initialize-and-tools', status: 'passed', milliseconds: Date.now() - started });
    const denied = await client.callTool({ name: 'grid_page_snapshot', arguments: {} });
    assert.equal(denied.isError, true);
    report.push({ stage: 'deny-before-user-grant', status: 'passed' });
    await until(async () => (await ui('window.grid.state()')).agent.connections.length === 1, 'pending authorization');
    await ui(`document.querySelector('#agent-connections button').click()`);
    await until(async () => (await ui('window.grid.state()')).agent.connections[0].authorized, 'grant');
    const result = await client.callTool({ name: 'grid_page_snapshot', arguments: {} });
    assert.ok(!result.isError);
    const snapshot = JSON.parse(result.content[0].text);
    assert.match(snapshot.text, /橘色风筝/);
    assert.match(snapshot.text, /session-shared-ok/);
    assert.doesNotMatch(JSON.stringify(snapshot), /DO_NOT_EXPORT|grid_mcp_session/);
    assert.equal(snapshot.url, url + '/private');
    report.push({ stage: 'same-session-cdp-read-with-field-filtering', status: 'passed' });
    writeFileSync(path.join(directory, 'mcp-authorized.png'), (await win.capturePage()).toPNG());

    const exportPath = path.join(directory, 'mcp-e2e-receipts.json');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
    await ui(`window.grid.agentExport()`);
    await until(() => existsSync(exportPath), 'JSON receipts');
    const receipts = JSON.parse(readFileSync(exportPath, 'utf8')).receipts;
    assert.ok(receipts.some(r => r.status === 'denied'));
    assert.ok(receipts.some(r => r.status === 'succeeded' && r.sha256));
    assert.doesNotMatch(JSON.stringify(receipts), /DO_NOT_EXPORT|橘色风筝|session-shared-ok/);
    report.push({ stage: 'metadata-only-json-receipts', status: 'passed' });
    await ui(`document.querySelector('#agent-connections button').click()`);
    assert.equal((await client.callTool({ name: 'grid_page_snapshot', arguments: {} })).isError, true);
    report.push({ stage: 'deny-after-revoke', status: 'passed' });
    await ui(`document.querySelector('#agent-connections button').click()`);
    await until(async () => (await ui('window.grid.state()')).agent.connections[0].authorized, 'regrant');
    await ui(`window.grid.open(${JSON.stringify(url)})`);
    assert.equal((await client.callTool({ name: 'grid_page_snapshot', arguments: {} })).isError, true);
    report.push({ stage: 'deny-after-same-origin-navigation', status: 'passed' });
    await client.close(); client = undefined;
    await until(async () => (await ui('window.grid.state()')).agent.connections.length === 0, 'client shutdown');
    report.push({ stage: 'disconnect-cleanup', status: 'passed' });
    const resultReport = { status: 'passed', report };
    writeFileSync(path.join(directory, 'mcp-e2e-report.json'), JSON.stringify(resultReport, null, 2));
    console.log(JSON.stringify(resultReport, null, 2));
  } catch (error) {
    const resultReport = { status: 'failed', reason: error.message, report };
    writeFileSync(path.join(directory, 'mcp-e2e-report.json'), JSON.stringify(resultReport, null, 2));
    console.error(JSON.stringify(resultReport, null, 2));
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    if (client) await client.close();
    fixture.close();
    app.quit();
  }
});
