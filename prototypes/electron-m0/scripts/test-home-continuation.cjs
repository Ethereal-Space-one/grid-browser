// Compiled production code with synthetic local sources. No native UI or external requests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
const {createRequire}=Module;
const deps=process.env.GRID_TEST_DEPENDENCY_PATH || path.join(__dirname,'quote-regression/deps');
const {JSDOM}=createRequire(path.join(path.resolve(deps),'package.json'))('jsdom');
const {BrowsingSession}=require('../dist/application/browsing-session.js');
const {TaskRepository}=require('../dist/storage/task-repository.js');
const {taskContinuation}=require('../dist/contracts/task-storage.js');
const {storageResumeSchema}=require('../dist/contracts/browsing.js');
let BrowserTab,WindowRegistry;const load=Module._load;
try{Module._load=function(name,...args){return name==='electron'?{}:load.call(this,name,...args);};({BrowserTab,WindowRegistry}=require('../dist/browser/window-registry.js'));}finally{Module._load=load;}
const hit={title:'合成资料',url:'https://example.invalid/source',site:'example.invalid',snippet:'合成摘要',date:null};
const provider={search:async()=>[hit],read:async()=>({title:hit.title,content:'合成公开正文。'}),extract:async()=>{throw Error('unexpected model');}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function substantive(){const s=new BrowsingSession(provider,()=>{});await s.search('合成探索','learning',false);return s;}

test('only completed substantive visible nodes offer a continuation, preserving exact stopping entry across Home/root and restart',async()=>{
 const s=new BrowsingSession(provider,()=>{});assert.equal(taskContinuation(s.exportTask()),undefined);
 s.setScene('living');const initial=s.snapshot();s.savePresentation(initial.entryId,{...initial.presentation,homeQuery:'尚未提交的草稿'});
 assert.equal(taskContinuation(s.exportTask()),undefined,'scene/draft changes are not exploration history');
 await s.search('合成探索','learning',false);const results=s.snapshot();s.home();
 assert.deepEqual(taskContinuation(s.exportTask()),{entryId:results.entryId,title:'合成探索',step:'搜索结果'});
 s.jump(s.snapshot().path.rootId);assert.equal(taskContinuation(s.exportTask()).entryId,results.entryId,'root remembers only its selected branch');
 s.removeNode(results.entryId);assert.equal(taskContinuation(s.exportTask()),undefined,'removed steps are not suggested');s.undoRemoval();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grid-home-test-'));const repo=new TaskRepository(dir);repo.receive(s.exportTask());await repo.flush();
 const reopened=new TaskRepository(dir);await reopened.load();assert.equal(reopened.state().paths[0].continuation.entryId,results.entryId);
 await reopened.deletePath(s.snapshot().path.id);assert.deepEqual(reopened.state().paths,[]);fs.rmSync(dir,{recursive:true});
});

test('cancelled/failed-only paths are not substantive and continuation titles do not expose judgment note text',async()=>{
 const s=await substantive();const original=s.snapshot();
 s.home();const t=s.exportTask();t.nodes.find(n=>n.id===original.entryId).step.status='cancelled';assert.equal(taskContinuation(t),undefined);
 t.nodes.find(n=>n.id===original.entryId).step.status='failed';assert.equal(taskContinuation(t),undefined);
 t.nodes.find(n=>n.id===original.entryId).step.status='ready';
 t.nodes.find(n=>n.id===original.entryId).step.kind='judgment';t.nodes.find(n=>n.id===original.entryId).step.label='我的判断';
 assert.equal(taskContinuation(t).title,'合成探索');assert.equal(taskContinuation(t).step,'我的判断');
 assert.equal(storageResumeSchema.safeParse({nodeId:'n',ownerId:'o',entryId:'e',url:hit.url}).success,false);
 assert.equal(storageResumeSchema.safeParse({nodeId:'n',ownerId:'o'}).success,false);
});

function nativeHost(){let refresh=0,revokes=0;const host={refresh(){refresh++;},registry:{bridge:()=>({revoke(){revokes++;}})},tabs:{active:()=>tab}};host.registry.target=host;const tab=new BrowserTab(host,provider);return {host,tab,refresh:()=>refresh,revokes:()=>revokes};}

test('native Home continuation jumps saved context but never calls native load/history/model/action/grant, including a lost POST position',async()=>{
 const f=nativeHost(),{tab}=f;tab.browsing.open(hit.url);const page=tab.browsing.snapshot();tab.browsing.home();
 let forbidden=0;const fail=()=>{forbidden++;assert.fail('resume must not navigate or execute');};
 tab.view={webContents:{isDestroyed:()=>false,isLoadingMainFrame:()=>false,getURL:()=>hit.url,navigationHistory:{getActiveIndex:()=>0,length:()=>1,goToIndex:fail},loadURL:fail,reload:fail}};
 tab.restorePage=fail;tab.open=fail;tab.action.confirm=fail;
 tab.resumeStoredNode(page.entryId);assert.equal(tab.browsing.snapshot().entryId,page.entryId);assert.equal(tab.recovery.kind,'history-lost');
 assert.equal(tab.recovery.nodeId,page.entryId);assert.match(tab.recovery.message,/尚未加载.*不重发表单.*旧授权/);assert.equal(forbidden,0);assert.ok(f.revokes()>0);
});

test('only an exactly-current retained native view may be shown without recovery; stale target rejects before invalidation',()=>{
 const f=nativeHost(),{tab}=f;tab.browsing.open(hit.url);const page=tab.browsing.snapshot();
 tab.browsing.navigated(hit.url,0,true,'retained');tab.position=()=>({index:0,url:hit.url,length:1});tab.visits={resolve:()=>({id:'retained',index:0,url:hit.url,method:'GET'})};
 tab.resumeStoredNode(page.entryId);assert.equal(tab.recovery,undefined);
 const before=tab.browsing.snapshot(),revokes=f.revokes();assert.throws(()=>tab.resumeStoredNode('foreign'));assert.strictEqual(tab.browsing.snapshot(),before);assert.equal(f.revokes(),revokes);
});

test('guarded restore rejects stale owner/entry, non-home, pending and temporary origins before touching unrelated authority; legacy restore stays unchanged',async()=>{
 for(const scenario of ['owner','entry','mode','pending','temporary']) {
  let touched=0;const state={ownerId:'owner',entryId:'home',mode:'home'};
  if(scenario==='mode')state.mode='results';if(scenario==='pending')state.pending={id:'request'};
  const host={active:{persistent:scenario!=='temporary',browsing:{snapshot:()=>state}}};
  const registry={all(){touched++;throw Error('must reject before enumerating targets');}};
  await assert.rejects(WindowRegistry.prototype.restoreTask.call(registry,'target',host,{ownerId:scenario==='owner'?'stale':'owner',entryId:scenario==='entry'?'stale':'home',nodeId:'node'}));assert.equal(touched,0);
 }
 let selected=0,focused=0;const tab={id:'tab',browsing:{snapshot:()=>({path:{id:'target'}})}};
 const win={tabs:{all:()=>[tab]},select:()=>selected++,win:{show(){},focus(){focused++;}}};
 await WindowRegistry.prototype.restoreTask.call({all:()=>[win],chooseTarget(){}},'target',{});
 assert.equal(selected,1);assert.equal(focused,1);
});

async function rendererFixture(){
 const host=await substantive();host.home();let state,calls=[],requests=[],publish;let revision=0,saveResolve;
 const task=host.exportTask(),continued=taskContinuation(task);
 const paths=[{id:'new-blank',title:'首页',updatedAt:'2026-11-16T00:00:01Z',nodes:1},{id:task.id,title:'合成探索',updatedAt:'2026-11-16T00:00:00Z',nodes:task.nodes.length,continuation:continued},{id:'older',title:'旧记录',updatedAt:'2026-11-15T00:00:00Z',nodes:2,continuation:{entryId:'old',title:'旧记录',step:'网站原页'}}];
 function emit(patch={}){state={...host.snapshot(),windowId:1,activeTabId:host.snapshot().ownerId,tabs:[{id:host.snapshot().ownerId,title:'合成探索',mode:'home',pending:false}],keyReady:false,hasResults:true,agentPanelOpen:false,agentTarget:false,pathMapOpen:false,storagePanelOpen:false,storage:{status:'saved',paths,limit:48,bytes:0,persistent:true},layoutId:'fixture',...patch,revision:++revision};publish?.(state);return state;}
 emit();const scripts=[],dir=path.join(__dirname,'../dist/renderer');const html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/g,(_,name)=>{scripts.push(name);return '';});
 const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://grid.invalid/'}),w=dom.window,errors=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};w.ResizeObserver=class{observe(){}};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 w.grid=new Proxy({},{get(_,name){if(name==='state')return async()=>state;if(name==='onState')return callback=>publish=callback;if(name==='onFocusAddress')return()=>{};return async(...args)=>{calls.push([name,...args]);if(name==='submit')requests.push(args[0]);if(name==='savePresentation' && saveResolve)return new Promise(resolve=>saveResolve(resolve));return true;};}});
 w.addEventListener('error',e=>errors.push(e.error));w.eval(scripts.map(name=>fs.readFileSync(path.join(dir,name),'utf8')).join('\n'));await tick();
 return {w,d:w.document,host,calls,requests,emit,paths,state:()=>state,saveGate:callback=>saveResolve=callback,close(){dom.window.close();assert.deepEqual(errors,[]);}};
}

test('home renders one quiet continue entry with title and stopping step, never requests on display, and hides it for empty history/temp/non-home',async()=>{
 const f=await rendererFixture();try{const {d,calls}=f;assert.equal(d.querySelector('#home-resume').hidden,false);assert.equal(d.querySelectorAll('#home-resume-button').length,1);assert.equal(d.querySelector('#home-resume-title').textContent,'合成探索');assert.equal(d.querySelector('#home-resume-step').textContent,'停在：搜索结果');assert.equal(calls.filter(c=>c[0]==='storageRestore').length,0);assert.equal(f.requests.length,0);assert.match(d.querySelector('#welcome').textContent,/五种场景只是可选.*不必先选/);
 f.emit({storage:{...f.state().storage,persistent:false}});assert.equal(d.querySelector('#home-resume').hidden,true);d.querySelector('#home-resume-button').click();await tick();assert.equal(calls.filter(c=>c[0]==='storageRestore').length,0);
 f.emit({storage:{...f.state().storage,persistent:true,paths:[f.paths[0]]}});assert.equal(d.querySelector('#home-resume').hidden,true);
 f.emit({mode:'results'});assert.equal(d.querySelector('#home-resume').hidden,true);
 }finally{f.close();}
});

test('explicit continue sends one strictly-bound trusted restore, suppresses double click, and never calls jump/open/reopen/model/grant',async()=>{
 const f=await rendererFixture();try{let release;f.saveGate(resolve=>release=resolve);const {d,calls}=f;d.querySelector('#home-resume-button').click();d.querySelector('#home-resume-button').click();await tick();assert.equal(d.querySelector('#home-resume-button').disabled,true);release(true);await tick();await tick();
 const restores=calls.filter(c=>c[0]==='storageRestore');assert.equal(restores.length,1);assert.deepEqual(JSON.parse(JSON.stringify(restores[0])),['storageRestore',f.paths[1].id,{nodeId:f.paths[1].continuation.entryId,ownerId:f.state().ownerId,entryId:f.state().entryId}]);assert.equal(calls.filter(c=>/^(jump|open|reopenPage|read|summarize|agentGrant|actionConfirm)$/.test(c[0])).length,0);
 }finally{f.close();}
});

test('a tab/entry change during draft save cancels continuation before any restore',async()=>{
 const f=await rendererFixture();try{let release;f.saveGate(resolve=>release=resolve);f.d.querySelector('#home-resume-button').click();await tick();f.emit({ownerId:'new-owner',entryId:'new-home'});release(true);await tick();assert.equal(f.calls.filter(c=>c[0]==='storageRestore').length,0);}finally{f.close();}
});

test('empty home submit stays local, announces 输入问题或网址 and focuses the field; input clears error and IME submit is ignored',async()=>{
 const f=await rendererFixture();try{const {d,w,calls}=f,field=d.querySelector('#home-query'),form=d.querySelector('#home-search');field.value='  ';d.querySelector('#home-resume-button').focus();form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(d.querySelector('#home-query-error').textContent,'输入问题或网址');assert.equal(d.querySelector('#home-query-error').hidden,false);assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(d.activeElement,field);assert.equal(calls.filter(c=>c[0]==='submit').length,0);
 field.value='合成问题';field.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.querySelector('#home-query-error').hidden,true);field.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(calls.filter(c=>c[0]==='submit').length,0);field.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true}));form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(calls.filter(c=>c[0]==='submit').length,1);
 }finally{f.close();}
});
