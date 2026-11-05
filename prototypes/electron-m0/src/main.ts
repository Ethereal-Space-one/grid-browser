import { mapCommandSchema } from './contracts/map';
import { TaskRepository } from './storage/task-repository';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkedUrl, classifyInput } from './intent';
import { LocalBridge } from './local-bridge';
import { checkedScene } from './scenes';
import { argument, chromeLayoutSchema, idSchema, keySchema, presentationSchema, submitOptionsSchema, textInputSchema } from './contracts/browsing';
import { deepSeekProvider } from './providers/deepseek';
import { judgmentEditSchema, judgmentSaveSchema } from './contracts/judgment';
import { comparisonSelectorSchema } from './contracts/comparison';
import { WindowRegistry, type WindowHost } from './browser/window-registry';

let configuredKey = process.env.DEEPSEEK_API_KEY || process.env.DeepSeek_ApiKeyN;
let bridge: LocalBridge | undefined;
const uiFile = path.join(__dirname, 'renderer', 'index.html');
const windows = new WindowRegistry(uiFile, pathToFileURL(uiFile).href, path.join(__dirname, 'preload.js'),
  () => deepSeekProvider(() => {
    if (!configuredKey) throw new Error('请先在首页配置搜索服务；网址直达无需密钥');
    return configuredKey;
  }), () => Boolean(configuredKey), () => bridge);

function ui(channel: string, handle: (host: WindowHost, ...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => handle(windows.from(event), ...args));
}
function url(value: unknown): string { return checkedUrl(argument(textInputSchema, value)); }
function active(host: WindowHost, ownerId: unknown) {
  const tab = host.active;
  if (ownerId !== undefined && argument(idSchema, ownerId) !== tab.id) throw new Error('标签已切换，请重新操作');
  return tab;
}
function currentEntry(host: WindowHost, ownerId: unknown, entryId: unknown) {
  const tab = active(host, argument(idSchema, ownerId));
  if (tab.browsing.snapshot().entryId !== argument(idSchema, entryId)) throw new Error('页面已变化，请重新操作');
  return tab;
}
function menus() {
  const focused = () => windows.all().find(h => h.win === BrowserWindow.getFocusedWindow()) ?? windows.target;
  const command = (run: (host: WindowHost) => unknown) => () => {
    const host = focused(); if (!host) return;
    void Promise.resolve().then(() => run(host)).catch(error => dialog.showErrorBox('无法完成操作', error instanceof Error ? error.message : '请重试'));
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '文件', submenu: [
      { id: 'new-window', label: '新建窗口', accelerator: 'CommandOrControl+N', click: command(() => { windows.create(); }) },
      { id: 'new-tab', label: '新建标签', accelerator: 'CommandOrControl+T', click: command(async host => { await host.newTab(); host.win.webContents.send('grid:focus-address'); }) },
      { id: 'close-tab', label: '关闭标签', accelerator: 'CommandOrControl+W', click: command(host => host.close(host.active.id)) }
    ] },
    { role: 'editMenu' },
    { label: '浏览', submenu: [
      { label: '输入网址或查询', accelerator: 'CommandOrControl+L', click: command(host => { host.win.webContents.focus(); host.win.webContents.send('grid:focus-address'); }) },
      { label: '后退', accelerator: 'Alt+Left', click: command(host => host.active.traverse(-1)) },
      { label: '前进', accelerator: 'Alt+Right', click: command(host => host.active.traverse(1)) },
      { label: '重新加载', accelerator: 'CommandOrControl+R', click: command(host => host.active.reload()) },
      { role: 'toggleDevTools' }, { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  const profile = session.fromPartition('persist:grid-m0');
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  profile.setPermissionCheckHandler(() => false);
  // Do not access legacy provider-key.bin or the OS keychain, including at startup.
  // A manually configured provider key lives only in this main process.
  const initial = windows.create(undefined,false);
  const repository = new TaskRepository(path.join(app.getPath('userData'), 'tasks-v1'), () => {if(windows.storage?.state().status==='saved')windows.pruneDeleted();windows.changed(false);});
  const workspace = await repository.load(); windows.storage = repository;
  const restored = workspace.windows.map((window,index) => { if(index===0){windows.restoreWindow(initial,window);return initial;}return windows.create(window,false); });
  const first = restored[workspace.active] ?? initial; windows.chooseTarget(first); menus();
  for(const host of windows.all()) void host.win.loadFile(uiFile);
  first.win.show();first.win.focus();
  ui('grid:configure-key', (_host, value) => {
    configuredKey = argument(keySchema, value);
    windows.changed(false);
  });
  ui('grid:storage-panel', (host, open) => { if(typeof open!=='boolean') throw new Error('参数格式无效');host.storagePanelOpen=open;if(open){host.agentPanelOpen=false;host.active.pathMapOpen=false;}host.resize();windows.changed(false); });
  ui('grid:storage-flush', () => windows.flushTasks());
  ui('grid:storage-restore', (host, id) => windows.restoreTask(argument(idSchema,id),host));
  ui('grid:storage-delete', (_host, id) => windows.deleteTask(argument(idSchema,id)));
  ui('grid:temporary-path', host => host.newTab(undefined,false));
  ui('grid:state', host => host.state());
  ipcMain.handle('grid-map:state', event => windows.fromMap(event).map.state());
  ipcMain.handle('grid-map:command', (event, raw) => windows.fromMap(event).map.command(argument(mapCommandSchema,raw)));
  ui('grid:submit', async (host, raw, options, ownerId) => {
    const input = argument(textInputSchema, raw); const parsed = argument(submitOptionsSchema, options);
    const intent = classifyInput(input); const tab = active(host, ownerId);
    const current = tab.browsing.snapshot();
    tab.browsing.savePresentation(current.entryId, { ...current.presentation, addressDraft: null });
    if (intent.kind === 'url') { await tab.open(intent.url); return { kind: 'page' }; }
    const response = await tab.browsing.search(intent.query, parsed?.scene ?? tab.browsing.snapshot().scene, parsed?.contextual !== false);
    return response ? { kind: 'results', ...response } : { kind: 'cancelled' };
  });
  ui('grid:open', (host, raw, ownerId) => active(host, ownerId).open(url(raw)));
  ui('grid:scene', (host, value, ownerId) => active(host, ownerId).browsing.setScene(checkedScene(value)));
  ui('grid:read', (host, raw, ownerId) => {
    const source = url(raw);
    if (!source.startsWith('https://')) throw new Error('Fetch 阅读层只支持公开 HTTPS 页面；请打开本机原页');
    return active(host, ownerId).browsing.read(source);
  });
  ui('grid:extract', (host, raw, scene, readingId, ownerId) => active(host, ownerId).browsing.extract(url(raw), checkedScene(scene), argument(idSchema, readingId)));
  ui('grid:summarize', (host, searchId, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.summarize(argument(idSchema, searchId)));
  ui('grid:page-summary', (host, ownerId, entryId) => {
    const tab = currentEntry(host, ownerId, entryId);
    if (!tab.identity()) throw new Error('原页仍在变化，请加载完成后再总结');
    return tab.browsing.summarizePage();
  });
  ui('grid:question', (host, ownerId, entryId) => {
    const tab = currentEntry(host, ownerId, entryId);
    if (tab.browsing.snapshot().mode === 'page' && !tab.identity()) throw new Error('原页仍在变化，请加载完成后再提问');
    tab.pathMapOpen = false;
    tab.browsing.beginQuestion();
  });
  ui('grid:ask', (host, text, ownerId, entryId, questionId) => currentEntry(host, ownerId, entryId).browsing.ask(argument(textInputSchema, text), argument(idSchema, questionId)));
  ui('grid:judgment-begin', (host, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.beginJudgment());
  ui('grid:judgment-edit', (host, value, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.editJudgment(argument(judgmentEditSchema, value)));
  ui('grid:judgment-save', (host, value, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.saveJudgment(argument(judgmentSaveSchema, value)));
  ui('grid:comparison-choose', (host, selector, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.chooseComparison(argument(comparisonSelectorSchema, selector)));
  ui('grid:comparison-remove', (host, id, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.removeComparison(argument(idSchema, id)));
  ui('grid:comparison-start', (host, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.startComparison());
  ui('grid:comparison-retry', (host, id, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.retryComparison(argument(idSchema, id)));
  ui('grid:comparison-recover', (host, ownerId, entryId) => currentEntry(host, ownerId, entryId).browsing.recoverComparison());
  ui('grid:home', (host, ownerId) => active(host, ownerId).browsing.home());
  ui('grid:results', (host, ownerId) => active(host, ownerId).browsing.results());
  ui('grid:cancel-request', (host, ownerId) => active(host, ownerId).browsing.cancel());
  ui('grid:back', (host, ownerId) => active(host, ownerId).traverse(-1));
  ui('grid:forward', (host, ownerId) => active(host, ownerId).traverse(1));
  ui('grid:reload', (host, ownerId) => active(host, ownerId).reload());
  ui('grid:jump', (host, rawId, ownerId, fromEntryId) => {
    const owner = argument(idSchema, ownerId); const tab = active(host, owner);
    if (tab.browsing.snapshot().entryId !== argument(idSchema, fromEntryId)) throw new Error('页面已变化，请重新选择路径节点');
    return tab.jump(argument(idSchema, rawId));
  });
  ui('grid:reopen-page', (host, rawId, ownerId, recoveryId) => active(host, argument(idSchema, ownerId)).reopen(argument(idSchema, rawId), argument(idSchema, recoveryId)));
  ui('grid:path-map', (host, open, ownerId) => {
    const tab = active(host, argument(idSchema, ownerId));
    if (typeof open !== 'boolean') throw new Error('地图参数无效');
    if(open) host.storagePanelOpen=false;
    tab.pathMapOpen = open && tab.browsing.snapshot().path.nodes.length > 1; host.refresh();
  });
  ui('grid:layout', (host, ownerId, layoutId, value) => host.reportLayout(argument(idSchema, ownerId), argument(idSchema, layoutId), argument(chromeLayoutSchema, value)));
  ui('grid:tab-new', (host, raw) => host.newTab(raw === undefined ? undefined : url(raw)));
  ui('grid:tab-select', (host, id) => host.select(argument(idSchema, id)));
  ui('grid:tab-close', (host, id) => host.close(argument(idSchema, id)));
  ui('grid:window-new', () => { windows.create(); });
  ui('grid:presentation', (host, ownerId, entryId, value) => {
    const owner = argument(idSchema, ownerId); const entry = argument(idSchema, entryId); const presentation = argument(presentationSchema, value);
    const saved=owner === host.active.id && host.active.browsing.savePresentation(entry, presentation);if(saved) windows.changed();return saved;
  });
  ui('grid:action-preview', (host, value, ownerId) => { windows.requireTarget(host); return active(host, ownerId).action.preview(value); });
  ui('grid:action-confirm', (host, id, ownerId) => { windows.requireTarget(host); return active(host, ownerId).action.confirm(argument(idSchema, id)); });
  ui('grid:action-pause', (host, ownerId) => active(host, ownerId).action.pause());
  ui('grid:action-resume', (host, ownerId) => active(host, ownerId).action.resume());
  ui('grid:action-cancel', (host, ownerId) => active(host, ownerId).action.cancel());
  ui('grid:agent-panel', (host, open) => {
    if (typeof open !== 'boolean') throw new Error('面板参数无效');
    if(open)host.storagePanelOpen=false;
    host.agentPanelOpen = open; host.resize(); windows.changed();
  });
  ui('grid:agent-grant', (host, id, documentId) => {
    windows.requireTarget(host);
    if (host.active.identity()?.documentId !== argument(idSchema, documentId)) throw new Error('页面已变化，请核对当前文档后重新授权');
    bridge?.grant(argument(idSchema, id));
  });
  ui('grid:agent-revoke', (_host, id) => bridge?.revoke(argument(idSchema, id)));
  ui('grid:agent-copy-config', async (_host, format = 'json') => {
    if (format !== 'json' && format !== 'codex') throw new Error('不支持的客户端配置格式');
    if (!bridge) throw new Error('MCP bridge is not ready');
    const npmNode = process.env.npm_node_execpath;
    const command = app.isPackaged ? process.execPath : npmNode && path.isAbsolute(npmNode) ? npmNode : 'node';
    const config = { mcpServers: { grid: { command, args: [path.join(__dirname, 'mcp.js'), '--connection-file', bridge.connectionFile], ...(app.isPackaged ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}) } } };
    const server = config.mcpServers.grid;
    const text = format === 'codex'
      ? `[mcp_servers.grid]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n${server.env ? 'env = { ELECTRON_RUN_AS_NODE = "1" }\n' : ''}`
      : JSON.stringify(config, null, 2);
    await clipboard.writeText(text);
  });
  ui('grid:agent-export', async host => {
    const result = await dialog.showSaveDialog(host.win, { defaultPath: 'grid-read-receipts.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.filePath && bridge) writeFileSync(result.filePath, JSON.stringify({ ...JSON.parse(bridge.exportReceipts()), formActions: windows.actionReceipts() }, null, 2), { mode: 0o600 });
  });
  let knownConnections = 0;
  bridge = new LocalBridge(() => windows.currentPage(), expected => windows.capturePage(expected), () => {
    const count = bridge?.state().connections.length || 0;
    if (count > knownConnections && windows.target) { windows.target.agentPanelOpen = true; windows.target.resize(); }
    knownConnections = count; windows.changed();
  }, path.join(app.getPath('userData'), 'mcp-connection.json'), {
    propose: async (value, owner) => {
      const host = windows.target; if (!host) throw new Error('请先打开 Grid 窗口');
      const result = await host.active.action.preview(value, owner);
      host.agentPanelOpen = true; host.resize(); windows.changed(); return result;
    },
    status: id => {
      const active = windows.target?.tabs.active()?.action.status(id);
      if (active && active.status !== 'none') return active;
      for (const host of windows.all()) for (const tab of host.tabs.all()) { const status = tab.action.status(id); if (status.status !== 'none') return status; }
      const receipt = windows.actionReceipts().filter(r => r.connectionId === id).at(-1);
      return receipt ? { id: receipt.id, status: receipt.status, message: '标签已关闭，请在 Grid 核对。' } : { status: 'none' };
    },
    cancel: id => windows.cancelOwner(id)
  });
  try { await bridge.start(); windows.changed(); }
  catch { bridge.close(); bridge = undefined; console.error('Grid MCP bridge could not start'); }
  if (process.argv.includes('--preview-smoke')) {
    void (async () => {
      try {
        for (let i = 0; i < 100; i++) {
          try { if (await first.win.webContents.executeJavaScript('Boolean(window.grid && document.querySelector("#home-search"))')) { console.log(JSON.stringify({ packagedPreview: 'passed', scene: first.state().scene, keyReady: first.state().keyReady })); app.quit(); return; } } catch { /* Wait for preload. */ }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Packaged UI startup timeout');
      } catch { app.exit(1); }
    })();
  }
  app.on('activate', () => { if (!windows.all().length) windows.create(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const host = windows.target; if (host) { if (host.win.isMinimized()) host.win.restore(); host.win.show(); host.win.focus(); } });
  void app.whenReady().then(start);
}
let quitReady=false, preparingQuit=false;
app.on('before-quit', event => {
  if(quitReady || !windows.storage) return;event.preventDefault();if(preparingQuit)return;preparingQuit=true;
  void (async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{
    await Promise.race([windows.flushTasks(),new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new Error('保存超时')),5000);})]);
    windows.closing=true;quitReady=true;app.quit();
  }catch{const result=await dialog.showMessageBox({type:'warning',title:'还有未保存的路径更改',message:'本地保存未完成。返回检查可保留当前窗口；仍然退出只能恢复最近已提交的状态。',buttons:['返回检查','仍然退出'],defaultId:0,cancelId:0});if(result.response===1){windows.closing=true;quitReady=true;app.quit();}}finally{clearTimeout(timer);preparingQuit=false;}})();
});
app.on('will-quit', () => bridge?.close());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
