import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LocalBridge, BridgeClient, type PageIdentity, type PageSnapshot } from './local-bridge';
import { semanticSnapshot } from './semantic-snapshot';

test('MCP read requires current-document grant; navigation and revocation remove access', async context => {
  let current: PageIdentity = { documentId: 'document-1', url: 'https://example.org/', title: 'Example' };
  const bridge = new LocalBridge(() => current, async page => ({ ...page, text: 'public page', truncated: false, trust: 'untrusted' }), () => {});
  const client = new BridgeClient();
  context.after(() => { client.close(); bridge.close(); });
  await bridge.start();
  await client.connect(bridge.connectionFile, 'test client');
  await assert.rejects(client.call('snapshot'), /not authorized/);
  const id = bridge.state().connections[0].id;
  bridge.grant(id);
  assert.equal((await client.call('snapshot') as PageSnapshot).text, 'public page');
  await assert.rejects(client.call('arbitrary.script'), /Unsupported/);
  current = { ...current, documentId: 'document-2' };
  await assert.rejects(client.call('snapshot'), /not authorized/);
  bridge.grant(id);
  bridge.revoke(id);
  await assert.rejects(client.call('snapshot'), /not authorized/);
  const receipts = JSON.parse(bridge.exportReceipts()).receipts;
  assert.ok(receipts.some((r: { status: string }) => r.status === 'succeeded'));
  assert.ok(!bridge.exportReceipts().includes('public page'));
  assert.equal(readFileSync(bridge.connectionFile, 'utf8').includes('DEEPSEEK'), false);
});

test('revoking while CDP read is in flight prevents delivery', async context => {
  const current = { documentId: 'one', url: 'https://example.org/', title: 'Example' };
  let complete!: (result: PageSnapshot) => void;
  let started!: () => void;
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const bridge = new LocalBridge(() => current, () => { started(); return new Promise(resolve => { complete = resolve; }); }, () => {});
  const client = new BridgeClient();
  context.after(() => { client.close(); bridge.close(); });
  await bridge.start(); await client.connect(bridge.connectionFile, 'test');
  bridge.grant(bridge.state().connections[0].id);
  const result = client.call('snapshot');
  await didStart;
  bridge.revoke();
  complete({ ...current, text: 'must not be returned', truncated: false, trust: 'untrusted' });
  await assert.rejects(result, /Authorization changed/);
});

test('local connection rejects a wrong capability token', async context => {
  const bridge = new LocalBridge(() => undefined, async () => { throw new Error('unreachable'); }, () => {});
  const client = new BridgeClient();
  context.after(() => { client.close(); bridge.close(); });
  await bridge.start();
  const descriptor = JSON.parse(readFileSync(bridge.connectionFile, 'utf8'));
  descriptor.token = '0'.repeat(64);
  const wrongFile = path.join(bridge.directory, 'wrong.json');
  writeFileSync(wrongFile, JSON.stringify(descriptor));
  await assert.rejects(client.connect(wrongFile, 'test'), /authentication/);
  assert.equal(bridge.state().connections.length, 0);
});

test('semantic output omits editable subtrees and values, and stays bounded', () => {
  const result = semanticSnapshot([
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Page' } },
    { nodeId: '2', parentId: '1', role: { value: 'StaticText' }, name: { value: 'Orange kite' } },
    { nodeId: '3', parentId: '1', role: { value: 'textbox' }, name: { value: 'private field' } },
    { nodeId: '4', parentId: '3', role: { value: 'StaticText' }, name: { value: 'secret-input-value' } },
    { nodeId: '5', parentId: '1', role: { value: 'generic' }, properties: [{ name: 'editable', value: { value: 'richtext' } }] },
    { nodeId: '6', parentId: '5', role: { value: 'StaticText' }, name: { value: 'secret-richtext' } }
  ]);
  assert.match(result.text, /Orange kite/);
  assert.doesNotMatch(result.text, /secret|private field/);
  const large = semanticSnapshot([{ nodeId: '1', name: { value: 'a'.repeat(17000) } }]);
  assert.equal(large.truncated, true);
  assert.ok(large.text.length <= 16000);
});
