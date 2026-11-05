import { checkedUrl } from './intent';

import type { SearchHit } from './contracts/browsing';
export type { SearchHit } from './contracts/browsing';

export function normalizeSearchResults(raw: unknown): SearchHit[] {
  if (!raw || typeof raw !== 'object') return [];
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const hits: SearchHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const hit = item as Record<string, unknown>;
    if (typeof hit.title !== 'string' || typeof hit.url !== 'string') continue;
    try {
      const url = checkedUrl(hit.url);
      hits.push({
        title: hit.title,
        url,
        snippet: typeof hit.snippet === 'string' ? hit.snippet : '',
        site: typeof hit.site_name === 'string' ? hit.site_name : new URL(url).hostname,
        date: typeof hit.date === 'string' ? hit.date : null
      });
    } catch { /* Invalid or unsupported URL; never present it as an openable result. */ }
  }
  return hits;
}
