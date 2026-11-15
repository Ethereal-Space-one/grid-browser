// Compiled comparison renderer only, with synthetic public snapshots and no IPC/provider.
// Run after npm run build. Reuses the quote regression's jsdom dependency setup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const deps = process.env.GRID_TEST_DEPENDENCY_PATH || path.join(__dirname, 'quote-regression/deps');
const { JSDOM } = createRequire(path.join(path.resolve(deps), 'package.json'))('jsdom');
const dir = path.join(__dirname, '../dist/renderer');
const quote = 'Synthetic fixed quotation for comparison reading hierarchy.';
const stamps = ['2026-11-15T08:30:01Z', '2026-11-14T09:40:02Z'];
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const errors = [], calls = [], actions = [];
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://grid.invalid/' });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.addEventListener('error', event => errors.push(event.error));
  const sources = [0, 1].map(index => ({
    id: `source-${index}`, originEntryId: `origin-${index}`, title: `合成来源 ${index ? 'B' : 'A'}`,
    url: `https://example.invalid/${index ? 'b' : 'a'}`,
    source: { readingId: `snapshot-${index}`, title: `合成正文 ${index}`, url: `https://example.invalid/${index ? 'b' : 'a'}`,
      text: `Start ${index}.\n${quote}\nEnd ${index}.`, fetchedAt: stamps[index], truncated: index === 1 }
  }));
  const side = index => ({ status: 'supported', text: `来源 ${index ? 'B' : 'A'} 的既有分析`, quotes: [quote] });
  const record = { id: 'comparison-1', scene: 'professional', topic: '合成对照', sources,
    generatedAt: stamps[0], analysis: { overview: '既有概述', limitations: '既有限制', rows: [
      { aspect: '既有逐项主题', relation: 'agreement', left: side(0), right: side(1) }
    ] } };
  let state = { ownerId: 'owner', entryId: 'entry', mode: 'comparison', comparisonSelection: [], comparison: record,
    path: { nodes: [{ id: 'entry', status: 'ready' }, { id: 'origin-0' }, { id: 'origin-1' }] } };
  w.eval(fs.readFileSync(path.join(dir, 'comparison.js'), 'utf8') + '\nwindow.TestComparison = SourceComparison.Controller;');
  const controller = new w.TestComparison({ state: () => state, save: async () => true,
    grid: new Proxy({}, { get: (_, name) => async (...args) => { calls.push([name, ...args]); return true; } }),
    work(action) { const promise = Promise.resolve().then(action); actions.push(promise); return promise; }
  });
  const render = patch => { state = { ...state, ...patch }; controller.render(state); };
  render();
  return { w, d, record, calls, render, state: () => state, async settle() { await Promise.all(actions); await tick(); },
    close() { dom.window.close(); assert.deepEqual(errors, []); } };
}

test('A/B cards keep full provenance, while successful rows keep identity, analysis, quote and action without repeated metadata', async () => {
  const f = fixture(), { d, w, record } = f;
  try {
    const cards = [...d.querySelectorAll('.comparison-source')]; assert.equal(cards.length, 2);
    for (const [index, card] of cards.entries()) {
      assert.equal(card.querySelector('.eyebrow').textContent, `来源 ${index ? 'B' : 'A'}`);
      assert.equal(card.querySelector('h2').textContent, record.sources[index].title);
      assert.equal(card.querySelector('.comparison-url').textContent, record.sources[index].url);
      assert.equal(card.querySelector('.comparison-caption').textContent,
        `引用快照 · 取得于 ${new w.Date(stamps[index]).toLocaleString('zh-CN')} · ${index ? '固定文本，仅前 16000 字符' : '固定文本，非网站当前内容'}`);
      assert.equal(card.querySelector('summary').textContent, '查看引用快照');
    }
    const row = d.querySelector('.comparison-row');
    assert.equal(row.querySelector('h2').textContent, '既有逐项主题');
    assert.equal(row.querySelector('.comparison-relation').textContent, '一致 · AI 判断待核对');
    assert.deepEqual([...row.querySelectorAll('h3')].map(node => node.textContent), ['来源 A', '来源 B']);
    assert.deepEqual([...row.querySelectorAll('.comparison-pair > article > p')].map(node => node.textContent), ['来源 A 的既有分析', '来源 B 的既有分析']);
    assert.equal(row.querySelectorAll('.comparison-quote').length, 2);
    assert.ok([...row.querySelectorAll('blockquote')].every(node => node.textContent === quote));
    assert.ok([...row.querySelectorAll('button')].every(node => node.textContent === '定位快照引文' && !node.disabled));
    assert.equal(row.querySelectorAll('.comparison-caption,.comparison-quote-issue').length, 0);
    assert.doesNotMatch(row.textContent, /取得于|固定文本|16000|未保存/);
    assert.equal(d.querySelector('#comparison-overview').textContent, '既有概述');
    assert.equal(d.querySelector('#comparison-limitations').textContent, '既有限制');
    assert.deepEqual(f.calls, [], 'rendering does not request or navigate');
  } finally { f.close(); }
});

test('snapshot location and return preserve focus, disclosure state, and the same no-request boundary', async () => {
  const f = fixture(), { d } = f;
  try {
    const target = d.querySelector('#comparison-quote-0-0-0'); target.focus(); target.click(); await f.settle();
    assert.equal(d.querySelector('#comparison-evidence-0').open, true);
    assert.equal(d.querySelector('#comparison-text-0 mark').textContent, quote);
    assert.equal(d.activeElement, d.querySelector('#comparison-text-0 mark'));
    d.querySelector('#comparison-evidence-back-0').click(); await f.settle();
    assert.equal(d.activeElement, target); assert.equal(d.querySelector('#comparison-evidence-0').open, false);
    d.querySelector('#comparison-evidence-0').open = true;
    target.click(); await f.settle(); d.querySelector('#comparison-evidence-back-0').click(); await f.settle();
    assert.equal(d.activeElement, target); assert.equal(d.querySelector('#comparison-evidence-0').open, true);
    f.render({ comparison: { ...f.record, id: 'comparison-rerender' } });
    assert.equal(d.activeElement.id, target.id, 'same-entry renderer replacement restores the action focus');
    assert.equal(d.querySelector('#comparison-evidence-0').open, true);
    assert.deepEqual(f.calls, [], 'snapshot inspection never invokes host/provider APIs');
  } finally { f.close(); }
});

test('duplicate and missing quotes show only adjacent local errors and never pick an arbitrary match', async () => {
  const f = fixture(), { d, record } = f;
  try {
    f.render({ comparison: { ...record, id: 'comparison-unmatched', sources: record.sources.map((item, index) => ({ ...item,
      source: { ...item.source, text: index ? 'Different synthetic content.' : `${quote}\n${quote}` } })) } });
    for (const [index, kind] of ['多处匹配', '未匹配'].entries()) {
      const button = d.querySelector(`#comparison-quote-0-${index}-0`), evidence = button.closest('.comparison-quote');
      assert.equal(button.textContent, `${kind} · 查看引用快照`); assert.equal(button.disabled, false);
      const issue = evidence.querySelector('.comparison-quote-issue');
      assert.equal(issue.textContent, `${kind}，未定位；仅展开固定文本供核对`);
      assert.equal(button.getAttribute('aria-describedby'), issue.id);
      assert.doesNotMatch(issue.textContent, /取得于|2026|引用快照 ·/);
      button.focus(); button.click(); await f.settle();
      assert.equal(d.querySelector(`#comparison-evidence-${index}`).open, true);
      assert.equal(d.querySelector(`#comparison-text-${index} mark`), null);
      assert.equal(d.activeElement, button);
    }
    assert.deepEqual(f.calls, []);
  } finally { f.close(); }
});

test('released or absent snapshots preserve the quote, explain the local limitation and keep location disabled', () => {
  const f = fixture(), { d, record } = f;
  try {
    f.render({ comparison: { ...record, id: 'comparison-released', sources: record.sources.map((item, index) => ({ ...item,
      source: index ? undefined : { ...item.source, text: '', released: true },
      issue: index ? '尚未取得公开正文' : undefined })) } });
    const evidence = [...d.querySelectorAll('.comparison-quote')]; assert.equal(evidence.length, 2);
    for (const item of evidence) {
      assert.equal(item.querySelector('blockquote').textContent, quote);
      assert.equal(item.querySelector('button').disabled, true);
      assert.equal(item.querySelector('button').textContent, '完整快照未保存 · 无法定位');
      assert.equal(item.querySelector('.comparison-quote-issue').textContent, '这里只保留引文，无法定位完整快照');
      assert.doesNotMatch(item.textContent, /取得于|2026/);
    }
    assert.match(d.querySelector('.comparison-source .comparison-caption').textContent, /取得于.*快照正文未保存；下方保留引文/);
    assert.equal(d.querySelectorAll('#comparison-sources details').length, 0);
    assert.deepEqual(f.calls, []);
  } finally { f.close(); }
});
