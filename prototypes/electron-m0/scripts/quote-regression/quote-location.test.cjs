// Compiled public legacy renderers in jsdom. Offline, no real model/IPC/native/layout claim.
// Run: GRID_QUOTE_APP=/path/to/prototypes/electron-m0 node --test quote-location.test.cjs
// QA dependency is separately locked under qa/deps; it is not an app dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('./deps/node_modules/jsdom');
const app = process.env.GRID_QUOTE_APP || path.resolve(__dirname, '../..');
const renderer = path.join(app, 'dist/renderer');
const tick = () => new Promise(resolve => setImmediate(resolve));
const paragraph = '同一整段引文：每天可查询 100 次，支持导出 JSON。';
const cases = [
  ['unique', '上下文。唯一引文。结尾。', '唯一引文', 'unique'],
  ['unique-full-paragraph', paragraph, paragraph, 'unique'],
  ['duplicate-unicode', '😀引文。😀引文。', '😀引文', 'ambiguous'],
  ['duplicate-direct', '重复引文。重复引文。', '重复引文', 'ambiguous'],
  ['duplicate-overlapping', 'ababa', 'aba', 'ambiguous'],
  ['identical-full-paragraph', `${paragraph}\n\n${paragraph}`, paragraph, 'ambiguous'],
  ['identical-new-copy-before-original', `${paragraph}\n新增上下文。\n${paragraph}\n原来的后文。`, paragraph, 'ambiguous'],
  ['missing', '保存的正文保持不变。', '正文没有这句', 'missing'],
  ['empty-defensive', '保存的正文保持不变。', '', 'missing'],
  ['unique-untrusted-text', '开头 <img src=x onerror=window.injected=true> 结尾', '<img src=x onerror=window.injected=true>', 'unique'],
];
function fixture(ui, surface, body, quotes, options = {}) {
  const html = fs.readFileSync(path.join(renderer, `index${ui === 'svelte' ? '-svelte' : ''}.html`), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://grid.local.invalid/' });
  const w = dom.window;
  const scrolls = [];
  w.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };
  if (ui === 'svelte') w.eval(fs.readFileSync(path.join(renderer, 'ui-slice.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(renderer, 'snapshot-quote.js'), 'utf8') + '\n' + fs.readFileSync(path.join(renderer, surface === 'question' ? 'understanding.js' : 'comparison.js'), 'utf8') + '\nwindow.TestController = ' + (surface === 'question' ? 'Understanding' : 'SourceComparison') + '.Controller;');
  const source = { id: 'fixed-source', title: '保存的来源', url: 'https://example.com/saved', fetchedAt: '2026-11-15T00:00:00Z', text: body, truncated: false, ...options.source };
  const state = { ownerId: 'owner', entryId: 'entry', mode: surface, scene: 'learning', presentation: {}, path: { nodes: [{ id: 'origin', status: 'ready' }, { id: 'entry', status: 'ready' }] }, comparisonSelection: [] };
  if (surface === 'question') state.question = { id: 'question', originEntryId: 'origin', title: source.title, url: source.url, question: '合成问题', source: options.noSource ? undefined : source, answer: { text: '待核对的回答', insufficient: false, citations: quotes.map(quote => ({ source: 1, title: source.title, url: source.url, quote })) } };
  else {
    state.comparison = { id: 'comparison', scene: 'learning', topic: '合成对照', sources: [0, 1].map(index => ({ id: `side-${index}`, title: source.title + index, url: source.url + index, originEntryId: 'origin', source: options.noSource ? undefined : index && options.otherBody ? {...source, id: 'other-fixed-source', text: options.otherBody} : source })), analysis: { overview: '待核对', limitations: '合成数据', rows: [{ aspect: '依据', relation: 'agreement', left: { text: '来源 A', quotes }, right: { text: '来源 B', quotes: options.otherQuotes || quotes } }] } };
  }
  const pending = [];
  const hooks = { state: () => state, grid: {}, save: async () => true, focusAddress: () => {}, work: action => { const p = action(); if (p && typeof p.then === 'function') pending.push(p); return p; } };
  const controller = new w.TestController(hooks);
  controller.render(state);
  const textId = surface === 'question' ? 'question-source-text' : 'comparison-text-0';
  const detailId = surface === 'question' ? 'question-evidence' : 'comparison-evidence-0';
  const button = (quoteIndex = 0, side = 0) => surface === 'question' ? w.document.querySelectorAll('#answer-citations button')[quoteIndex] : w.document.getElementById(`comparison-quote-0-${side}-${quoteIndex}`);
  const click = async (quoteIndex = 0, side = 0) => { const b = button(quoteIndex, side); b.focus(); b.click(); await Promise.all(pending.splice(0)); await tick(); return b; };
  return { dom, w, state, controller, scrolls, button, click, source, text: () => w.document.getElementById(textId), details: () => w.document.getElementById(detailId) };
}
for (const ui of ['legacy']) for (const surface of ['question', 'comparison']) {
  for (const [name, body, quote, kind] of cases) test(`${ui}/${surface}/${name}`, async () => {
    const f = fixture(ui, surface, body, [quote]);
    try {
      const b = await f.click();
      assert.equal(f.text().textContent, body, 'saved source is preserved exactly');
      assert.equal(f.details().open, true, 'plain source remains explicitly viewable');
      const marks = f.text().querySelectorAll('mark');
      if (kind === 'unique') {
        assert.equal(marks.length, 1, 'one unique exact match is highlighted');
        assert.equal(marks[0].textContent, quote);
        assert.equal(f.w.document.activeElement, marks[0]);
        assert.deepEqual(f.scrolls, [marks[0]]);
      } else {
        assert.equal(marks.length, 0, 'no guessed highlight');
        assert.equal(f.w.document.activeElement, b, 'nonunique/missing does not move focus');
        assert.equal(f.scrolls.length, 0, 'nonunique/missing does not scroll to a guessed position');
        assert.match(b.textContent, kind === 'ambiguous' ? /多处匹配.*查看引用快照/ : /未匹配/);
      }
      assert.equal(f.w.document.querySelectorAll(`#${surface === 'question' ? 'answer-citations' : 'comparison-rows'} blockquote`)[0].textContent, quote, 'saved quote stays readable');
      assert.equal(f.w.document.querySelectorAll('#question-source-text img,#comparison-text-0 img').length, 0, 'untrusted quote remains text');
      assert.equal(f.w.injected, undefined);
    } finally { f.dom.window.close(); }
  });
  for (const [name, second] of [['ambiguous', '重复引文'], ['missing', '没有的引文']]) test(`${ui}/${surface}/unique-then-${name}-clears-old-highlight`, async () => {
    const f = fixture(ui, surface, '唯一引文。重复引文。重复引文。', ['唯一引文', second]);
    try {
      await f.click(0); assert.equal(f.text().querySelectorAll('mark').length, 1);
      f.scrolls.length = 0;
      const b = await f.click(1);
      assert.equal(f.text().querySelectorAll('mark').length, 0);
      assert.equal(f.text().textContent, f.source.text);
      assert.equal(f.w.document.activeElement, b);
      assert.equal(f.scrolls.length, 0);
      if (surface === 'comparison') assert.equal(f.w.document.getElementById('comparison-evidence-back-0').hidden, true, 'no stale return target');
      await f.click(0); assert.equal(f.text().querySelectorAll('mark').length, 1, 'unique remains usable after refusal');
    } finally { f.dom.window.close(); }
  });
  for (const [name, options] of [['released', { source: { released: true } }], ['no-source', { noSource: true }]]) test(`${ui}/${surface}/${name}-disabled-and-quote-retained`, async () => {
    const f = fixture(ui, surface, '唯一引文', ['唯一引文'], options);
    try {
      assert.equal(f.button().disabled, true);
      f.button().click(); await tick();
      assert.equal(f.scrolls.length, 0);
      assert.equal(f.w.document.querySelector('blockquote').textContent.includes('唯一引文'), true);
    } finally { f.dom.window.close(); }
  });
  if (surface === 'comparison') for (const open of [false, true]) test(`${ui}/comparison/unique-back-preserves-details-${open}`, async () => {
    const f = fixture(ui, surface, '唯一引文', ['唯一引文']);
    try {
      f.details().open = open; await tick(); await f.click();
      const back = f.w.document.getElementById('comparison-evidence-back-0');
      assert.equal(back.hidden, false); back.click(); await tick();
      assert.equal(f.details().open, open);
      assert.equal(f.w.document.activeElement, f.button());
    } finally { f.dom.window.close(); }
  });
}

for (const ui of ['legacy']) test(`${ui}/comparison/sides-are-independent`, async () => {
  const f = fixture(ui, 'comparison', '重复引文。重复引文。', ['重复引文'], { otherBody: '来源 B 唯一引文。', otherQuotes: ['唯一引文'] });
  try {
    await f.click(0, 1);
    const bText = f.w.document.getElementById('comparison-text-1');
    const bMark = bText.querySelector('mark');
    assert.equal(bMark.textContent, '唯一引文');
    f.scrolls.length = 0;
    const aButton = await f.click(0, 0);
    assert.equal(f.text().querySelectorAll('mark').length, 0);
    assert.equal(bText.querySelector('mark'), bMark, 'refusing A does not erase independent B evidence');
    assert.equal(f.w.document.activeElement, aButton);
    assert.equal(f.scrolls.length, 0);
  } finally { f.dom.window.close(); }
});

// Exercise full compiled public UI with synthetic evidence and deferred mock IPC.
function legacyShell(save = async () => true) {
  const files = [];
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/g, (_, file) => { files.push(file); return ''; });
  const w = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://grid.invalid/' }).window;
  const { BrowsingSession } = require(path.join(app, 'dist/application/browsing-session.js'));
  const initial = new BrowsingSession({}, () => {}).snapshot();
  const base = { ...initial, keyReady: true, storage: { status: 'saved', paths: [], limit: 48, bytes: 0, persistent: true },
    tabs: [{ id: initial.ownerId, title: 'Fixture', mode: 'home' }], activeTabId: initial.ownerId, layoutId: 'layout' };
  const calls = [];
  let publish, revision = 0;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.ResizeObserver = class { observe() {} };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.grid = new Proxy({}, { get(_, name) {
    if (name === 'state') return async () => base;
    if (name === 'onState') return callback => { publish = callback; };
    if (name === 'onFocusAddress') return () => {};
    return async (...args) => { calls.push([name, ...args]); return name === 'savePresentation' ? save() : true; };
  } });
  w.eval(files.map(file => fs.readFileSync(path.join(renderer, file), 'utf8')).join('\n'));
  return { w, calls, render(patch) { publish({ ...base, ...patch, revision: ++revision }); }, close() { w.close(); } };
}

const sample = { readingId: 'fixture-reading', title: '合成来源', url: 'https://example.invalid/source',
  fetchedAt: '2026-11-18T00:00:00Z', text: '首条依据。第二条依据。', truncated: false };
const sampleQuotes = ['首条依据', '第二条依据'];
const sampleSide = { text: '合成分析', quotes: sampleQuotes };
const surfaces = {
  question: { mode: 'question', entryId: 'question', value: sample.url,
    question: { id: 'question', originEntryId: 'origin', title: sample.title, url: sample.url, source: sample, question: '结论？', scene: 'learning',
      answer: { text: '合成回答', citations: sampleQuotes.map(quote => ({ source: 1, title: sample.title, url: sample.url, quote })), insufficient: false } } },
  comparison: { mode: 'comparison', entryId: 'comparison', value: sample.url,
    comparison: { id: 'comparison', scene: 'learning', topic: '问题', sources: [0, 1].map(i => ({
      id: 'source-' + i, originEntryId: 'origin', title: sample.title, url: sample.url, source: sample
    })), analysis: { overview: '概述', limitations: '范围', rows: [{ aspect: '范围', relation: 'agreement', left: sampleSide, right: sampleSide }] } } }
};

for (const [surface, state] of Object.entries(surfaces)) test(`${surface}: successive snapshot lookups return to the actual citation without leaking a highlight`, async () => {
  const f = legacyShell(), { document: d } = f.w;
  try {
    await tick();
    f.render(state);
    const target = index => surface === 'question' ? d.querySelectorAll('#answer-citations button')[index]
      : d.getElementById(`comparison-quote-0-0-${index}`);
    const details = () => d.getElementById(surface === 'question' ? 'question-evidence' : 'comparison-evidence-0');
    const back = () => d.getElementById(surface === 'question' ? 'question-evidence-back' : 'comparison-evidence-back-0');
    const inspect = async index => { target(index).focus(); target(index).click(); await tick(); };
    for (const manuallyOpen of [false, true]) {
      details().open = manuallyOpen;
      await inspect(0);
      await inspect(1);
      assert.equal(details().querySelector('mark').textContent, sampleQuotes[1]);
      assert.ok(back() && !back().hidden);
      back().focus(); back().click(); await tick();
      assert.equal(d.activeElement, target(1));
      assert.equal(details().open, manuallyOpen);
      assert.equal(back().hidden, true);
      assert.equal(details().querySelector('mark'), null);
    }
    await inspect(1);
    details().open = false; await new Promise(resolve => f.w.setTimeout(resolve, 0));
    details().open = true; await tick();
    assert.equal(back().hidden, true, 'a manually closed inspection is gone');
    assert.equal(details().querySelector('mark'), null);
    for (const manuallyOpen of [false, true]) {
      details().open = manuallyOpen; await inspect(1);
      f.render({ mode: 'home', entryId: 'other' }); f.render(state);
      assert.equal(details().open, manuallyOpen);
      assert.equal(details().querySelector('mark'), null);
    }
    f.render({ ...state, entryId: 'different' });
    assert.equal(details().open, false);
    assert.ok(f.calls.every(([name]) => name === 'reportLayout' || name === 'savePresentation'));
  } finally { f.close(); }
});

test('an original-source click cannot outlive an intervening step or a rejected save', async () => {
  let release;
  const f = legacyShell(() => new Promise(resolve => { release = resolve; })), { document: d } = f.w;
  const reading = { mode: 'reading', entryId: 'reading', value: sample.url,
    reading: { id: 'reading', url: sample.url, title: sample.title, content: sample.text, fetchedAt: sample.fetchedAt } };
  try {
    await tick();
    for (const [id, state] of [['question-open', surfaces.question], ['comparison-open-0', surfaces.comparison], ['open-reading-source', reading]]) {
      const click = () => d.getElementById(id).click();
      const opens = () => f.calls.filter(([name]) => name === 'open');
      f.render(state);
      const before = opens().length;
      click(); f.render({ mode: 'home', entryId: 'newer' });
      release(true); await tick(); assert.equal(opens().length, before, id + ': newer step');
      f.render(state); click(); f.render({ mode: 'home', entryId: 'intervening' }); f.render(state);
      release(true); await tick(); assert.equal(opens().length, before, id + ': same step revisited');
      click(); release(false); await tick(); assert.equal(opens().length, before, id + ': rejected save');
      click(); release(true); await tick();
      assert.equal(opens().length, before + 1);
      assert.equal(opens().at(-1)[1], sample.url);
    }
  } finally { f.close(); }
});
