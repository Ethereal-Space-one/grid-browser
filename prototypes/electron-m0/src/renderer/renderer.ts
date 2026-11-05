(() => {
type SearchHit = import('../contracts/browsing').SearchHit;
type State = import('../contracts/browsing').State;
type GridApi = import('../contracts/browsing').GridApi;
type Scene = import('../contracts/browsing').Scene;
const grid = (window as unknown as { grid: GridApi }).grid;
const input = document.querySelector<HTMLInputElement>('#input')!;
const welcome = document.querySelector<HTMLElement>('#welcome')!;
const results = document.querySelector<HTMLElement>('#results')!;
const reading = document.querySelector<HTMLElement>('#reading')!;
const error = document.querySelector<HTMLElement>('#error')!;
const busy = document.querySelector<HTMLElement>('#busy')!;
const list = document.querySelector<HTMLElement>('#result-list')!;
const surface = document.querySelector<HTMLElement>('#surface')!;
const chrome = document.querySelector<HTMLElement>('#browser-chrome')!;
let renderedState: State | undefined;
let layoutFrame = 0;
let lastLayout = '';
function measureChrome() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    const state = renderedState; if (!state) return;
    const top = chrome.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty('--chrome-height', `${top}px`);
    const left = document.querySelector('#exploration-sidebar')!.getBoundingClientRect().width;
    document.querySelector('#sidebar-toggle')!.setAttribute('aria-expanded',String(left>0));
    const right = state.companion ? surface.getBoundingClientRect().width : 0;
    const value = { width: innerWidth, height: innerHeight, top, left, right };
    const signature = JSON.stringify([state.ownerId, state.layoutId, value]);
    if (signature === lastLayout) return;
    lastLayout = signature;
    void grid.reportLayout(state.ownerId, state.layoutId, value).catch(showError);
  });
}
new ResizeObserver(measureChrome).observe(chrome);
window.addEventListener('resize', measureChrome);
let viewKey = '';
let restoringPosition = false;
let restoreFrame = 0;
async function savePresentation(): Promise<boolean> {
  const state = renderedState;
  if (!state) return Promise.resolve(false);
  if (state.mode === 'judgment') await judgments.flush();
  return grid.savePresentation(state.ownerId, state.entryId, {
    scrollTop: restoringPosition ? state.presentation.scrollTop : surface.scrollTop, addressDraft: input.value === state.value ? null : input.value,
    homeQuery: document.querySelector<HTMLInputElement>('#home-query')!.value,
    contextual: document.querySelector<HTMLInputElement>('#contextual-search')!.checked,
    questionDraft: document.querySelector<HTMLTextAreaElement>('#question-input')!.value
  });
}
for (const id of ['input', 'home-query', 'contextual-search']) document.querySelector('#' + id)!.addEventListener('input', () => { void savePresentation().catch(showError); });
surface.addEventListener('scroll', () => { void savePresentation().catch(showError); });

let readingUrl = '';
let readingId = '';
let renderedSearchId = '';
let renderedExtractionId = '';
let renderedIssueId: string | undefined;
let lastRevision = -1;
let errorTimer: ReturnType<typeof setTimeout> | undefined;
let agentPanelOpen = false;
let selectedScene: Scene = 'professional';
let lastStateValue: string | undefined;
const sceneInfo: Record<string, { label: string; hint: string }> = {
  professional: { label: '专业', hint: '查依据，重事实，核对原始来源。' },
  learning: { label: '学习', hint: '从概念到方法，找到适合自己的解释。' },
  living: { label: '生活', hint: '贴近日常，把信息变成可用的步骤。' },
  entertainment: { label: '娱乐', hint: '轻松探索兴趣，也看清评价与事实。' },
  inspiration: { label: '灵感', hint: '发现不同视角，让想法有迹可循。' }
};
function renderScene(scene: Scene): void {
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
  renderScene(radio.value as Scene);
  void work(() => grid.setScene(radio.value, renderedState?.ownerId));
}));

(window as unknown as {gridFlushDrafts:()=>Promise<boolean>}).gridFlushDrafts = savePresentation;
const storage = new LocalPaths.Controller({ state: () => renderedState, grid, save: savePresentation, work });
document.querySelector('#refetch-reading')!.addEventListener('click', () => { const s=renderedState; if (s) void work(async()=>{await savePresentation();await grid.read(s.value,s.ownerId);}); });
const shell = new ReadingShell.Controller({state:()=>renderedState,grid,save:savePresentation,work,measure:measureChrome});
const understanding = new Understanding.Controller({ state: () => renderedState, grid, save: savePresentation, work });
const judgments = new PersonalJudgment.Controller({ state: () => renderedState, grid, save: savePresentation, work });
const comparisons = new SourceComparison.Controller({ state: () => renderedState, grid, save: savePresentation, work });
let actionId = '';
function renderAgent(state: State): void {
  const draft = state.action;
  actionId = draft?.id || '';
  document.querySelector('#action-details')!.classList.toggle('hidden', !draft);
  document.querySelector('#action-title')!.textContent = draft?.status === 'completed' ? '已填写，尚未提交' : draft?.status === 'cancelled' ? '提案已失效' : draft?.status === 'failed' ? '填写未完成，请重新预览' : draft?.status === 'paused' ? '填写已暂停' : '等待你确认的填写';
  document.querySelector('#action-client')!.textContent = draft?.owner ? `提案来自：${draft.owner.name}（客户端自报）` : '由你在本地提出';
  document.querySelector('#action-target')!.textContent = draft ? `目标：${draft.url} → 任务代号` : '';
  document.querySelector('#action-content')!.textContent = draft ? `拟填写内容：${JSON.stringify(draft.value)}` : '';
  document.querySelector('#action-status')!.textContent = draft?.message || '仅支持本地 /actions.html 测试页；每次填写都需确认，不提交表单。';
  document.querySelector<HTMLButtonElement>('#action-confirm')!.disabled = draft?.status !== 'preview';
  document.querySelector<HTMLButtonElement>('#action-pause')!.disabled = draft?.status !== 'preview';
  document.querySelector<HTMLButtonElement>('#action-resume')!.disabled = draft?.status !== 'paused';
  agentPanelOpen = state.agentPanelOpen;
  document.querySelector('#agent-panel')!.classList.toggle('hidden', !agentPanelOpen);
  document.querySelector('#agent-toggle')!.setAttribute('aria-expanded', String(agentPanelOpen));
  document.querySelector('#agent-scope')!.textContent = !state.agentTarget ? '此窗口尚未作为 Agent 目标；请激活窗口后重新授权。' : state.agent?.page ? `当前文档：${state.agent.page.url}` : '请先打开真实网页，再授权读取。';
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
    button.addEventListener('click', () => { void work(() => connection.authorized ? grid.agentRevoke(connection.id) : grid.agentGrant(connection.id, state.agent?.page?.documentId || '')); });
    row.append(label, button); connections.append(row);
  }
  if (!state.agent?.connections.length) connections.textContent = '等待本机客户端连接；复制配置后，在 AI 工具中调用 grid_connection_status。';
  document.querySelector('#agent-export')!.textContent = `导出读取回执 (${state.agent?.receiptCount || 0})`;
}

function show(name: 'welcome' | 'results' | 'reading' | 'question' | 'comparison' | 'judgment' | 'none'): void {
  welcome.classList.toggle('hidden', name !== 'welcome');
  results.classList.toggle('hidden', name !== 'results');
  reading.classList.toggle('hidden', name !== 'reading');
}

function showError(message: string): void {
  error.textContent = message;
  error.classList.remove('hidden');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => error.classList.add('hidden'), 7500);
}

async function work<T>(action: () => Promise<T>): Promise<T | undefined> {
  const owner = renderedState?.ownerId;
  try { return await action(); }
  catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (renderedState?.ownerId === owner) showError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    return undefined;
  }
}

function addResult(hit: SearchHit, index: number): void {
  const card = document.createElement('article');
  card.className = 'result';
  const title = document.createElement('h2');
  title.className = 'result-title';
  const link=document.createElement('a');link.href=hit.url;link.textContent=hit.title;
  link.addEventListener('click',event=>{event.preventDefault();void work(async()=>{const owner=renderedState?.ownerId;await savePresentation();if(event.metaKey||event.ctrlKey)await grid.tabNew(hit.url);else await grid.open(hit.url,owner);});});title.append(link);
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
  open.addEventListener('click', () => { void work(async () => { const owner = renderedState?.ownerId; await savePresentation(); await grid.open(hit.url, owner); }); });
  const read = document.createElement('button');
  read.type = 'button';
  read.textContent = '干净正文';
  read.addEventListener('click', () => { void work(async () => { const owner = renderedState?.ownerId; await savePresentation(); await grid.read(hit.url, owner); }); });
  const newTab = document.createElement('button'); newTab.type = 'button'; newTab.textContent = '新探索打开';
  newTab.addEventListener('click', () => { void work(async () => { await savePresentation(); await grid.tabNew(hit.url); }); });
  const more=document.createElement('details');more.className='result-more';const moreLabel=document.createElement('summary');moreLabel.textContent='更多';more.append(moreLabel,read,newTab,comparisons.resultControl(index, renderedState!.search!.id, hit.title, hit.url));actions.append(open,more);
  card.append(title, url, snippet, actions);
  list.append(card);
}

async function submitQuery(raw: string): Promise<void> {
  const owner = renderedState?.ownerId; const scene = selectedScene; const contextual = document.querySelector<HTMLInputElement>('#contextual-search')!.checked;
  await work(async () => { await savePresentation(); await grid.submit(raw, { scene, contextual }, owner); });
}
let composing=false;document.addEventListener('compositionstart',()=>{composing=true;});document.addEventListener('compositionend',()=>{composing=false;});
document.querySelector<HTMLFormElement>('#input-form')!.addEventListener('submit', event => { event.preventDefault(); if(composing)return; void submitQuery(input.value); });
document.querySelector<HTMLFormElement>('#home-search')!.addEventListener('submit', event => { event.preventDefault(); if(composing)return; void submitQuery(document.querySelector<HTMLInputElement>('#home-query')!.value); });
document.querySelector('#extract-scene')!.addEventListener('click', () => {
  void work(() => grid.extract(readingUrl, selectedScene, readingId, renderedState?.ownerId));
});
document.querySelector('#cancel-request')!.addEventListener('click', event => {
  const button = event.currentTarget; const owner = renderedState?.ownerId;
  const heldFocus = document.activeElement === button;
  void work(async () => {
    await grid.cancelRequest(owner);
    if (heldFocus && renderedState?.ownerId === owner && (document.activeElement === button || document.activeElement === document.body)) {
      const extract = document.querySelector<HTMLButtonElement>('#extract-scene')!;
      const next = reading.classList.contains('hidden') ? input : extract.disabled ? document.querySelector<HTMLButtonElement>('#open-reading-source')! : extract;
      next.focus();
    }
  });
});
document.querySelector<HTMLButtonElement>('#back')!.addEventListener('click', () => { void work(async () => { const owner = renderedState?.ownerId; await savePresentation(); await grid.back(owner); }); });
document.querySelector<HTMLButtonElement>('#forward')!.addEventListener('click', () => { void work(async () => { const owner = renderedState?.ownerId; await savePresentation(); await grid.forward(owner); }); });
document.querySelector<HTMLButtonElement>('#reload')!.addEventListener('click', () => { void work(() => grid.reload(renderedState?.ownerId)); });
document.querySelector<HTMLButtonElement>('#reopen-page')!.addEventListener('click', () => {
  const state = renderedState; const recovery = state?.pageRecovery;
  if (state && recovery) void work(() => grid.reopenPage(state.entryId, state.ownerId, recovery.id));
});
document.querySelector<HTMLButtonElement>('#home')!.addEventListener('click', () => { void work(async () => { const owner = renderedState?.ownerId; await savePresentation(); await grid.home(owner); }); });
document.querySelector('#action-preview')!.addEventListener('click', () => { void work(() => grid.actionPreview(document.querySelector<HTMLInputElement>('#action-value')!.value, renderedState?.ownerId)); });
document.querySelector('#action-confirm')!.addEventListener('click', () => { void work(() => grid.actionConfirm(actionId, renderedState?.ownerId)); });
document.querySelector('#action-pause')!.addEventListener('click', () => { void work(() => grid.actionPause(renderedState?.ownerId)); });
document.querySelector('#action-resume')!.addEventListener('click', () => { void work(() => grid.actionResume(renderedState?.ownerId)); });
document.querySelector('#action-cancel')!.addEventListener('click', () => { void work(() => grid.actionCancel(renderedState?.ownerId)); });
document.querySelector('#agent-toggle')!.addEventListener('click', () => { void work(() => grid.agentPanel(!agentPanelOpen)); });
document.querySelector('#agent-config')!.addEventListener('click', () => { void work(async () => {
  const format = document.querySelector<HTMLSelectElement>('#agent-config-format')!.value;
  await grid.agentCopyConfig(format === 'codex' ? 'codex' : 'json');
  const button = document.querySelector('#agent-config')!; button.textContent = '已复制';
  setTimeout(() => { button.textContent = '复制 MCP 配置'; }, 2000);
}); });
document.querySelector('#agent-export')!.addEventListener('click', () => { void work(() => grid.agentExport()); });
document.querySelector<HTMLButtonElement>('#return-results')!.addEventListener('click', () => {
  void work(async () => { const owner = renderedState?.ownerId; await savePresentation(); await grid.results(owner); });
});
document.querySelector<HTMLButtonElement>('#open-reading-source')!.addEventListener('click', () => {
  void work(async () => { const owner = renderedState?.ownerId; const url = readingUrl; await savePresentation(); await grid.open(url, owner); });
});

function renderTabs(state: State): void {
  const container = document.querySelector('#tab-list')!;
  const signature = JSON.stringify([state.activeTabId, state.tabs]);
  if (container.getAttribute('data-rendered') === signature) return;
  const focused = document.activeElement?.id;
  container.setAttribute('data-rendered', signature); container.replaceChildren();
  for (const tab of state.tabs) {
    const entry = document.createElement('div'); entry.className = 'tab-entry'; entry.setAttribute('role', 'presentation');
    const button = document.createElement('button'); button.type = 'button'; button.id = 'tab-' + tab.id;
    button.className = 'tab-select'; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'surface');
    button.setAttribute('aria-selected', String(tab.id === state.activeTabId)); button.tabIndex = tab.id === state.activeTabId ? 0 : -1;
    button.textContent = `${tab.pending ? '◦ ' : ''}${tab.title}`; button.title = tab.title;
    entry.classList.toggle('selected', tab.id === state.activeTabId);
    button.addEventListener('click', () => { void work(async () => { await savePresentation(); await grid.tabSelect(tab.id); document.getElementById(button.id)?.focus(); }); });
    button.addEventListener('keydown', event => {
      const index = state.tabs.findIndex(t => t.id === tab.id);
      const next = ['ArrowRight','ArrowDown'].includes(event.key) ? (index + 1) % state.tabs.length : ['ArrowLeft','ArrowUp'].includes(event.key) ? (index + state.tabs.length - 1) % state.tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); document.getElementById('tab-' + state.tabs[next].id)?.focus(); }
      if (event.key === 'Delete') { event.preventDefault(); void closeTab(tab.id); }
    });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'tab-close';
    close.textContent = '×'; close.setAttribute('aria-label', `关闭 ${tab.title}`); close.tabIndex = tab.id === state.activeTabId ? 0 : -1;
    close.addEventListener('click', () => { void closeTab(tab.id); });
    entry.append(button, close); container.append(entry);
  }
  if (focused?.startsWith('tab-')) document.getElementById(focused)?.focus();
  document.querySelector('#surface')!.setAttribute('aria-labelledby', 'tab-' + state.activeTabId);
}
async function closeTab(id: string) {
  await work(async () => { await savePresentation(); await grid.tabClose(id); if (renderedState) document.getElementById('tab-' + renderedState.activeTabId)?.focus(); });
}
document.querySelector('#new-tab')!.addEventListener('click', () => { void work(async () => { await savePresentation(); await grid.tabNew(); document.querySelector<HTMLInputElement>('#home-query')!.focus(); }); });
document.querySelector('#new-window')!.addEventListener('click', () => { void work(async () => { await savePresentation(); await grid.windowNew(); }); });
grid.onFocusAddress(() => { input.focus(); input.select(); });

function renderState(state: State): void {
  if (state.revision < lastRevision) return;
  lastRevision = state.revision;
  const nextView = [state.ownerId, state.entryId, state.mode, state.search?.id, state.reading?.id].join(':');
  const switched = viewKey !== nextView;
  if (switched) {
    viewKey = nextView; lastStateValue = undefined;
    error.classList.add('hidden'); clearTimeout(errorTimer);
    cancelAnimationFrame(restoreFrame); restoringPosition = true;
    document.querySelector<HTMLInputElement>('#home-query')!.value = state.presentation.homeQuery;
    document.querySelector<HTMLInputElement>('#contextual-search')!.checked = state.presentation.contextual;
  }
  const recovery = state.mode === 'page' ? state.pageRecovery : undefined;
  const focusRecovery = recovery && recovery.kind !== 'loading' && recovery.id !== renderedState?.pageRecovery?.id;
  renderedState = state;
  shell.render(state);
  understanding.render(state);
  measureChrome();
  document.querySelector('#page-recovery')!.classList.toggle('hidden', !recovery);
  if (recovery) {
    document.querySelector('#page-recovery-title')!.textContent = recovery.kind === 'loading' ? '正在打开页面' : recovery.kind === 'submission' ? '此页面未重新提交' : '需要重新打开页面';
    document.querySelector('#page-recovery-url')!.textContent = recovery.url;
    document.querySelector('#page-recovery-message')!.textContent = recovery.message;
    document.querySelector<HTMLButtonElement>('#reopen-page')!.disabled = recovery.kind === 'loading';
  }
  renderTabs(state);
  renderAgent(state);
  document.body.classList.toggle('agent-open', state.agentPanelOpen);
  if (!state.search && renderedSearchId) { renderedSearchId = ''; list.replaceChildren(); document.querySelector('#search-context')!.textContent = ''; }
  if (!state.reading && readingId) { readingId = ''; readingUrl = ''; renderedExtractionId = ''; document.querySelector('#reading-content')!.textContent = ''; document.querySelector('#extraction-content')!.textContent = ''; }
  if (state.search && state.search.id !== renderedSearchId) {
    renderedSearchId = state.search.id;
    document.querySelector('#results-title')!.textContent = state.search.query;
    document.querySelector('#search-details-label')!.textContent = `${sceneInfo[state.search.scene].label}场景 · ${state.search.contextual ? '场景优化' : '原始查询'} · 来源与实际查询`;
    document.querySelector<HTMLDetailsElement>('#search-details')!.open = false;
    document.querySelector('#search-context')!.textContent = `${sceneInfo[state.search.scene].label}场景 · ${state.search.contextual ? '场景优化已开启' : '使用原始查询'} · 实际查询：${state.search.actualQuery}`;
    list.replaceChildren();
    state.search.results.forEach(addResult);
    if (!state.search.results.length) {
      const empty = document.createElement('p'); empty.textContent = '没有返回可打开的结果。可以改写问题或返回首页关闭场景优化。'; list.append(empty);
    }
  }
  if (state.mode === 'results' && !state.search) {
    document.querySelector('#results-title')!.textContent = state.value;
    document.querySelector('#search-context')!.textContent = state.pending ? '正在搜索；你可以修改问题或取消请求。'
      : state.path.notice || '尚无结果。可以重新搜索或返回首页。';
  }
  document.querySelector<HTMLElement>('#refetch-reading')!.hidden = state.mode !== 'reading' || Boolean(state.reading && !state.reading.released) || Boolean(state.pending);
  document.querySelector<HTMLButtonElement>('#comparison-reading')!.disabled = !state.reading || Boolean(state.reading.released || state.pending);
  if (state.mode === 'reading' && (!state.reading || state.reading.released)) {
    readingId = ''; readingUrl = state.value;
    document.querySelector('#reading-title')!.textContent = state.path.nodes.find(node => node.id === state.entryId)?.label || '已访问的正文';
    document.querySelector('#reading-source')!.textContent = state.value;
    document.querySelector('#reading-content')!.textContent = state.reading?.released ? `正文全文未保存；路径、回答和笔记仍可回看。此版取得于 ${new Date(state.reading.fetchedAt).toLocaleString('zh-CN')}。点击重新获取会创建新步骤，内容可能变化。` : '正文已从内存释放；路径和位置仍保留。可以打开真实原页继续阅读。';
    document.querySelector('#extraction-content')!.textContent = '';
  }
  if (state.reading && !state.reading.released && state.reading.id !== readingId) {
    readingId = state.reading.id; readingUrl = state.reading.url; renderedExtractionId = '';
    document.querySelector('#reading-title')!.textContent = state.reading.title;
    document.querySelector('#reading-source')!.textContent = state.reading.url;
    document.querySelector('#reading-content')!.textContent = state.reading.content;
    document.querySelector('#extraction-content')!.textContent = '';
  }
  if (state.extraction && state.extraction.readingId === readingId && state.extraction.id !== renderedExtractionId) {
    renderedExtractionId = state.extraction.id;
    document.querySelector('#extraction-content')!.textContent = state.extraction.text;
  }
  document.querySelector('#extraction-label')!.textContent = state.pending?.kind === 'extraction'
    ? '正在提取，原文可继续阅读…'
    : state.issue?.kind === 'extraction' && state.mode === 'reading' ? '提取失败，可继续阅读下方原文或打开原页。'
    : state.extraction && state.extraction.readingId === readingId ? `${sceneInfo[state.extraction.scene].label}场景 · AI 提取，未经核对${state.extraction.truncated ? ' · 仅依据正文前 16000 字符' : ''}` : '';
  document.querySelector('#extract-notice')!.textContent = state.mode === 'reading' && (!state.reading || state.reading.released)
    ? '正文已从内存释放，当前无法提取；可以打开真实原页继续阅读。'
    : '点击后将公开网页正文（最多 16000 字符）发送给 DeepSeek 模型，产生额外调用。提取不会替换原文。';
  document.querySelector<HTMLButtonElement>('#extract-scene')!.disabled = Boolean(state.pending) || !readingId;
  busy.classList.toggle('hidden', !state.pending && !state.path.notice);
  document.querySelector<HTMLButtonElement>('#cancel-request')!.hidden = !state.pending;
  const pendingLabel = state.pending?.kind === 'comparison' ? '正在对照来源…' : state.pending?.kind === 'question' ? '正在回答…' : state.pending?.kind === 'summary' ? '正在生成短总结…' : state.pending?.kind === 'extraction' ? '正在提取重点…' : state.pending?.kind === 'reading' ? '正在获取正文…' : '正在获取结果…';
  const retained = state.pending && state.pending.kind !== 'extraction' && (state.search || state.reading || state.mode === 'page');
  document.querySelector('#busy-label')!.textContent = state.pending ? pendingLabel + (retained ? ' 保留上一步内容。' : '') : state.path.notice || '';
  busy.title = state.path.notice || '';
  if (state.issue?.id !== renderedIssueId) {
    renderedIssueId = state.issue?.id;
    if (state.issue) showError(state.issue.message); else error.classList.add('hidden');
  }
  if (state.pending) error.classList.add('hidden');
  show(state.mode === 'home' ? 'welcome' : state.mode === 'page' ? 'none' : state.mode);
  renderScene(state.scene);
  comparisons.render(state);
  judgments.render(state);
  storage.render(state);
  if (state.value !== lastStateValue) { input.value = switched ? state.presentation.addressDraft ?? state.value : state.value; lastStateValue = state.value; }
  if (switched) {
    const key = viewKey;
    restoreFrame = requestAnimationFrame(() => { if (key === viewKey) { surface.scrollTop = state.presentation.scrollTop; restoringPosition = false; } });
  }
  if (focusRecovery) requestAnimationFrame(() => {
    if (renderedState?.pageRecovery?.id === recovery.id) document.querySelector<HTMLElement>('#page-recovery-title')!.focus();
  });
  document.querySelector<HTMLButtonElement>('#back')!.disabled = !state.canGoBack;
  document.querySelector<HTMLButtonElement>('#forward')!.disabled = !state.canGoForward;
  document.querySelector<HTMLButtonElement>('#return-results')!.disabled = !state.hasResults;
  document.querySelector<HTMLElement>('#setup')!.textContent = state.keyReady
    ? '搜索已配置。搜索结果由 DeepSeek 提供；短总结和正文问答由你按需开启。'
    : '输入网址即可浏览；使用搜索时，可在下方设置 DeepSeek API key，仅本次有效。';
  document.querySelector('#provider-status')!.textContent = state.keyReady
    ? '密钥已配置，仅本次运行使用。' : '';
  document.querySelector('#provider-enable')!.textContent = state.keyReady ? '更换本次密钥' : '本次启用';
}
document.querySelector('#provider-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const field = document.querySelector<HTMLInputElement>('#provider-key')!;
  const key = field.value; field.value = '';
  void work(() => grid.configureKey(key));
});
grid.onState(renderState);
void grid.state().then(renderState);
})();
