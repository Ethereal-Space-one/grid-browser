import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearchResults } from './search';
import { deepSeekProvider } from './providers/deepseek';
import { BrowsingSession } from './application/browsing-session';
import { classifyInput } from './intent';

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

function searchReply(results: unknown[]) {
  return deepSeekProvider(() => 'local-fixture', async () => new Response(JSON.stringify({ results })))
    .search({ query: 'migration' }, new AbortController().signal);
}

test('one outlier does not bury later sources, translated pages, or versions', async () => {
  const base = 'https://docs.example.invalid';
  const urls = [
    '/blog/migrate-to-example-view', '/zh/blog/migrate-to-example-view',
    '/docs/v30/api/example-view', '/docs/latest/api/example-view',
    ...Array.from({ length: 5 }, (_, i) => `/docs/latest/tutorial/source-${i + 1}`)
  ].map(path => base + path);
  const raw = urls.map((url, i) => ({ url, title: `Document ${i + 1}`, snippet: 'Source snippet' }));
  // The truncation point would fall between the two UTF-16 units of this emoji.
  raw[1].title = 'a'.repeat(2046) + '😀' + 'tail';
  raw[1].snippet = 'b'.repeat(15998) + '🌿' + 'tail';
  const hits = await searchReply([raw[0], { title: 'Unavailable', url: 'not a URL' }, ...raw.slice(1)]);
  assert.deepEqual(hits.map(hit => hit.url), urls);
  assert.equal(hits[1].title, 'a'.repeat(2046) + '…');
  assert.equal(hits[1].snippet, 'b'.repeat(15998) + '…');
  assert.equal(hits[8].title, 'Document 9');
});

test('missing titles still produce identifiable source links; invalid optional fields are not displayed as facts', async () => {
  const first = 'https://source.invalid/version-one?lang=en#intro';
  const second = 'https://source.invalid/version-two?lang=en#intro';
  const hits = await searchReply([
    { url: first, site_name: 's'.repeat(2049), date: 'x'.repeat(257) },
    { url: second, title: '  ', snippet: null, site_name: '  ', date: '  ' }
  ]);
  assert.deepEqual(hits.map(hit => hit.title), [first, second]);
  assert.deepEqual(hits.map(hit => hit.site), ['source.invalid', 'source.invalid']);
  assert.deepEqual(hits.map(hit => hit.date), [null, null]);
  assert.deepEqual(hits.map(hit => hit.snippet), ['', '']);
});

test('a genuine zero-hit response is distinct from a nonempty response with no openable URL', async () => {
  assert.deepEqual(await searchReply([]), []);
  await assert.rejects(searchReply([null, { url: 'not a URL' }]), /没有可打开的网页地址/);
});

test('URLs are never truncated into different destinations after canonicalization', async () => {
  const expanded = 'https://source.invalid/' + '花'.repeat(1000);
  const kept = 'https://source.invalid/short';
  assert.ok(expanded.length < 8192 && new URL(expanded).href.length > 8192);
  assert.deepEqual((await searchReply([{ url: expanded, title: 'Long URL' }, { url: kept, title: 'Okay' }])).map(hit => hit.url), [kept]);
});

test('a failed filtered search keeps previous sources and retries the exact query only on request', async () => {
  const earlierUrl = 'https://example.invalid/earlier', requestedUrl = 'https://example.invalid/requested';
  const replies = [[{ url: earlierUrl }], [{ title: 'Missing address' }], [{ url: requestedUrl }]];
  const queries: string[] = [];
  const provider = deepSeekProvider(() => 'local-fixture', async (_url, options) => {
    queries.push(JSON.parse(String(options?.body)).query);
    return new Response(JSON.stringify({ results: replies.shift() }));
  });
  const session = new BrowsingSession(provider, () => {});
  const earlier = await session.search('先前查询', 'professional', false);
  const intent = classifyInput('site:example.invalid 迁移');
  assert.ok(intent.kind === 'query');
  await assert.rejects(session.search(intent.query, 'learning', false), /没有可打开的网页地址/);
  const failed = session.snapshot();
  const step = failed.path.nodes.find(node => node.id === failed.entryId);
  assert.equal(step?.status, 'failed');
  assert.equal(step?.context?.query, intent.query);
  assert.equal(failed.search?.id, earlier?.id);
  assert.deepEqual(failed.search?.results.map(hit => hit.url), [earlierUrl]);
  assert.deepEqual(queries, ['先前查询', intent.query]);
  const retried = await session.search(intent.query, 'learning', false);
  assert.deepEqual(retried?.results.map(hit => hit.url), [requestedUrl]);
  session.back();
  assert.equal(session.snapshot().entryId, failed.entryId);
  assert.equal(session.snapshot().search?.query, '先前查询');
  assert.deepEqual(queries, ['先前查询', intent.query, intent.query]);
});
