import type { StoredTask } from '../contracts/task-storage';
import { judgmentEditSchema, judgmentSaveSchema, judgmentScope, type Judgment, type JudgmentCitation, type JudgmentEdit, type JudgmentSave } from '../contracts/judgment';
import { argument } from '../contracts/browsing';
import type { ComparisonAnalysis, ComparisonRecord, ComparisonRequest, ComparisonSelector, ComparisonSource } from '../contracts/comparison';
import { comparisonScope } from '../contracts/comparison';
import { checkedUrl } from '../intent';
import type { BrowsingState, Extraction, NavigationStep, Pending, Presentation, QueryContext, ReadingDocument, Scene, SearchHit, SearchResponse } from '../contracts/browsing';
import { questionSource, summarySources, type GroundedText, type ModelRequest, type PageQuestion } from '../contracts/understanding';
import { sceneSearch } from '../scenes';
import { randomUUID } from 'node:crypto';
import { NavigationStore, type NavigationContent } from './navigation-store';

export interface BrowsingProvider {
  compare?(request: ComparisonRequest, signal: AbortSignal): Promise<ComparisonAnalysis>;
  model?(request: ModelRequest, signal: AbortSignal): Promise<GroundedText>;
  search(body: object, signal: AbortSignal): Promise<SearchHit[]>;
  read(url: string, signal: AbortSignal): Promise<{ title: string; content: string }>;
  extract(reading: ReadingDocument, scene: Scene, signal: AbortSignal): Promise<{ text: string; truncated: boolean }>;
}

/** One tab's task tree. Electron owns native pages and document identity. Nothing is persisted here. */
export class BrowsingSession {
  private navigation: NavigationStore;
  private current: BrowsingState;
  private active?: { id: string; nodeId: string; kind: Pending['kind']; controller: AbortController };
  private sequence = 0;
  private disposed = false;
  constructor(private provider: BrowsingProvider, private changed: () => void, limits?: { nodeLimit?: number; textBudget?: number }, restored?: StoredTask) {
    this.navigation = new NavigationStore(limits, restored);
    const entry = this.navigation.current();
    this.current = Object.freeze({ ownerId: randomUUID(), revision: 0, comparisonSelection: Object.freeze([]), ...entry.content,
      entryId: entry.id, presentation: entry.presentation, path: this.navigation.snapshot(), canGoBack: false, canGoForward: false });
  }
  removeNode(id: string) { this.navigation.remove(id); this.update({}, 'none'); }
  undoRemoval() { this.navigation.undoRemoval(); this.update({}, 'none'); }
  navigationTarget(direction: -1 | 1) { return this.navigation.navigationTarget(direction); }
  explorationTitle() { return this.navigation.explorationTitle(); }
  pageAncestor() { return this.navigation.pageAncestor(); }
  pageTitle(title: string) { if (this.current.mode === 'page') this.update({}, 'replace', { label: title.slice(0, 256) }); }
  exportTask(): StoredTask { return this.navigation.exportTask(); }
  snapshot(): BrowsingState { return this.current; }
  private content(next: BrowsingState): NavigationContent {
    return { mode: next.mode, value: next.value, scene: next.scene, search: next.search, searchContext: next.searchContext,
      reading: next.reading, extraction: next.extraction, summary: next.summary, question: next.question, comparison: next.comparison, judgment: next.judgment, issue: next.issue, nativeIndex: next.mode === 'page' ? next.nativeIndex : undefined,
      nativeVisitId: next.mode === 'page' ? next.nativeVisitId : undefined };
  }
  private update(patch: Partial<BrowsingState>, navigation: 'push' | 'replace' | 'none' = 'replace', step?: Partial<NavigationStep>, presentation?: Presentation, preserveMissing = true) {
    const next = { ...this.current, ...patch };
    if (navigation === 'push') this.navigation.visit(this.content(next), step as NavigationStep | undefined, presentation);
    if (navigation === 'replace') this.navigation.replace(this.content(next), step, preserveMissing);
    const entry = this.navigation.current();
    this.current = Object.freeze({ ...next, ...entry.content, revision: this.current.revision + 1,
      pending: next.pending && Object.freeze({ ...next.pending, nodeId: entry.id }),
      entryId: entry.id, presentation: entry.presentation, path: this.navigation.snapshot(),
      canGoBack: this.navigation.canBack(), canGoForward: this.navigation.canForward() });
    this.changed();
  }
  private invalidate() {
    const old = this.active;
    this.active = undefined;
    if (old) {
      if (!['extraction', 'summary'].includes(old.kind)) this.navigation.mark(old.nodeId, 'cancelled');
      old.controller.abort();
    }
  }
  private transition(patch: Partial<BrowsingState>, push = false, step?: NavigationStep) {
    this.invalidate(); this.update({ pending: undefined, issue: undefined, ...patch }, push ? 'push' : 'replace', step);
  }
  cancel() {
    const pending = this.current.pending;
    this.transition(pending?.kind === 'summary' ? { issue: { id: pending.id, kind: 'summary', message: '短总结已停止；当前内容仍可使用。' } } : {});
  }
  home() {
    this.transition({ mode: 'home', value: '', nativeIndex: undefined, reading: undefined, extraction: undefined },
      this.navigation.current().step.kind !== 'home', { kind: 'home', status: 'ready', label: '首页' });
  }
  results() {
    const context = this.current.searchContext;
    if (!context) { this.cancel(); return; }
    const entry = this.navigation.results(context.id);
    if (entry) this.jump(entry);
    else this.transition({ mode: 'results', value: context.query, nativeIndex: undefined, reading: undefined, extraction: undefined }, true,
      { kind: 'search', status: 'ready', label: context.query.slice(0, 256), runId: context.id });
  }
  open(url: string) { const hit = this.current.search?.results.find(hit => hit.url === url); this.transition({ mode: 'page', value: url, nativeIndex: undefined, nativeVisitId: undefined }, true,
    { kind: 'page', status: 'ready', label: (hit?.title || url).slice(0, 256), excerpt: hit?.snippet.slice(0, 400), target: url, context: this.current.searchContext }); }
  navigated(url: string, nativeIndex: number | undefined, replace = false, nativeVisitId?: string) {
    if (this.current.mode !== 'page') return;
    if (replace) this.update({ value: url, nativeIndex, nativeVisitId });
    else this.transition({ value: url, nativeIndex, nativeVisitId }, true,
      { kind: 'page', status: 'ready', label: url.slice(0, 256), target: url, context: this.current.searchContext });
  }
  private restore() { this.update({ pending: undefined }, 'none'); }
  jump(id: string): boolean {
    if (this.disposed || !this.navigation.get(id)) return false;
    if (id === this.current.entryId) return true;
    this.invalidate(); this.navigation.jump(id); this.restore(); return true;
  }
  back() { this.invalidate(); if (this.navigation.move(-1)) this.restore(); else this.cancel(); }
  forward() { this.invalidate(); if (this.navigation.move(1)) this.restore(); else this.cancel(); }
  savePresentation(entryId: string, presentation: Presentation): boolean {
    if(this.disposed || entryId !== this.current.entryId) return false;
    if(JSON.stringify(this.current.presentation)===JSON.stringify(presentation))return true;
    if (!this.navigation.save(entryId, presentation)) return false;
    this.current = Object.freeze({ ...this.current, presentation: this.navigation.current().presentation }); return true;
  }
  setScene(scene: Scene) {
    if (scene === this.current.scene) return;
    this.transition({ scene });
  }
  dispose() { this.disposed = true; this.cancel(); }

  private async run<T>(kind: Pending['kind'], target: string, task: (signal: AbortSignal, id: string, publish: (patch: Partial<BrowsingState>) => void) => Promise<T>, commit: (result: T) => Partial<BrowsingState>, start: Partial<BrowsingState> = {}, request?: Omit<QueryContext, 'id'>, finishedStep?: (result: T) => Partial<NavigationStep>): Promise<T | undefined> {
    if (this.disposed) throw new Error('窗口已关闭，请重新打开');
    this.invalidate();
    const lease = { id: `${this.current.ownerId}-${++this.sequence}`, nodeId: '', kind, controller: new AbortController() };
    const context = request ? Object.freeze({ id: lease.id, query: request.query, scene: request.scene, actualQuery: request.actualQuery, contextual: request.contextual }) : this.current.searchContext;
    const auxiliary = kind === 'extraction' || kind === 'summary';
    const step = auxiliary ? undefined : { kind, status: 'pending' as const, label: target.slice(0, 256), runId: lease.id,
      target: kind === 'question' ? start.question?.url : target, context: start.comparison?.context ?? context,
      comparisonScope: start.comparison && comparisonScope(start.comparison) };
    // Keep the last usable view while a new step is pending, but give that step its own identity.
    const presentation = { ...this.current.presentation, addressDraft: null, contextual: request?.contextual ?? this.current.presentation.contextual, ...(kind === 'question' ? { questionDraft: '', scrollTop: 0 } : {}) };
    if (!auxiliary) this.navigation.visit(this.content({ ...this.current, ...start, issue: undefined }), step, presentation);
    lease.nodeId = this.navigation.current().id;
    this.active = lease;
    this.update({ ...start, pending: { id: lease.id, nodeId: lease.nodeId, kind }, issue: undefined }, auxiliary ? 'replace' : 'none');
    const signal = lease.controller.signal;
    const ownsNode = () => this.active === lease && this.current.entryId === lease.nodeId && !signal.aborted && !this.disposed;
    if (!ownsNode()) return undefined;
    let abort!: () => void;
    try {
      // Settle even when an adapter ignores abort; returning to the same node does not revive its lease.
      const cancelled = new Promise<undefined>(resolve => { abort = () => resolve(undefined); signal.addEventListener('abort', abort, { once: true }); });
      const result = await Promise.race([task(signal, lease.id, patch => {
        if (ownsNode()) this.update(patch, 'replace', patch.comparison ? { comparisonScope: comparisonScope(patch.comparison) } : undefined);
      }), cancelled]);
      if (!ownsNode() || result === undefined) return undefined;
      this.active = undefined;
      if (!auxiliary) this.navigation.save(lease.nodeId, { ...this.navigation.current().presentation, scrollTop: 0 });
      this.update({ ...commit(result), pending: undefined }, 'replace', auxiliary ? undefined
        : { status: 'ready', label: (kind === 'reading' ? (result as ReadingDocument).title || target : target).slice(0, 256), ...finishedStep?.(result) }, undefined, false);
      return result;
    } catch (error) {
      if (!ownsNode()) return undefined;
      this.active = undefined;
      const message = error instanceof Error ? error.message : '请求失败，请保留现有内容或打开原页';
      this.update({ pending: undefined, issue: { id: lease.id, kind, message } }, 'replace', auxiliary ? undefined : { status: 'failed' });
      throw new Error(message);
    } finally { signal.removeEventListener('abort', abort); }
  }

  async search(query: string, scene: Scene, contextual: boolean): Promise<SearchResponse | undefined> {
    const request = sceneSearch(query, scene, contextual);
    return this.run('search', query, async (signal, id) => {
      const results = await this.provider.search(request.body, signal);
      return Object.freeze({ id, query, scene, contextual, actualQuery: request.actualQuery, results: Object.freeze(results.map(hit => Object.freeze({ ...hit }))) });
    }, result => ({ mode: 'results', value: query, search: result, reading: undefined, extraction: undefined, summary: undefined, question: undefined, comparison: undefined, judgment: undefined, nativeIndex: undefined }), { scene }, request);
  }
  async read(url: string): Promise<ReadingDocument | undefined> {
    const context: QueryContext | undefined = this.current.searchContext;
    return this.run('reading', url, async (signal, id) => {
      const result = await this.provider.read(url, signal);
      return Object.freeze({ ...result, id, url, fetchedAt: new Date().toISOString(), context });
    }, reading => ({ mode: 'reading', value: url, reading, extraction: undefined, question: undefined, comparison: undefined, judgment: undefined, nativeIndex: undefined }), {}, undefined, reading => ({ readingScope: { id: reading.id, title: reading.title, url: reading.url, fetchedAt: reading.fetchedAt } }));
  }
  async summarize(searchId: string) {
    const search = this.current.search;
    if (this.current.mode !== 'results' || !search || search.id !== searchId) throw new Error('结果已变化或已释放，请重新选择');
    if (this.current.summary?.searchId === search.id) return;
    const sources = summarySources(search);
    if (!sources.length) throw new Error('这些结果没有可用摘要；请直接打开来源');
    if (!this.provider.model) throw new Error('当前服务不支持总结；结果仍可使用');
    await this.run('summary', search.query, async (signal, id) => Object.freeze({
      ...await this.provider.model!({ kind: 'summary', scene: search.scene, question: search.query, sources }, signal), id, searchId, generatedAt: new Date().toISOString()
    }), summary => ({ summary }));
  }
  async summarizePage() {
    const state = this.current;
    if (state.mode !== 'page' || !state.value.startsWith('https://')) throw new Error('总结暂支持公开 HTTPS 正文；原页仍可浏览');
    const searchId = `page:${state.entryId}`;
    if (state.summary?.searchId === searchId) return;
    if (!this.provider.model) throw new Error('当前服务不支持总结');
    await this.run('summary', state.value, async (signal, id) => {
      const reading = await this.provider.read(state.value, signal); signal.throwIfAborted();
      const source = questionSource({ ...reading, id, url: state.value, fetchedAt: new Date().toISOString() });
      const answer = await this.provider.model!({ kind: 'summary', scene: state.scene, question: '概括这页的核心内容、适用范围和需要注意的限制，最多三句。',
        sources: [{ id: 1, title: source.title, url: source.url, text: source.text }] }, signal);
      const {readingId,title,url,fetchedAt,truncated}=source;
      return Object.freeze({ ...answer, id, searchId, generatedAt: new Date().toISOString(),pageSource:Object.freeze({readingId,title,url,fetchedAt,truncated}) });
    }, summary => ({ summary }));
  }
  beginQuestion() {
    const state = this.current;
    if (state.mode !== 'reading' && state.mode !== 'page') throw new Error('请先选择要提问的正文或原页');
    if (state.mode === 'reading' && (!state.reading || state.reading.released)) throw new Error('这版正文已释放；请重新选择正文');
    const url = state.mode === 'reading' ? state.reading!.url : state.value;
    if (!url.startsWith('https://')) throw new Error('问这页暂仅支持公开 HTTPS 正文；可继续浏览原页');
    const question: PageQuestion = Object.freeze({ id: randomUUID(), originEntryId: state.entryId, originKind: state.mode,
      url, title: state.reading?.url === url && state.mode === 'reading' ? state.reading.title : url,
      scene: state.scene, question: '', source: state.mode === 'reading' ? questionSource(state.reading!) : undefined });
    this.transition({ mode: 'question', value: url, question }, true,
      { kind: 'question', status: 'ready', label: '问这页', target: url, context: state.searchContext });
  }
  async ask(text: string, questionId: string) {
    const draft = this.current.question;
    const question = text.trim();
    if (this.current.mode !== 'question' || !draft || draft.id !== questionId) throw new Error('提问页面已变化，请重新选择');
    if (!question || question.length > 2000) throw new Error('问题需在 1–2000 字符之间');
    if (!this.provider.model) throw new Error('当前服务不支持问答；可继续阅读原文');
    const scene = this.current.scene;
    await this.run('question', question, async (signal, id) => {
      let source = draft.source;
      if (!source || source.released) {
        const reading = await this.provider.read(draft.url, signal);
        signal.throwIfAborted();
        source = questionSource({ ...reading, id: randomUUID(), url: draft.url, fetchedAt: new Date().toISOString() });
      }
      const sources = Object.freeze([Object.freeze({ id: 1, title: source.title, url: source.url, text: source.text })]);
      const answer = await this.provider.model!({ kind: 'question', scene, question, sources }, signal);
      return Object.freeze({ ...draft, id, title: source.title, scene, question, source, answer, answeredAt: new Date().toISOString() });
    }, question => ({ question }), { mode: 'question', question: Object.freeze({ ...draft, id: randomUUID(), scene, question, answer: undefined, answeredAt: undefined }) });
  }

  beginJudgment() {
    const state = this.current;
    if (this.disposed || state.pending) throw new Error('请等待当前请求完成或先停止');
    const original = state.mode === 'judgment' ? state.judgment : undefined;
    if (state.mode === 'judgment' && original?.status !== 'saved') throw new Error('请在现有草稿中编辑；已释放的文字无法自动重建');
    const q = state.mode === 'question' && state.question?.answer && state.question.source ? state.question : undefined;
    const c = state.mode === 'comparison' && state.comparison?.analysis ? state.comparison : undefined;
    if (!original && !q && !c) throw new Error('请先完成这页问答或来源对照');
    const citations: JudgmentCitation[] = [];
    const add = (source: NonNullable<PageQuestion['source']>, quote: string) => {
      if (citations.length >= 24 || !quote.trim() || quote.length > 1000 || (!source.released && !source.text.includes(quote))) return;
      if (citations.some(item => item.readingId === source.readingId && item.quote === quote)) return;
      citations.push(Object.freeze({ id: randomUUID(), title: source.title, url: source.url,
        readingId: source.readingId, fetchedAt: source.fetchedAt, truncated: source.truncated, quote }));
    };
    if (q) for (const citation of q.answer!.citations) if (citation.source === 1) add(q.source!, citation.quote);
    if (c) for (const row of c.analysis!.rows) for (const [index, side] of [row.left, row.right].entries()) {
      const source = c.sources[index]?.source; if (source) for (const quote of side.quotes) add(source, quote);
    }
    if (!this.navigation.canRecord()) throw new Error('本次路径已达记录上限，无法新建判断草稿；旧分支仍保留');
    const id = randomUUID();
    const judgment: Judgment = Object.freeze({ id, draftId: id, lineageId: original?.lineageId ?? randomUUID(),
      revision: 0, status: 'draft', version: original?.version ?? 0, basedOnId: original?.id,
      originEntryId: original?.originEntryId ?? state.entryId, originKind: original?.originKind ?? (q ? 'question' : 'comparison'),
      originRecordId: original?.originRecordId ?? (q?.id ?? c!.id), scene: original?.scene ?? state.scene,
      topic: original?.topic ?? (q?.question ?? c!.topic),
      modelNote: original?.modelNote ?? (q?.answer!.text ?? [c!.analysis!.overview, ...c!.analysis!.rows.map(row => `${row.aspect}：A ${row.left.text}；B ${row.right.text}`), c!.analysis!.limitations].join('\n')).slice(0, 12000),
      citations: original?.citations ?? Object.freeze(citations), citationIds: original?.citationIds ?? Object.freeze([]),
      text: original?.text ?? '', checks: original?.checks ?? '' });
    if (!this.navigation.canHoldJudgment(judgment, false)) throw new Error('本次判断内容已达内存预算，未新建草稿；旧记录仍保留');
    this.transition({ mode: 'judgment', judgment, scene: judgment.scene }, true,
      { kind: 'judgment', status: 'ready', label: original ? `修改判断 · 基于 v${original.version}` : '我的判断 · 草稿', judgmentScope: judgmentScope(judgment) });
  }
  editJudgment(raw: JudgmentEdit) {
    const edit = argument(judgmentEditSchema, raw); const current = this.current.judgment;
    if (this.disposed || this.current.mode !== 'judgment' || current?.status !== 'draft' || current.draftId !== edit.draftId || edit.revision <= current.revision) throw new Error('草稿已变化，未覆盖新内容；请重新选择');
    if (new Set(edit.citationIds).size !== edit.citationIds.length || edit.citationIds.some(id => !current.citations.some(c => c.id === id))) throw new Error('引用不属于这版资料，请重新选择');
    const judgment = Object.freeze({ ...current, id: randomUUID(), revision: edit.revision,
      text: edit.text, checks: edit.checks, citationIds: Object.freeze([...edit.citationIds]) });
    if (!this.navigation.canHoldJudgment(judgment, true)) throw new Error('本次判断内容已达内存预算，未覆盖已保留的草稿');
    this.update({ judgment }, 'replace', { judgmentScope: judgmentScope(judgment) });
  }
  saveJudgment(raw: JudgmentSave) {
    const save = argument(judgmentSaveSchema, raw); const current = this.current.judgment;
    if (this.disposed || this.current.mode !== 'judgment' || current?.status !== 'draft' || current.draftId !== save.draftId || current.revision !== save.revision) throw new Error('草稿仍在更新，请核对后重新保存');
    if (!current.text.trim()) throw new Error('先写下你的判断，再保存版本');
    if (!this.navigation.canRecord()) throw new Error('本次路径已达记录上限，无法新建可回看的判断版本；草稿仍在当前步骤');
    const version = Math.max(current.version, ...this.navigation.snapshot().nodes.map(n => n.judgmentScope?.lineageId === current.lineageId ? n.judgmentScope.version : 0)) + 1;
    const judgment: Judgment = Object.freeze({ ...current, id: randomUUID(), status: 'saved', version, savedAt: new Date().toISOString() });
    if (!this.navigation.canHoldJudgment(judgment, false)) throw new Error('本次判断内容已达内存预算，未保存新版本；草稿仍保留');
    this.transition({ judgment }, true, { kind: 'judgment', status: 'ready', label: `我的判断 · v${version}`, judgmentScope: judgmentScope(judgment) });
  }

  chooseComparison(selector: ComparisonSelector) {
    if (this.disposed || this.current.pending) throw new Error('请等待当前请求完成或先停止');
    const state = this.current;
    let title: string; let url: string; let source: ComparisonSource['source']; let context = state.searchContext;
    if (selector.kind === 'result') {
      const hit = state.mode === 'results' && state.search?.id === selector.searchId ? state.search.results[selector.index] : undefined;
      if (!hit) throw new Error('搜索结果已变化，请重新选择来源');
      title = hit.title; url = hit.url; context = state.search;
    } else if (selector.kind === 'reading') {
      if (state.mode !== 'reading' || (state.reading?.id !== selector.readingId || state.reading.released)) throw new Error('正文已变化或已释放，请重新选择');
      title = state.reading.title; url = state.reading.url; source = questionSource(state.reading); context = state.reading.context;
    } else {
      if (state.mode !== 'question' || state.question?.id !== selector.questionId || !state.question.source) throw new Error('这步没有可用正文，请返回来源');
      source = state.question.source; title = source.title; url = source.url;
    }
    url = checkedUrl(url);
    if (!url.startsWith('https://')) throw new Error('来源对照暂仅支持公开 HTTPS 正文');
    if (state.comparisonSelection.some(item => this.sourceAddress(item.url) === this.sourceAddress(url))) throw new Error('这个地址已选；如需更换正文版本，请先移除');
    if (state.comparisonSelection.length >= 2) throw new Error('一次对照两份来源；请先移除一份再选择');
    const frozenContext = context && Object.freeze({ id: context.id, query: context.query, scene: context.scene, actualQuery: context.actualQuery, contextual: context.contextual });
    const selected = Object.freeze({ id: randomUUID(), originEntryId: state.entryId, title, url, source, context: frozenContext });
    this.update({ comparisonSelection: Object.freeze([...state.comparisonSelection, selected]) }, 'none');
  }
  private sourceAddress(raw: string): string { const value = new URL(raw); value.hash = ''; return value.href; }
  removeComparison(id: string) {
    if (!this.current.comparisonSelection.some(item => item.id === id)) throw new Error('所选来源已变化');
    this.update({ comparisonSelection: Object.freeze(this.current.comparisonSelection.filter(item => item.id !== id)) }, 'none');
  }
  async startComparison() {
    if (this.current.pending) throw new Error('请等待当前请求完成或先停止');
    if (this.current.comparisonSelection.length !== 2) throw new Error('请先明确选择两份来源');
    const context = this.current.searchContext;
    return this.compare(Object.freeze({ id: randomUUID(), scene: this.current.scene, context,
      topic: context?.query || '这两份资料有哪些一致、分歧、适用范围与信息缺口？', sources: Object.freeze([...this.current.comparisonSelection]) }));
  }
  async retryComparison(id: string) {
    const comparison = this.current.comparison;
    if (this.current.mode !== 'comparison' || !comparison || comparison.id !== id || this.current.pending) throw new Error('这份对照已变化，请重新操作');
    return this.compare(comparison);
  }
  async recoverComparison() {
    const scope = this.navigation.current().step.comparisonScope;
    if (this.current.mode !== 'comparison' || this.current.comparison || !scope || this.current.pending) throw new Error('这步不需要重新获取，请核对当前对照');
    const sources = Object.freeze(scope.sources.map(item => Object.freeze({ id: item.id, originEntryId: item.originEntryId,
      title: item.title, url: item.url, context: item.context })));
    return this.compare(Object.freeze({ id: randomUUID(), scene: scope.scene, context: scope.context, topic: scope.topic, sources }));
  }
  private async compare(snapshot: ComparisonRecord) {
    if (!this.provider.compare) throw new Error('当前模型服务不支持来源对照；可继续阅读');
    return this.run('comparison', '来源对照', async (signal, id, publish) => {
      const slots = [...snapshot.sources]; let version = 0;
      const record = () => Object.freeze({ ...snapshot, id: `${id}-sources-${++version}`, sources: Object.freeze([...slots]), analysis: undefined, generatedAt: undefined });
      await Promise.all(slots.map(async (item, index) => {
        if (item.source && !item.source.released) return;
        try {
          signal.throwIfAborted(); const data = await this.provider.read(item.url, signal); signal.throwIfAborted();
          const source = questionSource({ ...data, id: randomUUID(), url: item.url, fetchedAt: new Date().toISOString(), context: item.context });
          slots[index] = Object.freeze({ ...item, title: source.title, source, issue: undefined });
        } catch (error) {
          signal.throwIfAborted();
          slots[index] = Object.freeze({ ...item, source: item.source?.released ? undefined : item.source, issue: error instanceof Error ? error.message.slice(0, 256) : '公开正文暂不可用' });
        }
        publish({ comparison: record() });
      }));
      signal.throwIfAborted();
      const complete = record(); publish({ comparison: complete });
      if (slots.some(item => !item.source)) return complete;
      const analysis = await this.provider.compare!({ scene: snapshot.scene, topic: snapshot.topic, sources: Object.freeze(slots.map(item => item.source!)) }, signal);
      return Object.freeze({ ...complete, id, analysis, generatedAt: new Date().toISOString() });
    }, comparison => ({ comparison, issue: comparison.analysis ? undefined : { id: comparison.id, kind: 'comparison', message: '有来源未取得公开正文，尚未生成对照；可补取或打开原页。' } }),
    { mode: 'comparison', value: snapshot.topic, scene: snapshot.scene, comparison: Object.freeze({ ...snapshot, id: randomUUID(), analysis: undefined, generatedAt: undefined }) }, undefined,
    comparison => ({ status: comparison.analysis ? 'ready' : 'failed' }));
  }

  async extract(url: string, scene: Scene, readingId: string): Promise<Extraction | undefined> {
    const reading = this.current.reading;
    if (this.current.mode !== 'reading' || !reading || reading.released || reading.id !== readingId || reading.url !== url) throw new Error('正文已变化或已释放，请重新选择当前正文');
    return this.run('extraction', url, async (signal, id) => Object.freeze({ ...await this.provider.extract(reading, scene, signal), id, readingId, scene }), extraction => ({ extraction }));
  }
}
