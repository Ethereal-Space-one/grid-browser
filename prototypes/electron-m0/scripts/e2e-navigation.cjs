const { app, BrowserWindow, clipboard, nativeTheme } = require('electron');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os'); const path = require('node:path'); const http = require('node:http');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-navigation-')));
process.env.DEEPSEEK_API_KEY = 'synthetic-navigation-key'; delete process.env.DeepSeek_ApiKeyN;
const report = []; const traffic = []; let same = 0; let posts = 0; let slow;
global.fetch = async url => new Response(JSON.stringify(url.endsWith('/search') ? { results: [] } : { title: 'Synthetic reading', content: 'Synthetic source only.' }), { headers: { 'Content-Type': 'application/json' } });
const fixture = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); traffic.push({ path: url.pathname, method: req.method });
  if (req.method === 'POST') posts++;
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/slow') { slow = res; return; }
  if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/redirected' }); res.end(); return; }
  if (url.pathname === '/post-redirect' && req.method === 'POST') { res.writeHead(303, { Location: '/redirected' }); res.end(); return; }
  if (url.pathname === '/same') same++;
  const label = url.pathname === '/same' ? 'same-' + same : url.pathname === '/receipt' ? req.method + '-receipt-' + posts : url.pathname;
  res.end(`<!doctype html><title>${label}</title><h1 id="marker">${label}</h1><input id="draft"><a id="next" href="${url.pathname === '/a' ? '/b' : '/same'}">下一页</a><form method="POST" action="/receipt"><input name="synthetic" value="fixture"><button id="post">提交合成任务</button></form><form method="POST" action="/post-redirect"><button id="post-redirect">提交并跳转</button></form>${url.pathname === '/with-frame' ? '<iframe id="sub" src="/redirect"></iframe>' : ''}<script>onpopstate=()=>{document.querySelector('#marker').textContent=history.state?.view||location.pathname;};</script>`);
});
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const deadline = setTimeout(() => app.exit(1), 90000);
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check, label) { for (let n = 0; n < 260; n++) { if (await check()) return; await pause(); } throw new Error(label || 'navigation timeout'); }
app.whenReady().then(async () => {
  let client; let stage = 'startup';
  const win = BrowserWindow.getAllWindows()[0]; const ui = code => win.webContents.executeJavaScript(code);
  const state = () => ui('window.grid.state()');
  const view = () => win.contentView.children.find(v => v.webContents && /^https?:/.test(v.webContents.getURL()))?.webContents;
  const jump = async id => { const s = await state(); await ui(`window.grid.jump(${JSON.stringify(id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`); };
  const stable = url => until(async () => { const s = await state(); return s.mode === 'page' && !s.pageRecovery && s.value === url && view() && !view().isLoadingMainFrame(); }, 'stable ' + url);
  const passed = name => { report.push(name); console.log(JSON.stringify({ stage: name, status: 'passed' })); };
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + fixture.address().port;
    await until(async () => { try { return await ui('Boolean(window.grid)'); } catch { return false; } });
    stage = 'mixed history';
    await ui('window.grid.submit("合成问题",{contextual:false})');
    const results = (await state()).entryId;
    await ui('window.grid.read("https://example.com/article")'); const reading = (await state()).entryId;
    await ui(`window.grid.open(${JSON.stringify(base + '/a')})`); await stable(base + '/a');
    await view().executeJavaScript('document.querySelector("#next").click()'); await stable(base + '/b');
    const b = (await state()).entryId;
    await view().executeJavaScript('document.querySelector("#next").click()'); await stable(base + '/same');
    const c = (await state()).entryId;
    assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'same-1');
    await jump(reading); assert.equal((await state()).mode, 'reading');
    await jump(results); assert.equal((await state()).mode, 'results');
    await jump(b); await stable(base + '/b');
    passed('trusted-node-jump-and-buttons-share-mixed-product-and-native-history');

    stage = 'same URL branch reuse';
    await view().executeJavaScript('document.querySelector("#next").click()'); await stable(base + '/same');
    const d = (await state()).entryId; assert.notEqual(c, d);
    assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'same-2');
    await ui('window.grid.agentCopyConfig()');
    const config = JSON.parse(await clipboard.readText()).mcpServers.grid;
    client = new Client({ name: 'Navigation synthetic client', version: '1.0' });
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, stderr: 'pipe' }));
    const call = name => client.callTool({ name, arguments: {} });
    await call('grid_connection_status');
    await ui('window.grid.state().then(s=>window.grid.agentGrant(s.agent.connections[0].id,s.agent.page.documentId))');
    assert.ok(!(await call('grid_page_snapshot')).isError);
    const beforeLost = traffic.length;
    await jump(c);
    assert.equal((await state()).entryId, c); assert.equal((await state()).pageRecovery.kind, 'history-lost');
    assert.equal(view(), undefined, 'wrong live visit is hidden'); assert.equal(traffic.length, beforeLost);
    assert.equal((await state()).agent.page, undefined); assert.equal((await call('grid_page_snapshot')).isError, true);
    passed('reused-index-and-identical-URL-never-substitute-another-visit-or-read-grant');
    const lost = await state();
    await ui(`window.grid.reopenPage(${JSON.stringify(c)},${JSON.stringify(lost.ownerId)},${JSON.stringify(lost.pageRecovery.id)})`);
    await stable(base + '/same'); assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'same-3');
    assert.equal((await state()).entryId, c); assert.equal((await call('grid_page_snapshot')).isError, true);
    passed('explicit-reopen-performs-new-GET-in-the-same-node-without-restoring-grant');

    stage = 'POST restoration';
    await ui(`window.grid.open(${JSON.stringify(base + '/form')})`); await stable(base + '/form');
    await view().executeJavaScript('document.querySelector("#post").click()'); await stable(base + '/receipt');
    const postNode = (await state()).entryId; assert.equal(posts, 1);
    await ui('window.grid.back()'); await stable(base + '/form');
    await ui('window.grid.forward()');
    assert.equal((await state()).pageRecovery.kind, 'submission'); assert.equal(posts, 1);
    const blocked = await state();
    await ui('window.grid.reload()'); assert.equal(posts, 1);
    await assert.rejects(ui(`window.grid.reopenPage(${JSON.stringify(postNode)},${JSON.stringify(blocked.ownerId)},${JSON.stringify(blocked.pageRecovery.id)})`));
    const directory = path.join(__dirname, '../.local'); mkdirSync(directory, { recursive: true });
    await ui('window.grid.agentPanel(false)');
    win.setSize(720, 480); nativeTheme.themeSource = 'light';
    await until(async () => await ui('document.activeElement.id === "page-recovery-title" && innerWidth === 720'));
    await ui('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await ui('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
    assert.ok(await ui('(()=>{const r=document.querySelector("#reopen-page").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=124&&r.bottom<=innerHeight;})()'));
    assert.ok((await state()).pageRecovery.url.endsWith('/receipt'), 'recovery identifies the unavailable visit');
    assert.equal(await ui('document.querySelector("#input").value'),base+'/receipt','address identifies the current visit while exploration name stays stable');
    writeFileSync(path.join(directory, 'navigation-post-recovery.png'), (await win.capturePage()).toPNG());
    nativeTheme.themeSource = 'dark';
    await ui('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await ui('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
    writeFileSync(path.join(directory, 'navigation-post-recovery-dark.png'), (await win.capturePage()).toPNG());
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await until(async () => await ui('document.activeElement.id === "reopen-page"'));
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await stable(base + '/receipt');
    nativeTheme.themeSource = 'system'; win.setSize(1180, 820);
    assert.equal(posts, 1); assert.ok(traffic.some(r => r.path === '/receipt' && r.method === 'GET'));
    passed('POST-back-forward-reload-and-stale-reopen-never-repeat-submission');
    passed('recovery-focus-keyboard-and-light-dark-minimum-window-layout');

    stage = 'POST redirect';
    await ui(`window.grid.open(${JSON.stringify(base + '/form')})`); await stable(base + '/form');
    await view().executeJavaScript('document.querySelector("#post-redirect").click()'); await stable(base + '/redirected');
    const redirectedPost = (await state()).entryId; assert.equal(posts, 2);
    await ui('window.grid.back()'); await stable(base + '/form'); await jump(redirectedPost);
    assert.equal((await state()).pageRecovery.kind, 'submission'); assert.equal(posts, 2);
    passed('POST-to-GET-redirect-keeps-the-submission-boundary');

    stage = 'SPA and anchors';
    await ui(`window.grid.open(${JSON.stringify(base + '/spa')})`); await stable(base + '/spa');
    await view().executeJavaScript('history.pushState({view:"first"},"","/spa/same");document.querySelector("#marker").textContent="first"');
    await stable(base + '/spa/same'); const first = (await state()).entryId;
    await view().executeJavaScript('history.pushState({view:"second"},"","/spa/same");document.querySelector("#marker").textContent="second"');
    await until(async () => (await state()).entryId !== first && !(await state()).pageRecovery, 'same URL SPA');
    const second = (await state()).entryId; await jump(first); await stable(base + '/spa/same');
    assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'first');
    await jump(second); await stable(base + '/spa/same');
    assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'second');
    const count = (await state()).path.nodes.length;
    await view().executeJavaScript('location.hash="anchor"'); await stable(base + '/spa/same#anchor');
    assert.equal((await state()).entryId, second); assert.equal((await state()).path.nodes.length, count);
    passed('same-URL-SPA-visits-stay-distinct-and-anchor-does-not-create-a-node');

    stage = 'SPA branch reuse and page-initiated back';
    await jump(first); await stable(base + '/spa/same');
    const beforeTraversal = (await state()).path.nodes.length;
    await view().executeJavaScript('history.pushState({view:"third"},"","/spa/same");document.querySelector("#marker").textContent="third"');
    await until(async () => (await state()).entryId !== first && !(await state()).pageRecovery);
    const third = (await state()).entryId; assert.notEqual(third, second);
    const beforeSpaJump = traffic.length;
    await jump(second); assert.equal((await state()).pageRecovery.kind, 'history-lost');
    assert.equal(view(), undefined); assert.equal(traffic.length, beforeSpaJump);
    await jump(third); await stable(base + '/spa/same');
    assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'third');
    await view().executeJavaScript('history.back()');
    await until(async () => (await state()).entryId === first && !(await state()).pageRecovery);
    assert.equal((await state()).path.nodes.length, beforeTraversal + 1);
    passed('SPA-branch-reuses-no-old-visit-and-page-initiated-back-selects-existing-node');

    stage = 'SPA replacement';
    await view().executeJavaScript('history.replaceState({view:"replacement"},"","/spa/replaced");document.querySelector("#marker").textContent="replacement"');
    await stable(base + '/spa/replaced'); const replaced = (await state()).entryId;
    assert.notEqual(replaced, first); assert.equal((await state()).path.nodes.length, beforeTraversal + 2);
    const beforeReplaceJump = traffic.length;
    await jump(first); assert.equal((await state()).pageRecovery.kind, 'history-lost');
    assert.equal(view(), undefined); assert.equal(traffic.length, beforeReplaceJump);
    await jump(replaced); await stable(base + '/spa/replaced');
    assert.equal(await view().executeJavaScript('document.querySelector("#marker").textContent'), 'replacement');
    passed('SPA-route-replacement-keeps-the-old-step-with-explicit-loss-of-native-state');

    stage = 'redirect and ownership';
    const beforeRedirect = (await state()).path.nodes.length;
    await ui(`window.grid.open(${JSON.stringify(base + '/redirect')})`); await stable(base + '/redirected');
    assert.equal((await state()).path.nodes.length, beforeRedirect + 1);
    const owned = await state();
    await assert.rejects(ui(`window.grid.jump("foreign-node",${JSON.stringify(owned.ownerId)},${JSON.stringify(owned.entryId)})`));
    await assert.rejects(ui(`window.grid.jump(${JSON.stringify(first)},${JSON.stringify(owned.ownerId)},"stale-from-node")`));
    const other = await ui('window.grid.tabNew()');
    await assert.rejects(ui(`window.grid.jump(${JSON.stringify(first)},${JSON.stringify(owned.ownerId)},${JSON.stringify(owned.entryId)})`));
    await ui(`window.grid.tabSelect(${JSON.stringify(owned.ownerId)})`);
    passed('redirect-is-one-step-and-foreign-or-stale-node-commands-are-rejected');

    stage = 'native history removed';
    view().navigationHistory.clear();
    const beforeClearJump = traffic.length;
    await jump(replaced); assert.equal((await state()).pageRecovery.kind, 'history-lost');
    assert.equal(view(), undefined); assert.equal(traffic.length, beforeClearJump);
    passed('removed-native-history-never-guesses-or-automatically-refetches-a-visit');

    stage = 'superseded native load';
    const loading = ui(`window.grid.open(${JSON.stringify(base + '/slow')})`);
    await until(() => Boolean(slow), 'slow request received');
    await jump(results); await loading;
    slow.end('<!doctype html><title>late</title><h1>late page</h1>');
    await pause();
    assert.equal((await state()).entryId, results); assert.equal((await state()).mode, 'results');
    assert.equal(view(), undefined);
    passed('superseded-native-load-cannot-replace-the-selected-product-node');

    await ui(`window.grid.open(${JSON.stringify(base + '/redirected')})`); await stable(base + '/redirected');

    stage = 'crash and invalid native history';
    const crashed = view();
    await new Promise(resolve => { crashed.once('render-process-gone', resolve); crashed.forcefullyCrashRenderer(); });
    await until(async () => (await state()).pageRecovery?.kind === 'history-lost');
    assert.equal(view(), undefined);
    const crashState = await state(); const beforeReopen = traffic.length;
    await pause(); assert.equal(traffic.length, beforeReopen);
    await ui(`window.grid.reopenPage(${JSON.stringify(crashState.entryId)},${JSON.stringify(crashState.ownerId)},${JSON.stringify(crashState.pageRecovery.id)})`);
    await stable(base + '/redirected');
    assert.equal((await call('grid_page_snapshot')).isError, true);
    passed('renderer-crash-requires-explicit-reopen-and-never-revives-a-grant');

    stage = 'destroyed web view';
    const destroyed = view(); const beforeDestroy = traffic.length;
    await new Promise(resolve => { destroyed.once('destroyed', resolve); destroyed.close(); });
    await until(async () => (await state()).pageRecovery?.kind === 'history-lost');
    assert.equal(view(), undefined); assert.equal(traffic.length, beforeDestroy);
    const closedState = await state();
    await ui(`window.grid.reopenPage(${JSON.stringify(closedState.entryId)},${JSON.stringify(closedState.ownerId)},${JSON.stringify(closedState.pageRecovery.id)})`);
    try { await stable(base + '/redirected'); }
    catch (error) { const s = await state(); console.error({ recovery: s.pageRecovery, value: s.value, attached: Boolean(view()) }); throw error; }
    assert.notEqual(view(), destroyed);
    assert.equal((await call('grid_page_snapshot')).isError, true);
    passed('destroyed-view-stays-on-recovery-until-explicit-new-instance');

    stage = 'iframe navigation scope';
    const beforeFrame = (await state()).path.nodes.length;
    await ui(`window.grid.open(${JSON.stringify(base + '/with-frame')})`); await stable(base + '/with-frame');
    const frameNode = (await state()).entryId;
    await until(() => view().executeJavaScript('document.querySelector("#sub").contentDocument?.title === "/redirected"'));
    await view().executeJavaScript('document.querySelector("#sub").src="/b"');
    await until(() => view().executeJavaScript('document.querySelector("#sub").contentDocument?.title === "/b"'));
    assert.equal((await state()).entryId, frameNode); assert.equal((await state()).value, base + '/with-frame');
    assert.equal((await state()).path.nodes.length, beforeFrame + 1);
    passed('iframe-navigation-and-redirect-do-not-change-the-main-frame-task-node');

    stage = 'background navigation isolation';
    const foreground = (await state()).ownerId;
    await ui(`window.grid.tabNew(${JSON.stringify(base + '/background')})`); await stable(base + '/background');
    const background = view();
    await ui(`window.grid.tabSelect(${JSON.stringify(foreground)})`); await stable(base + '/with-frame');
    await ui('window.grid.state().then(s=>window.grid.agentGrant(s.agent.connections[0].id,s.agent.page.documentId))');
    const foregroundDocument = (await state()).agent.page.documentId;
    await background.executeJavaScript('location.href="/background-next"');
    await until(() => background.getURL().endsWith('/background-next') && !background.isLoadingMainFrame());
    assert.equal((await state()).entryId, frameNode);
    assert.equal((await state()).agent.page.documentId, foregroundDocument);
    assert.ok(!(await call('grid_page_snapshot')).isError);
    passed('background-navigation-does-not-revoke-or-replace-the-visible-document');
    writeFileSync(path.join(directory, 'navigation-e2e-report.json'), JSON.stringify({ status: 'passed', report, posts,
      network: 'loopback synthetic websites; synthetic Search/Fetch; real MCP', scope: 'runtime navigation; no persistence or map UI' }, null, 2));
    console.log(JSON.stringify({ status: 'passed', report, posts }));
  } catch (error) { console.error('stage=' + stage, error); process.exitCode = 1; }
  finally { await client?.close(); clearTimeout(deadline); fixture.closeAllConnections(); fixture.close(); app.quit(); }
});
