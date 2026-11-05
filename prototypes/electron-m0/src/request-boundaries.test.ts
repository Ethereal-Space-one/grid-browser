import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { assertTrustedUi } from './browser/ui-sender';
import { argument, submitOptionsSchema } from './contracts/browsing';
import { boundedJson, deepSeekProvider, MAX_RESPONSE_BYTES } from './providers/deepseek';
import { checkedUrl } from './intent';

test('UI privilege requires the exact live webContents, main frame and internal URL', () => {
  const url = 'file:///app/renderer/index.html';
  const frame = { url };
  const expected = { isDestroyed: () => false, mainFrame: frame } as unknown as WebContents;
  const event = { sender: expected, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  assert.doesNotThrow(() => assertTrustedUi(event, expected, url));
  for (const bad of [ { ...event, senderFrame: null }, { ...event, senderFrame: { url } }, { ...event, sender: { ...expected } } ]) {
    assert.throws(() => assertTrustedUi(bad as unknown as IpcMainInvokeEvent, expected, url), /无效/);
  }
  frame.url = 'https://example.com/';
  assert.throws(() => assertTrustedUi(event, expected, url), /无效/);
  assert.throws(() => argument(submitOptionsSchema, { scene: 'living', contextual: 'private-marker' }), /参数格式无效/);
  assert.throws(() => argument(submitOptionsSchema, { scene: 'living', execute: true }), /参数格式无效/);
  assert.throws(() => checkedUrl('https://private-marker@'), error => error instanceof Error && error.message === '网址格式无效' && !('input' in error));
});

test('response limits cover actual bytes, malformed JSON and provider schemas', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(boundedJson(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { headers: { 'content-length': '1' } }), signal), /过大/);
  await assert.rejects(boundedJson(new Response('private-marker-not-json'), signal), /格式无效/);
  const invalid = deepSeekProvider(() => 'synthetic', async () => new Response('{"results":"not-an-array"}'));
  await assert.rejects(invalid.search({}, signal), /返回格式无效/);
  const empty = deepSeekProvider(() => 'synthetic', async () => new Response('{"results":[]}'));
  assert.deepEqual(await empty.search({}, signal), []);
});

test('an already cancelled response releases its body without parsing', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(boundedJson(response, controller.signal));
  assert.equal(cancelled, true);
  await assert.rejects(boundedJson(new Response(new Uint8Array([0x22, 0xff, 0x22])), new AbortController().signal), /格式无效/);
});

test('aborting a real loopback HTTP response closes its stream', async context => {
  let began!: () => void;
  let closed!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_req, res) => {
    res.on('close', closed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"results":'); began();
  });
  context.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const provider = deepSeekProvider(() => 'synthetic', (_url, options) => fetch(`http://127.0.0.1:${address.port}/`, options));
  const controller = new AbortController();
  const pending = provider.search({}, controller.signal);
  const rejected = assert.rejects(pending);
  await started; controller.abort();
  await rejected;
  await Promise.race([disconnected, new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('HTTP response was not closed')), 2000); timer.unref(); })]);
});
