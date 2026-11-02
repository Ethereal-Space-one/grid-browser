import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearchResults } from './search';

test('provider order and visible snippets are preserved without model summaries', () => {
  const hits = normalizeSearchResults({ results: [
    { title: 'First', url: 'https://a.example/', snippet: 'Source snippet A', summary: 'Model-oriented summary A' },
    { title: 'Second', url: 'https://b.example/', snippet: 'Source snippet B' }
  ] });
  assert.deepEqual(hits.map(hit => hit.title), ['First', 'Second']);
  assert.equal(hits[0].snippet, 'Source snippet A');
});

test('unsupported URLs are never offered as openable results', () => {
  const hits = normalizeSearchResults({ results: [
    { title: 'Unsafe', url: 'javascript:alert(1)' },
    { title: 'Valid', url: 'https://example.org/', snippet: 'Okay' }
  ] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, 'https://example.org/');
});
