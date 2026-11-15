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
  w.eval(fs.readFileSync(path.join(renderer, surface === 'question' ? 'understanding.js' : 'comparison.js'), 'utf8') + '\nwindow.TestController = ' + (surface === 'question' ? 'Understanding' : 'SourceComparison') + '.Controller;');
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
