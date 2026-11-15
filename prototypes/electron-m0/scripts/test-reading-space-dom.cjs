// Production native-map renderer, with synthetic bridge state. No native-geometry claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const deps = process.env.GRID_TEST_DEPENDENCY_PATH || path.join(__dirname, 'quote-regression/deps');
const { JSDOM } = createRequire(path.join(path.resolve(deps), 'package.json'))('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 35));
function fixture() {
  const dir = path.join(__dirname, '../dist/renderer');
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'map.html'), 'utf8').replace(/<script[^>]*src="map.js"[^>]*><\/script>/, ''), { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, calls = []; let publish;
  const node = id => ({ id, kind: 'page', label: '合成网页标题保留两行', excerpt: '合成引用摘录保留两行', status: 'ready', childIds: [] });
  let state = { ownerId: 'owner', entryId: 'first', scene: 'professional', path: { nodes: [node('first')], currentId: 'first' }, open: true, title: '合成探索', tabs: [{ id: 'owner', title: '合成探索', count: 1, last: '合成网页', ordinal: 1 }], orientation: 'horizontal', density: 'compact', draft: '' };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.gridMap = { state: async () => state, onState: callback => { publish = callback; }, command: async command => { calls.push(command); } };
  w.eval(fs.readFileSync(path.join(dir, 'map.js'), 'utf8'));
  return { w, d: w.document, calls, emit(patch) { state = { ...state, ...patch }; publish(state); }, node, close() { w.close(); } };
}
test('density has a named reversible control and never implies closing the user-open map', async () => {
  const f = fixture(); try {
    await tick(); assert.equal(f.d.body.dataset.density, 'compact');
    f.d.querySelector('#density').click(); assert.equal(f.calls.at(-1).kind, 'density'); assert.equal(f.calls.at(-1).value, 'expanded');
    assert.equal(f.calls.some(c => c.kind === 'close'), false);
    f.emit({ density: 'expanded' }); assert.equal(f.d.querySelector('#density').textContent, '紧凑地图');
    f.d.querySelector('#density').click(); assert.equal(f.calls.at(-1).value, 'compact');
    assert.equal(f.d.querySelector('.node-open strong').textContent, '合成网页标题保留两行'); assert.equal(f.d.querySelector('.excerpt').textContent, '合成引用摘录保留两行');
    f.emit({ open: false }); assert.equal(f.d.querySelector('#density').hidden, true);
    f.emit({ open: true, density: 'expanded' }); assert.equal(f.d.body.dataset.density, 'expanded');
  } finally { f.close(); }
});
test('new current nodes and orientation changes scroll the map into view without stealing draft focus', async () => {
  const f = fixture(); try {
    await tick(); f.d.querySelector('#continue-first').click(); const input = f.d.querySelector('#continue-input'); input.value = '未提交的草稿'; input.focus();
    f.emit({ entryId: 'second', path: { nodes: [f.node('first'), f.node('second')], currentId: 'second' }, draftNode: 'first', draft: input.value }); await tick();
    assert.equal(f.d.activeElement, input); assert.equal(input.value, '未提交的草稿');
    f.emit({ orientation: 'vertical' }); await tick(); assert.equal(f.d.activeElement, input);
    f.d.querySelector('#locate').click(); assert.equal(f.d.activeElement.id, 'node-second', 'explicit Current still focuses its node');
  } finally { f.close(); }
});
