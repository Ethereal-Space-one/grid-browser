import { app, BrowserWindow, ipcMain, session, WebContentsView } from 'electron';
import path from 'node:path';
import { checkedUrl, classifyInput } from './intent';
import { normalizeSearchResults, type SearchHit } from './search';

type SearchResponse = { results: SearchHit[]; query: string };
type Reading = { title: string; url: string; content: string };
type State = { mode: 'home' | 'results' | 'page' | 'reading'; value: string; canGoBack: boolean; canGoForward: boolean; hasResults: boolean; keyReady: boolean };

const TOOLBAR_HEIGHT = 78;
const partition = 'persist:grid-m0';
let window: BrowserWindow;
let page: WebContentsView;
let pageAttached = false;
let mode: State['mode'] = 'home';
let value = '';
let hasResults = false;
let lastQuery = '';
const configuredKey = process.env.DEEPSEEK_API_KEY || process.env.DeepSeek_ApiKeyN;

function state(): State {
  return {
    mode,
    value,
    canGoBack: (mode === 'page' && (page?.webContents.navigationHistory.canGoBack() || hasResults)) ?? false,
    canGoForward: (mode === 'page' && page?.webContents.navigationHistory.canGoForward()) ?? false,
    hasResults,
    keyReady: Boolean(configuredKey)
  };
}

function notifyState(): void {
  if (window && !window.isDestroyed()) window.webContents.send('grid:state', state());
}

function setPageVisible(visible: boolean): void {
  if (visible && !pageAttached) {
    window.contentView.addChildView(page);
    pageAttached = true;
    resizePage();
  } else if (!visible && pageAttached) {
    window.contentView.removeChildView(page);
    pageAttached = false;
  }
}

function resizePage(): void {
  if (!pageAttached) return;
  const [width, height] = window.getContentSize();
  page.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
}

function assertUiSender(senderId: number): void {
  if (!window || senderId !== window.webContents.id) throw new Error('无效的界面调用');
}

function requireKey(): string {
  const key = configuredKey;
  if (!key) throw new Error('请先在启动 Grid 的终端设置 DEEPSEEK_API_KEY；网址直达无需密钥');
  return key;
}

async function deepSeek<T>(endpoint: 'search' | 'fetch', body: object): Promise<T> {
  const response = await fetch(`https://api.deepseek.com/v1/tools/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`DeepSeek ${endpoint} 返回 HTTP ${response.status}`);
  return await response.json() as T;
}

async function search(query: string): Promise<SearchResponse> {
  if (query.length > 128) throw new Error('查询最多 128 个字符');
  mode = 'results';
  value = query;
  setPageVisible(false);
  notifyState();
  const payload = await deepSeek<unknown>('search', { query, count: 10, need_content: false });
  const results = normalizeSearchResults(payload);
  hasResults = true;
  lastQuery = query;
  notifyState();
  return { results, query };
}

async function openPage(raw: string): Promise<void> {
  const url = checkedUrl(raw);
  mode = 'page';
  value = url;
  setPageVisible(true);
  notifyState();
  await page.webContents.loadURL(url);
}

async function readPage(raw: string): Promise<Reading> {
  const url = checkedUrl(raw);
  if (!url.startsWith('https://')) throw new Error('Fetch 阅读层只支持公开 HTTPS 页面；请打开本机原页');
  const payload = await deepSeek<{ title?: unknown; content?: unknown }>('fetch', { url });
  if (typeof payload.content !== 'string' || !payload.content.trim()) throw new Error('未能抓取正文；请打开原页');
  mode = 'reading';
  value = url;
  setPageVisible(false);
  notifyState();
  return { title: typeof payload.title === 'string' ? payload.title : url, url, content: payload.content };
}

function createWindow(): void {
  const profile = session.fromPartition(partition);
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  profile.setPermissionCheckHandler(() => false);

  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Grid · M0',
    backgroundColor: '#0b0f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void window.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  page = new WebContentsView({ webPreferences: {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true
  } });
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  page.webContents.on('will-navigate', (event, url) => {
    try { checkedUrl(url); } catch { event.preventDefault(); }
  });
  page.webContents.on('did-navigate', (_event, url) => { value = url; notifyState(); });
  page.webContents.on('did-navigate-in-page', (_event, url) => { value = url; notifyState(); });
  window.on('resize', resizePage);
  window.on('closed', () => {
    if (!page.webContents.isDestroyed()) page.webContents.close();
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('grid:state', event => { assertUiSender(event.sender.id); return state(); });
  ipcMain.handle('grid:submit', async (event, input: string) => {
    assertUiSender(event.sender.id);
    if (typeof input !== 'string') throw new Error('输入格式无效');
    const intent = classifyInput(input);
    if (intent.kind === 'url') { await openPage(intent.url); return { kind: 'page' }; }
    return { kind: 'results', ...(await search(intent.query)) };
  });
  ipcMain.handle('grid:open', async (event, url: string) => {
    assertUiSender(event.sender.id);
    await openPage(url);
  });
  ipcMain.handle('grid:read', async (event, url: string) => {
    assertUiSender(event.sender.id);
    return await readPage(url);
  });
  ipcMain.handle('grid:home', event => {
    assertUiSender(event.sender.id);
    mode = 'home'; value = ''; setPageVisible(false); notifyState();
  });
  ipcMain.handle('grid:results', event => {
    assertUiSender(event.sender.id);
    if (!hasResults) return;
    mode = 'results'; value = lastQuery; setPageVisible(false); notifyState();
  });
  ipcMain.handle('grid:back', event => {
    assertUiSender(event.sender.id);
    if (mode !== 'page') return;
    if (page.webContents.navigationHistory.canGoBack()) page.webContents.navigationHistory.goBack();
    else if (hasResults) { mode = 'results'; value = lastQuery; setPageVisible(false); notifyState(); }
  });
  ipcMain.handle('grid:forward', event => {
    assertUiSender(event.sender.id);
    if (mode === 'page' && page.webContents.navigationHistory.canGoForward()) page.webContents.navigationHistory.goForward();
  });
  ipcMain.handle('grid:reload', event => {
    assertUiSender(event.sender.id);
    if (mode === 'page') page.webContents.reload();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
