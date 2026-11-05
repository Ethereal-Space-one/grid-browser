import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeVisits } from './browser/native-visits';

test('a same-URL replacement at the same index never inherits the old visit identity', () => {
  const visits = new NativeVisits();
  visits.record({ index: 0, url: 'https://example.com/a', length: 1 }, 'a', 'GET');
  const b = visits.record({ index: 1, url: 'https://example.com/b', length: 2 }, 'b', 'GET');
  const c = visits.record({ index: 2, url: 'https://example.com/same', length: 3 }, 'c', 'GET');
  const back = { index: 1, url: b.url, length: 3 };
  assert.ok(visits.activate(b, back));
  const dPosition = { index: 2, url: c.url, length: 3 };
  const d = visits.record(dPosition, 'd', 'GET');
  assert.notEqual(c.id, d.id);
  assert.equal(visits.resolve(c.id, dPosition), undefined);
  assert.equal(visits.resolve(d.id, dPosition), d);
  assert.equal(visits.at(2, c.url)?.nodeId, 'd');
});

test('external history shape changes invalidate bindings instead of guessing from a URL', () => {
  const visits = new NativeVisits();
  const a = visits.record({ index: 0, url: 'https://example.com/same', length: 1 }, 'a', 'GET');
  const b = visits.record({ index: 1, url: a.url, length: 2 }, 'b', 'OTHER');
  assert.equal(visits.resolve(b.id, { index: 0, url: a.url, length: 1 }), undefined);
  assert.equal(visits.at(0, a.url), undefined);
  assert.equal(visits.activate(a, { index: 0, url: a.url, length: 2 }), false);
});

test('reload replaces only its visit; native ledger is bounded and never stores form state', () => {
  const visits = new NativeVisits(2);
  const a = visits.record({ index: 0, url: 'https://example.com/a', length: 1 }, 'a', 'GET');
  const b = visits.record({ index: 1, url: 'https://example.com/b', length: 2 }, 'b', 'OTHER');
  visits.activate(a, { index: 0, url: a.url, length: 2 });
  const refreshed = visits.record({ index: 0, url: a.url, length: 2 }, 'a', 'GET', true);
  assert.equal(visits.resolve(a.id, { index: 0, url: a.url, length: 2 }), undefined);
  assert.equal(visits.at(1, b.url), b, 'reload does not erase a valid forward entry');
  const c = visits.record({ index: 2, url: 'https://example.com/c', length: 3 }, 'c', 'GET');
  assert.equal(visits.resolve(b.id, { index: 2, url: c.url, length: 3 }), undefined);
  assert.deepEqual(Object.keys(refreshed).sort(), ['id', 'index', 'method', 'nodeId', 'url']);
});

test('child-frame joint history rebinding preserves the main document and invalidates cut forward slots', () => {
  const visits = new NativeVisits();
  const a = visits.record({ index: 0, url: 'https://example.com/a', length: 1 }, 'a', 'GET');
  const b = visits.record({ index: 1, url: 'https://example.com/b', length: 2 }, 'b', 'GET');
  visits.activate(a, { index: 0, url: a.url, length: 2 });
  const position = { index: 1, url: a.url, length: 2 };
  const framed = visits.followFrame(a.id, position)!;
  assert.equal(framed.nodeId, 'a'); assert.equal(framed.method, 'GET');
  assert.equal(visits.resolve(b.id, position), undefined);
  assert.equal(visits.followFrame(a.id, { ...position, index: 2 }), undefined, 'only the latest main visit can be rebound');
  assert.equal(visits.followFrame(framed.id, { ...position, url: b.url }), undefined, 'a frame event cannot replace the main URL');
});
