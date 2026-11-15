const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.GRID_JSDOM_PATH || './deps/node_modules/jsdom');
const root = process.env.GRID_SOURCE_ROOT || path.resolve(__dirname, '../..');
const dir = path.join(root, 'dist/renderer');
const { BrowsingSession } = require(path.join(root, 'dist/application/browsing-session.js'));
const snapshot = new BrowsingSession({}, () => {}).snapshot();
const base = { ...snapshot, keyReady: true, hasResults: false, storage: { status: 'saved', paths: [], limit:48, bytes:0, persistent:true }, tabs: [{id:snapshot.ownerId,title:'Fixture',mode:'home',pending:false}], activeTabId: snapshot.ownerId, layoutId: 'layout' };
const tick = () => new Promise(r => setImmediate(r));
function setup(renderer) {
  const scripts = [];
  const html = fs.readFileSync(path.join(dir, renderer === 'svelte' ? 'index-svelte.html' : 'index.html'), 'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/g, (_, file) => { scripts.push(file); return ''; });
  const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://grid.invalid/' });
  const w=dom.window, calls=[]; let state=base,publish,focused=true;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  // A DOM test has no geometry or real native focus: only use this stub to
  // distinguish hidden fallback controls. Native geometry is tested separately.
  w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden],.hidden,[inert]')?[]:[{x:0,y:0,width:32,height:32}];};
  w.document.hasFocus=()=>focused;
  w.ResizeObserver=class {observe(){}disconnect(){}};
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.grid=new Proxy({}, {get(_,name){
    if(name==='state')return async()=>state;
    if(name==='onState')return callback=>{publish=callback;};
    if(name==='onFocusAddress')return()=>{};
    return async(...args)=>{calls.push([name,...args]);return true;};
  }});
  w.eval(scripts.map(file=>fs.readFileSync(path.join(dir,file),'utf8')).join('\n'));
  let revision=0;
  return {w,calls,close:()=>w.close(),nativeFocus:()=>{focused=false;},chromeFocus:()=>{focused=true;},render(patch){state={...base,...patch,revision:++revision};publish(state);return state;}};
}
(async()=>{
 const report=[];
 for(const renderer of ['legacy']){
  const e=setup(renderer),d=e.w.document;
  try{
   await tick();
   const c={id:'fixture-citation',title:'合成来源',url:'https://example.invalid/source',readingId:'fixture-reading',fetchedAt:'2026-11-15T00:00:00Z',truncated:false,quote:'This synthetic quote is only judgment evidence.'};
   const j={id:'fixture-judgment',draftId:'fixture-draft',lineageId:'fixture-lineage',revision:0,status:'draft',version:0,originEntryId:base.entryId,originKind:'question',originRecordId:'fixture-question',scene:'professional',topic:'合成题目',modelNote:'',citations:[c],citationIds:[],text:'合成结论',checks:''};
   e.render({mode:'judgment',judgment:j});
   assert.equal(d.querySelectorAll('.judgment-open-citation').length,1);
   const open=d.querySelector('.judgment-open-citation'),checkbox=d.querySelector('#judgment-references input');
   assert.equal(open.dataset.citationId,c.id);assert.equal(checkbox.checked,false);assert.equal(open.closest('label'),null);
   open.click();await tick();assert.equal(checkbox.checked,false,'open is independent of citation selection');
   assert.deepEqual(e.calls.filter(c=>c[0]==='judgmentOpenCitation').at(-1),['judgmentOpenCitation',c.id,base.ownerId,base.entryId]);
   e.render({mode:'judgment',entryId:'saved-fixture',judgment:{...j,id:'fixture-saved',status:'saved',version:1,citationIds:[c.id],savedAt:c.fetchedAt}});
   assert.equal(d.querySelectorAll('.judgment-open-citation').length,1);assert.equal(d.querySelectorAll('#judgment-references input').length,0);
   report.push(renderer+': saved/draft explicit ID-only open, button outside selection label');
   const locator={id:'fixture-locator',citationId:c.id,sourceTitle:c.title,sourceUrl:c.url,status:'ready',message:'原页已打开。点击定位这段引文后才查找。'};
   const page=patch=>e.render({mode:'page',entryId:'fixture-page',value:c.url,canGoBack:true,quoteLocator:locator,...patch});
   page();
   const bar=d.querySelector('#quote-locator-bar'), locate=d.querySelector('#quote-locate'),close=d.querySelector('#quote-dismiss'),live=d.querySelector('#quote-locator-announcement');
   assert.equal(bar.hidden,false);assert.equal(bar.parentElement.id,'browser-chrome');
   assert.equal(bar.textContent.includes(c.quote),false);assert.equal(bar.contains(live),false);assert.equal(live.getAttribute('aria-live'),'polite');
   if(renderer==='svelte')assert.equal(locate.dataset.icon,'search');
   locate.focus();locate.click();await tick();assert.deepEqual(e.calls.filter(c=>c[0]==='quoteLocate').at(-1),['quoteLocate',locator.id,base.ownerId,'fixture-page']);
   page({quoteLocator:{...locator,status:'locating',message:'正在定位。'}});
   assert.equal(d.activeElement,locate);assert.equal(locate.disabled,false);assert.equal(locate.getAttribute('aria-disabled'),'true');
   const count=e.calls.filter(c=>c[0]==='quoteLocate').length;locate.click();await tick();assert.equal(e.calls.filter(c=>c[0]==='quoteLocate').length,count);
   d.querySelector('#input').focus();page({quoteLocator:{...locator,status:'found',message:'找到唯一匹配。'}});assert.equal(d.activeElement.id,'input','new valid focus wins over async completion');
   assert.equal(d.querySelector('#quote-locate'),locate,'status must not remount control');
   report.push(renderer+': stable shared controls, guarded repeats, focus survives locating, simulated focus-away async completion');
   for(const status of ['found','ambiguous','missing','unsupported','uncertain']){
     page({quoteLocator:{...locator,status,message:'合成 '+status}});assert.equal(live.textContent,'合成 '+status);assert.equal(d.activeElement.id,'input');
     assert.equal(locate.getAttribute('aria-disabled'),'true');const before=e.calls.filter(c=>c[0]==='quoteLocate').length;locate.click();await tick();assert.equal(e.calls.filter(c=>c[0]==='quoteLocate').length,before,'terminal status must never retry');
   }
   let dismissCount=e.calls.filter(c=>c[0]==='quoteDismiss').length;
   d.querySelector('#input').dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();assert.equal(e.calls.filter(c=>c[0]==='quoteDismiss').length,dismissCount,'outside Escape must not dismiss locator');
   locate.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true}));await tick();assert.equal(e.calls.filter(c=>c[0]==='quoteDismiss').length,dismissCount,'composing Escape is not a close command');
   const escape=new e.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});locate.dispatchEvent(escape);await tick();assert.equal(escape.defaultPrevented,true);assert.equal(e.calls.filter(c=>c[0]==='quoteDismiss').length,++dismissCount,'scoped bar Escape dismisses locator');
   report.push(renderer+': all terminal outcomes disallow retries; Escape scoped to non-IME bar event');
   close.focus();close.click();await tick();assert.deepEqual(e.calls.filter(c=>c[0]==='quoteDismiss').at(-1),['quoteDismiss',locator.id,base.ownerId,'fixture-page']);
   page({quoteLocator:undefined});assert.equal(bar.hidden,true);assert.equal(d.activeElement.id,'summarize-page');assert.equal(live.textContent,'引文定位已关闭。');assert.equal(live.closest('[hidden],.hidden'),null);
   report.push(renderer+': separate persistent polite live region and focused close returns to visible summary control');
   page();close.focus();d.querySelector('#input').focus();page({quoteLocator:undefined});assert.equal(d.activeElement.id,'input');
   page();close.focus();e.nativeFocus();page({quoteLocator:undefined});assert.notEqual(d.activeElement.id,'summarize-page','stale DOM focus must not steal native focus');e.chromeFocus();
   page();close.focus();e.render({mode:'home',quoteLocator:undefined});assert.equal(d.activeElement.id,'home-query');
   const ids=[...d.querySelectorAll('[id]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length);
   report.push(renderer+': external/new focus preserved, native focus not stolen, removal fallback visible, no duplicate IDs');
  }finally{e.close();}
 }
 console.log(JSON.stringify({status:'passed',scope:'Compiled production DOM with mocked IPC and visibility/focus stubs; not native geometry or screen-reader proof',report},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
