// Offline interaction and layout checks. Run with the existing Electron binary.
const {app,BrowserWindow,nativeTheme}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const dir=mkdtempSync(path.join(tmpdir(),'grid-reading-flow-'));
app.setPath('userData',dir);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let win;const checks=[],errors=[];
app.whenReady().then(async()=>{
 try{
  win=new BrowserWindow({width:1180,height:830,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(String(event.message).includes('Uncaught'))errors.push(event.message);});
  const ui=s=>win.webContents.executeJavaScript(s);
  const click=s=>ui(`document.querySelector(${JSON.stringify(s)}).click()`);
  const act=a=>click(`[data-act="${a}"]`);
  const fill=(s,v)=>ui(`(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const yes=async(s,label)=>{assert.equal(await ui(s),true,label);};
  const shot=async name=>{await pause(100);writeFileSync(path.join(__dirname,`.local/${name}.png`),(await win.capturePage()).toPNG());};
  mkdirSync(path.join(__dirname,'.local'),{recursive:true});
  writeFileSync(path.join(__dirname,'.local/report.json'),JSON.stringify({status:'running'}));
  await win.loadFile(path.join(__dirname,'index.html'));await pause(150);
  await yes('document.querySelectorAll("#navigation [data-act=chain-select]").length===2','initial preview shows two exploration labels');
  await shot('chain-reading');await click('#map-chain-trigger');await shot('chain-picker');
  await click('#chain-picker [aria-pressed=false]');
  await yes('document.querySelector("#grid-flow").dataset.page==="c" && document.querySelectorAll(".map-excerpt").length===1','switching map selects associated webpage and only its chain');
  await shot('chain-second');await act('reset');
  await shot('home');
  for(const scene of ['professional','learning','living','entertainment','inspiration']){await click(`[data-act=scene][data-value=${scene}]`);await yes(`document.querySelector('#grid-flow').dataset.scene==='${scene}'`,'scene switches');}
  await click('[data-act=scene][data-value=professional]');
  await ui('document.querySelector("#query").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));document.querySelector("#search-form").requestSubmit()');
  await yes('document.querySelector(".welcome")!==null','IME composition cannot submit');
  await ui('document.querySelector("#query").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));document.querySelector("#search-form").requestSubmit()');
  await yes('document.querySelectorAll(".result-title").length===3','results ready before summary');await shot('results');
  await yes(`Array.from(document.querySelectorAll('.result p')).every(e=>Math.abs(e.clientHeight-2*parseFloat(getComputedStyle(e).lineHeight))<1)`,'search content excerpts reserve two lines');
  await click('[data-open=a]');const first=await ui('document.querySelector("#grid-flow").dataset.current');
  await yes('!document.querySelector("#page-tools").hidden && document.querySelector("#summary-panel").hidden','result opens webpage with compact controls');
  await shot('reading');
  await ui('document.querySelector("#main-content").scrollTop=180');
  await fill('#site-input','保留我写下的文字');
  const before=await ui('document.querySelector("#main-content").scrollTop');
  await act('summary');await yes('!document.querySelector("#summary-panel").hidden','summary opens');await pause(950);
  await yes(`document.querySelector('#main-content').scrollTop===${before} && document.querySelector('#site-input').value==='保留我写下的文字'`,'summary does not rerender or reset website');
  await ui('document.querySelector("#main-content").scrollTop=0');await shot('summary');
  await act('chat');await yes('document.querySelector("#summary-panel").hidden && !document.querySelector("#assistant-panel").hidden','Q&A replaces summary, website stays');
  await fill('#question','这篇文章有哪些局限？');await ui('document.querySelector("#chat-form").requestSubmit()');
  await fill('#question','待会继续问的问题');await ui('document.querySelector("#question").focus()');await pause(950);
  await yes('document.querySelectorAll(".chat-user").length===1','question answered');
  await yes('document.querySelector("#question").value==="待会继续问的问题" && document.activeElement.id==="question"','completion preserves next draft and focus');
  await fill('#question','待会继续问的问题');await shot('question');
  await act('back');await click('[data-open=b]');const second=await ui('document.querySelector("#grid-flow").dataset.current');
  await act('chat');await yes('document.querySelector("#question").value==="" && document.querySelectorAll(".chat-user").length===0','new page has separate question context');
  await act('map-toggle');
  await pause(100);
  await yes(`(()=>{const all=[...document.querySelectorAll('.map-title')];return all.length>0&&all.every(e=>{const s=getComputedStyle(e);return Math.abs(e.clientHeight-2*parseFloat(s.lineHeight))<1&&s.webkitLineClamp==='2';});})()`,'map titles reserve exactly two lines');
  await yes(`(()=>{const all=[...document.querySelectorAll('.map-excerpt')];return all.length===2&&all.every(e=>{const s=getComputedStyle(e);return Math.abs(e.clientHeight-2*parseFloat(s.lineHeight))<1&&e.textContent.length>20&&e.closest('button').getAttribute('aria-describedby')===e.id;});})()`,'each website has a separate accessible two-line content excerpt');
  await yes(`Array.from(document.querySelectorAll('.map-node')).every(e=>e.offsetWidth===164&&e.offsetHeight<=124)`,'compact nodes retain readable title and excerpt');
  await yes(`document.querySelector('[data-value="${first}"] .map-preview').naturalWidth>0 && !document.querySelector('[data-value="${second}"] .map-preview')`,'existing image displays, absent image adds no placeholder');
  await yes(`(()=>{const e=document.querySelector('[data-value="${second}"] .map-title'),r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect().height>parseFloat(getComputedStyle(e).lineHeight);})()`,'longer website title visibly wraps to second line');
  await click(`[data-value="${first}"] .map-preview`);await yes(`document.querySelector('#grid-flow').dataset.current==='${first}'`,'image click navigates to associated page');
  await act('nav');
  await yes(`(()=>{const e=document.querySelector('.node span');return Math.abs(e.clientHeight-2*parseFloat(getComputedStyle(e).lineHeight))<1;})()`,'sidebar titles also reserve two lines');await act('nav');
  checks.push('two-line website titles and sidebar labels','two-line website and result excerpts','compact node size','optional local image and image-click navigation');
  await click(`[data-act=map-jump][data-value="${first}"]`);await act('chat');
  await yes('document.querySelector("#question").value==="待会继续问的问题" && document.querySelectorAll(".chat-user").length===1','map restores same-page draft and answer');
  await act('close-panel');await act('map-toggle');await click(`[data-act=activity][data-value="${first}:chat"]`);
  await yes('document.querySelectorAll(".chat-user").length===1','map activity opens associated Q&A');
  await act('close-panel');await act('map-toggle');await shot('map');
  await act('back');await act('forward');await yes(`document.querySelector('#grid-flow').dataset.current==='${first}'`,'forward follows selected branch');
  await act('back');await click(`[data-act=map-jump][data-value="${second}"]`);
  await ui('document.querySelector("#demo-response").value="error";document.querySelector("#demo-response").dispatchEvent(new Event("change",{bubbles:true}))');
  await act('summary');await pause(950);
  await yes('document.querySelector("#summary-panel .error")!==null && document.querySelector(".site")!==null','fetch failure leaves page usable');await shot('failure');
  await act('retry-summary');await act('cancel');await pause(950);
  await yes('document.querySelector("#summary-panel").textContent.includes("已取消")','late generation cannot overwrite cancelled state');
  await act('retry-summary');await act('back');await pause(950);await yes('document.querySelector(".results")!==null && document.querySelector("#summary-panel").hidden','late generation cannot overwrite another page');
  await act('forward');await act('chat');await fill('#question','测试取消后草稿');await ui('document.querySelector("#chat-form").requestSubmit()');await act('cancel');
  await yes('document.querySelector("#question").value==="测试取消后草稿"','cancel retains draft');
  await act('compare');await yes('document.querySelector("[data-act=run-compare]").disabled','requires two sources');
  await click('[data-compare=a]');await act('run-compare');await yes('document.querySelector("#assistant-panel").textContent.includes("相同点与差异")','two-source comparison');
  await act('notes');await fill('#note','先保留路径，再核对来源。');await click('#include-quote');await act('save-note');await fill('#note','修改后仍保留旧版本。');await act('save-note');
  await yes('document.querySelectorAll(".version").length===2','immutable note versions');
  await act('nav');await act('records');await act('save-path');await yes('document.querySelector("[data-act=restore]")!==null','path save in memory');
  await act('nav');await act('agent');await act('authorize');await act('preview-action');await act('confirm-action');await act('close-panel');
  await yes('!document.querySelector("#agent-strip").hidden','agent takeover visible with closed panel');await act('pause-agent');await act('takeover');
  await yes('document.querySelector("#agent-strip").hidden','takeover stops simulation');
  checks.push('five scenes','results → webpage','summary and scroll/input preservation','same-window Q&A','per-page drafts/answers','map branches and forward selection','failure fallback','cancel and stale completion','two-source comparison','note versions','memory path saving','agent pause/takeover');
  for(const appearance of ['light','dark']){
   nativeTheme.themeSource=appearance;
   for(const width of [320,375,414,768,1180]){
    win.setContentSize(width,860);await pause(100);
    for(const state of ['reading','summary','chat','map','map-vertical']){
     if(state==='reading'){await act('reset');await ui('document.querySelector("#search-form").requestSubmit()');await click('[data-open=a]');}
     if(state==='summary'){await act('summary');await pause(900);}
     if(state==='chat')await act('chat');
     if(state==='map'){await act('close-panel');await act('map-toggle');}
     if(state==='map-vertical')await click('[data-act=map-axis][data-value=vertical]');
     await yes('document.documentElement.scrollWidth<=innerWidth',`${width} ${state} document fits`);
     await yes(`(()=>{const r=document.querySelector('#grid-flow');return [...r.querySelectorAll('button,input,textarea,summary')].filter(e=>e.getClientRects().length&&!e.closest('.map-canvas')).every(e=>{const b=e.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth+1;});})()`,`${width} ${state} controls fit`);
     if(state==='chat')await yes('document.querySelector("#main-content").getBoundingClientRect().height>=215','webpage remains visible beside/before chat');
    }
    if(width===375)await shot(`narrow-${appearance}`);
   }
  }
  win.setContentSize(1180,830);await act('reset');await ui('document.querySelector("#search-form").requestSubmit()');await click('[data-open=a]');await act('chat');await shot('question-dark');
  win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await yes('getComputedStyle(document.querySelector("[data-act=chat]")).transitionDuration==="0s"','reduced motion');win.webContents.debugger.detach();
  await ui('document.querySelector("#question").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await yes('document.querySelector("#assistant-panel").hidden && document.activeElement.dataset.act==="chat"','Escape closes panel and returns focus');
  await act('nav');await act('records');await act('save-path');await click('[data-act=delete-record]');await yes('document.querySelectorAll("[data-act=restore]").length===0','delete does not recreate saved record');
  await act('reset');await ui('document.querySelector("#demo-response").value="empty";document.querySelector("#demo-response").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#search-form").requestSubmit()');await yes('document.querySelectorAll(".result-title").length===0','empty result state');
  await act('nav');await act('records');await act('temporary');await act('nav');await act('records');await act('save-path');
  await yes('document.querySelectorAll("[data-act=restore]").length===0','temporary task cannot be saved');
  checks.push('50 layout states: 5 widths × 2 appearances × 5 states','reduced motion','Escape focus return','delete path','empty results','IME composition guard','map activity opens associated Q&A','temporary task refuses saving','completion preserves next draft and focus');
  // Map topology is asserted through rendered relations, without exposing application state.
  win.setContentSize(1180,830);nativeTheme.themeSource='light';await act('reset');
  const currentId=()=>ui('Number(document.querySelector("#grid-flow").dataset.current)');
  const mapNode=id=>`#floating-map [data-act=map-jump][data-value="${id}"]`;
  const parentOf=id=>ui(`document.querySelector('[data-node="${id}"]')?.dataset.parent`);
  const openMap=async()=>{if(await ui('document.querySelector("#floating-map").hidden'))await act('map-toggle');};
  const jumpMap=async id=>{await openMap();await click(mapNode(id));};
  const rootId=await currentId();await ui('document.querySelector("#search-form").requestSubmit()');const resultId=await currentId();
  await click('[data-open=a]');const pageA=await currentId();await click('[data-open=b]');const pageB=await currentId();
  await jumpMap(pageA);await fill('#site-input','节点移除也不能丢');
  await ui('document.querySelector("#site-input").dataset.preserve="yes";document.querySelector("#main-content").scrollTop=140');
  const viewport=await ui('JSON.stringify(document.querySelector("#main-content").getBoundingClientRect().toJSON())');
  await act('map-toggle');await openMap();
  assert.equal(await ui('JSON.stringify(document.querySelector("#main-content").getBoundingClientRect().toJSON())'),viewport,'floating map does not resize page');
  await act('map-delete');assert.equal(await currentId(),pageA,'removal does not navigate current webpage');
  assert.equal(await parentOf(pageB),String(resultId),'child reconnects to preceding step');
  await yes(`document.querySelector('[data-node="${pageA}"]')===null`,'removed node absent');
  await yes('document.querySelector("#site-input").dataset.preserve==="yes" && document.querySelector("#site-input").value==="节点移除也不能丢" && document.querySelector("#main-content").scrollTop===140','deletion preserves live DOM, text and scroll');
  await jumpMap(resultId);await act('map-continue');await fill('#map-query','从这里换一个方向');await ui('document.querySelector("#map-continue-form").requestSubmit()');const newBranch=await currentId();
  assert.equal(await parentOf(newBranch),String(resultId));assert.equal(await parentOf(pageB),String(resultId),'continue retains old descendants');
  await act('map-undo');assert.equal(await parentOf(pageB),String(pageA),'undo restores intermediate link');assert.equal(await parentOf(newBranch),String(resultId),'undo preserves subsequent new branch');assert.equal(await currentId(),newBranch,'undo does not navigate');
  await jumpMap(resultId);await act('forward');assert.equal(await currentId(),newBranch,'forward retains latest selected branch');
  await jumpMap(rootId);await act('map-delete');assert.equal(await parentOf(resultId),'','deleting root promotes child');
  await jumpMap(pageB);await act('map-delete');await act('map-undo');await act('map-undo');
  assert.equal(await parentOf(resultId),String(rootId),'successive undo restores root');assert.equal(await parentOf(pageB),String(pageA),'successive undo restores leaf');
  await jumpMap(pageA);await act('map-continue');await fill('#map-query','未发出的新方向');await ui('document.querySelector("#map-query").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));document.querySelector("#map-continue-form").requestSubmit()');assert.equal(await currentId(),pageA,'map input respects composition');
  await ui('document.querySelector("#map-query").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));document.querySelector("#map-query").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await yes('document.querySelector("#map-query")===null && !document.querySelector("#floating-map").hidden','Escape cancels branch input first');
  await shot('floating-horizontal');
  const bounds=()=>ui(`(()=>{const m=document.querySelector('#floating-map').getBoundingClientRect(),p=document.querySelector('.page-viewport').getBoundingClientRect();return {x:m.x,y:m.y,w:m.width,h:m.height,px:p.x,py:p.y,pw:p.width,ph:p.height}})()`);
  const contained=async()=>{const b=await bounds();assert.ok(Math.abs(b.x-b.px-8)<1&&b.y>=b.py+7&&Math.abs(b.x+b.w-b.px-b.pw+8)<1&&Math.abs(b.y+b.h-b.py-b.ph+8)<1,'map stays at the bottom within webpage bounds');};
  await contained();
  assert.ok((await bounds()).h<=280,'desktop dock leaves more room for the webpage');
  const dockBefore=await bounds();await ui('document.querySelector("#main-content").scrollTop=220');
  assert.deepEqual(await bounds(),dockBefore,'page scrolling does not move dock');
  await yes(`getComputedStyle(document.querySelector('#floating-map')).backdropFilter.includes('blur')`,'glass uses background blur');
  win.webContents.setZoomFactor(1.25);await pause(150);await contained();win.webContents.setZoomFactor(1);await pause(150);
  await click('[data-act=map-axis][data-value=vertical]');await contained();await shot('floating-vertical');
  win.setContentSize(375,860);await pause(150);await contained();await shot('floating-narrow');
  nativeTheme.themeSource='dark';await shot('floating-narrow-dark');
  await act('chat');await yes('document.querySelector("#floating-map").hidden && !document.querySelector("#assistant-panel").hidden','opening Q&A tucks map away');
  await openMap();await yes('document.querySelector("#assistant-panel").hidden','narrow map does not compete with Q&A');await contained();
  await ui('document.querySelector("#floating-map [data-act=map-toggle]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await yes('document.querySelector("#floating-map").hidden && document.activeElement.id==="map-launcher"','map Escape restores launcher focus');
  await act('reset');await openMap();await act('map-delete');await yes('document.querySelectorAll("[data-node]").length===0','sole node removal yields empty map');await ui('document.querySelector("#search-form").requestSubmit()');await yes('document.querySelectorAll("[data-node]").length===1','search after empty map starts surviving root');await act('map-undo');await yes('document.querySelectorAll("[data-node]").length===2','undo retains later independent root');
  await act('nav');await act('records');await act('save-path');await openMap();await act('map-delete');await act('nav');await act('records');await click('[data-act=delete-record]');await openMap();await yes('document.querySelector("[data-act=map-undo]").disabled','deleting whole task clears its undo, preventing resurrection');
  checks.push('map does not resize/recreate webpage','delete preserves descendants, current DOM/input/scroll','continue from chosen node preserves old branches','undo preserves new branches','root/leaf/successive undo','empty map and new root','map IME and cancellation','bottom anchor on page scroll and UI zoom','glass blur','bottom anchor on resize/orientation','map and Q&A hierarchy','map Escape focus','whole-task deletion clears undo');
  win.webContents.debugger.attach('1.3');
  for(const feature of [{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-contrast',value:'more'}]){
   await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[feature]});
   await yes(`matchMedia('(${feature.name}: ${feature.value})').matches && getComputedStyle(document.querySelector('#floating-map')).backdropFilter==='none' && getComputedStyle(document.querySelector('#floating-map')).backgroundColor===getComputedStyle(document.querySelector('.secondary')).backgroundColor`,'accessibility preference makes map opaque');
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach();
  checks.push('reduced transparency and increased contrast use opaque fallback');
  // Exercise user-provided long labels and a real image decoding failure offline.
  win.setContentSize(375,860);await act('reset');
  const longLabel='如何保留每次探索的上下文？'+ 'AReallyLongUnbrokenWebsiteTitle'.repeat(5);
  await fill('#query',longLabel);await ui('document.querySelector("#search-form").requestSubmit()');await openMap();
  await yes(`(()=>{const n=document.querySelector('.map-node[aria-current]'),t=n.querySelector('.map-title');return n.dataset.tooltip===${JSON.stringify(longLabel)}&&t.textContent===${JSON.stringify(longLabel)}&&n.getAttribute('aria-label')==='返回：'+t.textContent&&n.offsetWidth===164&&t.clientHeight===36&&t.scrollHeight>t.clientHeight;})()`,'long labels retain full accessible text and clamp without widening node');
  await click('[data-open=a]');await openMap();await pause(80);
  const imageNode=await currentId();
  await ui('document.querySelector(".map-preview").src="data:image/png;base64,AA=="');await pause(100);
  await yes('document.querySelectorAll(".map-preview").length===0 && document.querySelector(".map-node[aria-current] .map-title")!==null && document.querySelector(".map-node[aria-current] .map-excerpt")!==null','image decode failure leaves title and content excerpt');
  await click('[data-act=map-axis][data-value=vertical]');await yes('document.querySelectorAll(".map-preview").length===0','rerender does not retry failed image');
  await act('back');await click(mapNode(imageNode));assert.equal(await currentId(),imageNode,'failed image cannot disable node navigation');
  checks.push('long and unbroken labels retain full accessible text','image decode failure falls back to text without retries');
  // Labels identify independent chains; visits never become competing tab identities.
  win.setContentSize(1180,830);nativeTheme.themeSource='light';await act('reset');
  const taskId=()=>ui('Number(document.querySelector("#grid-flow").dataset.task)');
  const choose=async id=>{await click('#map-switch');await click(`#chain-picker [data-act=chain-select][data-value="${id}"]`);};
  const switchByList=async id=>{await click('#map-chain-trigger');await click(`#chain-picker [data-value="${id}"]`);};
  await fill('#query','减少浏览干扰');await ui('document.querySelector("#search-form").requestSubmit()');await click('[data-open=a]');
  const chainA=await taskId(),visitA=await currentId();
  await fill('#site-input','甲链页内输入');await ui('document.querySelector("#main-content").scrollTop=160');
  await act('chat');await fill('#question','甲链尚未发送的问题');await act('close-panel');await openMap();
  await click('[data-act=map-axis][data-value=vertical]');await act('map-continue');await fill('#map-query','甲链未提交的分支');
  await click('#map-chain-trigger');await yes('!document.querySelector("#chain-picker").hidden && document.querySelector(".map-detail").hidden','picker replaces map controls while choosing');
  const beforePick=await currentId();await ui('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.equal(await currentId(),beforePick,'Escape cancels selection without navigation');
  await yes('document.activeElement.id==="map-chain-trigger" && document.querySelector("#map-query").value==="甲链未提交的分支"','cancel picker returns focus and retains continuation draft');
  await click('#map-chain-trigger');await click('#chain-picker [data-act=home]');
  await yes('document.activeElement.id==="query" && document.querySelector("#floating-map").hidden','new exploration focuses home without overlay');
  await fill('#query','记录阅读中的想法');await ui('document.querySelector("#search-form").requestSubmit()');await click('[data-open=b]');
  const chainB=await taskId(),visitB=await currentId();assert.notEqual(chainA,chainB);
  await fill('#site-input','乙链页内输入');await openMap();
  await yes('document.querySelector("#floating-map").dataset.axis==="horizontal" && !document.querySelector("#map-query")','new chain uses its own orientation and draft');
  await act('nav');await click(`#navigation [data-act=chain-select][data-value="${chainA}"]`);
  assert.equal(await currentId(),visitA,'sidebar switch returns last visit, not chain root');
  await yes(`document.querySelector('#site-input').value==='甲链页内输入' && document.querySelector('#main-content').scrollTop===160 && document.querySelector('#map-query').value==='甲链未提交的分支' && document.querySelector('#floating-map').dataset.axis==='vertical'`,'switch restores webpage input/position and map draft/orientation');
  await yes(`!document.querySelector('#navigation [data-act=jump][data-value="${visitB}"]') && !document.querySelector('[data-node="${visitB}"]') && document.querySelector('#navigation [data-act=chain-select][data-value="${chainA}"]').getAttribute('aria-pressed')==='true'`,'sidebar and map agree on active chain');
  await act('map-cancel');await act('chat');await yes('document.querySelector("#question").value==="甲链尚未发送的问题"','question draft survives chain switch');await act('close-panel');
  await choose(chainB);assert.equal(await currentId(),visitB);await yes('document.querySelector("#floating-map").hidden && document.activeElement.id==="map-switch"','collapsed shortcut switches without leaving map expanded');
  await click('#map-switch');await ui('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await yes('document.querySelector("#floating-map").hidden && document.activeElement.id==="map-switch"','collapsed picker cancellation returns to shortcut');
  await act('summary');await choose(chainA);await pause(950);
  assert.equal(await currentId(),visitA,'late summary cannot replace switched chain');await yes('document.querySelector("#summary-panel").hidden','switching clears visible old summary');
  await openMap();await act('map-delete');await switchByList(chainB);await yes('document.querySelector("[data-act=map-undo]").disabled','deletion undo is chain-local');
  await switchByList(chainA);await act('map-undo');await yes(`document.querySelector('[data-node="${visitA}"]')!==null`,'switching back retains local undo');
  await act('nav');await act('records');await act('save-path');await click('[data-act=delete-record]');
  await click('#map-switch');await yes(`!document.querySelector('#chain-picker [data-value="${chainA}"]')`,'whole-chain deletion removes switch entry');
  await click(`#chain-picker [data-value="${chainB}"]`);await act('back');
  await click('[data-act=open-new][data-value=a]');const separate=await taskId();assert.notEqual(separate,chainB,'explicit new tab opens separate chain');
  await openMap();await yes('document.querySelectorAll("[data-node]").length===1','new tab does not inherit source chain nodes');
  await click('#map-chain-trigger');await click('#chain-picker [data-act=home]');await fill('#query','记录阅读中的想法');await ui('document.querySelector("#search-form").requestSubmit()');
  await click('#map-switch');
  await yes(`(()=>{const labels=[...document.querySelectorAll('#chain-picker .chain-option')].filter(b=>b.querySelector('.chain-option-title').textContent==='记录阅读中的想法');return labels.length===2 && labels[0].dataset.value!==labels[1].dataset.value && labels[0].getAttribute('aria-label')!==labels[1].getAttribute('aria-label');})()`,'same-name explorations keep distinct identity and accessible labels');
  // Overflow uses a bounded list; long names never stretch the page or hide New.
  for(let i=0;i<7;i++){await click('#chain-picker [data-act=home]');await fill('#query',`待探索 ${i} · `+longLabel);await ui('document.querySelector("#search-form").requestSubmit()');await click('#map-switch');}
  for(const appearance of ['light','dark']){
    nativeTheme.themeSource=appearance;
    for(const width of [320,375,414,768,1180]){
      win.setContentSize(width,860);await pause(100);
      await yes(`(()=>{const list=document.querySelector('#chain-picker .chain-list'),create=document.querySelector('#chain-picker .chain-new'),r=create.getBoundingClientRect();return list.scrollHeight>list.clientHeight && r.left>=0 && r.right<=innerWidth && r.bottom<=document.querySelector('#floating-map').getBoundingClientRect().bottom && document.documentElement.scrollWidth<=innerWidth;})()`,'long label and many-chain picker stays bounded with New visible');
      await yes(`[...document.querySelectorAll('#chain-picker .chain-option')].every(b=>{const d=b.querySelector('.chain-option-detail'),r=d.getBoundingClientRect(),p=b.getBoundingClientRect();return r.height>=parseFloat(getComputedStyle(d).lineHeight)-1 && r.top>=p.top && r.bottom<=p.bottom;})`,'many-chain selector preserves last-page and node-count row');
      await yes(`(()=>{const list=document.querySelector('#chain-picker .chain-list').getBoundingClientRect(),selected=document.querySelector('#chain-picker [aria-pressed=true]').getBoundingClientRect();return selected.top>=list.top-1 && selected.bottom<=list.bottom+1;})()`,'current exploration is visible when opening or resizing the selector');
      if(width===375)await shot(`chain-picker-many-${appearance}`);
    }
  }
  await act('chains-demo');await shot('chain-reading-dark');
  checks.push('two-label initial demonstration','map selector and sidebar share chain identity','switch restores last visit, website input/scroll and question draft','continuation draft and orientation are chain-local','picker cancel and collapsed/expanded focus return','new exploration is separate from continuation','late generation and undo stay chain-local','whole-chain deletion removes switch entry','explicit new tab starts separate chain','duplicate names retain distinct identity','many-chain picker bounded at five widths and two appearances');
  assert.deepEqual(errors,[]);
  const report={status:'passed',scope:'offline synthetic design prototype, not production Electron or live API',checks};
  writeFileSync(path.join(__dirname,'.local/report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){console.error(e);writeFileSync(path.join(__dirname,'.local/report.json'),JSON.stringify({status:'failed',message:e.message}));process.exitCode=1;}
 finally{win?.destroy();app.quit();}
});
app.on('quit',()=>rmSync(dir,{recursive:true,force:true}));
