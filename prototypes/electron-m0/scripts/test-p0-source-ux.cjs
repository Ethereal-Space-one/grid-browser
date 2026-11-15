// Compiled production renderer + real selection use case; synthetic public sources only.
// No native geometry or external services. Install deps with npm run test:quote:setup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const deps = process.env.GRID_TEST_DEPENDENCY_PATH || path.join(__dirname, 'quote-regression/deps');
const { JSDOM } = createRequire(path.join(path.resolve(deps), 'package.json'))('jsdom');
const { BrowsingSession } = require('../dist/application/browsing-session.js');
const stamp = '2026-11-15T08:30:00Z';
const quote = 'Synthetic fixed source quotation for this UX regression.';
const urls = ['https://example.invalid/a', 'https://example.invalid/b', 'https://example.invalid/c'];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const calls = [], requests = [], errors = [];
  const provider = {
    search: async () => { requests.push('search'); return urls.map((url, i) => ({ url, title: `资料 ${i + 1}`, site: 'example.invalid', snippet: '仅用于本地回归的合成公开摘要。', date: null })); },
    read: async url => { requests.push(['read', url]); return { title: url, content: quote }; },
    extract: async () => { throw new Error('unexpected extract'); },
    compare: async request => { requests.push(['compare', request.sources.map(s => s.url)]); return { overview: '合成对照', limitations: '仅用于回归', rows: [{ aspect: '合成依据', relation: 'agreement', left: { status: 'supported', text: '合成', quotes: [quote] }, right: { status: 'supported', text: '合成', quotes: [quote] } }] }; }
  };
  let publish, revision = 0, state;
  const host = new BrowsingSession(provider, () => emit());
  const full = patch => ({ ...host.snapshot(), windowId: 1, activeTabId: host.snapshot().ownerId,
    tabs: [{ id: host.snapshot().ownerId, title: '合成回归', mode: host.snapshot().mode, pending: false }],
    keyReady: true, hasResults: true, agentPanelOpen: false, agentTarget: false, pathMapOpen: false,
    storagePanelOpen: false, storage: { status: 'saved', paths: [], limit: 48, bytes: 0, persistent: true }, layoutId: 'fixture', ...patch, revision: ++revision });
  function emit(patch) { state = full(patch); publish?.(state); return state; }
  await host.search('合成资料对照', 'professional', false); emit();
  const scripts = [], dir = path.join(__dirname, '../dist/renderer');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/g, (_, file) => { scripts.push(file); return ''; });
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://grid.invalid/' });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  w.grid = new Proxy({}, { get(_, name) {
    if (name === 'state') return async () => state;
    if (name === 'onState') return callback => { publish = callback; };
    if (name === 'onFocusAddress') return () => {};
    return async (...args) => {
      calls.push([name, ...args]);
      if (name === 'comparisonChoose') return host.chooseComparison(args[0]);
      if (name === 'comparisonRemove') return host.removeComparison(args[0]);
      if (name === 'comparisonStart') return host.startComparison();
      if (name === 'jump') return host.jump(args[0]);
      if (name === 'open') return host.open(args[0]);
      return true;
    };
  } });
  w.addEventListener('error', event => { errors.push(event.error); });
  w.eval(scripts.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n'));
  await tick();
  return { w, d: w.document, host, calls, requests, emit, state: () => state, close() { dom.window.close(); assert.deepEqual(errors, []); } };
}

test('results opt in once, expose every checkbox outside More, preserve explicit ordered sources on exit, and request only on Compare', async () => {
  const f = await fixture(), { d, w, host, requests, calls } = f;
  try {
    const button = d.querySelector('#comparison-select-mode');
    const picks = () => [...d.querySelectorAll('[data-comparison-url]')];
    const chosen = () => host.snapshot().comparisonSelection.map(s => s.url);
    const before = host.snapshot(), nodes = before.path.nodes.length;
    assert.equal(button.textContent, '选资料对照'); assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(picks().length, 3); assert.ok(picks().every(box => box.closest('.comparison-pick').hidden && !box.closest('details')));
    picks()[0].click(); await tick(); assert.deepEqual(chosen(), [], 'hidden controls cannot bypass opt-in');
    button.click(); assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.ok(picks().every(box => !box.closest('.comparison-pick').hidden));
    assert.ok(picks().every(box => box.getAttribute('aria-label').includes('资料') && box.getAttribute('aria-describedby') === 'comparison-select-help'));
    assert.equal(calls.filter(c => /^comparison/.test(c[0])).length, 0, 'entering mode is UI-only');
    picks()[1].click(); await tick(); assert.deepEqual(chosen(), [urls[1]]); assert.equal(d.querySelector('#comparison-start').hidden, true);
    picks()[0].click(); await tick(); assert.deepEqual(chosen(), [urls[1], urls[0]]);
    assert.equal(picks()[2].disabled, true); assert.equal(d.querySelector('#comparison-start').hidden, false);
    assert.equal(picks()[1].closest('label').textContent, '已选为 A'); assert.equal(picks()[0].closest('label').textContent, '已选为 B');
    assert.match(d.querySelector('#comparison-selection').textContent, /A · 资料 2.*B · 资料 1/);
    button.click(); assert.ok(picks().every(box => box.closest('.comparison-pick').hidden)); assert.deepEqual(chosen(), [urls[1], urls[0]]);
    button.click();
    const more = d.querySelector('.result-more'); more.open = true; more.querySelector('button').focus();
    more.querySelector('button').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(more.open, false); assert.equal(d.activeElement, more.querySelector('summary'));
    assert.equal(button.getAttribute('aria-pressed'), 'true', 'first Escape closes the inner disclosure');
    picks()[0].focus();
    picks()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true }));
    assert.equal(button.getAttribute('aria-pressed'), 'true', 'IME Escape is ignored');
    const escape = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    picks()[0].dispatchEvent(escape); assert.equal(escape.defaultPrevented, true); assert.equal(d.activeElement, button);
    assert.equal(button.getAttribute('aria-pressed'), 'false'); assert.deepEqual(chosen(), [urls[1], urls[0]]);
    assert.equal(host.snapshot().path.nodes.length, nodes); assert.deepEqual(requests, ['search']);
    // An explicit remove is the only selection-clearing action. Re-adding follows click order.
    d.querySelector('#comparison-selection button').click(); await tick(); assert.deepEqual(chosen(), [urls[0]]);
    button.click(); picks()[1].click(); await tick(); assert.deepEqual(chosen(), [urls[0], urls[1]]);
    assert.deepEqual(requests, ['search']);
    d.querySelector('#comparison-start').click(); await tick(); await tick();
    assert.equal(host.snapshot().mode, 'comparison'); assert.equal(host.snapshot().path.nodes.length, nodes + 1);
    assert.deepEqual(requests, ['search', ['read', urls[0]], ['read', urls[1]], ['compare', [urls[0], urls[1]]]]);
    const comparison = host.snapshot(); host.jump(before.entryId); await tick();
    assert.equal(button.getAttribute('aria-pressed'), 'false', 'reading return is dense by default'); assert.deepEqual(chosen(), [urls[0], urls[1]]);
    button.click();
    f.emit({ ownerId: 'other-tab', activeTabId: 'other-tab', search: { ...before.search, id: 'other-search' }, comparisonSelection: [] });
    assert.equal(button.getAttribute('aria-pressed'), 'false', 'another result list does not inherit opt-in');
    f.emit(); assert.deepEqual(chosen(), [urls[0], urls[1]]); assert.equal(button.getAttribute('aria-pressed'), 'false');
    host.jump(comparison.entryId); await tick();
    assert.equal(requests.length, 4, 'returning to a fixed comparison never re-requests');
    assert.equal(new Set([...d.querySelectorAll('[id]')].map(n => n.id)).size, d.querySelectorAll('[id]').length);
  } finally { f.close(); }
});

test('snapshot view/location and current website actions have distinct labels, times, and no ambiguous snapshot highlight', async () => {
  const f = await fixture(), { d, host, calls, requests } = f;
  try {
    for (const index of [0, 1]) host.chooseComparison({ kind: 'result', searchId: host.snapshot().search.id, index });
    await host.startComparison(); await tick();
    assert.equal(d.querySelector('#comparison-evidence-0 summary').textContent, '查看引用快照');
    assert.match(d.querySelector('.comparison-source .comparison-caption').textContent, /引用快照 · 取得于.*固定文本/);
    assert.equal(d.querySelector('#comparison-open-0').textContent, '打开网站原页 ↗');
    const quoteButton = d.querySelector('#comparison-quote-0-0-0'); assert.equal(quoteButton.textContent, '定位快照引文');
    const count = requests.length; quoteButton.click(); await tick();
    assert.equal(d.querySelector('#comparison-text-0 mark').textContent, quote); assert.equal(requests.length, count);
    const source = { readingId: 'fixed-reading', fetchedAt: stamp, truncated: false, title: '固定资料', url: urls[0], text: quote };
    const question = { id: 'fixed-question', originEntryId: host.snapshot().entryId, originKind: 'reading', title: source.title, url: source.url, scene: 'professional', question: '合成问题', source, answer: { text: '合成答案', insufficient: false, citations: [{ source: 1, title: source.title, url: source.url, quote }] }, answeredAt: stamp };
    f.emit({ mode: 'question', entryId: 'question-unique', question });
    assert.equal(d.querySelector('#question-evidence summary').textContent, '查看引用快照');
    assert.match(d.querySelector('#source-version').textContent, /引用快照 · 取得于.*固定文本.*非网站当前内容/);
    assert.equal(d.querySelector('#question-open').textContent, '打开网站原页 ↗');
    assert.equal(d.querySelector('#answer-citations button').textContent, '定位快照引文');
    d.querySelector('#answer-citations button').click(); assert.equal(d.querySelector('#question-source-text mark').textContent, quote);
    for (const [id, text, label] of [['duplicate', quote + '\n' + quote, '多处匹配 · 查看引用快照'], ['missing', 'Synthetic different text.', '未匹配 · 查看引用快照']]) {
      f.emit({ mode: 'question', entryId: id, question: { ...question, id, source: { ...source, text } } });
      assert.equal(d.querySelector('#answer-citations button').textContent, label);
      d.querySelector('#answer-citations button').click(); assert.equal(d.querySelector('#question-source-text mark'), null, 'never select an arbitrary occurrence');
      assert.match(d.querySelector('#answer-citations .question-caption').textContent, /取得于.*未定位/);
    }
    f.emit({ mode: 'question', entryId: 'released', question: { ...question, id: 'released', source: { ...source, text: '', released: true } } });
    assert.equal(d.querySelector('#question-evidence').hidden, true); assert.equal(d.querySelector('#answer-citations button').disabled, true);
    assert.match(d.querySelector('#answer-citations button').getAttribute('aria-label'), /完整快照未保存 · 无法定位/);
    f.emit({ mode: 'reading', entryId: 'reading', reading: { id: 'reading', title: source.title, url: source.url, content: quote, fetchedAt: stamp } });
    assert.match(d.querySelector('#reading-version').textContent, /引用快照 · 取得于.*固定文本，非网站当前内容/);
    assert.equal(d.querySelector('#open-reading-source').textContent, '打开网站原页 ↗');
    const citation = { ...source, id: 'host-citation', quote }; delete citation.text;
    const judgment = { id: 'fixed-judgment', draftId: 'fixed-draft', lineageId: 'lineage', revision: 0, status: 'draft', version: 0, originEntryId: host.snapshot().entryId, originKind: 'question', originRecordId: question.id, scene: 'professional', topic: '合成题目', modelNote: '', citations: [citation], citationIds: [], text: '合成判断', checks: '' };
    f.emit({ mode: 'judgment', entryId: 'judgment', judgment });
    const open = d.querySelector('.judgment-open-citation'); assert.equal(open.textContent, '打开网站原页'); assert.match(open.title, /主动定位一次.*不会自动定位或改用引用快照/);
    assert.match(d.querySelector('.judgment-citation .judgment-caption').textContent, /引用快照引文 · 取得于/);
    open.click(); await tick(); assert.deepEqual(calls.filter(c => c[0] === 'judgmentOpenCitation').at(-1), ['judgmentOpenCitation', citation.id, host.snapshot().ownerId, 'judgment']);
    assert.equal(d.querySelector('#quote-locate').textContent, '定位这段引文', 'existing explicit one-shot website control is unchanged');
    assert.equal(calls.filter(c => c[0] === 'quoteLocate').length, 0, 'opening original never auto-locates');
    const snippetSummary = { id: 'snippet-summary', searchId: host.snapshot().search.id, text: '合成搜索短总结', insufficient: false, generatedAt: stamp, citations: [{ source: 1, title: source.title, url: source.url, quote }] };
    f.emit({ mode: 'results', summary: snippetSummary });
    assert.equal(d.querySelector('#summary-sources').closest('details').querySelector('summary').textContent, '查看摘要引用');
    assert.match(d.querySelector('#summary-sources').closest('details').textContent, /来自搜索摘要，不是 Fetch 正文或完整引用快照/);
    assert.equal(d.querySelector('#summary-sources blockquote').textContent, quote);
    assert.equal(d.querySelector('#summary-sources button').textContent, '来源 1 · 打开网站原页');
    f.emit({ mode: 'page', entryId: 'summary-page', value: source.url, summary: { ...snippetSummary, id: 'page-summary', searchId: 'page:summary-page', pageSource: source } });
    assert.equal(d.querySelector('#page-summary details summary').textContent, '查看引用摘录');
    assert.match(d.querySelector('#page-summary details').textContent, /不含完整正文快照/);
    assert.match(d.querySelector('#page-summary-source').textContent, /Fetch 来源取得于/);
    const evidence = d.querySelector('.page-summary-evidence');
    assert.equal(evidence.querySelector('blockquote').textContent, quote);
    assert.equal(evidence.children[1].id, 'page-summary-citations', 'actual excerpt precedes source disclosure');
    assert.equal(evidence.querySelector('.page-source-details').open, false);
    assert.equal(d.querySelector('#page-summary-citations').closest('details'), evidence);
    assert.equal(requests.length, count, 'snapshot and excerpt inspection makes no provider request');
  } finally { f.close(); }
});
