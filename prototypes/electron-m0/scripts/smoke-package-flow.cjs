// Test the delivered application, not source Electron with a different main entry.
// Seed only synthetic, projected tasks; no provider key, personal profile or test hooks in the bundle.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { promises: fs } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { BrowsingSession } = require('../dist/application/browsing-session');
const { TaskRepository } = require('../dist/storage/task-repository');

const bundle = path.resolve(process.argv[2] || path.join(__dirname, '../.local/release/Grid Preview.app'));
const output = path.join(__dirname, '../.local');
const source = '合成资料：个人方案保留七天，团队方案保留三十天。';
const calls = { search: 0, fetch: 0, model: 0, comparison: 0 };
const provider = {
  search: async () => { calls.search++; return ['a', 'b'].map(id => ({ title: '合成来源 ' + id.toUpperCase(), url: 'https://example.com/' + id, snippet: source, site: 'example.com', date: null })); },
  read: async url => { calls.fetch++; return { title: '合成来源 ' + url.slice(-1).toUpperCase(), content: source + '\nRAW_BODY_NOT_PERSISTED_96' }; },
  extract: async () => ({ text: '按账户类型区分保留期限。', truncated: false }),
  model: async () => { calls.model++; return { text: '账户类型不同，需要分别核对。', insufficient: false, citations: [{ source: 1, quote: source, title: '合成来源 A', url: 'https://example.com/a' }] }; },
  compare: async () => { calls.comparison++; return { overview: '两份合成来源提供同一段说明。', limitations: '仅用于自动流程检查。', rows: [{ aspect: '适用范围', relation: 'agreement', left: { status: 'supported', text: '依账户类型区分。', quotes: [source] }, right: { status: 'supported', text: '依账户类型区分。', quotes: [source] } }] }; }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(40); }
  throw new Error(label + ' timeout');
}
class Cdp {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') this.exceptions.push(message.params.exceptionDetails.text);
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debug connection closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new Cdp(socket);
  }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timeout')); }, 8000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}
async function launch(profile) {
  const env = { ...process.env }; delete env.DEEPSEEK_API_KEY; delete env.DeepSeek_ApiKeyN; delete env.ELECTRON_RUN_AS_NODE;
  const portFile = path.join(profile, 'DevToolsActivePort'); await fs.rm(portFile, { force: true });
  const child = spawn(path.join(bundle, 'Contents/MacOS/Grid Preview'), ['--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', port, browser, page;
  child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const exited = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: error.message })); });
  try {
    await until(async () => { try { port = (await fs.readFile(portFile, 'utf8')).trim().split('\n'); return port.length === 2; } catch { return false; } }, 'packaged debug port');
    browser = await Cdp.connect('ws://127.0.0.1:' + port[0] + port[1]);
    let target;
    await until(async () => { const targets = await (await fetch('http://127.0.0.1:' + port[0] + '/json/list', { signal: AbortSignal.timeout(1000) })).json(); target = targets.find(t => t.url === pathToFileURL(path.join(bundle, 'Contents/Resources/app/dist/renderer/index.html')).href); return Boolean(target); }, 'bundled renderer');
    page = await Cdp.connect(target.webSocketDebuggerUrl); await page.send('Runtime.enable');
    await until(() => page.evaluate('Boolean(window.grid && document.querySelector("#storage-list"))'), 'bundled preload');
    return { child, page, browser, exited, log: () => log };
  } catch (error) { page?.close(); browser?.close(); child.kill('SIGTERM'); await exited; throw error; }
}
async function quit(running, name) {
  // Browser.close goes through Electron's quit path; source tests independently check its save barrier.
  await running.browser.send('Browser.close').catch(() => {});
  let status;
  await Promise.race([running.exited.then(value => { status = value; }), delay(10000)]);
  if (!status) { running.child.kill('SIGTERM'); await running.exited; throw new Error('Packaged graceful quit timed out'); }
  running.page.close(); running.browser.close();
  await fs.writeFile(path.join(output, 'package-flow-' + name + '.log'), running.log());
  assert.equal(status.code, 0, JSON.stringify(status)); assert.deepEqual(running.page.exceptions, []);
}
async function screenshot(page, filename) {
  const result = await page.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, filename), Buffer.from(result.data, 'base64'));
}
(async () => {
  let running;
  try {
    await fs.mkdir(output, { recursive: true }); const profile = await fs.mkdtemp(path.join(tmpdir(), 'grid-delivered-flow-'));
    const session = new BrowsingSession(provider, () => {});
    await session.search('如何按账户类型比较保留期限？', 'learning', false); const results = session.snapshot();
    await session.read('https://example.com/a'); const readingA = session.snapshot(); session.beginQuestion();
    await session.ask('适用范围有什么差别？', session.snapshot().question.id); const question = session.snapshot();
    session.savePresentation(question.entryId, { ...question.presentation, questionDraft: '留到下次继续的问题' });
    session.jump(results.entryId); await session.read('https://example.com/b'); const readingB = session.snapshot();
    session.jump(results.entryId);
    for (const index of [0, 1]) session.chooseComparison({ kind: 'result', searchId: results.search.id, index });
    await session.startComparison(); const comparison = session.snapshot(); session.beginJudgment();
    const draft = session.snapshot().judgment;
    session.editJudgment({ draftId: draft.draftId, revision: 1, text: '我的合成判断：先区分账户类型。', checks: '核对原页更新日期。', citationIds: [draft.citations[0].id] });
    session.saveJudgment({ draftId: draft.draftId, revision: session.snapshot().judgment.revision }); const v1 = session.snapshot();
    const repository = new TaskRepository(path.join(profile, 'tasks-v1')); repository.receive(session.exportTask());
    repository.setWorkspace({ windows: [{ paths: [v1.path.id], selected: v1.path.id }], active: 0 }); await repository.flush();
    const build = JSON.parse(await fs.readFile(path.join(bundle, 'Contents/Resources/app/build-info.json'), 'utf8'));
    running = await launch(profile); const ui = code => running.page.evaluate(code); const state = () => ui('window.grid.state()');
    const click = id => ui(`document.getElementById(${JSON.stringify(id)}).click()`);
    const jump = async id => { const s = await state(); await ui(`window.grid.jump(${JSON.stringify(id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`); };
    await until(async () => (await state()).judgment?.version === 1, 'saved version');
    assert.notEqual((await state()).ownerId, v1.ownerId); assert.equal((await state()).keyReady, false);
    await jump(results.entryId); assert.equal(await ui('document.querySelectorAll("#result-list article").length'), 2);
    assert.equal(await ui('document.querySelector("#summary-slot").dataset.expanded'), 'false');
    await screenshot(running.page, 'package-flow-results.png');
    await jump(readingA.entryId); assert.ok((await state()).reading.released);
    await jump(question.entryId); assert.equal(await ui('document.querySelector("#question-input").value'), '留到下次继续的问题');
    await screenshot(running.page, 'package-flow-question.png');
    await jump(results.entryId); await ui('window.grid.forward()'); assert.equal((await state()).entryId, readingA.entryId);
    // Choosing B changes only the selected forward branch; A and its question remain available.
    await jump(readingB.entryId); await jump(results.entryId); await ui('window.grid.forward()'); assert.equal((await state()).entryId, readingB.entryId);
    await jump(comparison.entryId); assert.ok((await state()).comparison.sources.every(s => s.source.released));
    await screenshot(running.page, 'package-flow-comparison.png'); await jump(v1.entryId);
    await click('judgment-revise'); await until(async () => (await state()).judgment?.status === 'draft', 'revision draft');
    await ui('(()=>{const t=document.querySelector("#judgment-text");t.value="我的合成判断：修订后仍先核对账户类型。";t.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await until(async () => (await state()).judgment.text.includes('修订后'), 'retained revision');
    await ui('document.querySelector("#judgment-form").requestSubmit()'); await until(async () => (await state()).judgment?.version === 2 && (await state()).judgment.status === 'saved', 'new version');
    const v2 = await state();
    // Quit immediately after the UI save, without an explicit repository flush.
    await quit(running, 'first'); running = undefined;
    running = await launch(profile);
    await until(async () => (await state()).judgment?.version === 2, 'new process retains latest UI version');
    assert.equal((await state()).entryId, v2.entryId); assert.equal((await state()).scene, 'learning'); assert.equal((await state()).keyReady, false);
    assert.ok((await state()).judgment.text.includes('修订后')); assert.ok(!(await state()).agent?.page);
    await jump(v1.entryId); assert.equal((await state()).judgment.version, 1); await jump(v2.entryId);
    await screenshot(running.page, 'package-flow-judgment.png');
    await ui('window.grid.storagePanel(true)'); assert.ok(await ui('document.querySelector("#storage-list strong").textContent.includes("账户类型")'));
    await screenshot(running.page, 'package-flow-records.png');
    await quit(running, 'second'); running = undefined;
    const reader = new TaskRepository(path.join(profile, 'tasks-v1')); await reader.load(); const restored = JSON.stringify(reader.get(v1.path.id));
    assert.ok(!restored.includes('RAW_BODY_NOT_PERSISTED_96')); assert.ok(restored.includes('留到下次继续的问题'));
    const report = { status: 'passed', build, launches: 2, seedProviderCalls: calls, steps: ['bundled UI and preload', 'results and both branches', 'question draft', 'fixed comparison sources', 'UI revision v2', 'graceful quit and fresh process', 'old judgment v1', 'record query titles'], scope: 'synthetic seeded task; no personal key or live provider, no human content-quality claim' };
    await fs.writeFile(path.join(output, 'package-flow-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error.stack); process.exitCode = 1;
    if (running) { await screenshot(running.page, 'package-flow-failure.png').catch(() => {}); running.page.close(); running.browser.close(); running.child.kill('SIGTERM'); await running.exited; }
  }
})();
