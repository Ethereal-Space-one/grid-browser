(() => {
type SearchHit = { title: string; url: string; snippet: string; site: string; date: string | null };
type SearchResponse = { kind: 'results'; results: SearchHit[]; query: string } | { kind: 'page' };
type Reading = { title: string; url: string; content: string };
type State = { mode: 'home' | 'results' | 'page' | 'reading'; value: string; canGoBack: boolean; canGoForward: boolean; hasResults: boolean; keyReady: boolean };
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

function show(name: 'welcome' | 'results' | 'reading'): void {
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
document.querySelector<HTMLButtonElement>('#return-results')!.addEventListener('click', () => {
  void work(async () => { await grid.results(); show('results'); });
});
document.querySelector<HTMLButtonElement>('#open-reading-source')!.addEventListener('click', () => {
  void work(() => grid.open(readingUrl));
});

grid.onState(state => {
  if (state.mode === 'home') show('welcome');
  input.value = state.value;
  document.querySelector<HTMLButtonElement>('#back')!.disabled = !state.canGoBack;
  document.querySelector<HTMLButtonElement>('#forward')!.disabled = !state.canGoForward;
  document.querySelector<HTMLButtonElement>('#return-results')!.disabled = !state.hasResults;
  document.querySelector<HTMLElement>('#setup')!.textContent = state.keyReady
    ? '已检测到 DeepSeek API key。搜索结果由 DeepSeek 提供；当前原型不生成 AI 总结。'
    : '未检测到 DeepSeek API key。网址直达可用；搜索需在启动终端配置 DEEPSEEK_API_KEY。';
});
void grid.state().then(state => {
  document.querySelector<HTMLElement>('#setup')!.textContent = state.keyReady
    ? '已检测到 DeepSeek API key。搜索结果由 DeepSeek 提供；当前原型不生成 AI 总结。'
    : '未检测到 DeepSeek API key。网址直达可用；搜索需在启动终端配置 DEEPSEEK_API_KEY。';
});
})();
