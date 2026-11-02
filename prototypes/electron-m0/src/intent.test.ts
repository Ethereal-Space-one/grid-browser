import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyInput } from './intent';

test('addresses never become search queries', () => {
  assert.deepEqual(classifyInput('developer.mozilla.org'), { kind: 'url', url: 'https://developer.mozilla.org/' });
  assert.deepEqual(classifyInput('localhost:8765/media.html'), { kind: 'url', url: 'http://localhost:8765/media.html' });
  assert.deepEqual(classifyInput('什么是 WebMCP'), { kind: 'query', query: '什么是 WebMCP' });
});

test('remote insecure and credential URLs are rejected', () => {
  assert.throws(() => classifyInput('http://example.com'));
  assert.throws(() => classifyInput('https://name:secret@example.com'));
  assert.throws(() => classifyInput('file:///private/example.txt'));
});
