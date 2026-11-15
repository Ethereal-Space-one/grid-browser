import { randomUUID } from 'node:crypto';
import type { BrowsingState } from '../contracts/browsing';
import type { JudgmentCitation } from '../contracts/judgment';
import type { QuoteLocatorState, QuoteLocatorStatus } from '../contracts/quote-locator';
import { checkedUrl } from '../intent';

export type QuoteBinding = Readonly<{
  ownerId: string; entryId: string; documentId: string; webContentsId: number;
  frameToken: string; nativeVisitId: string; url: string;
}>;
export type QuoteDomResult = 'prepared' | 'found' | 'ambiguous' | 'missing' | 'unsupported' | 'uncertain';
const messages: Record<QuoteLocatorStatus, string> = {
  ready: '网站原页已打开，这是网站当前内容，不是引用快照。点击后仅尝试一次逐字定位，不会自动定位、读取表单或发送给模型。',
  locating: '正在本机核对当前原页；仅唯一、可测量的逐字文本才请求滚动。',
  found: '已请求滚动到唯一逐字文本所在处。没有改写网页或验证来源真实性；请在原页目视核对。',
  ambiguous: '原页有重复逐字文本，未选择位置，也未滚动。',
  missing: '当前主文档未找到逐字引文，未滚动；原页可能已更新。',
  unsupported: '当前原页或文本布局不在安全支持范围，未请求滚动。可自行在原页核对。',
  uncertain: '页面或操作在定位期间发生变化，滚动可能已经发出。未确认定位结果，不会自动重试。'
};
export function sameQuoteBinding(a: QuoteBinding | undefined, b: QuoteBinding | undefined): boolean {
  return Boolean(a && b && a.ownerId === b.ownerId && a.entryId === b.entryId && a.documentId === b.documentId && a.webContentsId === b.webContentsId
    && a.frameToken === b.frameToken && a.nativeVisitId === b.nativeVisitId && a.url === b.url);
}
/** Resolve only an existing host-owned citation on the current judgment, never a renderer URL/quote. */
export function judgmentCitation(state: BrowsingState, id: string): JudgmentCitation {
  const j = state.mode === 'judgment' && !state.pending && !state.path.currentRemoved && state.judgment;
  const citation = j && j.citations.find(c => c.id === id && (j.status === 'draft' || j.citationIds.includes(id)));
  if (!citation) throw new Error('引用不属于当前判断或未被保存，请重新选择');
  const source = checkedUrl(citation.url);
  if (source !== citation.url || !citation.quote.trim() || citation.quote.length > 1000) throw new Error('这条引用的原页地址或引文不受支持');
  return citation;
}

/** One transient lease. It is not stored in the task tree, page permissions, or exported state. */
export class QuoteLocator {
  private lease?: { state: QuoteLocatorState; quote: string; binding: QuoteBinding; token: string; attempted: boolean };
  constructor(private readonly changed: () => void) {}
  state(): QuoteLocatorState | undefined { return this.lease?.state; }
  clear() { if (this.lease) this.lease.quote = ''; this.lease = undefined; }
  start(citation: JudgmentCitation, binding: QuoteBinding, token: string, supported = true) {
    this.lease = { binding, token, quote: citation.quote, attempted: false, state: Object.freeze({ id: randomUUID(), citationId: citation.id,
      sourceTitle: citation.title, sourceUrl: citation.url, status: supported ? 'ready' : 'unsupported', message: messages[supported ? 'ready' : 'unsupported'] }) };
    this.changed();
  }
  dismiss(id: string) {
    if (!this.lease || this.lease.state.id !== id) throw new Error('定位提示已变化，请重新操作');
    this.clear(); this.changed();
  }
  async locate(id: string, binding: () => QuoteBinding | undefined, prepare: (token: string, quote: string) => Promise<QuoteDomResult>, apply: (token: string) => Promise<QuoteDomResult>) {
    const lease = this.lease;
    if (!lease || lease.state.id !== id || lease.state.status !== 'ready' || lease.attempted || !sameQuoteBinding(lease.binding, binding())) throw new Error('原页或定位提示已变化，请重新打开引用');
    lease.attempted = true;
    const set = (status: QuoteLocatorStatus) => { if (this.lease === lease) { lease.state = Object.freeze({ ...lease.state, status, message: messages[status] }); this.changed(); } };
    set('locating');
    let dispatched = false;
    try {
      const result = await prepare(lease.token, lease.quote);
      if (this.lease !== lease) return;
      if (!sameQuoteBinding(lease.binding, binding())) { set('unsupported'); return; }
      if (result !== 'prepared') { set(result === 'found' ? 'unsupported' : result); return; }
      // The host rechecks immediately before dispatch. Renderer execution cannot be
      // atomically coupled to tab switches: after dispatch, any mismatch is uncertain.
      dispatched = true;
      const applied = await apply(lease.token);
      if (this.lease !== lease) return;
      if (!sameQuoteBinding(lease.binding, binding())) { set('uncertain'); return; }
      set(applied === 'prepared' ? 'uncertain' : applied);
    } catch { set(dispatched ? 'uncertain' : 'unsupported'); }
    finally { lease.quote = ''; }
  }
}
