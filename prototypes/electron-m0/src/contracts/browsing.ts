import type { StorageState } from './task-storage';
import type { Judgment, JudgmentEdit, JudgmentSave, JudgmentScope } from './judgment';
import { z } from 'zod';
import type { FormAction } from '../form-action';
import type { LocalBridge } from '../local-bridge';
import type { PageQuestion, SearchSummary } from './understanding';
import type { ComparisonRecord, ComparisonScope, ComparisonSelector, ComparisonSource } from './comparison';

export const sceneSchema = z.enum(['professional', 'learning', 'living', 'entertainment', 'inspiration']);
export type Scene = z.infer<typeof sceneSchema>;
export const textInputSchema = z.string().max(8192).trim().min(1);
export const submitOptionsSchema = z.object({ scene: sceneSchema.optional(), contextual: z.boolean().optional() }).strict().optional();
export const idSchema = z.string().min(1).max(256);
export const keySchema = z.string().max(512).trim().min(10);
export const presentationSchema = z.object({
  scrollTop: z.number().finite().min(0).max(10_000_000), addressDraft: z.string().max(8192).nullable(),
  homeQuery: z.string().max(8192), contextual: z.boolean(), questionDraft: z.string().max(2000).optional()
}).strict();
export type Presentation = z.infer<typeof presentationSchema>;
export const chromeLayoutSchema = z.object({
  width: z.number().finite().positive().max(32768), height: z.number().finite().positive().max(32768),
  top: z.number().finite().min(0).max(32768),
  left: z.number().finite().min(0).max(1000).optional(), right: z.number().finite().min(0).max(1200).optional()
}).strict();
export type ChromeLayout = z.infer<typeof chromeLayoutSchema>;

export const searchHitSchema = z.object({
  title: z.string().max(2048), url: z.string().max(8192), snippet: z.string().max(16000),
  site: z.string().max(2048), date: z.string().max(256).nullable()
});
export type SearchHit = z.infer<typeof searchHitSchema>;
export const searchPayloadSchema = z.object({ results: z.array(z.unknown()).max(100) });
export const fetchPayloadSchema = z.object({ title: z.string().max(2048).optional(), content: z.string().min(1).max(1_000_000) });
export const extractionPayloadSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1).max(16) });

export function argument<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  // Do not expose schema diagnostics: they can contain private argument values.
  if (!parsed.success) throw new Error('参数格式无效，请检查输入');
  return parsed.data;
}

export type QueryContext = Readonly<{ id: string; query: string; scene: Scene; actualQuery: string; contextual: boolean }>;
export type SearchResponse = QueryContext & { readonly results: readonly SearchHit[] };
export type ReadingDocument = Readonly<{
  id: string; title: string; url: string; content: string; fetchedAt: string; context?: QueryContext; released?: true;
}>;
export type Extraction = Readonly<{ id: string; readingId: string; text: string; scene: Scene; truncated: boolean }>;
export const contentKinds = ['search', 'reading', 'extraction', 'summary', 'question', 'comparison', 'judgment'] as const;
export type ContentKind = typeof contentKinds[number];
export type NavigationStep = Readonly<{
  kind: 'home' | 'search' | 'reading' | 'page' | 'question' | 'comparison' | 'judgment';
  status: 'ready' | 'pending' | 'cancelled' | 'failed'; label: string; runId?: string;
  target?: string; context?: QueryContext; excerpt?: string;
  comparisonScope?: ComparisonScope; judgmentScope?: JudgmentScope;
  readingScope?: Readonly<{id:string;url:string;title:string;fetchedAt:string}>;
}>;
export type PathNode = NavigationStep & Readonly<{
  id: string; parentId?: string; childIds: readonly string[]; selectedChildId?: string;
  scene: Scene; createdAt: string; recorded: boolean; missingContent: readonly ContentKind[];
}>;
export type BrowsingPath = Readonly<{
  id: string; rootId: string; currentId: string; nodes: readonly PathNode[];
  recordingPaused: boolean; notice?: string; canUndo?: boolean; currentRemoved?: boolean;
}>;
export type Pending = Readonly<{ id: string; nodeId: string; kind: ContentKind }>;
export type PageRecovery = Readonly<{
  id: string; nodeId: string; url: string; kind: 'loading' | 'history-lost' | 'submission' | 'failed'; message: string;
}>;
export type BrowsingState = Readonly<{
  ownerId: string; revision: number; scene: Scene; mode: 'home' | 'results' | 'page' | 'reading' | 'question' | 'comparison' | 'judgment'; value: string;
  entryId: string; presentation: Presentation; canGoBack: boolean; canGoForward: boolean; nativeIndex?: number; nativeVisitId?: string;
  search?: SearchResponse; searchContext?: QueryContext; reading?: ReadingDocument; extraction?: Extraction; pending?: Pending;
  summary?: SearchSummary; question?: PageQuestion;
  judgment?: Judgment; comparison?: ComparisonRecord; comparisonSelection: readonly ComparisonSource[];
  path: BrowsingPath;
  issue?: { id: string; kind: Pending['kind']; message: string };
}>;
export type State = BrowsingState & {
  windowId: number; activeTabId: string; tabs: { id: string; title: string; mode: BrowsingState['mode']; pending: boolean }[];
  hasResults: boolean; keyReady: boolean; agentPanelOpen: boolean; agentTarget: boolean;
  action?: ReturnType<FormAction['state']>; agent?: ReturnType<LocalBridge['state']>;
  pageRecovery?: PageRecovery;
  companion?: { id: string; url: string; title: string };
  pathMapOpen: boolean; layoutId: string; storage: StorageState & {persistent:boolean}; storagePanelOpen:boolean;
};
export type SubmitResponse = ({ kind: 'results' } & SearchResponse) | { kind: 'page' | 'cancelled' };
export type GridApi = {
  storagePanel(open:boolean): Promise<void>; storageFlush(): Promise<void>; storageRestore(id:string): Promise<void>; storageDelete(id:string): Promise<void>; temporaryPath(): Promise<string>;
  actionPreview(value: string, ownerId?: string): Promise<void>; actionConfirm(id: string, ownerId?: string): Promise<void>;
  actionPause(ownerId?: string): Promise<void>; actionResume(ownerId?: string): Promise<void>; actionCancel(ownerId?: string): Promise<void>;
  configureKey(key: string): Promise<void>; setScene(scene: string, ownerId?: string): Promise<void>;
  extract(url: string, scene: string, readingId: string, ownerId?: string): Promise<Extraction | undefined>;
  summarize(searchId: string, ownerId: string, entryId: string): Promise<void>;
  summarizePage(ownerId: string, entryId: string): Promise<void>;
  beginQuestion(ownerId: string, entryId: string): Promise<void>;
  ask(question: string, ownerId: string, entryId: string, questionId: string): Promise<void>;
  judgmentBegin(ownerId: string, entryId: string): Promise<void>;
  judgmentEdit(edit: JudgmentEdit, ownerId: string, entryId: string): Promise<void>;
  judgmentSave(save: JudgmentSave, ownerId: string, entryId: string): Promise<void>;
  comparisonChoose(selector: ComparisonSelector, ownerId: string, entryId: string): Promise<void>;
  comparisonRemove(id: string, ownerId: string, entryId: string): Promise<void>;
  comparisonStart(ownerId: string, entryId: string): Promise<void>;
  comparisonRetry(id: string, ownerId: string, entryId: string): Promise<void>;
  comparisonRecover(ownerId: string, entryId: string): Promise<void>;
  submit(input: string, options?: { scene?: Scene; contextual?: boolean }, ownerId?: string): Promise<SubmitResponse>;
  open(url: string, ownerId?: string): Promise<void>; read(url: string, ownerId?: string): Promise<ReadingDocument | undefined>;
  back(ownerId?: string): Promise<void>; forward(ownerId?: string): Promise<void>; reload(ownerId?: string): Promise<void>; home(ownerId?: string): Promise<void>; results(ownerId?: string): Promise<void>;
  jump(nodeId: string, ownerId: string, fromEntryId: string): Promise<void>;
  reopenPage(nodeId: string, ownerId: string, recoveryId: string): Promise<void>;
  pathMap(open: boolean, ownerId: string): Promise<void>;
  reportLayout(ownerId: string, layoutId: string, value: ChromeLayout): Promise<boolean>;
  cancelRequest(ownerId?: string): Promise<void>; state(): Promise<State>; agentPanel(open: boolean): Promise<void>;
  tabNew(url?: string): Promise<string>; tabSelect(id: string): Promise<void>; tabClose(id: string): Promise<void>;
  windowNew(): Promise<void>; savePresentation(ownerId: string, entryId: string, value: Presentation): Promise<boolean>;
  onFocusAddress(callback: () => void): () => void;
  agentGrant(id: string, documentId: string): Promise<void>; agentRevoke(id: string): Promise<void>;
  agentCopyConfig(format?: 'json' | 'codex'): Promise<void>; agentExport(): Promise<void>;
  onState(callback: (state: State) => void): () => void;
};
