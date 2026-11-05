// Opt-in, model-backed test. Only synthetic localhost text may leave Grid.
const { app, BrowserWindow, clipboard, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');

const selected = process.argv.find(a => a.startsWith('--host='))?.slice(7);
if (selected && !['codex', 'claude'].includes(selected)) throw new Error('Use --host=codex or --host=claude');
const hostTimeout = Number(process.argv.find(a => a.startsWith('--host-timeout='))?.split('=')[1] || 90000);
if (!Number.isInteger(hostTimeout) || hostTimeout < 1000 || hostTimeout > 180000) throw new Error('Host timeout must be 1000–180000 ms');
const proposeMode = process.argv.includes('--propose');
const hosts = selected ? [selected] : ['codex', 'claude'];
const directory = path.join(__dirname, '../.local');
mkdirSync(directory, { recursive: true });
const temporary = mkdtempSync(path.join(tmpdir(), 'grid-host-e2e-'));
app.setPath('userData', path.join(temporary, 'browser'));
delete process.env.DEEPSEEK_API_KEY;
delete process.env.DeepSeek_ApiKeyN;
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const report = [];
let child;
let marker;
const fixture = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><title>Grid coding host fixture</title><body>
    <h1>Grid synthetic host test</h1><p>Verification code: ${marker}</p>
    <label>任务代号 <input name="task"></label><p id="submitted">尚未提交</p>
    <input value="DO_NOT_EXPORT_HOST_INPUT"><input type="password" value="DO_NOT_EXPORT_HOST_PASSWORD">
    <div contenteditable="true">DO_NOT_EXPORT_HOST_EDITABLE</div></body></html>`);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await check()) return; await pause(75); }
  throw new Error(`${label}: timeout`);
}
function stopChild() {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}
function category(output, timedOut) {
  if (/OAuth token revoked|not logged in|please log in|authentication|unauthorized|401|invalid.*key/i.test(output)) return 'host-authentication';
  if (/ENOTFOUND|EAI_AGAIN|network|connection refused|fetch failed|error sending request|tls handshake|websocket/i.test(output)) return 'host-network';
  return timedOut ? 'host-timeout' : 'host-or-protocol-error';
}

app.whenReady().then(async () => {
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${fixture.address().port}`;
    const win = BrowserWindow.getAllWindows()[0];
    const ui = script => win.webContents.executeJavaScript(script);
    await until(async () => {
      try { return Boolean((await ui('window.grid.state()')).agent); } catch { return false; }
    }, 'Grid startup');
    for (const host of hosts) {
      marker = `GRID-HOST-${randomBytes(12).toString('hex')}`;
      const pageUrl = url + (proposeMode ? '/actions.html?host=' + host : '/' + host);
      await ui(`window.grid.open(${JSON.stringify(pageUrl)})`);
      await ui('window.grid.agentCopyConfig()');
      const config = JSON.parse(await clipboard.readText());
      const server = config.mcpServers.grid;
      const cwd = path.join(temporary, host);
      mkdirSync(cwd);
      const prompt = (proposeMode ? 'After reading the Verification code, call grid_form_propose with that exact code as value. Do not confirm, submit, or run scripts. The synthetic test harness will pause then confirm in Grid. Poll grid_form_status up to 12 times until completed. Return the code and say completed ONLY if the tool reports completed. ' : '') + 'Use only the Grid MCP tools. Call grid_connection_status, then grid_page_snapshot. '
        + 'The first snapshot must be denied: this is expected. The test harness will then approve the synthetic page in Grid. '
        + 'Retry grid_connection_status and grid_page_snapshot up to five times until authorized. '
        + (proposeMode ? 'Return the Verification code and the observed final proposal status. ' : 'Return only the Verification code from the page. ') + 'Do not guess it. Do not read files or use shell, web or other tools.';
      let args;
      if (host === 'codex') {
        const toml = `{ command = ${JSON.stringify(server.command)}, args = ${JSON.stringify(server.args)}, startup_timeout_sec = 15, tool_timeout_sec = 15, default_tools_approval_mode = "approve" }`;
        args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
          '-c', `mcp_servers.grid=${toml}`, '--json', prompt];
      } else {
        const configPath = path.join(cwd, 'mcp.json');
        writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
        args = ['-p', '--strict-mcp-config', '--mcp-config', configPath, '--tools', '',
          '--allowedTools', 'mcp__grid__grid_connection_status', 'mcp__grid__grid_page_snapshot', ...(proposeMode ? ['mcp__grid__grid_form_propose', 'mcp__grid__grid_form_status'] : []),
          '--no-session-persistence', '--output-format', 'stream-json', '--verbose', prompt];
      }
      const started = Date.now();
      let output = '';
      let overflow = false;
      let timedOut = false;
      let connectionMs;
      let connectionId;
      let grantMs;
      let readMs;
      let proposalMs;
      let confirmedMs;
      let previewVerified = false;
      let completed = false;
      let failure;
      let closed = false;
      let exitCode;
      const receiptPath = path.join(temporary, `${host}-receipts.json`);
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: receiptPath });
      child = spawn(host, args, { cwd, env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
        detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = chunk => {
        if (output.length + chunk.length > 2 * 1024 * 1024) { overflow = true; stopChild(); return; }
        output += chunk;
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.on('error', error => { failure = error.code || 'spawn-error'; closed = true; });
      child.on('close', code => { exitCode = code; closed = true; });
      console.log(`${host}: started (${hostTimeout / 1000} second deadline; synthetic page only)`);
      while (!closed && Date.now() - started < hostTimeout) {
        const fullState = await ui('window.grid.state()');
        const state = fullState.agent;
        const connection = state.connections[0];
        if (connection && connectionMs === undefined) { connectionMs = Date.now() - started; connectionId = connection.id; }
        await ui('window.grid.agentExport()');
        const receipts = JSON.parse(readFileSync(receiptPath, 'utf8')).receipts;
        // Never auto-grant a real page; URL and denial are both required.
        if (connection && grantMs === undefined && receipts.some(r => r.connectionId === connectionId && r.status === 'denied')) {
          assert.equal(state.page.url, pageUrl);
          await ui('document.querySelector("#agent-connections button").click()');
          grantMs = Date.now() - started;
        }
        if (readMs === undefined && receipts.some(r => r.connectionId === connectionId && r.status === 'succeeded' && r.url === pageUrl)) readMs = Date.now() - started;
        if (proposeMode && connectionId && fullState.action?.owner?.id === connectionId && fullState.action.status === 'preview' && confirmedMs === undefined) {
          assert.equal(state.page.url, pageUrl);
          assert.equal(fullState.action.value, marker);
          const remote = win.contentView.children.find(v => v.webContents && /^https?:/.test(v.webContents.getURL())).webContents;
          assert.equal(await remote.executeJavaScript('document.querySelector("input[name=task]").value'), '');
          proposalMs = Date.now() - started;
          await until(async () => await ui('document.querySelector("#action-status").textContent.includes("请确认")'), 'preview rendered');
          await ui('document.querySelector("#action-pause").click()');
          await until(async () => (await ui('window.grid.state()')).action.status === 'paused', 'paused');
          assert.equal(await remote.executeJavaScript('document.querySelector("input[name=task]").value'), '');
          previewVerified = true;
          await ui('document.querySelector("#action-resume").click()');
          await until(async () => (await ui('window.grid.state()')).action.status === 'preview', 'resumed');
          await pause(250);
          assert.equal(await ui(`(() => {
            const panel = document.querySelector('#agent-panel').getBoundingClientRect();
            const button = document.querySelector('#action-confirm').getBoundingClientRect();
            return button.top >= panel.top && button.bottom <= panel.bottom;
          })()`), true, 'confirmation must be visible without scrolling');
          writeFileSync(path.join(directory, `${host}-form-preview.png`), (await win.capturePage()).toPNG());
          await ui('document.querySelector("#action-confirm").click()');
          await until(async () => (await ui('window.grid.state()')).action.status === 'completed', 'confirmed fill');
          confirmedMs = Date.now() - started;
          assert.equal(await remote.executeJavaScript('document.querySelector("input[name=task]").value'), marker);
          assert.equal(await remote.executeJavaScript('document.querySelector("#submitted").textContent'), '尚未提交');
          completed = true;
        }
        await pause(100);
      }
      if (!closed) { timedOut = true; stopChild(); await until(() => closed, 'host shutdown'); }
      await ui('window.grid.agentExport()');
      const receipts = JSON.parse(readFileSync(receiptPath, 'utf8')).receipts;
      const succeeded = receipts.some(r => r.connectionId === connectionId && r.status === 'succeeded' && r.url === pageUrl);
      const denied = receipts.some(r => r.connectionId === connectionId && r.status === 'denied');
      const finalMessages = output.split('\n').flatMap(line => {
        try {
          const event = JSON.parse(line);
          if (host === 'codex' && event.type === 'item.completed' && event.item?.type === 'agent_message') return [event.item.text];
          if (host === 'claude' && event.type === 'result' && typeof event.result === 'string') return [event.result];
        } catch { /* Non-JSON diagnostics are not answers. */ }
        return [];
      });
      const codeSeen = finalMessages.at(-1)?.includes(marker) === true;
      const fieldsFiltered = !output.includes('DO_NOT_EXPORT_HOST_');
      const passed = exitCode === 0 && !timedOut && !overflow && denied && succeeded && codeSeen && fieldsFiltered && (!proposeMode || (previewVerified && completed));
      report.push({ host, status: passed ? 'passed' : 'failed', exitCode: exitCode ?? null,
        reason: passed ? undefined : failure || (overflow ? 'output-limit' : category(output, timedOut)),
        proposalMs, confirmedMs, previewVerified, completed,
        connectionMs, grantMs, firstReadMs: readMs, elapsedMs: Date.now() - started,
        deniedBeforeGrant: denied, receiptConfirmedRead: succeeded, codeSeen, fieldsFiltered });
      stopChild(); child = undefined;
      await until(async () => (await ui('window.grid.state()')).agent.connections.length === 0, 'connection cleanup');
      console.log(JSON.stringify(report.at(-1)));
    }
  } catch (error) {
    // Do not persist raw CLI output, configuration, page bodies or credentials.
    report.push({ status: 'failed', reason: error.message });
  } finally {
    stopChild();
    const result = { date: new Date().toISOString(), scope: 'Synthetic local page; automated consent, not user onboarding timing',
      status: report.length === hosts.length && report.every(r => r.status === 'passed') ? 'passed' : 'failed', report };
    writeFileSync(path.join(directory, proposeMode ? 'hosts-form-e2e-report.json' : 'hosts-e2e-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'passed' ? 0 : 1;
    fixture.close();
    app.quit();
    rmSync(temporary, { recursive: true, force: true });
  }
});
