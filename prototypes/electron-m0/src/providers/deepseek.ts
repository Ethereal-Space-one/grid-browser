import { extractionPayloadSchema, fetchPayloadSchema, searchHitSchema, searchPayloadSchema } from '../contracts/browsing';
import type { BrowsingProvider } from '../application/browsing-session';
import { extractionBody } from '../scenes';
import { normalizeSearchResults } from '../search';
import { comparisonBody, comparisonCompletion } from './comparison';
import { groundedCompletion, understandingBody } from './understanding';

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) { void response.body?.cancel().catch(() => {}); throw new Error('服务响应过大；请缩小查询或打开原页'); }
  if (!response.body) throw new Error('服务没有返回可用内容');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let bytes = 0;
  // Fixed storage also bounds memory for servers sending millions of tiny chunks.
  const buffer = new Uint8Array(MAX_RESPONSE_BYTES);
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (value.byteLength > MAX_RESPONSE_BYTES - bytes) { void reader.cancel().catch(() => {}); throw new Error('服务响应过大；请缩小查询或打开原页'); }
      buffer.set(value, bytes); bytes += value.byteLength;
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))); }
    catch { throw new Error('服务返回格式无效；可重试或打开原页'); }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

export function deepSeekProvider(key: () => string, transport: typeof fetch = (...args) => fetch(...args)): BrowsingProvider {
  async function request(endpoint: 'search' | 'fetch' | 'extract', body: object, cancelled: AbortSignal): Promise<unknown> {
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(endpoint === 'extract' ? 20000 : 15000)]);
    try {
      signal.throwIfAborted();
      const url = endpoint === 'extract' ? 'https://api.deepseek.com/chat/completions' : `https://api.deepseek.com/v1/tools/${endpoint}`;
      const response = await transport(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(`DeepSeek 返回 HTTP ${response.status}；可保留现有内容或打开原页`); }
      return await boundedJson(response, signal);
    } catch (error) {
      if (cancelled.aborted) throw error;
      if (signal.aborted) throw new Error('服务响应超时；可重试或打开原页');
      throw error;
    }
  }
  return {
    async search(body, signal) {
      const parsed = searchPayloadSchema.safeParse(await request('search', body, signal));
      if (!parsed.success) throw new Error('搜索服务返回格式无效；已有结果仍可使用');
      const results = normalizeSearchResults(parsed.data);
      if (results.some(hit => !searchHitSchema.safeParse(hit).success)) throw new Error('搜索结果超出支持范围；请缩小查询');
      return results;
    },
    async read(url, signal) {
      const parsed = fetchPayloadSchema.safeParse(await request('fetch', { url }, signal));
      if (!parsed.success || !parsed.data.content.trim()) throw new Error('未能取得可用正文；请打开原页');
      return { title: parsed.data.title || url, content: parsed.data.content };
    },
    async compare(input, signal) {
      return comparisonCompletion(await request('extract', comparisonBody(input), signal), input);
    },
    async model(input, signal) {
      return groundedCompletion(await request('extract', understandingBody(input), signal), input);
    },
    async extract(reading, scene, signal) {
      const parsed = extractionPayloadSchema.safeParse(await request('extract', extractionBody(scene, reading.content, reading.context?.query || ''), signal));
      if (!parsed.success || !parsed.data.choices[0].message.content.trim()) throw new Error('没有生成可用重点；请继续阅读原文');
      return { text: Array.from(parsed.data.choices[0].message.content).slice(0, 8000).join(''), truncated: Array.from(reading.content).length > 16000 };
    }
  };
}
