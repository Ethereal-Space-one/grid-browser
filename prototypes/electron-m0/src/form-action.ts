import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { PageIdentity } from './local-bridge';

type Owner = { id: string; name: string };
type Draft = { owner?: Owner; id: string; documentId: string; url: string; value: string; status: 'preview' | 'paused' | 'executing' | 'completed' | 'cancelled' | 'failed'; message: string };
// This experimental executor accepts only the repository's synthetic form route.
export class FormAction {
  private draft?: Draft;
  private receipts: { timestamp: string; id: string; connectionId?: string; status: string; url: string }[] = [];
  exportReceipts() { return [...this.receipts]; }
  private record() {
    if (!this.draft) return;
    this.receipts.push({ timestamp: new Date().toISOString(), id: this.draft.id, connectionId: this.draft.owner?.id, status: this.draft.status, url: this.draft.url });
    if (this.receipts.length > 200) this.receipts.shift();
  }
  status(id: string) {
    const d = this.draft;
    return d?.owner?.id === id ? { id: d.id, status: d.status, message: d.message } : { status: 'none' };
  }
  cancelOwner(id: string) { if (this.draft?.owner?.id === id) this.cancel(); }
  constructor(private current: () => PageIdentity | undefined, private contents: () => WebContents, private changed: () => void, private authorized: (id: string) => boolean = () => false) {}
  state() { return this.draft ? { ...this.draft } : undefined; }
  cancel() {
    if (this.draft && !['completed', 'failed', 'cancelled'].includes(this.draft.status)) {
      this.draft.status = 'cancelled'; this.draft.message = '旧预览已取消或授权已失效，请直接操作原页。'; this.record(); this.changed();
    }
  }
  pause() {
    if (this.draft?.status !== 'preview') throw new Error('只有待确认预览可以暂停');
    this.draft.status = 'paused'; this.draft.message = '已暂停；恢复后仍需单独确认。'; this.record(); this.changed();
  }
  resume() {
    if (this.draft?.status !== 'paused') throw new Error('没有暂停的预览');
    this.draft.status = 'preview'; this.draft.message = '请确认目标页面和填写内容。'; this.record(); this.changed();
  }
  private run(code: string) { return this.contents().executeJavaScriptInIsolatedWorld(999, [{ code }]); }
  async preview(value: unknown, owner?: Owner) {
    if (this.draft && ['preview', 'paused', 'executing'].includes(this.draft.status)) throw new Error('已有待处理预览，请先确认或取消');
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('填写内容需为 1–128 字符');
    const current = this.current();
    if (!current) throw new Error('请先打开本地表单测试页');
    const url = new URL(current.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/actions.html') throw new Error('填写实验仅支持本地 /actions.html 测试页');
    this.cancel();
    const draft: Draft = { owner, id: randomUUID(), documentId: current.documentId, url: current.url, value, status: 'preview', message: '请确认目标页面和填写内容。' };
    this.draft = draft;
    const ok = await this.run(`(() => {
      const el = document.querySelector('input[name="task"]');
      if (!(el instanceof HTMLInputElement) || el.type !== 'text' || el.disabled || el.readOnly || !el.checkVisibility()) return false;
      globalThis.gridFormDraft = { id: ${JSON.stringify(draft.id)}, el, before: el.value };
      return true;
    })()`).catch(error => { this.cancel(); throw error; });
    if (!ok || this.draft !== draft || draft.status !== 'preview' || this.current()?.documentId !== draft.documentId) { this.cancel(); throw new Error('目标字段不可用或页面已变化'); }
    this.record(); this.changed();
    return { id: draft.id, status: draft.status, message: '等待用户在 Grid 确认；未填写' };
  }
  async confirm(id: unknown) {
    const draft = this.draft;
    if (!draft || draft.id !== id || draft.status !== 'preview') throw new Error('预览已失效、暂停或已执行');
    if (draft.owner && !this.authorized(draft.owner.id)) { this.cancel(); throw new Error('客户端授权已失效'); }
    if (this.current()?.documentId !== draft.documentId || this.current()?.url !== draft.url) { this.cancel(); throw new Error('页面已变化，请重新预览'); }
    draft.status = 'executing'; this.record(); this.changed();
    try {
      // Single synchronous mutation: no submit, click, network call or arbitrary script from clients.
      const ok = await this.run(`(() => {
        const d = globalThis.gridFormDraft;
        if (!d || d.id !== ${JSON.stringify(draft.id)}) return false;
        const el = d.el;
        if (!el.isConnected || el !== document.querySelector('input[name="task"]') || el.type !== 'text' || el.disabled || el.readOnly || !el.checkVisibility() || el.value !== d.before) return false;
        delete globalThis.gridFormDraft;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(draft.value)});
        return el.value === ${JSON.stringify(draft.value)};
      })()`);
      if (draft.status !== 'executing' || this.current()?.documentId !== draft.documentId) throw new Error('执行期间已接管或页面变化，需人工核对');
      if (!ok) throw new Error('字段已变化，请重新预览');
      draft.status = 'completed'; draft.message = '已填写；未提交表单。';
    } catch (error) {
      if (draft.status === 'executing') { draft.status = 'failed'; draft.message = error instanceof Error ? error.message : '填写失败'; }
      throw error;
    } finally { this.record(); this.changed(); }
  }
}
