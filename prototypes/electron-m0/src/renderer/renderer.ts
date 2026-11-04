(() => {
type SearchHit = { title: string; url: string; snippet: string; site: string; date: string | null };
type SearchResponse = { kind: 'results'; results: SearchHit[]; query: string; scene: string; actualQuery: string; contextual: boolean } | { kind: 'page' };
type Reading = { title: string; url: string; content: string };
type State = { scene: string; mode: 'home' | 'results' | 'page' | 'reading'; value: string; canGoBack: boolean; canGoForward: boolean; hasResults: boolean; keyReady: boolean; agentPanelOpen: boolean; action?: { owner?: { name: string }; id: string; url: string; value: string; status: string; message: string }; agent?: { page?: { url: string }; connections: { id: string; name: string; authorized: boolean }[]; receiptCount: number } };
type GridApi = {
  actionPreview(value: string): Promise<void>;
  actionConfirm(id: string): Promise<void>;
  actionPause(): Promise<void>;
  actionResume(): Promise<void>;
  actionCancel(): Promise<void>;
  setScene(scene: string): Promise<void>;
  extract(url: string, scene: string): Promise<{ text: string; scene: string; truncated: boolean }>;
  submit(input: string, options?: { scene: string; contextual: boolean }): Promise<SearchResponse>;
  open(url: string): Promise<void>;
  read(url: string): Promise<Reading>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  home(): Promise<void>;
  results(): Promise<void>;
  state(): Promise<State>;
  agentPanel(open: boolean): Promise<void>;
  agentGrant(id: string): Promise<void>;
  agentRevoke(id: string): Promise<void>;
  agentCopyConfig(format?: 'json' | 'codex'): Promise<void>;
  agentExport(): Promise<void>;
  onState(callback: (state: State) => void): () => void;
};
const grid = (window as unknown as { grid: GridApi }).grid;
const input = document.querySelector<HTMLInputElement>('#input')!;
const welcome = document.querySelector<HTMLElement>('#welcome')!;
const results = document.querySelector<HTMLElement>('#results')!;
const reading = document.querySelector<HTMLElement>('#reading')!;
const error = document.querySelector<HTMLElement>('#error')!;
const busy = document.querySelector<HTMLElement>('#busy')!;
const list = document.querySelector<HTMLElement>('#result-list')!;
let readingUrl = '';
let agentPanelOpen = false;
let selectedScene = 'professional';
let lastStateValue: string | undefined;
const sceneInfo: Record<string, { label: string; hint: string }> = {
  professional: { label: '专业', hint: '查依据，重事实，核对原始来源。' },
  learning: { label: '学习', hint: '从概念到方法，找到适合自己的解释。' },
  living: { label: '生活', hint: '贴近日常，把信息变成可用的步骤。' },
  entertainment: { label: '娱乐', hint: '轻松探索兴趣，也看清评价与事实。' },
  inspiration: { label: '灵感', hint: '发现不同视角，让想法有迹可循。' }
};
function renderScene(scene: string): void {
  if (!sceneInfo[scene]) return;
  const changed = selectedScene !== scene;
  selectedScene = scene;
  document.body.dataset.scene = scene;
  document.querySelector<HTMLInputElement>(`input[name="scene"][value="${scene}"]`)!.checked = true;
  document.querySelector('#scene-hint')!.textContent = sceneInfo[scene].hint;
  document.querySelector('#extract-scene')!.textContent = `按${sceneInfo[scene].label}场景提取重点`;
  if (changed && !matchMedia('(prefers-reduced-motion: reduce)').matches) welcome.animate([{ opacity: .65, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
}
document.querySelectorAll<HTMLInputElement>('input[name="scene"]').forEach(radio => radio.addEventListener('change', () => {
  renderScene(radio.value);
  void work(() => grid.setScene(radio.value));
}));
let searchRequest = 0;
let readingRequest = 0;

let actionId = '';
function renderAgent(state: State): void {
  const draft = state.action;
  actionId = draft?.id || '';
  document.querySelector('#action-details')!.classList.toggle('hidden', !draft);
  document.querySelector('#action-title')!.textContent = draft?.status === 'completed' ? '已填写，尚未提交' : draft?.status === 'cancelled' ? '提案已失效' : draft?.status === 'failed' ? '填写未完成，请重新预览' : draft?.status === 'paused' ? '填写已暂停' : '等待你确认的填写';
  document.querySelector('#action-client')!.textContent = draft?.owner ? `提案来自：${draft.owner.name}（客户端自报）` : '由你在本地提出';
  document.querySelector('#action-target')!.textContent = draft ? `目标：${draft.url} → 任务代号` : '';
  document.querySelector('#action-content')!.textContent = draft ? `拟填写内容：${JSON.stringify(draft.value)}` : '';
  if (draft) document.querySelector('#action-status')!.textContent = draft.message;
  document.querySelector<HTMLButtonElement>('#action-confirm')!.disabled = draft?.status !== 'preview';
  document.querySelector<HTMLButtonElement>('#action-pause')!.disabled = draft?.status !== 'preview';
  document.querySelector<HTMLButtonElement>('#action-resume')!.disabled = draft?.status !== 'paused';
  agentPanelOpen = state.agentPanelOpen;
  document.querySelector('#agent-panel')!.classList.toggle('hidden', !agentPanelOpen);
  document.querySelector('#agent-toggle')!.setAttribute('aria-expanded', String(agentPanelOpen));
  document.querySelector('#agent-scope')!.textContent = state.agent?.page ? `当前文档：${state.agent.page.url}` : '请先打开真实网页，再授权读取。';
  const connections = document.querySelector('#agent-connections')!;
  connections.replaceChildren();
  for (const connection of state.agent?.connections || []) {
    const row = document.createElement('div'); row.className = 'agent-connection';
    const label = document.createElement('span');
    label.textContent = `${connection.name} · ${connection.authorized ? '已授权当前文档' : '未授权'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.connectionId = connection.id;
    button.textContent = connection.authorized ? '撤销' : '允许读取当前页';
    button.disabled = !connection.authorized && !state.agent?.page;
    button.addEventListener('click', () => { void work(() => connection.authorized ? grid.agentRevoke(connection.id) : grid.agentGrant(connection.id)); });
    row.append(label, button); connections.append(row);
  }
  if (!state.agent?.connections.length) connections.textContent = '等待本机客户端连接；复制配置后，在 AI 工具中调用 grid_connection_status。';
  document.querySelector('#agent-export')!.textContent = `导出读取回执 (${state.agent?.receiptCount || 0})`;
}

function show(name: 'welcome' | 'results' | 'reading' | 'none'): void {
  welcome.classList.toggle('hidden', name !== 'welcome');
  results.classList.toggle('hidden', name !== 'results');
  reading.classList.toggle('hidden', name !== 'reading');
}

function showError(message: string): void {
  error.textContent = message;
  error.classList.remove('hidden');
  setTimeout(() => error.classList.add('hidden'), 7500);
}

async function work<T>(action: () => Promise<T>): Promise<T | undefined> {
  busy.classList.remove('hidden');
  error.classList.add('hidden');
  try { return await action(); }
  catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    showError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    return undefined;
  }
  finally { busy.classList.add('hidden'); }
}

function addResult(hit: SearchHit): void {
  const card = document.createElement('article');
  card.className = 'result';
  const title = document.createElement('h2');
  title.className = 'result-title';
  title.textContent = hit.title;
  const url = document.createElement('div');
  url.className = 'result-url';
  url.textContent = `${hit.site} · ${hit.url}`;
  const snippet = document.createElement('p');
  snippet.textContent = hit.snippet || '检索服务未返回摘要';
  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = '打开原页 ↗';
  open.addEventListener('click', () => { void work(() => grid.open(hit.url)); });
  const read = document.createElement('button');
  read.type = 'button';
  read.textContent = '干净正文 B';
  read.addEventListener('click', () => { void work(async () => {
    const request = ++readingRequest;
    const page = await grid.read(hit.url);
    if (request !== readingRequest) return;
    document.querySelector('#extraction-content')!.textContent = '';
    document.querySelector('#extraction-label')!.textContent = '';
    readingUrl = page.url;
    document.querySelector<HTMLElement>('#reading-title')!.textContent = page.title;
    document.querySelector<HTMLElement>('#reading-source')!.textContent = page.url;
    document.querySelector<HTMLElement>('#reading-content')!.textContent = page.content;
    show('reading');
  }); });
  actions.append(open, read);
  card.append(title, url, snippet, actions);
  list.append(card);
}

async function submitQuery(raw: string): Promise<void> {
  const request = ++searchRequest;
  await work(async () => {
    const response = await grid.submit(raw, { scene: selectedScene, contextual: document.querySelector<HTMLInputElement>('#contextual-search')!.checked });
    if (request !== searchRequest) return;
    if (response.kind === 'results') {
      document.querySelector<HTMLElement>('#results-title')!.textContent = response.query;
      document.querySelector('#search-context')!.textContent = `${sceneInfo[response.scene].label}场景 · ${response.contextual ? '场景优化已开启' : '使用原始查询'} · 实际查询：${response.actualQuery}`;
      list.replaceChildren();
      response.results.forEach(addResult);
      if (!response.results.length) { const empty = document.createElement('p'); empty.textContent = '没有返回可打开的结果。可以改写问题或返回首页关闭场景优化。'; list.append(empty); }
      show('results');
    }
  });
}
document.querySelector<HTMLFormElement>('#input-form')!.addEventListener('submit', event => { event.preventDefault(); void submitQuery(input.value); });
document.querySelector<HTMLFormElement>('#home-search')!.addEventListener('submit', event => { event.preventDefault(); void submitQuery(document.querySelector<HTMLInputElement>('#home-query')!.value); });
document.querySelector('#extract-scene')!.addEventListener('click', () => {
  const url = readingUrl;
  const scene = selectedScene;
  const request = ++readingRequest;
  const button = document.querySelector<HTMLButtonElement>('#extract-scene')!;
  button.disabled = true;
  document.querySelector('#extraction-label')!.textContent = `${sceneInfo[scene].label}场景 · 正在提取，原文可继续阅读…`;
  void work(async () => {
    try {
      const response = await grid.extract(url, scene);
      if (request !== readingRequest || url !== readingUrl) return;
      document.querySelector('#extraction-content')!.textContent = response.text;
      document.querySelector('#extraction-label')!.textContent = `${sceneInfo[scene].label}场景 · AI 提取，未经核对${response.truncated ? ' · 仅依据正文前 16000 字符' : ''}`;
    } catch (error) {
      if (request === readingRequest) document.querySelector('#extraction-label')!.textContent = '提取失败，可继续阅读下方原文或打开原页。';
      throw error;
    } finally { button.disabled = false; }
  });
});
document.querySelector<HTMLButtonElement>('#back')!.addEventListener('click', () => { void work(() => grid.back()); });
document.querySelector<HTMLButtonElement>('#forward')!.addEventListener('click', () => { void work(() => grid.forward()); });
document.querySelector<HTMLButtonElement>('#reload')!.addEventListener('click', () => { void work(() => grid.reload()); });
document.querySelector<HTMLButtonElement>('#home')!.addEventListener('click', () => { void work(() => grid.home()); });
document.querySelector('#action-preview')!.addEventListener('click', () => { void work(() => grid.actionPreview(document.querySelector<HTMLInputElement>('#action-value')!.value)); });
document.querySelector('#action-confirm')!.addEventListener('click', () => { void work(() => grid.actionConfirm(actionId)); });
document.querySelector('#action-pause')!.addEventListener('click', () => { void work(() => grid.actionPause()); });
document.querySelector('#action-resume')!.addEventListener('click', () => { void work(() => grid.actionResume()); });
document.querySelector('#action-cancel')!.addEventListener('click', () => { void work(() => grid.actionCancel()); });
document.querySelector('#agent-toggle')!.addEventListener('click', () => { void work(() => grid.agentPanel(!agentPanelOpen)); });
document.querySelector('#agent-config')!.addEventListener('click', () => { void work(async () => {
  const format = document.querySelector<HTMLSelectElement>('#agent-config-format')!.value;
  await grid.agentCopyConfig(format === 'codex' ? 'codex' : 'json');
  const button = document.querySelector('#agent-config')!; button.textContent = '已复制';
  setTimeout(() => { button.textContent = '复制 MCP 配置'; }, 2000);
}); });
document.querySelector('#agent-export')!.addEventListener('click', () => { void work(() => grid.agentExport()); });
document.querySelector<HTMLButtonElement>('#return-results')!.addEventListener('click', () => {
  void work(async () => { await grid.results(); show('results'); });
});
document.querySelector<HTMLButtonElement>('#open-reading-source')!.addEventListener('click', () => {
  void work(() => grid.open(readingUrl));
});

function renderState(state: State): void {
  renderAgent(state);
  document.body.classList.toggle('agent-open', state.agentPanelOpen);
  if (state.mode === 'home') show('welcome');
  if (state.mode === 'page') show('none');
  if (state.mode === 'results' && state.hasResults) show('results');
  renderScene(state.scene);
  if (state.value !== lastStateValue) { input.value = state.value; lastStateValue = state.value; }
  document.querySelector<HTMLButtonElement>('#back')!.disabled = !state.canGoBack;
  document.querySelector<HTMLButtonElement>('#forward')!.disabled = !state.canGoForward;
  document.querySelector<HTMLButtonElement>('#return-results')!.disabled = !state.hasResults;
  document.querySelector<HTMLElement>('#setup')!.textContent = state.keyReady
    ? '已检测到 DeepSeek API key。搜索结果由 DeepSeek 提供；当前原型不生成 AI 总结。'
    : '未检测到 DeepSeek API key。网址直达可用；搜索需在启动终端配置 DEEPSEEK_API_KEY。';
}
grid.onState(renderState);
void grid.state().then(renderState);
})();
