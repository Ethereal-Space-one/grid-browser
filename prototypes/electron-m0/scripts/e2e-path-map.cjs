// Production renderer/Host, isolated profile, synthetic provider and loopback websites.
const { app, BrowserWindow, clipboard, nativeTheme } = require('electron');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os'); const path = require('node:path'); const http = require('node:http');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-path-map-')));
process.env.DEEPSEEK_API_KEY = 'synthetic-map-key'; delete process.env.DeepSeek_ApiKeyN;
const directory = path.join(__dirname, '../.local'); const report = []; const calls = []; let held; let waiting; let pageRequests = 0;
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body); calls.push({ url, signal: options.signal });
  if (held) { waiting = held; held = undefined; waiting.started = true; return waiting.promise; }
  if (body.query === '合成失败') throw new Error('synthetic failure');
  if (url.endsWith('/search')) return json({ results: [{ title: body.query, url: 'https://example.com/a', snippet: '仅用于地图验证的合成来源' }] });
  assert.ok(url.endsWith('/fetch'), 'the map makes no model requests');
  return json({ title: '合成正文 ' + new URL(body.url).pathname, content: '合成原文，保留阅读位置。\n'.repeat(body.url.includes('/cache-') ? 30000 : 600) });
};
const fixture = http.createServer((req, res) => { pageRequests++; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>合成原页</title><h1>合成原页</h1><input id="draft"><a href="/b" id="next">下一页</a><div style="height:3000px">仅本机合成内容</div>'); });
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const deadline = setTimeout(() => app.exit(1), 120000);
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check, label = 'map UI') { for (let n = 0; n < 240; n++) { if (await check()) return; await pause(); } throw new Error(label + ' timeout'); }
app.whenReady().then(async () => {
  let client; let stage = 'startup';
  const win = BrowserWindow.getAllWindows()[0]; const ui = code => win.webContents.executeJavaScript(code);
  const state = () => ui('window.grid.state()');
  const native = () => win.contentView.children.find(v => v.webContents && v.webContents !== win.webContents);
  const paint = () => ui('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const settled = async () => {
    await until(async () => {
      const expected = await ui('Math.ceil(document.querySelector("#browser-chrome").getBoundingClientRect().bottom)');
      const zoom = win.webContents.getZoomFactor(); const bounds = native()?.getBounds();
      return !bounds || Math.abs(bounds.y - expected * zoom) <= 2 && bounds.height > 0;
    }, 'native chrome layout'); await paint();
  };
  const select = async id => { await ui(`document.getElementById(${JSON.stringify('map-' + id)}).click()`); await until(async () => (await state()).entryId === id); await paint(); };
  const toggle = async open => { if ((await state()).pathMapOpen !== open) await ui('document.querySelector("#path-toggle").click()'); await until(async () => (await state()).pathMapOpen === open); await settled(); };
  const passed = name => { report.push(name); console.log(JSON.stringify({ stage: name, status: 'passed' })); };
  const key = keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); };
  try {
    nativeTheme.themeSource = 'light';
    mkdirSync(directory, { recursive: true });
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + fixture.address().port;
    await until(async () => { try { return await ui('Boolean(window.grid && document.querySelector("#path-toggle"))'); } catch { return false; } });
    assert.equal(await ui('document.querySelector("#path-bar").hidden'), true);
    await ui('window.grid.submit("从真实问题出发",{scene:"learning",contextual:false})'); const search = (await state()).entryId;
    await ui('window.grid.read("https://example.com/a")'); const a = (await state()).entryId;
    await until(async () => await ui('!document.querySelector("#reading").classList.contains("hidden")')); await paint();
    await ui('document.querySelector("#surface").scrollTop=500');
    await until(async () => (await state()).presentation.scrollTop > 490);
    const count = (await state()).path.nodes.length; const beforeToggle = calls.length;
    await toggle(true);
    assert.equal(await ui('document.querySelector("#path-toggle").getAttribute("aria-expanded")'), 'true');
    assert.equal((await state()).path.nodes.length, count); assert.equal(calls.length, beforeToggle);
    assert.ok(await ui('Math.abs(document.querySelector("#surface").scrollTop-500)<2'));
    win.webContents.focus(); await ui('document.querySelector("#path-tree [aria-current=step]").focus()'); key('Escape');
    await until(async () => !(await state()).pathMapOpen && await ui('document.activeElement.id === "path-toggle"'));
    assert.ok(await ui('Math.abs(document.querySelector("#surface").scrollTop-500)<2'));
    passed('compact-disclosure-and-Escape-preserve-reading-position-without-a-new-step');

    stage = 'branch navigation';
    await ui(`document.getElementById(${JSON.stringify('trail-' + search)}).click()`); await until(async () => (await state()).entryId === search);
    await ui('window.grid.read("https://example.com/b")'); const b = (await state()).entryId;
    await ui('window.grid.setScene("living")');
    await toggle(true); assert.equal(await ui('document.querySelectorAll("#path-tree button").length'), (await state()).path.nodes.length);
    const beforeBranches = calls.length;
    await select(a); assert.equal((await state()).scene, 'learning');
    await ui('document.querySelector("#back").click()'); await until(async () => (await state()).entryId === search);
    await ui('document.querySelector("#forward").click()'); await until(async () => (await state()).entryId === a);
    await select(b); assert.equal((await state()).scene, 'living'); assert.equal(calls.length, beforeBranches);
    assert.ok((await state()).path.nodes.some(n => n.id === a));
    await paint(); await ui('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
    writeFileSync(path.join(directory, 'path-map-branches-light.png'), (await win.capturePage()).toPNG());
    passed('clickable-old-and-new-branches-share-Host-forward-choice-scenes-and-cached-content');

    stage = 'keyboard and focus';
    win.webContents.focus(); await ui('document.querySelector("#path-tree button").focus()');
    const beforeKeys = (await state()).entryId; key('End');
    await until(async () => await ui(`document.activeElement.id === ${JSON.stringify('map-' + b)}`));
    assert.equal((await state()).entryId, beforeKeys);
    key('Up'); await until(async () => await ui(`document.activeElement.id === ${JSON.stringify('map-' + a)}`));
    key('Enter'); await until(async () => (await state()).entryId === a);
    key('Escape'); await until(async () => !(await state()).pathMapOpen);
    await ui(`document.getElementById(${JSON.stringify('trail-' + search)}).click()`);
    await until(async () => await ui('document.activeElement.id === "results-title"'));
    passed('keyboard-browses-before-activation-and-jumps-focus-to-the-current-content');

    stage = 'native surface';
    await ui(`window.grid.open(${JSON.stringify(base + '/a')})`); await settled();
    const web = native().webContents;
    await web.executeJavaScript('document.querySelector("#draft").value="合成草稿";scrollTo(0,480)');
    await ui('window.grid.agentCopyConfig()'); const config = JSON.parse(await clipboard.readText()).mcpServers.grid;
    client = new Client({ name: 'Path map synthetic client', version: '1.0' });
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, stderr: 'pipe' }));
    const call = name => client.callTool({ name, arguments: {} }); await call('grid_connection_status'); await settled();
    await until(async () => Boolean((await state()).agent.page));
    await ui('window.grid.state().then(s=>window.grid.agentGrant(s.agent.connections[0].id,s.agent.page.documentId))');
    await ui('window.grid.agentPanel(false)'); await settled(); const beforePageToggle = pageRequests;
    await toggle(true); assert.ok(!(await call('grid_page_snapshot')).isError);
    await toggle(false); assert.ok(!(await call('grid_page_snapshot')).isError);
    assert.equal(pageRequests, beforePageToggle); assert.equal(native().webContents, web);
    assert.equal(await web.executeJavaScript('document.querySelector("#draft").value'), '合成草稿');
    assert.ok(await web.executeJavaScript('scrollY>=470'));
    passed('map-changes-native-bounds-without-reload-lost-fields-position-or-reading-grant');

    stage = 'layout ownership and resize';
    const saved = await state();
    assert.equal(await ui(`window.grid.reportLayout("other-owner",${JSON.stringify(saved.layoutId)},{width:1180,height:820,top:168})`), false);
    assert.equal(await ui(`window.grid.reportLayout(${JSON.stringify(saved.ownerId)},"expired-layout",{width:1180,height:820,top:168})`), false);
    await assert.rejects(ui(`window.grid.reportLayout(${JSON.stringify(saved.ownerId)},${JSON.stringify(saved.layoutId)},{width:1180,height:820,top:-1})`));
    const beforeSpoof = native().getBounds();
    assert.equal(await ui(`window.grid.reportLayout(${JSON.stringify(saved.ownerId)},${JSON.stringify(saved.layoutId)},{width:99,height:99,top:168})`), false);
    assert.deepEqual(native().getBounds(), beforeSpoof);
    await toggle(true); await ui('window.grid.agentPanel(true)');
    for (const [width, height] of [[720,480],[768,820],[1180,820]]) {
      win.setContentSize(width,height); await settled();
      assert.ok(await ui('document.querySelector("#path-tree-scroll").getBoundingClientRect().height>=36'), 'map nodes remain reachable alongside Agent');
      assert.ok(native().getBounds().y >= await ui('document.querySelector("#browser-chrome").getBoundingClientRect().bottom'));
    }
    await ui('window.grid.agentPanel(false)'); await settled();
    for (const zoom of [1.25,1.5,1]) { win.webContents.setZoomFactor(zoom); await settled(); }
    passed('bounded-layout-rejects-stale-owners-and-coordinates-and-tracks-panels-resize-and-zoom');

    stage = 'UI reload and tab ownership';
    const oldLayout = (await state()).layoutId; const owner = (await state()).ownerId; const pathId = (await state()).path.id;
    win.webContents.reload(); await until(async () => { try { return (await state()).layoutId !== oldLayout && await ui('!document.querySelector("#path-map").hidden'); } catch { return false; } }); await settled();
    assert.equal((await state()).path.id, pathId);
    await ui('window.grid.tabNew()'); assert.equal((await state()).pathMapOpen, false);
    await assert.rejects(ui(`window.grid.pathMap(true,${JSON.stringify(owner)})`));
    await ui(`window.grid.tabSelect(${JSON.stringify(owner)})`); await settled(); assert.equal((await state()).pathMapOpen, true);
    await select(a); await until(async () => (await state()).mode === 'reading'); assert.equal((await call('grid_page_snapshot')).isError, true);
    passed('map-state-is-tab-owned-and-reloads-from-Host-without-reviving-page-grants');

    stage = 'pending and failure';
    let resolve; held = { promise: new Promise(yes => { resolve = yes; }) }; const pending = ui('window.grid.submit("合成等待",{contextual:false})');
    await until(() => waiting?.started); const pendingNode = (await state()).entryId;
    await until(async () => await ui(`document.getElementById(${JSON.stringify('map-' + pendingNode)}).getAttribute('aria-busy') === 'true'`));
    await select(a); assert.equal((await pending).kind, 'cancelled'); assert.equal(calls.at(-1).signal.aborted, true);
    resolve(json({ results: [] })); await pause(); assert.equal((await state()).entryId, a);
    await assert.rejects(ui('window.grid.submit("合成失败",{contextual:false})'));
    await until(async () => await ui('Boolean(document.querySelector("#path-tree [data-state=error]"))'));
    assert.equal((await state()).path.nodes.find(n => n.id === pendingNode).status, 'cancelled');
    passed('pending-cancelled-and-failed-steps-stay-honest-and-late-work-cannot-navigate');

    stage = 'cache missing and deep paths';
    let cached;
    for (let n = 0; n < 12; n++) { await ui(`window.grid.read("https://example.com/cache-${n}")`); if (n === 0) cached = (await state()).entryId; }
    const callsBeforeMissing = calls.length; await select(cached);
    assert.ok((await state()).path.nodes.find(n => n.id === cached).missingContent.length);
    assert.equal(calls.length, callsBeforeMissing); assert.ok(await ui('document.querySelector("#reading-content").textContent.includes("释放")'));
    for (let n = 0; n < 30; n++) await ui(`window.grid.submit(${JSON.stringify('合成长路径' + n + ' / ' + '<script>untrusted</script>'.repeat(3))},{contextual:false})`);
    await paint(); const final = await state();
    assert.equal(final.path.nodes.length, 33); assert.equal(final.path.recordingPaused, true);
    assert.equal(await ui('document.querySelectorAll("#path-tree button").length'), 33);
    assert.ok(await ui('document.querySelector("#path-tree").textContent.includes("未记录")'));
    assert.equal(await ui('document.querySelectorAll("#path-tree script").length'), 0);
    passed('released-content-and-capacity-keep-all-recorded-branches-in-a-deep-safe-list');

    stage = 'appearance and responsive';
    win.setMinimumSize(320,480);
    for (const appearance of ['light','dark']) {
      nativeTheme.themeSource = appearance;
      for (const width of [320,375,414,768,1180]) {
        win.setContentSize(width,820); await settled();
        assert.equal(await ui('document.documentElement.scrollWidth<=innerWidth'), true, appearance+' '+width);
        assert.ok(await ui('(()=>{const r=document.querySelector("#path-toggle").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()'));
        assert.ok(await ui('document.querySelector("#path-tree-scroll").scrollHeight>document.querySelector("#path-tree-scroll").clientHeight'));
        await until(() => ui('(()=>{const n=document.querySelector("#path-tree [aria-current=step]").getBoundingClientRect();const c=document.querySelector("#path-tree-scroll").getBoundingClientRect();return n.top>=c.top-2&&n.bottom<=c.bottom+2;})()'), 'current node remains visible after width changes');
      }
      await ui('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
      writeFileSync(path.join(directory, `path-map-deep-${appearance}.png`), (await win.capturePage()).toPNG());
    }
    win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await toggle(false); await toggle(true);
    assert.equal(await ui('document.querySelector("#path-map").getAnimations({subtree:true}).length'), 0);
    win.webContents.debugger.detach();
    passed('light-dark-and-320-375-414-768-1180-layouts-deep-scrolling-and-reduced-motion');

    stage = 'contrast';
    const luminance = rgb => rgb.slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
    const ratio = (a,b) => { const x=luminance(a); const y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
    let lowestText = Infinity; let lowestFocus = Infinity;
    for (const appearance of ['light','dark']) {
      nativeTheme.themeSource=appearance;
      for (const scene of ['professional','learning','living','entertainment','inspiration']) {
        await ui(`window.grid.setScene(${JSON.stringify(scene)})`);
        await until(() => ui(`document.body.dataset.scene === ${JSON.stringify(scene)}`)); await paint();
        await ui('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
        const colors = await ui(`(()=>{const node=document.querySelector('#path-tree [aria-current=step]');const rgb=c=>c.match(/[\\d.]+/g).map(Number);const style=getComputedStyle(node);node.classList.add('is-focus');const focus=getComputedStyle(node).outlineColor;node.classList.remove('is-focus');return {background:rgb(style.backgroundColor),page:rgb(getComputedStyle(document.querySelector('#path-map')).backgroundColor),text:rgb(style.color),number:rgb(getComputedStyle(node.querySelector('.path-number')).color),badge:rgb(getComputedStyle(node.querySelector('.path-badge')).color),focus:rgb(focus)};})()`);
        for (const color of [colors.text,colors.number,colors.badge]) { const value=ratio(color,colors.background); lowestText=Math.min(lowestText,value); assert.ok(value>=4.5,appearance+' '+scene+' text contrast '+value); }
        for (const background of [colors.page,colors.background]) { const value=ratio(colors.focus,background); lowestFocus=Math.min(lowestFocus,value); assert.ok(value>=3,appearance+' '+scene+' focus contrast '+value); }
      }
    }
    passed('current-node-labels-and-focus-pass-WCAG-contrast-across-five-scenes-and-both-appearances');

    const css = readFileSync(path.join(__dirname, '../src/renderer/path-map.css'), 'utf8'); const tokens = readFileSync(path.join(__dirname, '../../../tokens.css'), 'utf8');
    const states = ['default','hover','focus','active','disabled','loading','error','success'];
    writeFileSync(path.join(directory, 'path-map.preview.html'), `<!doctype html><meta charset="utf-8"><title>路径节点八状态 · 合成设计检查</title><style>${tokens}\n${css}\nbody{font-family:var(--font-body);background:var(--color-paper);color:var(--color-ink);padding:var(--space-md)}article{max-width:32rem;margin-block:var(--space-md)}</style><h1>路径节点八状态</h1><p>仅用于设计检查的合成示例，不属于生产界面。</p>${states.map(s=>`<article><p>${s}</p><button class="path-node ${['hover','focus','active'].includes(s)?'is-'+s:''}" ${s==='disabled'?'disabled':''} ${s==='success'?'aria-current="step"':''} data-state="${s}"><span class="path-number">2</span><span class="path-name">合成来源的正文</span><span class="path-badge">${s==='loading'?'正在加载':s==='error'?'未完成':s==='success'?'当前':'正文'}</span></button></article>`).join('')}`);
    const preview=new BrowserWindow({width:720,height:1040,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    await preview.loadFile(path.join(directory,'path-map.preview.html'));
    await preview.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    writeFileSync(path.join(directory,'path-map-states.png'),(await preview.capturePage()).toPNG()); preview.close();
    writeFileSync(path.join(directory, 'path-map-e2e-report.json'), JSON.stringify({ status:'passed',report,contrast:{lowestText,lowestFocus},network:'synthetic provider; loopback website; real MCP',scope:'step 3 map UI and runtime navigation; no persistence or question/compare/judgment pages' },null,2));
    console.log(JSON.stringify({status:'passed',report}));
  } catch (error) { console.error('stage='+stage,error); process.exitCode=1; }
  finally { await client?.close(); clearTimeout(deadline); fixture.closeAllConnections(); fixture.close(); app.quit(); }
});
