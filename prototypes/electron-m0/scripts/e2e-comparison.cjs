// Production UI/IPC, isolated profile and synthetic Search/Fetch/Model/HTTPS. No external requests.
const { app, BrowserWindow, nativeTheme, session } = require('electron');
const { Client } = require('@modelcontextprotocol/client');const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');const { tmpdir } = require('node:os');const path = require('node:path');const assert = require('node:assert/strict');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'grid-comparison-')));process.env.DEEPSEEK_API_KEY='synthetic-comparison-key';delete process.env.DeepSeek_ApiKeyN;
const directory=path.join(__dirname,'../.local');const calls=[];const report=[];let badQuote=false;let modelError=false;let failB=false;let holdModel;let waiting;let holdFetch;let waitingFetch;
const bodies=[
 '个人方案每天可查询 100 次。\n离线模式可导出 PDF。\n导出功能支持 JSON。\n个人方案保留 7 天。\n'+'资料 A 的合成补充段落，仅用于阅读位置检查。\n'.repeat(700),
 '团队方案每天可查询 1000 次。\n离线模式不可导出 PDF。\n导出功能支持 JSON。\n'+'资料 B 的合成补充段落，仅用于阅读位置检查。\n'.repeat(700)
];
const side=(text,quote)=>({status:'supported',text,quotes:[quote]});
const result=()=>({overview:'两份资料的查询额度适用于不同账户，不能直接当作矛盾。JSON 导出说明一致，离线 PDF 说明存在分歧，需要回到原页核对。',limitations:'这是两版公开正文片段的 AI 对照，未核对原页；当前无法判断哪份资料更新或更可靠。',rows:[
 {aspect:'查询额度与适用对象',relation:'different-scope',left:side('个人方案每天 100 次。','个人方案每天可查询 100 次。'),right:side('团队方案每天 1000 次。','团队方案每天可查询 1000 次。')},
 {aspect:'离线导出 PDF',relation:'conflict',left:side('说明支持离线导出。',badQuote?'离线模式不可导出 PDF。':'离线模式可导出 PDF。'),right:side('说明不支持离线导出。','离线模式不可导出 PDF。')},
 {aspect:'JSON 导出',relation:'agreement',left:side('明确支持 JSON。','导出功能支持 JSON。'),right:side('明确支持 JSON。','导出功能支持 JSON。')},
 {aspect:'保留期限',relation:'insufficient',left:side('个人方案保留 7 天。','个人方案保留 7 天。'),right:{status:'not-stated',text:'没有说明',quotes:[]}}
]});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
global.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);calls.push({url,body,signal:options.signal});
 if(url.endsWith('/search'))return json({results:[0,1,2].map(i=>({title:['个人方案 · 公开说明','团队方案 · 公开说明','未选择的来源'][i],url:'https://example.com/'+['a','b','c'][i],snippet:'合成搜索摘要。选择后才进行来源对照。'}))});
 if(url.endsWith('/fetch')){
  if(body.url.includes('/cache/'))return json({title:'合成缓存占用',content:'x'.repeat(950000)});
  if(holdFetch&&body.url.endsWith('/b')){waitingFetch=holdFetch;holdFetch=undefined;return waitingFetch.promise;}
  if(failB&&body.url.endsWith('/b'))throw new Error('来源 B 的合成公开 Fetch 失败');
  return json({title:body.url.endsWith('/a')?'个人方案 · 公开说明':'团队方案 · 公开说明',content:bodies[body.url.endsWith('/a')?0:1]});
 }
 assert.equal(url,'https://api.deepseek.com/chat/completions');const input=JSON.parse(body.messages[1].content);
 assert.ok(input.left&&input.right,'comparison has exactly the selected left/right versions');assert.ok(!JSON.stringify(input).includes('PRIVATE_NATIVE_FIELD'));assert.ok(!JSON.stringify(input).includes('https://example.com/c'));
 if(holdModel){waiting=holdModel;holdModel=undefined;return waiting.promise;}
 if(modelError)return new Response('{}',{status:503});
 const response=result();if(input.left.url.endsWith('/b'))response.rows=response.rows.map(row=>({...row,left:row.right,right:row.left}));
 return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}]});
};
require('../dist/main.js');app.once('will-quit',()=>{if(process.exitCode)app.exit(Number(process.exitCode));});const deadline=setTimeout(()=>app.exit(1),150000);
const pause=()=>new Promise(r=>setTimeout(r,30));async function until(check,label='UI'){for(let i=0;i<250;i++){if(await check())return;await pause();}throw new Error(label+' timeout');}
app.whenReady().then(async()=>{
 let client;let stage='startup';const win=BrowserWindow.getAllWindows()[0];const ui=code=>win.webContents.executeJavaScript(code).catch(error=>{throw new Error(stage+': '+code.slice(0,180)+' — '+error.message);});const state=()=>ui('window.grid.state()');const paint=()=>ui('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const animations=()=>ui('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
 const click=id=>ui(`document.getElementById(${JSON.stringify(id)}).click()`);const selected=()=>ui('Array.from(document.querySelectorAll("[data-comparison-url]")).filter(n=>n.checked).length');
 const choose=async index=>{await ui(`document.querySelectorAll('[data-comparison-url]')[${index}].click()`);await until(async()=>(await state()).comparisonSelection.some(s=>s.url.endsWith('/'+['a','b','c'][index])));await paint();};
 const search=async()=>{await ui('window.grid.submit("对照两种方案的额度与导出条件",{scene:"professional",contextual:false})');await until(async()=>await ui('document.querySelectorAll("[data-comparison-url]").length===3'));await paint();};
 const jump=async id=>{const s=await state();await ui(`window.grid.jump(${JSON.stringify(id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`);await paint();};
 const start=async()=>{await click('comparison-start');await until(async()=>!(await state()).pending&&(await state()).mode==='comparison');await until(async()=>await ui('!document.querySelector("#comparison-view").classList.contains("hidden")'));await paint();await animations();};
 const retry=async()=>{await click('comparison-retry');await until(async()=>!(await state()).pending);await paint();await animations();};
 const fetches=()=>calls.filter(c=>c.url.endsWith('/fetch'));const models=()=>calls.filter(c=>c.url.endsWith('/chat/completions'));
 const passed=name=>{report.push(name);console.log(JSON.stringify({stage:name,status:'passed'}));};
 const native=()=>win.contentView.children.find(v=>v.webContents&&/^https?:/.test(v.webContents.getURL()));
 const settled=async()=>{await until(async()=>{const expected=await ui('document.querySelector("#browser-chrome").getBoundingClientRect().bottom');const b=native()?.getBounds();return !b||b.height>0&&Math.abs(b.y-expected*win.webContents.getZoomFactor())<=2;},'native layout');await paint();};
 try{
  mkdirSync(directory,{recursive:true});nativeTheme.themeSource='light';await until(async()=>{try{return await ui('Boolean(window.grid && document.querySelector("#comparison-start"))');}catch{return false;}});
  assert.ok(await ui('document.querySelector("#comparison-tray").hidden'));await search();const results=await state();const before=calls.length;
  await choose(0);assert.equal(calls.length,before);assert.ok(await ui('document.querySelector("#comparison-start").hidden'));assert.equal((await state()).path.nodes.length,results.path.nodes.length);
  await choose(1);assert.equal(calls.length,before);assert.equal(await selected(),2);assert.ok(await ui('!document.querySelector("#comparison-start").hidden'));
  assert.ok(await ui('document.querySelectorAll("[data-comparison-url]")[2].disabled'));
  passed('explicit-selection-makes-no-requests-or-nodes-and-reveals-only-a-temporary-two-source-entry');

  stage='comparison and evidence';const nodeCount=(await state()).path.nodes.length;await start();const comparison=await state();const record=comparison.comparison;
  assert.equal(comparison.path.nodes.length,nodeCount+1);assert.equal(comparison.path.nodes.at(-1).status,'ready');assert.equal(record.sources.length,2);assert.equal(fetches().length,2);assert.equal(models().length,1);
  assert.ok(await ui('document.querySelector("#comparison-tray").hidden'));assert.equal(await ui('document.querySelectorAll(".comparison-row").length'),4);
  assert.deepEqual(await ui('Array.from(document.querySelectorAll(".comparison-relation")).map(n=>n.dataset.relation)'),['different-scope','conflict','agreement','insufficient']);
  for(const index of [0,1]){await click('comparison-quote-1-'+index+'-0');assert.ok(await ui(`document.querySelector('#comparison-evidence-${index}').open`));assert.equal(await ui(`document.querySelector('#comparison-text-${index} mark').textContent`),index?'离线模式不可导出 PDF。':'离线模式可导出 PDF。');await click('comparison-evidence-back-'+index);assert.equal(await ui('document.activeElement.id'),'comparison-quote-1-'+index+'-0');}
  await ui('document.querySelectorAll("#comparison-sources details").forEach(d=>d.open=false);document.querySelector("#surface").scrollTop=0');await animations();
  writeFileSync(path.join(directory,'comparison-light.png'),(await win.capturePage()).toPNG());
  passed('one-request-node-shows-four-explicit-relations-and-each-quote-locates-the-correct-version');

  stage='reading positions and cached return';await jump(results.entryId);await ui('window.grid.read("https://example.com/a")');await paint();const reading=await state();await ui('document.querySelector("#surface").scrollTop=460');await until(async()=>(await state()).presentation.scrollTop>=450);
  // Exchange the old A metadata selection for this exact reading version.
  let s=await state();await ui(`window.grid.comparisonRemove(${JSON.stringify(s.comparisonSelection[0].id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`);await click('comparison-reading');await until(async()=>(await state()).comparisonSelection.some(x=>x.source?.readingId===reading.reading.id));
  const priorFetch=fetches().length;await start();const fromReading=await state();assert.ok(fromReading.comparison.analysis);assert.equal(fetches().length,priorFetch+1,'only the uncached B is fetched');
  const a=fromReading.comparison.sources.findIndex(x=>x.url.endsWith('/a'));await click('comparison-origin-'+a);await until(async()=>(await state()).entryId===reading.entryId);await paint();assert.ok(await ui('document.querySelector("#surface").scrollTop>=450'));
  const beforeJump=calls.length;await jump(fromReading.entryId);assert.equal(calls.length,beforeJump);assert.equal((await state()).comparison.id,fromReading.comparison.id);
  passed('reading-version-and-scroll-position-are-fixed-and-returning-to-the-same-comparison-never-replays');

  stage='native layout and grants';
  session.fromPartition('persist:grid-m0').protocol.handle('https',()=>new Response('<title>合成原页</title><h1>用于对照返回的原页</h1><input value="PRIVATE_NATIVE_FIELD"><div style="height:3000px"></div>',{headers:{'Content-Type':'text/html'}}));
  await click('comparison-open-0');await until(async()=>(await state()).agent?.page);await settled();
  const web=native().webContents;await web.executeJavaScript('scrollTo(0,400)');
  const connectionFile=path.join(app.getPath('userData'),'mcp-connection.json');
  client=new Client({name:'Comparison synthetic client',version:'1.0'});await client.connect(new StdioClientTransport({command:process.env.npm_node_execpath||'node',args:[path.join(__dirname,'../dist/mcp.js'),'--connection-file',connectionFile],stderr:'pipe'}));
  const call=name=>client.callTool({name,arguments:{}});await call('grid_connection_status');await until(async()=>Boolean((await state()).agent?.connections.length));
  await ui('window.grid.state().then(s=>window.grid.agentGrant(s.agent.connections[0].id,s.agent.page.documentId))');await ui('window.grid.agentPanel(false)');await settled();
  assert.ok(!(await call('grid_page_snapshot')).isError);
  for(const width of [720,768,1180]){win.setContentSize(width,820);await settled();assert.ok(await ui('(()=>{const r=document.querySelector("#comparison-start").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()'));}
  const firstSource=(await state()).comparisonSelection[0];await click('comparison-remove-'+firstSource.id);await settled();assert.ok(!(await call('grid_page_snapshot')).isError);
  assert.equal(native().webContents,web);assert.ok(await web.executeJavaScript('scrollY>=390'));
  await ui('window.grid.back()');await until(async()=>(await state()).entryId===fromReading.entryId);assert.ok((await call('grid_page_snapshot')).isError,'leaving native page revokes grant');
  assert.equal((await state()).comparison.id,fromReading.comparison.id);await client.close();client=undefined;
  passed('original-page-return-restores-comparison-and-selection-layout-keeps-only-the-current-document-grant');

  stage='partial failure and retry';
  // Rebuild the basket from result metadata so both public documents need explicit Fetch.
  await jump(results.entryId);s=await state();for(const item of s.comparisonSelection)await ui(`window.grid.comparisonRemove(${JSON.stringify(item.id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`);
  await choose(0);await choose(1);failB=true;const priorModels=models().length;await start();const failed=await state();
  assert.equal(models().length,priorModels);assert.equal(failed.path.nodes.at(-1).status,'failed');assert.ok(failed.comparison.sources[0].source);assert.ok(await ui('document.querySelectorAll(".comparison-source-issue").length===1'));
  const version=failed.comparison.sources[0].source.readingId;failB=false;const beforeRetry=fetches().length;await retry();assert.equal(fetches().length,beforeRetry+1);assert.equal((await state()).comparison.sources[0].source.readingId,version);const retried=await state();await jump(failed.entryId);assert.equal((await state()).comparison.analysis,undefined);await jump(retried.entryId);
  passed('partial-fetch-failure-is-not-a-conflict-and-explicit-retry-only-fetches-missing-content');

  stage='invalid model and cancellation';badQuote=true;await retry();badQuote=false;const invalid=await state();assert.ok(invalid.issue.message.includes('不匹配'));assert.equal(invalid.comparison.analysis,undefined);assert.ok(invalid.comparison.sources.every(x=>x.source));
  modelError=true;const beforeModelRetry=fetches().length;await retry();modelError=false;assert.equal(fetches().length,beforeModelRetry);assert.ok((await state()).issue.message.includes('503'));
  const late={};late.promise=new Promise(r=>late.resolve=r);holdModel=late;waiting=undefined;await click('comparison-retry');await until(()=>Boolean(waiting),'held model');const pending=await state();await click('comparison-cancel');await until(async()=>!(await state()).pending);assert.ok(models().at(-1).signal.aborted);
  waiting.resolve(json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result())}}]}));await pause();assert.equal((await state()).comparison.analysis,undefined);assert.equal((await state()).entryId,pending.entryId);assert.ok(await ui('document.querySelector("#comparison-status").textContent.includes("停止")'));
  passed('foreign-side-quotes-and-model-errors-retain-sources-and-cancelled-analysis-cannot-return-late');

  stage='cancel concurrent Fetch';await jump(results.entryId);const slow={};slow.promise=new Promise(r=>slow.resolve=r);holdFetch=slow;waitingFetch=undefined;
  const beforeCancelledFetch=models().length;await click('comparison-start');await until(()=>Boolean(waitingFetch),'held B Fetch');await until(async()=>Boolean((await state()).comparison?.sources[0].source));
  const stoppedFetch=await state();await click('comparison-cancel');await until(async()=>!(await state()).pending);assert.ok(fetches().at(-1).signal.aborted);
  waitingFetch.resolve(json({title:'团队说明',content:bodies[1]}));await pause();assert.equal(models().length,beforeCancelledFetch);assert.equal((await state()).entryId,stoppedFetch.entryId);assert.ok((await state()).comparison.sources[0].source);assert.equal((await state()).comparison.sources[1].source,undefined);
  await retry();assert.ok((await state()).comparison.analysis);
  passed('stop-during-concurrent-Fetch-keeps-finished-source-and-never-starts-a-late-model');

  stage='ownership and keyboard';s=await state();const foreign=s;await ui('window.grid.tabNew()');assert.equal((await state()).comparisonSelection.length,0);
  await assert.rejects(ui(`window.grid.comparisonRetry(${JSON.stringify(foreign.comparison.id)},${JSON.stringify(foreign.ownerId)},${JSON.stringify(foreign.entryId)})`));
  await ui(`window.grid.tabSelect(${JSON.stringify(foreign.ownerId)})`);await assert.rejects(ui(`window.grid.comparisonRetry("wrong-version",${JSON.stringify(foreign.ownerId)},${JSON.stringify(foreign.entryId)})`));
  await assert.rejects(ui(`window.grid.comparisonChoose({kind:"result",searchId:"old",index:0,url:"https://evil.example"},${JSON.stringify(foreign.ownerId)},${JSON.stringify(foreign.entryId)})`));
  await jump(results.entryId);s=await state();for(const item of s.comparisonSelection)await ui(`window.grid.comparisonRemove(${JSON.stringify(item.id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`);await choose(0);await choose(1);
  win.webContents.focus();await ui('document.querySelector("#comparison-start").focus()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await until(async()=>!(await state()).pending&&(await state()).mode==='comparison');await until(()=>ui('document.activeElement.id === "comparison-title"'));
  const beforeReload=calls.length;win.webContents.reload();await until(async()=>{try{return await ui('document.querySelectorAll(".comparison-row").length===4');}catch{return false;}});assert.equal(calls.length,beforeReload);
  passed('owner-entry-record-fences-keyboard-focus-and-ui-reload-preserve-the-comparison');

  stage='responsive contrast';const contrast=[];const ratio=(a,b)=>{const L=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const x=L(a),y=L(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  win.setMinimumSize(320,480);
  for(const appearance of ['light','dark']){nativeTheme.themeSource=appearance;for(const width of [320,375,414,768,1180]){win.setContentSize(width,820);await paint();await animations();
    assert.ok(await ui('document.documentElement.scrollWidth<=innerWidth+1'));
    assert.ok(await ui('Array.from(document.querySelectorAll("#comparison-view button")).filter(b=>!b.disabled).every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})'),'all comparison actions stay horizontally reachable');
    for(const scene of ['professional','learning','living','entertainment','inspiration']){await ui(`window.grid.setScene(${JSON.stringify(scene)})`);await paint();await animations();
      const colors=await ui('Array.from(document.querySelectorAll(".comparison-relation,#comparison-status,#comparison-retry")).map(n=>{const c=getComputedStyle(n);return[c.color,c.backgroundColor==="rgba(0, 0, 0, 0)"?getComputedStyle(document.documentElement).backgroundColor:c.backgroundColor]})');
      colors.forEach(pair=>contrast.push(ratio(...pair)));
    }
    if(width===375){writeFileSync(path.join(directory,'comparison-narrow-'+appearance+'.png'),(await win.capturePage()).toPNG());}
  }}
  assert.ok(contrast.every(value=>value>=4.5));win.webContents.setZoomFactor(1.5);await paint();assert.ok(await ui('document.documentElement.scrollWidth<=innerWidth+1'));win.webContents.setZoomFactor(1);
  win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await ui('getComputedStyle(document.querySelector("#comparison-retry")).transitionDuration'),'0s');win.webContents.debugger.detach();
  win.setContentSize(1180,820);await paint();await animations();await ui('document.querySelector("#surface").scrollTop=0');writeFileSync(path.join(directory,'comparison-dark.png'),(await win.capturePage()).toPNG());
  passed('light-dark-five-scenes-narrow-actions-150-percent-zoom-reduced-motion-and-contrast');

  stage='selection and panels';await jump(results.entryId);
  s=await state();await ui(`window.grid.pathMap(true,${JSON.stringify(s.ownerId)})`);await ui('window.grid.agentPanel(true)');
  for(const [width,height]of[[720,480],[320,480],[1180,820]]){win.setContentSize(width,height);await paint();assert.ok(await ui('(()=>{const r=document.querySelector("#comparison-start").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()'));
    const overlay=win.contentView.children.find(v=>v.webContents?.getURL().endsWith('/renderer/map.html'));
    if(overlay){const bounds=overlay.getBounds();const chrome=await ui('document.querySelector("#browser-chrome").getBoundingClientRect().bottom');assert.ok(bounds.height>=44 && bounds.y>=chrome && bounds.y+bounds.height<=win.getContentSize()[1], 'floating map stays below Agent controls');}
  }
  passed('temporary-selection-with-map-and-Agent-retains-reachable-controls');

  nativeTheme.themeSource='light';win.setContentSize(1180,820);await ui('window.grid.agentPanel(false)');s=await state();await ui(`window.grid.pathMap(false,${JSON.stringify(s.ownerId)})`);await jump(comparison.entryId);await paint();await animations();
  await ui('document.querySelector("#surface").scrollTop=0');writeFileSync(path.join(directory,'comparison-light.png'),(await win.capturePage()).toPNG());
  await ui('(()=>{const root=document.querySelector("#surface");const row=document.querySelector(".comparison-row");root.scrollTop+=row.getBoundingClientRect().top-root.getBoundingClientRect().top-16})()');await paint();writeFileSync(path.join(directory,'comparison-details-light.png'),(await win.capturePage()).toPNG());
  stage='released comparison recovery';
  for(let i=0;i<9;i++)await ui(`window.grid.read("https://example.com/cache/${i}")`);
  const beforeReleaseReturn=calls.length;await jump(comparison.entryId);assert.equal((await state()).comparison,undefined);assert.equal(calls.length,beforeReleaseReturn);
  assert.equal((await state()).path.nodes.find(n=>n.id===comparison.entryId).comparisonScope.sources.length,2);
  assert.equal(await ui('document.querySelectorAll(".comparison-source").length'),2);assert.ok(await ui('document.querySelector("#comparison-status").textContent.includes("新版本")'));
  writeFileSync(path.join(directory,'comparison-released.png'),(await win.capturePage()).toPNG());
  const beforeRecoverFetches=fetches().length;await retry();assert.ok((await state()).comparison.analysis);assert.equal(fetches().length,beforeRecoverFetches+2);assert.notEqual((await state()).entryId,comparison.entryId);
  assert.notEqual((await state()).comparison.sources[0].source.readingId,record.sources[0].source.readingId);await jump(comparison.entryId);assert.equal((await state()).comparison,undefined);
  passed('released-comparison-keeps-source-version-handles-and-only-explicit-recovery-fetches-new-versions-in-a-new-step');

  const tokens=readFileSync(path.join(__dirname,'../../../tokens.css'),'utf8');const css=readFileSync(path.join(__dirname,'../src/renderer/understanding.css'),'utf8');const states=['default','hover','focus','active','disabled','loading','error','success'];
  writeFileSync(path.join(directory,'comparison.preview.html'),`<!doctype html><meta charset="utf-8"><title>来源对照八状态 · 合成检查</title><style>${tokens}\n${css}\nbody{background:var(--color-paper);color:var(--color-ink);font-family:var(--font-body);padding:var(--space-lg)}article{margin-block:var(--space-md)}</style><h1>对照入口八状态</h1><p>仅用于设计检查的合成示例。</p>${states.map(s=>`<article class="understanding"><p>${s}</p><button class="${['hover','focus','active'].includes(s)?'is-'+s:''}" data-state="${s}" ${s==='disabled'?'disabled':''}>${s==='loading'?'正在对照…':s==='error'?'有来源未取得正文':s==='success'?'已生成 · 待核对':'对照这两份'}</button></article>`).join('')}`);
  const preview=new BrowserWindow({width:620,height:1060,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await preview.loadFile(path.join(directory,'comparison.preview.html'));await preview.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');writeFileSync(path.join(directory,'comparison-states.png'),(await preview.capturePage()).toPNG());preview.close();
  writeFileSync(path.join(directory,'comparison-e2e-report.json'),JSON.stringify({status:'passed',report,minimumTextContrast:Math.min(...contrast),scope:'synthetic provider only; no live content-quality or persistence claim'},null,2));console.log(JSON.stringify({status:'passed',groups:report.length}));
 }catch(error){process.exitCode=1;console.error(JSON.stringify({status:'failed',stage,message:error.message}));}
 finally{await client?.close();clearTimeout(deadline);for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.close();app.quit();}
});
