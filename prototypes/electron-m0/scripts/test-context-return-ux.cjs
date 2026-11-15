// Production DOM/IPC wiring with synthetic state and services, no native window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const deps = process.env.GRID_TEST_DEPENDENCY_PATH || path.join(__dirname, 'quote-regression/deps');
const { JSDOM } = createRequire(path.join(path.resolve(deps), 'package.json'))('jsdom');
const { BrowsingSession } = require('../dist/application/browsing-session.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const a = 'https://example.invalid/previous', b = 'https://example.invalid/failed';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture() {
  const calls = [], requests = [], errors = [];
  const host = new BrowsingSession({
    search: async () => { requests.push('search'); throw Error('请先在首页配置搜索服务'); },
    read: async url => { requests.push(['read',url]); if(url===b)throw Error('Fetch failed'); return {title:'Previous synthetic source',content:'Only the previous fixed content.'}; },
    extract: async () => assert.fail('no extraction'), model: async () => assert.fail('no model')
  }, () => emit());
  let revision = 0, state, publish, keyReady = true, saveGate;
  const full = patch => ({ ...host.snapshot(), windowId: 1, activeTabId: host.snapshot().ownerId,
    tabs: [{id:host.snapshot().ownerId,title:'Synthetic',mode:host.snapshot().mode,pending:false}],
    keyReady,hasResults:false,agentPanelOpen:false,agentTarget:false,pathMapOpen:false,storagePanelOpen:false,
    storage:{status:'saved',paths:[],limit:48,bytes:0,persistent:true},layoutId:'layout',...patch,revision:++revision });
  function emit(patch) { state=full(patch);publish?.(state);return state; }
  emit();
  const scripts=[],dir=path.join(__dirname,'../dist/renderer');
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/g,(_,file)=>{scripts.push(file);return '';});
  const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://grid.invalid/'}),w=dom.window;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.ResizeObserver=class{observe(){}disconnect(){}};
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.grid=new Proxy({}, {get(_,name){
    if(name==='state')return async()=>state;
    if(name==='onState')return callback=>{publish=callback;};
    if(name==='onFocusAddress')return()=>{};
    return async(...args)=>{
      calls.push([name,...args]);
      if(name==='savePresentation')return saveGate?saveGate.promise:true;
      if(name==='open')return host.open(args[0]);
      if(name==='back')return host.back();
      if(name==='home')return host.home();
      return true;
    };
  }});
  w.addEventListener('error',event=>errors.push(event.error));
  w.eval(scripts.map(file=>fs.readFileSync(path.join(dir,file),'utf8')).join('\n'));
  await tick();
  return {host,calls,requests,w,d:w.document,emit,setKey(value){keyReady=value;emit();},setSaveGate(value){saveGate=value;},state:()=>state,close(){w.close();assert.deepEqual(errors,[]);}};
}

test('quote return remains ID-only and explicit for all terminal quote outcomes, never changing normal Back',async()=>{
  const f=await fixture();try{
    const locator={id:'locator',citationId:'citation',sourceTitle:'Synthetic',sourceUrl:a,status:'ready',message:'Synthetic current site notice',returnLabel:'返回判断'};
    const page=patch=>f.emit({mode:'page',value:a,entryId:'current-page',canGoBack:true,quoteLocator:{...locator,...patch}});
    page();const button=f.d.querySelector('#quote-return');
    assert.equal(button.hidden,false);assert.equal(button.textContent,'返回判断');
    assert.equal(f.calls.filter(c=>c[0]==='quoteReturn').length,0);
    for(const status of ['ready','found','missing','ambiguous','unsupported','uncertain']){
      page({status});button.click();await tick();
      assert.deepEqual(f.calls.filter(c=>c[0]==='quoteReturn').at(-1),['quoteReturn','locator',f.host.snapshot().ownerId,'current-page']);
    }
    page({returnLabel:undefined});assert.equal(button.hidden,true);const before=f.calls.filter(c=>c[0]==='quoteReturn').length;
    button.click();await tick();assert.equal(f.calls.filter(c=>c[0]==='quoteReturn').length,before,'hidden stale capability cannot dispatch');
    f.d.querySelector('#back').click();await tick();assert.equal(f.calls.filter(c=>c[0]==='back').length,1);
    assert.deepEqual(f.requests,[],'rendering statuses and navigating context does not call a provider');
  }finally{f.close();}
});

test('a failed Fetch offers its exact failed-node address, never the retained previous source',async()=>{
  const f=await fixture();try{
    await f.host.read(a);const previous=f.host.snapshot();await assert.rejects(f.host.read(b),/Fetch failed/);await tick();
    const failed=f.host.snapshot();assert.equal(failed.reading.url,a);assert.equal(failed.value,a);
    assert.equal(f.d.querySelector('#failure-exits').hidden,false);assert.equal(f.d.querySelector('#failure-source').textContent,b);
    assert.match(f.d.querySelector('#failure-message').textContent,/上一步.*不是下方地址的正文/);
    assert.equal(f.d.querySelector('#failure-original').hidden,false);assert.deepEqual(f.requests,[['read',a],['read',b]]);
    f.d.querySelector('#failure-original').click();await tick();
    assert.deepEqual(f.calls.filter(c=>c[0]==='open'),[['open',b,failed.ownerId]]);
    assert.equal(f.host.snapshot().mode,'page');assert.equal(f.host.snapshot().value,b);
    f.host.back();assert.equal(f.host.snapshot().entryId,failed.entryId);
    f.d.querySelector('#failure-back').click();await tick();assert.equal(f.host.snapshot().entryId,previous.entryId);
    assert.deepEqual(f.requests,[['read',a],['read',b]],'open/back have no Fetch or model retry');
  }finally{f.close();}
});

test('failed-node links require exact issue/run/node identity and stay unavailable during pending work',async()=>{
  const f=await fixture();try{
    await f.host.read(a);await assert.rejects(f.host.read(b));const failed=f.host.snapshot();
    for(const patch of [
      {issue:{...failed.issue,id:'stale'}},
      {entryId:'foreign'},
      {pending:{id:'new-request',nodeId:failed.entryId,kind:'reading'}},
      {path:{...failed.path,nodes:failed.path.nodes.map(n=>n.id===failed.entryId?{...n,kind:'search'}:n)}},
      {path:{...failed.path,nodes:failed.path.nodes.map(n=>n.id===failed.entryId?{...n,target:'file:///private'}:n)}}
    ]){
      f.emit(patch);assert.equal(f.d.querySelector('#failure-exits').hidden,true);
    }
    f.emit();const gate=deferred();f.setSaveGate(gate);f.d.querySelector('#failure-original').click();
    f.host.home();gate.resolve(true);await tick();assert.equal(f.calls.filter(c=>c[0]==='open').length,0,'a newer navigation wins over delayed save');
  }finally{f.close();}
});

test('no-provider failure offers settings without sending a key, retrying, or entering Agent',async()=>{
  const f=await fixture();try{
    f.setKey(false);await assert.rejects(f.host.search('Synthetic blocked query','professional',false));await tick();
    assert.equal(f.d.querySelector('#failure-exits').hidden,false);assert.equal(f.d.querySelector('#failure-configure').hidden,false);
    assert.match(f.d.querySelector('#failure-message').textContent,/未配置.*不会自动重试/);
    const before=f.requests.length;f.d.querySelector('#failure-configure').click();await tick();
    assert.equal(f.d.querySelector('#provider-settings').open,true);assert.equal(f.d.activeElement.id,'provider-key');
    assert.equal(f.requests.length,before);assert.equal(f.calls.some(c=>['configureKey','agentPanel','read','submit'].includes(c[0])),false);
    assert.equal(new Set([...f.d.querySelectorAll('[id]')].map(n=>n.id)).size,f.d.querySelectorAll('[id]').length);
  }finally{f.close();}
});
