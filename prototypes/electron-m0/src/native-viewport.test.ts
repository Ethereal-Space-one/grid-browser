import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebContentsView } from 'electron';
import { NativeViewport } from './browser/native-viewport';
import { mapCommandSchema } from './contracts/map';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
function fixture(initial = { x: 208, y: 108, width: 972, height: 680 }) {
  const calls: unknown[][] = []; let bounds = initial;
  const web = {
    isDestroyed: () => false, isLoadingMainFrame: () => false,
    insertCSS: async (css: string) => { calls.push(['css', css]); return 'anchor-key'; },
    removeInsertedCSS: async (key: string) => { calls.push(['remove', key]); },
    executeJavaScriptInIsolatedWorld: async (world: number, scripts: { code: string }[]) => { calls.push(['settle', world, scripts[0].code]); }
  };
  const view = { webContents: web, getBounds: () => bounds, setBounds(value: typeof bounds) { bounds = value; calls.push(['bounds', value]); }, setVisible(value: boolean) { calls.push(['visible', value]); } };
  return { view: view as unknown as WebContentsView, web, calls, bounds: () => bounds };
}
test('live viewport sizes disable anchoring before resize and clean up without reading/replaying website scroll or fields', async () => {
  const f = fixture(), layout = new NativeViewport(), resized = { x: 208, y: 108, width: 592, height: 680 };
  layout.resize(f.view, resized, () => true); assert.deepEqual(f.calls.map(c => c[0]), ['css']);
  await tick(); assert.deepEqual(f.bounds(), resized); assert.deepEqual(f.calls.map(c => c[0]), ['css', 'bounds', 'visible', 'settle', 'remove']);
  assert.match(String(f.calls[0][1]), /overflow-anchor: none/);
  assert.doesNotMatch(JSON.stringify(f.calls.filter(c => ['css', 'settle'].includes(String(c[0])))), /scrollTo|scrollY|scrollX|value|focus|document\.body/);
});
test('unmeasured chrome hides rather than zero-sizing a live native document', () => {
  const f = fixture(), before = f.bounds(), layout = new NativeViewport(); layout.hide(f.view);
  assert.deepEqual(f.calls, [['visible', false]]); assert.deepEqual(f.bounds(), before);
});
test('hiding or a newer owner cancels a pending resize and still removes its temporary stylesheet', async () => {
  for (const hidden of [true, false]) {
    const f = fixture(), pending = deferred(), layout = new NativeViewport(); let current = true;
    f.web.insertCSS = () => pending.promise;
    layout.resize(f.view, { ...f.bounds(), width: 592 }, () => current);
    if (hidden) layout.hide(f.view); else current = false;
    pending.resolve('stale'); await tick();
    assert.equal(f.calls.some(c => c[0] === 'bounds'), false); assert.deepEqual(f.calls.at(-1), ['remove', 'stale']);
  }
});
test('latest viewport wins when prior native CSS work completes out of order', async () => {
  const f = fixture(), first = deferred(), second = deferred(), layout = new NativeViewport(); let count = 0;
  f.web.insertCSS = () => ++count === 1 ? first.promise : second.promise;
  layout.resize(f.view, { ...f.bounds(), width: 592 }, () => true);
  const final = { ...f.bounds(), width: 760 }; layout.resize(f.view, final, () => true);
  second.resolve('new'); await tick(); first.resolve('old'); await tick();
  assert.deepEqual(f.bounds(), final); assert.equal(f.calls.filter(c => c[0] === 'bounds').length, 1);
  assert.ok(f.calls.some(c => c[0] === 'remove' && c[1] === 'old')); assert.ok(f.calls.some(c => c[0] === 'remove' && c[1] === 'new'));
});
test('initial/loading/position-only view changes do not delay geometry or inspect the page', () => {
  for (const kind of ['initial', 'loading', 'position']) {
    const f = fixture(kind === 'initial' ? { x: 0, y: 0, width: 0, height: 0 } : undefined), layout = new NativeViewport();
    f.web.isLoadingMainFrame = () => kind === 'loading';
    const next = { ...f.bounds(), y: 120, width: kind === 'loading' ? 500 : f.bounds().width };
    layout.resize(f.view, next, () => true); assert.deepEqual(f.bounds(), next); assert.equal(f.calls.some(c => c[0] === 'css'), false);
  }
});
test('CSS failure still applies current safe geometry but never a stale one', async () => {
  const f = fixture(), layout = new NativeViewport(); f.web.insertCSS = async () => { throw new Error('navigating'); };
  const next = { ...f.bounds(), width: 592 }; layout.resize(f.view, next, () => true); await tick(); assert.deepEqual(f.bounds(), next);
});
test('map density accepts only the two bounded open sizes, not arbitrary or missing values', () => {
  const command = { ownerId: 'owner', entryId: 'entry', kind: 'density' };
  for (const value of ['compact', 'expanded']) assert.equal(mapCommandSchema.safeParse({ ...command, value }).success, true);
  for (const value of ['tiny', 'horizontal', undefined]) assert.equal(mapCommandSchema.safeParse({ ...command, value }).success, false);
});
