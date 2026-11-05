import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import { TaskRepository, type CommitPoint } from './storage/task-repository';
import { parseTask, PATH_BYTES, type StoredTask } from './contracts/task-storage';
const RAW='RAW_SOURCE_SECRET_7428', FORBIDDEN='RUNTIME_AUTHORITY_SECRET_8391';
const provider=():BrowsingProvider=>({search:async()=>[{title:'合成结果',url:'https://example.com/a',snippet:'合成摘要。',site:'example.com',date:null}],read:async()=>({title:'合成正文',content:'公开结论：仅适用于个人。\n'+RAW,cookie:FORBIDDEN,key:FORBIDDEN} as any),extract:async()=>({text:'仅适用于个人。',truncated:false}),model:async()=>({text:'AI 说明：需要核对适用范围。',insufficient:false,citations:[{source:1,title:'合成正文',url:'https://example.com/a',quote:'仅适用于个人。'}]})});
async function fixture(){const s=new BrowsingSession(provider(),()=>{});await s.search('合成查询','learning',false);await s.read('https://example.com/a');s.beginQuestion();await s.ask('适用于谁？',s.snapshot().question!.id);const q=s.snapshot();s.savePresentation(q.entryId,{...q.presentation,questionDraft:'下一次要问的问题'});s.beginJudgment();let j=s.snapshot().judgment!;s.editJudgment({draftId:j.draftId,revision:1,text:'我的判断：先核对适用范围。',checks:'确认更新日期。',citationIds:[j.citations[0].id]});j=s.snapshot().judgment!;s.saveJudgment({draftId:j.draftId,revision:j.revision});return{s,task:s.exportTask(),question:q};}
const directory=()=>fs.mkdtemp(path.join(tmpdir(),'grid-task-unit-'));
const workspace=(t:StoredTask)=>({windows:[{paths:[t.id],selected:t.id}],active:0});
const attach=(r:TaskRepository,t:StoredTask)=>{r.beginCapture();r.receive(t);r.setWorkspace(workspace(t));};
async function allText(dir:string):Promise<string>{let text='';for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);text+=entry.isDirectory()?await allText(p):await fs.readFile(p,'utf8');}return text;}

test('recent records recall the active query and step after restart without exposing personal note text as a title',async()=>{
 const {s,task}=await fixture();const dir=await directory();const r=new TaskRepository(dir);attach(r,task);await r.flush();
 assert.equal(r.state().paths[0].title,'合成查询');assert.ok(r.state().paths[0].step?.includes('判断'));assert.ok(!r.state().paths[0].title.includes('我的判断：'));
 const reopened=new TaskRepository(dir);await reopened.load();assert.equal(reopened.state().paths[0].title,'合成查询');
 await s.search('🧭'.repeat(110),'learning',false);reopened.receive(s.exportTask());await reopened.flush();
 assert.equal(reopened.state().paths[0].title,'🧭'.repeat(100));
 const again=new TaskRepository(dir);await again.load();assert.equal(again.state().paths[0].title,'🧭'.repeat(100));
});

test('storage whitelist preserves authored tasks, branches and versions but excludes raw bodies and runtime authority',async()=>{
 const {s,task,question}=await fixture();const json=JSON.stringify(task);assert.ok(!json.includes(RAW));assert.ok(!json.includes(FORBIDDEN));assert.ok(!json.includes('nativeVisitId'));assert.ok(!json.includes('ownerId'));assert.ok(json.includes('下一次要问的问题'));assert.ok(json.includes('我的判断：'));
 const restored=new BrowsingSession(provider(),()=>{},undefined,parseTask(JSON.parse(json)));assert.notEqual(restored.snapshot().ownerId,s.snapshot().ownerId);assert.equal(restored.snapshot().path.id,s.snapshot().path.id);assert.equal(restored.snapshot().entryId,s.snapshot().entryId);assert.equal(restored.snapshot().judgment!.text,s.snapshot().judgment!.text);assert.equal(restored.snapshot().pending,undefined);assert.equal(restored.snapshot().comparisonSelection.length,0);
 restored.jump(question.entryId);assert.equal(restored.snapshot().presentation.questionDraft,'下一次要问的问题');assert.equal(restored.snapshot().question!.source!.text,'');assert.equal(restored.snapshot().question!.source!.released,true);restored.beginJudgment();assert.equal(restored.snapshot().judgment!.citations.length,1);
});
test('task parser rejects unknown fields, forged references, orphan cycles, oversized and unknown-version formats',async()=>{
 const {task}=await fixture();for(const mutate of [(t:any)=>t.version=2,(t:any)=>t.key=FORBIDDEN,(t:any)=>t.nodes[0].metadata.nativeIndex=1,(t:any)=>t.nodes[0].childIds.push(t.rootId),(t:any)=>t.nodes.at(-1).selectedChildId=t.rootId,(t:any)=>t.records[0].key='reading:forged',(t:any)=>t.records[0].value.content=RAW,(t:any)=>t.nodes.at(-1).references.judgment='question:forged']){const clone=structuredClone(task);mutate(clone);assert.throws(()=>parseTask(clone));}
 const clone=structuredClone(task);const note=clone.records.find(r=>r.kind==='judgment')!;if(note.kind==='judgment')note.value.citationIds=['forged'];assert.throws(()=>parseTask(clone));assert.ok(Buffer.byteLength(JSON.stringify(task))<PATH_BYTES);
});
test('generation commit restores through a new repository, hashes each path and removes obsolete generations',async()=>{
 const dir=await directory();const {s,task}=await fixture();const r=new TaskRepository(dir);await r.load();attach(r,task);await r.flush();assert.equal(r.state().status,'saved');assert.equal(r.writes,1);
 s.home();attach(r,s.exportTask());await r.flush();assert.equal(r.writes,2);const other=new TaskRepository(dir);const w=await other.load();assert.equal(w.windows[0].selected,task.id);assert.equal(other.get(task.id).currentId,s.snapshot().entryId);assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('gen-')).length,1);assert.ok(!(await allText(dir)).includes(RAW));
});
test('single writer coalesces frequent updates and never acknowledges a newer draft with an older commit',async()=>{
 const dir=await directory();const {s,task}=await fixture();let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);let first=true;
 const repo=new TaskRepository(dir,()=>{},{checkpoint:async point=>{if(point==='data-written'&&first){first=false;entered();await gate;}}});attach(repo,task);const flushing=repo.flush();await ready;
 s.beginJudgment();for(let i=1;i<=20;i++){const j=s.snapshot().judgment!;s.editJudgment({draftId:j.draftId,revision:i,text:'最新判断'+i,checks:'',citationIds:[]});attach(repo,s.exportTask());}assert.notEqual(repo.state().status,'saved');release();await flushing;assert.equal(repo.writes,2);assert.equal(repo.state().status,'saved');const reopened=new TaskRepository(dir);await reopened.load();assert.ok(JSON.stringify(reopened.get(task.id)).includes('最新判断20'));
});
test('interruption at each commit boundary recovers only the pointed generation and never scans a backup to resurrect data',async()=>{
 for(const point of ['data-written','before-manifest','after-manifest','before-cleanup'] as CommitPoint[]){const dir=await directory();const {s,task}=await fixture();const original=new TaskRepository(dir);attach(original,task);await original.flush();s.home();const next=s.exportTask();const failing=new TaskRepository(dir,()=>{},{checkpoint:async p=>{if(p===point)throw new Error('synthetic interruption');}});await failing.load();attach(failing,next);await assert.rejects(failing.flush());assert.equal(failing.state().status,'error');
 const reader=new TaskRepository(dir);await reader.load();assert.equal(reader.get(task.id).currentId,['after-manifest','before-cleanup'].includes(point)?next.currentId:task.currentId);assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('gen-')).length,1);}
});
test('delete waits for an older writer, removes every obsolete copy and rejects stale reinsertions',async()=>{
 const dir=await directory();const {task}=await fixture();const other=new BrowsingSession(provider(),()=>{}).exportTask();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);let first=true;
 const r=new TaskRepository(dir,()=>{},{checkpoint:async p=>{if(p==='data-written'&&first){first=false;entered();await gate;}}});attach(r,task);r.receive(other);const writing=r.flush();await ready;const deletion=r.deletePath(task.id);r.receive(task);release();await Promise.all([writing,deletion]);assert.throws(()=>r.get(task.id));assert.ok(!(await allText(dir)).includes('我的判断：'));assert.ok(r.get(other.id));const reader=new TaskRepository(dir);await reader.load();assert.throws(()=>reader.get(task.id));assert.ok(reader.get(other.id));
});
test('missing or damaged content is isolated without overwriting the unique originals; unknown schemas are protected',async()=>{
 for(const kind of ['missing','damaged','future'] as const){const dir=await directory();const {task}=await fixture();const r=new TaskRepository(dir);attach(r,task);await r.flush();const file=path.join(dir,'manifest.json');const before=await fs.readFile(file);const manifest=JSON.parse(before.toString());const body=path.join(dir,'gen-'+manifest.generation,task.id+'.json');if(kind==='missing')await fs.unlink(body);else if(kind==='damaged')await fs.writeFile(body,'{"partial":');else{manifest.version=99;await fs.writeFile(file,JSON.stringify(manifest));}
 const original=await fs.readFile(file);const broken=new TaskRepository(dir);await broken.load();assert.equal(broken.state().status,'blocked');broken.receive(new BrowsingSession(provider(),()=>{}).exportTask());await assert.rejects(broken.flush());assert.deepEqual(await fs.readFile(file),original);}
});
test('read-only failure and quota rejection remain visible and keep the most recent committed generation',async()=>{
 const dir=await directory();const {s,task}=await fixture();let simulate=false;const r=new TaskRepository(dir,()=>{},{checkpoint:async p=>{if(simulate&&p==='before-manifest')throw new Error('synthetic denied write');}});attach(r,task);await r.flush();const file=path.join(dir,'manifest.json');const original=await fs.readFile(file);if(process.platform==='win32')simulate=true;else await fs.chmod(dir,0o500);try{s.home();attach(r,s.exportTask());await assert.rejects(r.flush());assert.equal(r.state().status,'error');assert.deepEqual(await fs.readFile(file),original);}finally{simulate=false;if(process.platform!=='win32')await fs.chmod(dir,0o700);}await r.flush();assert.equal(r.state().status,'saved');
 const oversized=structuredClone(task);const hit={title:'x',url:'https://example.com',snippet:'界'.repeat(16000),site:'example.com',date:null};const result=oversized.records.find(x=>x.kind==='search')!;if(result.kind==='search')result.value.results=Array.from({length:100},()=>hit);attach(r,oversized);assert.equal(r.state().status,'error');await assert.rejects(r.flush());
});
test('restored public text is explicitly re-fetched in a new question version, never silently used as empty evidence',async()=>{
 const {task,question}=await fixture();let reads=0;const p=provider();const original=p.read;p.read=async(...args)=>{reads++;return original(...args);};const restored=new BrowsingSession(p,()=>{},undefined,task);restored.jump(question.entryId);assert.equal(reads,0);await restored.ask('再问适用范围',restored.snapshot().question!.id);assert.equal(reads,1);assert.notEqual(restored.snapshot().entryId,question.entryId);assert.ok(!restored.snapshot().question!.source!.released);restored.jump(question.entryId);assert.equal(restored.snapshot().question!.source!.released,true);
});

test('abrupt child-process exits before and after manifest commit recover only the last committed state',async()=>{
 for(const point of ['data-written','before-manifest','after-manifest','before-cleanup']){const dir=await directory();const {s,task}=await fixture();const original=new TaskRepository(dir);attach(original,task);await original.flush();s.home();const next=s.exportTask();const nextFile=path.join(await directory(),'next.json');await fs.writeFile(nextFile,JSON.stringify(next));
 const code=`const fs=require('node:fs');const {TaskRepository}=require(${JSON.stringify(path.join(__dirname,'storage/task-repository.js'))});(async()=>{const r=new TaskRepository(${JSON.stringify(dir)},()=>{},{checkpoint:async p=>{if(p===${JSON.stringify(point)})process.exit(77);}});await r.load();r.receive(JSON.parse(fs.readFileSync(${JSON.stringify(nextFile)},'utf8')));await r.flush();process.exit(2);})()`;
 await assert.rejects(promisify(execFile)(process.execPath,['-e',code]),(error:any)=>error.code===77);const recovered=new TaskRepository(dir);await recovered.load();assert.equal(recovered.get(task.id).currentId,['after-manifest','before-cleanup'].includes(point)?next.currentId:task.currentId);
 }
});
test('a missing manifest never causes existing generation files to be silently discarded',async()=>{
 const dir=await directory();const {task}=await fixture();const r=new TaskRepository(dir);attach(r,task);await r.flush();await fs.unlink(path.join(dir,'manifest.json'));const before=await allText(dir);const fresh=new TaskRepository(dir);await fresh.load();assert.equal(fresh.state().status,'blocked');await assert.rejects(fresh.flush());assert.equal(await allText(dir),before);
});

test('catalog count and aggregate byte quotas reject new commits without deleting previously committed paths',async()=>{
 for(const kind of ['count','bytes']){const dir=await directory();const {task}=await fixture();const r=new TaskRepository(dir);attach(r,task);await r.flush();const committed=await fs.readFile(path.join(dir,'manifest.json'));
 for(let i=0;i<(kind==='count'?48:16);i++){const copy=structuredClone(task);copy.id=randomUUID();if(kind==='bytes'){const search=copy.records.find(r=>r.kind==='search')!;if(search.kind==='search')search.value.results=Array.from({length:100},()=>({title:'合成容量资料',url:'https://example.com',site:'example.com',date:null,snippet:'x'.repeat(16000)}));}assert.ok(r.receive(copy));}
 await assert.rejects(r.flush());assert.equal(r.state().status,'error');assert.deepEqual(await fs.readFile(path.join(dir,'manifest.json')),committed);const reader=new TaskRepository(dir);await reader.load();assert.equal(reader.state().paths.length,1);assert.equal(reader.get(task.id).id,task.id);
 }
});
