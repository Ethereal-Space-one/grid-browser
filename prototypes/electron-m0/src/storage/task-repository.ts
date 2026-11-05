import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { parseTask, workspaceSchema, PATH_BYTES, TOTAL_BYTES, PATH_LIMIT, type StorageState, type StoredTask, type Workspace } from '../contracts/task-storage';
const hash = (text:string|Buffer) => createHash('sha256').update(text).digest('hex');
const uuid = z.uuid(), stamp = z.iso.datetime();
const manifestSchema = z.object({ version:z.literal(1), generation:uuid, committedAt:stamp, workspace:workspaceSchema,
  paths:z.array(z.object({id:uuid,title:z.string().max(256),updatedAt:stamp,nodes:z.number().int().min(1).max(32),bytes:z.number().int().min(1).max(PATH_BYTES),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(PATH_LIMIT)
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
type Task = { task:StoredTask; text:string; title:string; updatedAt:string };
/** Recall by the active query (or page), not an identical generic judgment label. */
function recallTitle(task:StoredTask):string {
  let node=task.nodes.find(n=>n.id===task.currentId);
  const fallback=node?.step.label || '浏览路径';
  while(node){
    const query=node.step.context?.query || node.metadata.searchContext?.query;
    if(query)return Array.from(query).slice(0,100).join('');
    if(node.step.kind==='page' && node.step.target)return Array.from(node.step.target).slice(0,100).join('');
    node=task.nodes.find(n=>n.id===node!.parentId);
  }
  return Array.from(fallback).slice(0,100).join('');
}
export type CommitPoint = 'data-written'|'before-manifest'|'after-manifest'|'before-cleanup';
/** One writer; a generation is visible only through its committed manifest. Never scans old generations for recovery. */
export class TaskRepository {
  private tasks = new Map<string,Task>();
  private deleted = new Set<string>();
  private workspace:Workspace = {windows:[],active:0};
  private revision = 0;
  private committed = 0;
  private worker?:Promise<void>;
  private timer?:ReturnType<typeof setTimeout>;
  private status:StorageState['status'] = 'ready';
  private message?:string;
  private generation?:string;
  private committedAt?:string;
  private blocked = false;
  private captureFailure = false;
  writes = 0;
  constructor(readonly directory:string, private changed:()=>void = ()=>{}, private options:{delay?:number;checkpoint?:(point:CommitPoint)=>Promise<void>}={}) {}
  state():StorageState { return {status:this.status,message:this.message,generation:this.generation,committedAt:this.committedAt,
    paths:[...this.tasks.values()].map(t=>({id:t.task.id,title:t.title,step:t.task.nodes.find(n=>n.id===t.task.currentId)?.step.label,updatedAt:t.updatedAt,nodes:t.task.nodes.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),limit:PATH_LIMIT,bytes:[...this.tasks.values()].reduce((n,t)=>n+Buffer.byteLength(t.text),0)}; }
  private notify(status:StorageState['status'],message?:string) { const changed=this.status!==status||this.message!==message;this.status=status;this.message=message;if(changed)this.changed(); }
  private async read(file:string,max:number):Promise<Buffer> { const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw new Error('Invalid task file');const data=await fs.readFile(file);if(data.length>max)throw new Error('Task file too large');return data; }
  async load():Promise<Workspace> {
    let data:Buffer;
    try {const directory=await fs.lstat(this.directory);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('Invalid directory');data=await this.read(path.join(this.directory,'manifest.json'),128*1024);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){
      const files=await fs.readdir(this.directory).catch(()=>[]);if(files.some(name=>/^gen-[a-f0-9-]{36}$/.test(name))){this.blocked=true;this.notify('blocked','恢复清单缺失；已有任务文件已保留，本轮不覆盖保存空间。');}return this.workspace;}this.blocked=true;this.notify('blocked','保存空间不可读，原文件已保留；本轮继续浏览，但不覆盖它。');return this.workspace;}
    try {
      const manifest=manifestSchema.parse(JSON.parse(data.toString('utf8')));
      if(new Set(manifest.paths.map(t=>t.id)).size!==manifest.paths.length||manifest.paths.reduce((n,t)=>n+t.bytes,0)>TOTAL_BYTES)throw new Error('Invalid catalog');
      this.generation=manifest.generation;this.committedAt=manifest.committedAt;
      const generationDirectory=await fs.lstat(path.join(this.directory,`gen-${manifest.generation}`));if(!generationDirectory.isDirectory()||generationDirectory.isSymbolicLink())throw new Error('Invalid generation directory');
      let damaged=false;
      for(const meta of manifest.paths){try{
        const text=await this.read(path.join(this.directory,`gen-${manifest.generation}`,`${meta.id}.json`),PATH_BYTES);
        if(text.length!==meta.bytes||hash(text)!==meta.hash)throw new Error('Hash mismatch');const task=parseTask(JSON.parse(text.toString('utf8')));
        if(task.id!==meta.id||task.nodes.length!==meta.nodes)throw new Error('Task mismatch');this.tasks.set(task.id,{task,text:JSON.stringify(task),title:recallTitle(task),updatedAt:meta.updatedAt});
      }catch{damaged=true;}}
      this.validateWorkspace(manifest.workspace,new Set(manifest.paths.map(p=>p.id)));
      this.workspace={windows:manifest.workspace.windows.map(w=>{const paths=w.paths.filter(id=>this.tasks.has(id));return {paths,selected:paths.includes(w.selected)?w.selected:paths[0]};}).filter(w=>w.paths.length),active:0};
      const activeSelected=manifest.workspace.windows[manifest.workspace.active]?.selected;const active=this.workspace.windows.findIndex(w=>w.paths.includes(activeSelected));this.workspace.active=Math.max(0,active);
      if(damaged){this.blocked=true;this.notify('blocked','部分路径损坏或缺失；已隔离并保留原文件。本轮可查看其余路径，但不覆盖保存空间。');}
      else {await this.cleanup();this.notify('saved');}
    }catch{this.blocked=true;this.notify('blocked','保存格式未知或清单损坏；原文件已保留。本轮可继续浏览，但不覆盖保存空间。');}
    return this.workspace;
  }
  get(id:string):StoredTask {const item=this.tasks.get(id);if(!item||this.deleted.has(id))throw new Error('这条路径已删除或未保存');return parseTask(item.task);}
  private validateWorkspace(workspace:Workspace,ids:Set<string>) {
    const all=workspace.windows.flatMap(w=>w.paths);
    if(new Set(all).size!==all.length||workspace.windows.some(w=>!w.paths.length||!w.paths.includes(w.selected)||w.paths.some(id=>!ids.has(id)))||workspace.windows.length&&workspace.active>=workspace.windows.length)throw new Error('Invalid workspace references');
  }
  receive(raw:StoredTask):boolean {
    if(this.blocked||this.deleted.has(raw.id))return true;
    try{
      const old=this.tasks.get(raw.id);const present=new Set(raw.records.map(r=>r.key));const referenced=new Set(raw.nodes.flatMap(n=>Object.values(n.references)));
      // Memory eviction is not a request to delete already committed task answers or notes.
      const records=[...raw.records,...(old?.task.records.filter(r=>referenced.has(r.key)&&!present.has(r.key))??[])].sort((a,b)=>a.key.localeCompare(b.key));
      const task=parseTask({...raw,records});const text=JSON.stringify(task);if(old?.text===text)return true;
      this.tasks.set(task.id,{task,text,title:recallTitle(task),updatedAt:new Date().toISOString()});this.dirty();return true;
    }catch{this.captureFailure=true;this.notify('error','有路径超出保存范围或容量；更改仍在内存，尚未保存。请保留窗口并处理后重试。');return false;}
  }
  captureError() {this.captureFailure=true;this.notify('error','路径快照未能完成；更改仍在内存，尚未保存。');}
  beginCapture() {this.captureFailure=false;}
  setWorkspace(raw:Workspace) {
    if(this.blocked)return;const workspace=workspaceSchema.parse(raw);
    if(JSON.stringify(workspace)!==JSON.stringify(this.workspace)){this.workspace=workspace;this.dirty();}
  }
  isDeleted(id:string):boolean {return this.deleted.has(id);}
  private dirty() {this.revision++;if(!this.captureFailure)this.notify('dirty');clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},this.options.delay??500);this.timer.unref();}
  async flush():Promise<void> {
    clearTimeout(this.timer);
    if(this.blocked||this.captureFailure)throw new Error(this.message||'本地保存不可用');
    if(this.worker){await this.worker;return this.flush();}
    this.worker=this.drain();try{await this.worker;}finally{this.worker=undefined;}
  }
  private async drain() {
    let staging:string|undefined;
    try{while(this.committed<this.revision){if(this.captureFailure)throw new Error('Snapshot not ready');
      const revision=this.revision;const items=[...this.tasks.values()].filter(t=>!this.deleted.has(t.task.id));
      const bytes=items.reduce((n,t)=>n+Buffer.byteLength(t.text),0);if(items.length>PATH_LIMIT||bytes>TOTAL_BYTES)throw new Error('Task capacity exceeded');
      this.validateWorkspace(this.workspace,new Set(items.map(t=>t.task.id)));
      const generation=randomUUID();staging=generation;const manifest:Manifest={version:1,generation,committedAt:new Date().toISOString(),workspace:structuredClone(this.workspace),paths:items.map(t=>({id:t.task.id,title:t.title,updatedAt:t.updatedAt,nodes:t.task.nodes.length,bytes:Buffer.byteLength(t.text),hash:hash(t.text)}))};
      this.notify('saving');await fs.mkdir(this.directory,{recursive:true,mode:0o700});const root=await fs.lstat(this.directory);if(!root.isDirectory()||root.isSymbolicLink())throw new Error('Invalid directory');
      const directory=path.join(this.directory,`gen-${generation}`);await fs.mkdir(directory,{mode:0o700});
      for(const t of items)await this.write(path.join(directory,`${t.task.id}.json`),t.text);
      await this.options.checkpoint?.('data-written');await this.syncDirectory(directory);
      const temporary=path.join(this.directory,`manifest.tmp-${generation}`);await this.write(temporary,JSON.stringify(manifest));await this.options.checkpoint?.('before-manifest');
      await fs.rename(temporary,path.join(this.directory,'manifest.json'));this.generation=generation;this.committedAt=manifest.committedAt;this.writes++;
      await this.syncDirectory(this.directory);await this.options.checkpoint?.('after-manifest');await this.options.checkpoint?.('before-cleanup');await this.cleanup();
      this.committed=revision;
    }this.notify('saved');}
    catch {if(staging && staging!==this.generation){await fs.rm(path.join(this.directory,`gen-${staging}`),{recursive:true,force:true}).catch(()=>{});await fs.rm(path.join(this.directory,`manifest.tmp-${staging}`),{force:true}).catch(()=>{});}
      this.notify('error','本地保存或清理未完成；当前更改仍在内存。请重试，未确认的新状态可能无法恢复。');throw new Error(this.message);}
  }
  private async write(file:string,text:string) {const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}}
  private async syncDirectory(directory:string) {let handle;try{handle=await fs.open(directory,'r');await handle.sync();}catch(error){if(!['EINVAL','ENOTSUP','EISDIR','EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;}finally{await handle?.close();}}
  private async cleanup() {
    const owned=/^(?:gen-[a-f0-9-]{36}|manifest\.tmp-[a-f0-9-]{36})$/;
    for(const name of await fs.readdir(this.directory))if(owned.test(name)&&name!==`gen-${this.generation}`)await fs.rm(path.join(this.directory,name),{recursive:true,force:true});
  }
  async deletePath(id:string) {
    if(this.blocked)throw new Error('保存空间处于保护状态，未删除原文件');
    if(!this.tasks.has(id)&&!this.deleted.has(id))throw new Error('路径已变化，请刷新列表');
    this.deleted.add(id);this.tasks.delete(id);
    this.workspace={windows:this.workspace.windows.map(w=>{const paths=w.paths.filter(p=>p!==id);return{paths,selected:paths.includes(w.selected)?w.selected:paths[0]};}).filter(w=>w.paths.length),active:0};
    this.dirty();await this.flush();
  }
}
