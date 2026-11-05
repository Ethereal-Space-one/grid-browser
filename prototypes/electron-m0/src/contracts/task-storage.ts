import { z } from 'zod';
import { sceneSchema, presentationSchema, searchHitSchema, type ContentKind } from './browsing';
import type { NavigationContent } from '../application/navigation-store';
export const TASK_VERSION = 1;
export const PATH_BYTES = 2 * 1024 * 1024;
export const TOTAL_BYTES = 24 * 1024 * 1024;
export const PATH_LIMIT = 48;
const id = z.string().min(1).max(256), uuid = z.uuid(), time = z.iso.datetime(), url = z.string().max(8192);
const query = z.object({ id, query: z.string().max(8192), actualQuery: z.string().max(8192), scene: sceneSchema, contextual: z.boolean() }).strict();
const source = z.object({ readingId: id, title: z.string().max(2048), url, fetchedAt: time, truncated: z.boolean(), text: z.literal(''), released: z.literal(true) }).strict();
const citation = z.object({ source: z.number().int().min(1).max(100), quote: z.string().max(1000), title: z.string().max(2048), url }).strict();
const grounded = { text: z.string().max(12000), insufficient: z.boolean(), citations: z.array(citation).max(24) };
const side = z.object({ status: z.enum(['supported','not-stated']), text: z.string().max(600), quotes: z.array(z.string().max(240)).max(2) }).strict();
const comparisonSource = z.object({ id, originEntryId: uuid, title: z.string().max(2048), url, context: query.optional(), source: source.optional(), issue: z.string().max(256).optional() }).strict();
const analysis = z.object({ overview: z.string().max(600), limitations: z.string().max(800), rows: z.array(z.object({ aspect: z.string().max(120), relation: z.enum(['agreement','conflict','different-scope','insufficient']), left: side, right: side }).strict()).max(4) }).strict();
const judgmentCitation = z.object({ id, title: z.string().max(2048), url, readingId: id, fetchedAt: time, truncated: z.boolean(), quote: z.string().max(1000) }).strict();
const judgmentShape = { id, draftId: id, lineageId: id, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), status: z.enum(['draft','saved']), version: z.number().int().nonnegative(), basedOnId: id.optional(), originEntryId: uuid, originKind: z.enum(['question','comparison']), originRecordId: id, scene: sceneSchema, topic: z.string().max(8192), modelNote: z.string().max(12000), citations: z.array(judgmentCitation).max(24), citationIds: z.array(id).max(24), text: z.string().max(4000), checks: z.string().max(2000), savedAt: time.optional() };
const comparisonScope = z.object({ scene: sceneSchema, context: query.optional(), topic: z.string().max(8192), sources: z.array(z.object({ id, originEntryId: uuid, title: z.string().max(2048), url, context: query.optional(), version: source.pick({ readingId:true, fetchedAt:true, truncated:true }).optional() }).strict()).length(2) }).strict();
const judgmentScope = z.object({ id, lineageId: id, status: z.enum(['draft','saved']), version: z.number().int().nonnegative(), originEntryId: uuid, originKind: z.enum(['question','comparison']), originRecordId: id, savedAt: time.optional() }).strict();
const mode = z.enum(['home','results','page','reading','question','comparison','judgment']);
export const stepSchema = z.object({ kind: z.enum(['home','search','page','reading','question','comparison','judgment']), status: z.enum(['ready','cancelled','failed']), label: z.string().max(256), excerpt: z.string().max(400).optional(), runId: id.optional(), target: url.optional(), context: query.optional(), comparisonScope: comparisonScope.optional(), judgmentScope: judgmentScope.optional(), readingScope: z.object({ id, title:z.string().max(2048), url, fetchedAt:time }).strict().optional() }).strict();
const record = <K extends ContentKind, T extends z.ZodType>(kind: K, value: T) => z.object({ kind: z.literal(kind), key: z.string().min(1).max(300), value }).strict();
export const taskRecordSchema = z.discriminatedUnion('kind', [
  record('search', z.object({ ...query.shape, results:z.array(searchHitSchema.strict()).max(100) }).strict()),
  record('reading', z.object({id,title:z.string().max(2048),url,fetchedAt:time,context:query.optional(),content:z.literal(''),released:z.literal(true)}).strict()),
  record('extraction', z.object({id,readingId:id,text:z.string().max(16000),scene:sceneSchema,truncated:z.boolean()}).strict()),
  record('summary', z.object({...grounded,id,searchId:id,generatedAt:time,pageSource:source.pick({readingId:true,title:true,url:true,fetchedAt:true,truncated:true}).optional()}).strict()),
  record('question', z.object({id,originEntryId:uuid,url,title:z.string().max(2048),originKind:z.enum(['page','reading']),scene:sceneSchema,question:z.string().max(2000),source:source.optional(),answer:z.object(grounded).strict().optional(),answeredAt:time.optional()}).strict()),
  record('comparison', z.object({id,scene:sceneSchema,context:query.optional(),topic:z.string().max(8192),sources:z.array(comparisonSource).length(2),analysis:analysis.optional(),generatedAt:time.optional()}).strict()),
  record('judgment', z.object(judgmentShape).strict())
]);
const refs = z.object({search:id.max(300).optional(),reading:id.max(300).optional(),extraction:id.max(300).optional(),summary:id.max(300).optional(),question:id.max(300).optional(),comparison:id.max(300).optional(),judgment:id.max(300).optional()}).strict();
export const taskSchema = z.object({ version:z.literal(TASK_VERSION), id:uuid, rootId:uuid, currentId:uuid,
  nodes:z.array(z.object({id:uuid,removed:z.boolean().optional(),parentId:uuid.optional(),childIds:z.array(uuid).max(32),selectedChildId:uuid.optional(),createdAt:time,
    metadata:z.object({mode,value:z.string().max(8192),scene:sceneSchema,searchContext:query.optional()}).strict(),
    step:stepSchema, presentation:presentationSchema, references:refs}).strict()).min(1).max(32), records:z.array(taskRecordSchema).max(224)
}).strict();
export type StoredTask = z.infer<typeof taskSchema>;
export type StoredRecord = z.infer<typeof taskRecordSchema>;
export type Workspace = { windows: { paths: string[]; selected: string }[]; active: number };
export const workspaceSchema = z.object({windows:z.array(z.object({paths:z.array(uuid).max(12),selected:uuid}).strict()).max(4),active:z.number().int().min(0).max(3)}).strict();
export type StorageState = Readonly<{ status:'ready'|'dirty'|'saving'|'saved'|'error'|'blocked'; message?:string; committedAt?:string; generation?:string;
  paths:readonly Readonly<{id:string;title:string;step?:string;updatedAt:string;nodes:number}>[]; limit:number; bytes:number }>;
const pick = (v:any, fields:string[]) => Object.fromEntries(fields.filter(k => v[k] !== undefined).map(k => [k,v[k]]));
export const storedQuery = (v:any) => v && pick(v,['id','query','actualQuery','scene','contextual']);
const storedSource = (v:any) => v && ({...pick(v,['readingId','title','url','fetchedAt','truncated']), text:'',released:true});
const storedGrounded = (v:any) => v && ({...pick(v,['text','insufficient']),citations:v.citations.map((c:any)=>pick(c,['source','quote','title','url']))});
/** Explicit projections: no raw source text, runtime authority, pageState or prompt objects. */
export function storedRecord(kind:ContentKind,key:string,v:any):StoredRecord {
  let value:any;
  if(kind==='reading') value={...pick(v,['id','title','url','fetchedAt']),context:storedQuery(v.context),content:'',released:true};
  else if(kind==='search') value={...storedQuery(v),results:v.results.map((hit:any)=>pick(hit,['title','url','snippet','site','date']))};
  else if(kind==='extraction') value=pick(v,['id','readingId','text','scene','truncated']);
  else if(kind==='summary') value={...pick(v,['id','searchId','generatedAt']),...storedGrounded(v),pageSource:v.pageSource&&pick(v.pageSource,['readingId','title','url','fetchedAt','truncated'])};
  else if(kind==='question') value={...pick(v,['id','originEntryId','url','title','originKind','scene','question','answeredAt']),source:storedSource(v.source),answer:storedGrounded(v.answer)};
  else if(kind==='comparison') value={...pick(v,['id','scene','topic','generatedAt']),context:storedQuery(v.context),sources:v.sources.map((s:any)=>({...pick(s,['id','originEntryId','title','url','issue']),context:storedQuery(s.context),source:storedSource(s.source)})),analysis:v.analysis && {...pick(v.analysis,['overview','limitations']),rows:v.analysis.rows.map((r:any)=>({...pick(r,['aspect','relation']),left:pick(r.left,['status','text','quotes']),right:pick(r.right,['status','text','quotes'])}))}};
  else value={...pick(v,Object.keys(judgmentShape)),citations:v.citations.map((c:any)=>pick(c,Object.keys(judgmentCitation.shape)))};
  return taskRecordSchema.parse({kind,key,value});
}
export function storedMetadata(v:NavigationContent):StoredTask['nodes'][number]['metadata'] { return {mode:v.mode,value:v.value,scene:v.scene,searchContext:storedQuery(v.searchContext)} as StoredTask['nodes'][number]['metadata']; }
export function parseTask(raw:unknown):StoredTask {
  const task=taskSchema.parse(raw);if(Buffer.byteLength(JSON.stringify(task))>PATH_BYTES)throw new Error('路径超过保存容量');
  const nodes=new Map(task.nodes.map(n=>[n.id,n]));if(nodes.size!==task.nodes.length || !nodes.has(task.currentId) || !nodes.has(task.rootId))throw new Error('路径引用无效');
  const root=nodes.get(task.rootId)!;if(root.parentId || root.step.kind!=='home')throw new Error('路径根无效');
  for(const n of task.nodes){if(n.childIds.length!==new Set(n.childIds).size || n.selectedChildId && !n.childIds.includes(n.selectedChildId))throw new Error('后续分支无效');
    if(n.id!==root.id && (!n.parentId || !nodes.get(n.parentId)?.childIds.includes(n.id)))throw new Error('父节点无效');
    if(n.childIds.some(id=>nodes.get(id)?.parentId!==n.id))throw new Error('子节点无效');
    const seen=new Set<string>();let current:typeof n|undefined=n;while(current){if(seen.has(current.id))throw new Error('路径存在环');seen.add(current.id);current=current.parentId?nodes.get(current.parentId):undefined;}if(!seen.has(root.id))throw new Error('孤立路径');
    for(const [kind,key]of Object.entries(n.references))if(!key?.startsWith(kind+':'))throw new Error('内容引用类型无效');
  }
  const keys=new Set<string>();for(const r of task.records){if(keys.has(r.key)||r.key!==`${r.kind}:${r.value.id}`)throw new Error('内容标识无效');keys.add(r.key);
    if(r.kind==='question'&&!nodes.has(r.value.originEntryId)||r.kind==='judgment'&&!nodes.has(r.value.originEntryId)||r.kind==='comparison'&&r.value.sources.some(s=>!nodes.has(s.originEntryId)))throw new Error('来源位置无效');
    if(r.kind==='judgment'&&(new Set(r.value.citationIds).size!==r.value.citationIds.length||r.value.citationIds.some(id=>!r.value.citations.some(c=>c.id===id))||r.value.status==='saved'&&(!r.value.savedAt||!r.value.version||!r.value.text.trim())))throw new Error('判断版本无效');
  }
  const referenced=new Set(task.nodes.flatMap(n=>Object.values(n.references)));if(task.records.some(r=>!referenced.has(r.key)))throw new Error('未引用内容');
  return task;
}
