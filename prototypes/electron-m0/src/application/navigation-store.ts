import { parseTask, storedMetadata, storedRecord, stepSchema, type StoredTask } from '../contracts/task-storage';
import type { Judgment } from '../contracts/judgment';
import { contentKinds } from '../contracts/browsing';
import type { ComparisonRecord } from '../contracts/comparison';
import type { PageQuestion, SearchSummary } from '../contracts/understanding';
import { randomUUID } from 'node:crypto';
import type { BrowsingPath, BrowsingState, ContentKind, Extraction, NavigationStep, PathNode, Presentation, ReadingDocument, SearchResponse } from '../contracts/browsing';

type ContentFields = 'mode' | 'value' | 'scene' | 'search' | 'searchContext' | 'reading' | 'extraction' | 'nativeIndex' | 'nativeVisitId' | 'issue' | 'summary' | 'question' | 'comparison' | 'judgment';
type ContentState = Pick<BrowsingState, ContentFields>;
export type NavigationContent = { -readonly [K in keyof ContentState]: ContentState[K] };
type ContentInput = Omit<NavigationContent, 'scene'> & Partial<Pick<NavigationContent, 'scene'>>;
type Metadata = Omit<NavigationContent, ContentKind>;
type References = Readonly<Partial<Record<ContentKind, string>>>;
type Entry = {
  id: string; removed?: boolean; parentId?: string; childIds: string[]; selectedChildId?: string; recorded: boolean; createdAt: string;
  metadata: Metadata; references: References; presentation: Presentation; step: NavigationStep;
};
export type NavigationEntry = Readonly<{ id: string; content: NavigationContent; presentation: Presentation; step: NavigationStep }>;
type RecordValue = SearchResponse | ReadingDocument | Extraction | SearchSummary | PageQuestion | ComparisonRecord | Judgment;
type CachedRecord = { value: RecordValue; bytes: number };
const defaults = (): Presentation => Object.freeze({ scrollTop: 0, addressDraft: null, homeQuery: '', contextual: true });
export const HISTORY_LIMIT = 32;
export const HISTORY_TEXT_BUDGET = 8 * 1024 * 1024;
const key = (kind: ContentKind, id: string) => `${kind}:${id}`;

/** Bounded task tree; payload eviction never removes a visited branch. No native pageState. */
export class NavigationStore {
  readonly pathId: string = randomUUID();
  readonly rootId: string = randomUUID();
  private entries = new Map<string, Entry>();
  private temporary?: Entry;
  private currentId: string = this.rootId;
  private records = new Map<string, CachedRecord>();
  private bytes = 0;
  private removals: string[] = [];
  private readonly nodeLimit: number;
  private readonly textBudget: number;

  constructor(limits: { nodeLimit?: number; textBudget?: number } = {}, restored?: StoredTask) {
    this.nodeLimit = limits.nodeLimit ?? HISTORY_LIMIT;
    this.textBudget = limits.textBudget ?? HISTORY_TEXT_BUDGET;
    if (!Number.isSafeInteger(this.nodeLimit) || this.nodeLimit < 1 || !Number.isSafeInteger(this.textBudget) || this.textBudget < 0) throw new Error('导航容量无效');
    this.entries.set(this.rootId, { id: this.rootId, childIds: [], recorded: true, createdAt: new Date().toISOString(),
      metadata: Object.freeze({ mode: 'home', value: '', scene: 'professional' }), references: {}, presentation: defaults(),
      step: Object.freeze({ kind: 'home', status: 'ready', label: '首页' }) });
    if (restored) {
      const task = parseTask(restored); this.pathId = task.id; this.rootId = task.rootId; this.currentId = task.currentId; this.entries.clear();
      const freeze = (value: any): any => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
      for (const node of task.nodes) this.entries.set(node.id, { ...node, childIds: [...node.childIds], recorded: true,
        metadata: freeze(node.metadata), references: freeze(node.references), presentation: freeze(node.presentation), step: freeze(node.step) });
      for (const record of task.records) { const value = freeze(record.value); const bytes = Buffer.byteLength(JSON.stringify(value)); this.records.set(record.key, { value, bytes }); this.bytes += bytes; }
      this.evict();
    }

  }
  exportTask(): StoredTask {
    const entries = [...this.entries.values()];
    const pick = (v: any, fields: string[]) => Object.fromEntries(fields.filter(k => v[k] !== undefined).map(k => [k, v[k]]));
    const nodes = entries.map(e => ({ id:e.id,removed:e.removed,parentId:e.parentId,childIds:[...e.childIds],
      selectedChildId:e.selectedChildId && this.entries.has(e.selectedChildId) ? e.selectedChildId : undefined,createdAt:e.createdAt,
      metadata:storedMetadata(e.metadata as NavigationContent),references:{...e.references},
      presentation:pick(e.presentation,['scrollTop','addressDraft','homeQuery','contextual','questionDraft']) as Presentation,
      step:stepSchema.parse({...pick(e.step,['kind','status','label','excerpt','runId','target','context','comparisonScope','judgmentScope','readingScope']),status:e.step.status==='pending'?'cancelled':e.step.status}) }));
    const references = new Set(nodes.flatMap(e => Object.values(e.references)));
    const records = [...this.records].filter(([key]) => references.has(key)).sort(([a],[b]) => a.localeCompare(b))
      .map(([key,record]) => storedRecord(key.split(':')[0] as ContentKind,key,record.value));
    return {version:1,id:this.pathId,rootId:this.rootId,currentId:this.active().recorded?this.currentId:this.active().parentId!,nodes,records};
  }
  private entry(id: string = this.currentId): Entry | undefined { return this.entries.get(id) ?? (this.temporary?.id === id ? this.temporary : undefined); }
  private active(): Entry { return this.entry()!; }
  private all(): Entry[] { return [...this.entries.values(), ...(this.temporary ? [this.temporary] : [])]; }
  private children(entry: Entry): string[] {
    return [...entry.childIds, ...(this.temporary?.parentId === entry.id ? [this.temporary.id] : [])];
  }
  current(): NavigationEntry { return this.read(this.active(), true); }
  get(id: string): NavigationEntry | undefined { const entry = this.entry(id); return entry && this.read(entry); }
  canRecord(): boolean { return this.entries.size < this.nodeLimit; }
  canHoldJudgment(value: Judgment, replacing: boolean): boolean {
    const currentKey = this.active().references.judgment;
    const live = new Set(this.all().flatMap(e => e.references.judgment ? [e.references.judgment] : []));
    // A replaced draft is disposable only if no other recorded view refers to it.
    if (replacing && currentKey && !this.all().some(e => e.id !== this.currentId && e.references.judgment === currentKey)) live.delete(currentKey);
    let required = Buffer.byteLength(JSON.stringify(value));
    for (const id of live) required += this.records.get(id)?.bytes ?? 0;
    return required <= this.textBudget;
  }
  canBack(): boolean { return Boolean(this.visibleParent(this.active())); }
  canForward(): boolean { return Boolean(this.visibleForward(this.active())); }

  visit(content: ContentInput, step?: NavigationStep, presentation?: Presentation): string {
    const previous = this.active();
    const normalized = { ...content, scene: content.scene ?? previous.metadata.scene };
    let parent = previous;
    // At capacity only the live, explicitly unrecorded continuation is replaced. Recorded nodes survive.
    if (this.entries.size >= this.nodeLimit) {
      if (!previous.recorded) parent = this.entry(previous.parentId!)!;
      if (this.temporary) {
        const oldParent = this.entry(this.temporary.parentId!);
        if (oldParent?.selectedChildId === this.temporary.id) oldParent.selectedChildId = undefined;
      }
      this.temporary = undefined;
    }
    const entry: Entry = { id: randomUUID(), parentId: parent.id, childIds: [], recorded: this.entries.size < this.nodeLimit, createdAt: new Date().toISOString(),
      ...this.capture(normalized), presentation: Object.freeze({ ...defaults(), homeQuery: previous.presentation.homeQuery,
        contextual: previous.presentation.contextual, ...presentation }), step: this.freezeStep(step ?? this.describe(normalized)) };
    if (entry.recorded) { this.entries.set(entry.id, entry); parent.childIds.push(entry.id); }
    else this.temporary = entry;
    parent.selectedChildId = entry.id;
    this.currentId = entry.id;
    this.evict();
    return entry.id;
  }
  replace(content: ContentInput, step?: Partial<NavigationStep>, preserveMissing = false) {
    const entry = this.active();
    const captured = this.capture({ ...content, scene: content.scene ?? entry.metadata.scene });
    const references = { ...captured.references };
    if (preserveMissing) for (const kind of this.missing(entry)) if (!content[kind]) references[kind] = entry.references[kind];
    Object.assign(entry, captured, { references: Object.freeze(references) });
    if (step) entry.step = this.freezeStep({ ...entry.step, ...step });
    this.evict();
  }
  explorationTitle(): string {
    const entries = [...this.entries.values()];
    const first = entries.find(n => n.step.kind === 'search') ?? entries.find(n => n.step.kind === 'page');
    return (first?.step.context?.query || first?.step.label || '新的探索').slice(0, 256);
  }
  mark(id: string, status: NavigationStep['status']) {
    const entry = this.entry(id);
    if (entry) entry.step = Object.freeze({ ...entry.step, status });
  }
  move(direction: -1 | 1): boolean {
    const current = this.active();
    const target = direction < 0 ? this.visibleParent(current) : this.visibleForward(current);
    return target ? this.jump(target) : false;
  }
  jump(id: string): boolean {
    const target = this.entry(id);
    if (!target) return false;
    let child = target;
    while (child.parentId) {
      const parent = this.entry(child.parentId)!;
      parent.selectedChildId = child.id; child = parent;
    }
    this.currentId = id;
    this.read(target, true);
    return true;
  }
  results(id: string): string | undefined {
    let entry: Entry | undefined = this.active();
    while (entry) {
      if (entry.step.kind === 'search' && entry.step.runId === id) return entry.id;
      entry = entry.parentId ? this.entry(entry.parentId) : undefined;
    }
    return undefined;
  }
  save(id: string, presentation: Presentation): boolean {
    if (id !== this.currentId) return false;
    this.active().presentation = Object.freeze({ ...presentation }); return true;
  }
  snapshot(): BrowsingPath {
    const nodes: PathNode[] = this.all().filter(entry => !entry.removed).map(entry => Object.freeze({ ...entry.step, id: entry.id, parentId: this.visibleParent(entry),
      childIds: Object.freeze(this.visibleChildren(entry)), selectedChildId: this.visibleForward(entry), recorded: entry.recorded,
      scene: entry.metadata.scene, createdAt: entry.createdAt,
      missingContent: Object.freeze(this.missing(entry)) }));
    const paused = Boolean(this.temporary);
    const notices = [paused ? `路径已达 ${this.nodeLimit} 个记录上限；旧分支保留，后续只暂存当前步骤，后退回到最近记录位置。` : '',
      this.missing(this.active()).length ? '路径和位置仍在，部分旧内容已从内存释放；可重新搜索或打开原页，尚未重新请求服务。' : ''].filter(Boolean);
    return Object.freeze({ id: this.pathId, rootId: this.rootId, currentId: this.currentId, nodes: Object.freeze(nodes),
      recordingPaused: paused, canUndo: Boolean(this.removals.length), currentRemoved: Boolean(this.active().removed), notice: notices.join(' ') || undefined });
  }
  // Removal changes the map projection only. The canonical tree and versioned sources
  // survive, so undo never overwrites branches created after removal.
  private visibleParent(entry: Entry): string | undefined {
    let parent = entry.parentId ? this.entry(entry.parentId) : undefined;
    while (parent?.removed) parent = parent.parentId ? this.entry(parent.parentId) : undefined;
    return parent?.id;
  }
  private visibleChildren(entry: Entry): string[] {
    return this.children(entry).flatMap(id => { const child = this.entry(id); return !child ? [] : child.removed ? this.visibleChildren(child) : [id]; });
  }
  private visibleForward(entry: Entry): string | undefined {
    let child = entry.selectedChildId ? this.entry(entry.selectedChildId) : undefined;
    while (child?.removed) child = child.selectedChildId ? this.entry(child.selectedChildId) : undefined;
    return child?.id;
  }
  remove(id: string) {
    const entry = this.entry(id);
    if (!entry || entry.removed) throw new Error('节点已经变化，请重新选择');
    entry.removed = true; this.removals.push(id);
  }
  undoRemoval() { const id = this.removals.pop(); if (id) { const entry = this.entry(id); if (entry) entry.removed = undefined; } }
  navigationTarget(direction: -1 | 1) { return direction < 0 ? this.visibleParent(this.active()) : this.visibleForward(this.active()); }
  pageAncestor(): NavigationEntry | undefined {
    let entry: Entry | undefined = this.active();
    while (entry) {
      if (entry.metadata.mode === 'page' && entry.metadata.nativeVisitId) return this.read(entry);
      entry = entry.parentId ? this.entry(entry.parentId) : undefined;
    }
    return undefined;
  }
  private describe(content: NavigationContent): NavigationStep {
    return { kind: content.mode === 'results' ? 'search' : content.mode, status: 'ready',
      label: (content.mode === 'home' ? '首页' : content.reading?.title || content.value).slice(0, 256), runId: content.search?.id,
      target: content.value, context: content.search ?? content.searchContext ?? content.reading?.context };
  }
  private freezeStep(step: NavigationStep): NavigationStep {
    const c = step.context;
    const context = c && Object.freeze({ id: c.id, query: c.query, scene: c.scene, actualQuery: c.actualQuery, contextual: c.contextual });
    return Object.freeze({ ...step, context });
  }
  private capture(content: NavigationContent): Pick<Entry, 'metadata' | 'references'> {
    const { search, reading, extraction, summary, question, comparison, judgment, ...metadata } = content;
    const references: Partial<Record<ContentKind, string>> = {};
    if (search) references.search = this.put('search', search);
    if (reading) references.reading = this.put('reading', reading);
    if (extraction) references.extraction = this.put('extraction', extraction);
    if (summary) references.summary = this.put('summary', summary);
    if (question) references.question = this.put('question', question);
    if (comparison) references.comparison = this.put('comparison', comparison);
    if (judgment) references.judgment = this.put('judgment', judgment);
    const context = search ?? metadata.searchContext ?? reading?.context;
    const searchContext = context && Object.freeze({ id: context.id, query: context.query, scene: context.scene,
      actualQuery: context.actualQuery, contextual: context.contextual });
    return { metadata: Object.freeze({ ...metadata, searchContext, issue: metadata.issue && Object.freeze({ ...metadata.issue }) }), references: Object.freeze(references) };
  }
  private put(kind: ContentKind, value: RecordValue): string {
    const id = key(kind, value.id);
    const existing = this.records.get(id);
    if (existing) { this.records.delete(id); this.records.set(id, existing); return id; }
    let frozen: RecordValue;
    if (Object.isFrozen(value) && ('results' in value ? Object.isFrozen(value.results) && value.results.every(Object.isFrozen)
      : 'content' in value ? !value.context || Object.isFrozen(value.context) : true)) frozen = value;
    else if ('results' in value) frozen = Object.freeze({ ...value, results: Object.freeze(value.results.map(hit => Object.freeze({ ...hit }))) });
    else if ('content' in value) frozen = Object.freeze({ ...value, context: value.context && Object.freeze({ ...value.context }) });
    else frozen = Object.freeze({ ...value });
    const bytes = Buffer.byteLength(JSON.stringify(frozen));
    if (bytes <= this.textBudget) { this.records.set(id, { value: frozen, bytes }); this.bytes += bytes; }
    return id;
  }
  private read(entry: Entry, touch = false): NavigationEntry {
    const content: NavigationContent = { searchContext: undefined, nativeIndex: undefined, nativeVisitId: undefined, issue: undefined,
      ...entry.metadata, search: undefined, reading: undefined, extraction: undefined, summary: undefined, question: undefined, comparison: undefined, judgment: undefined };
    for (const kind of contentKinds) {
      const id = entry.references[kind]; const record = id && this.records.get(id);
      if (!record) continue;
      if (touch) { this.records.delete(id!); this.records.set(id!, record); }
      if (kind === 'search') content.search = record.value as SearchResponse;
      else if (kind === 'reading') content.reading = record.value as ReadingDocument;
      else if (kind === 'extraction') content.extraction = record.value as Extraction;
      else if (kind === 'summary') content.summary = record.value as SearchSummary;
      else if (kind === 'question') content.question = record.value as PageQuestion;
      else if (kind === 'comparison') content.comparison = record.value as ComparisonRecord;
      else content.judgment = record.value as Judgment;
    }
    return Object.freeze({ id: entry.id, content: Object.freeze(content), presentation: entry.presentation, step: entry.step });
  }
  private missing(entry: Entry): ContentKind[] {
    return contentKinds.filter(kind => Boolean(entry.references[kind] && !this.records.has(entry.references[kind]!)));
  }
  private evict() {
    // Drop unreferenced records first, then LRU payloads. Prefer the active view within the same budget.
    const live = new Set(this.all().flatMap(entry => Object.values(entry.references)));
    for (const [id, record] of this.records) if (!live.has(id)) { this.records.delete(id); this.bytes -= record.bytes; }
    const protectedIds = new Set(Object.values(this.active().references));
    while (this.bytes > this.textBudget) {
      const ids = [...this.records.keys()];
      // Prefer authored notes over reproducible provider payloads, within the same fixed budget.
      const id = ids.find(id => !protectedIds.has(id) && !id.startsWith('judgment:'))
        ?? ids.find(id => !id.startsWith('judgment:'))
        ?? ids.find(id => !protectedIds.has(id)) ?? this.records.keys().next().value!;
      const record = this.records.get(id)!;
      this.records.delete(id); this.bytes -= record.bytes;
    }
  }
}
