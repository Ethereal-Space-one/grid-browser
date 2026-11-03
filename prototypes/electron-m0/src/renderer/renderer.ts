(() => {
type SearchHit = { title: string; url: string; snippet: string; site: string; date: string | null };
type SearchResponse = { kind: 'results'; results: SearchHit[]; query: string } | { kind: 'page' };
type Reading = { title: string; url: string; content: string };
type State = { mode: 'home' | 'results' | 'page' | 'reading'; value: string; canGoBack: boolean; canGoForward: boolean; hasResults: boolean; keyReady: boolean; agentPanelOpen: boolean; agent?: { page?: { url: string }; connections: { id: string; name: string; authorized: boolean }[]; receiptCount: number } };
type GridApi = {
  submit(input: string): Promise<SearchResponse>;
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
  agentCopyConfig(): Promise<void>;
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

function renderAgent(state: State): void {
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
    const page = await grid.read(hit.url);
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

document.querySelector<HTMLFormElement>('#input-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const response = await grid.submit(input.value);
    if (response.kind === 'results') {
      document.querySelector<HTMLElement>('#results-title')!.textContent = response.query;
      list.replaceChildren();
      response.results.forEach(addResult);
      if (response.results.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = '没有返回可打开的结果。你可以改写查询，或直接输入网址。';
        list.append(empty);
      }
      show('results');
    }
  });
});
document.querySelector<HTMLButtonElement>('#back')!.addEventListener('click', () => { void work(() => grid.back()); });
document.querySelector<HTMLButtonElement>('#forward')!.addEventListener('click', () => { void work(() => grid.forward()); });
document.querySelector<HTMLButtonElement>('#reload')!.addEventListener('click', () => { void work(() => grid.reload()); });
document.querySelector<HTMLButtonElement>('#home')!.addEventListener('click', () => { void work(() => grid.home()); });
document.querySelector('#agent-toggle')!.addEventListener('click', () => { void work(() => grid.agentPanel(!agentPanelOpen)); });
document.querySelector('#agent-config')!.addEventListener('click', () => { void work(async () => {
  await grid.agentCopyConfig();
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
  input.value = state.value;
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
