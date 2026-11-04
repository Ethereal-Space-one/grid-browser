import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebContents } from 'electron';
import { FormAction } from './form-action';

test('expired external authorization blocks confirmation before field mutation', async () => {
  let calls = 0;
  let authorized = true;
  const contents = { executeJavaScriptInIsolatedWorld: async () => { calls++; return true; } } as unknown as WebContents;
  const action = new FormAction(() => ({ documentId: 'd1', url: 'http://127.0.0.1:8765/actions.html', title: 'test' }), () => contents, () => {}, () => authorized);
  const plan = await action.preview('synthetic', { id: 'client-a', name: 'Self-reported client' });
  assert.deepEqual(action.status('client-b'), { status: 'none' });
  authorized = false;
  await assert.rejects(action.confirm(plan.id), /授权已失效/);
  assert.equal(calls, 1, 'only preview inspection ran; mutation was never requested');
  assert.equal(action.state()?.status, 'cancelled');
  assert.doesNotMatch(JSON.stringify(action.exportReceipts()), /synthetic/);
});

test('failed preview releases pending slot for a fresh proposal', async () => {
  let broken = true;
  const contents = { executeJavaScriptInIsolatedWorld: async () => { if (broken) throw new Error('page gone'); return true; } } as unknown as WebContents;
  const action = new FormAction(() => ({ documentId: 'd1', url: 'http://127.0.0.1:8765/actions.html', title: 'test' }), () => contents, () => {});
  await assert.rejects(action.preview('one'), /page gone/);
  broken = false;
  assert.equal((await action.preview('two')).status, 'preview');
});
