import { checkedUrl } from './intent';

import { searchHitLimits, type SearchHit } from './contracts/browsing';
export type { SearchHit } from './contracts/browsing';

// Match storage's UTF-16 limits without cutting a surrogate pair. Only display
// text can be shortened; a URL prefix is never an acceptable substitute link.
function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(limit - 2)) ? limit - 2 : limit - 1;
  return text.slice(0, end) + '…';
}

function optionalLabel(raw: unknown, limit: number): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text && text.length <= limit ? text : null;
}

export function normalizeSearchResults(raw: unknown): SearchHit[] {
  if (!raw || typeof raw !== 'object') return [];
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const hits: SearchHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const hit = item as Record<string, unknown>;
    if (typeof hit.url !== 'string') continue;
    let url: string;
    try {
      url = checkedUrl(hit.url);
    } catch { continue; }
    // URL serialization (e.g. percent encoding) may expand a permitted raw input.
    if (url.length > searchHitLimits.url) continue;
    const title = (typeof hit.title === 'string' && hit.title.trim()) || url;
    hits.push({
      title: excerpt(title, searchHitLimits.title), url,
      snippet: typeof hit.snippet === 'string' ? excerpt(hit.snippet, searchHitLimits.snippet) : '',
      site: optionalLabel(hit.site_name, searchHitLimits.site) ?? optionalLabel(new URL(url).host, searchHitLimits.site) ?? '',
      date: optionalLabel(hit.date, searchHitLimits.date)
    });
  }
  return hits;
}
