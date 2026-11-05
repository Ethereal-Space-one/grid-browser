// Real production UI/IPC + synthetic Search/Fetch/Model. No personal profile or external calls.
const { app, BrowserWindow, nativeTheme } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-understanding-')));
process.env.DEEPSEEK_API_KEY = 'synthetic-understanding-key'; delete process.env.DeepSeek_ApiKeyN;
const directory = path.join(__dirname, '../.local'); const calls = []; const report = []; let held; let waiting; let badQuote = false; let failRead = false;
const facts = 'Grid 的地图保留已访问的分支。返回旧节点不会自动重新搜索。保存完成后，可以在下次启动恢复任务。';
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body); calls.push({ url, body, signal: options.signal });
  if (held && url.endsWith('/chat/completions')) { waiting = held; held = undefined; return waiting.promise; }
  if (url.endsWith('/search')) return json({ results: Array.from({ length: 4 }, (_, i) => ({ title: ['Grid 浏览路径说明','来源与正文','问答的依据边界','保存与恢复'][i], url: 'https://example.com/' + i, snippet: facts })) });
  if (url.endsWith('/fetch')) { if (failRead) throw new Error('合成公开正文不可用'); return json({ title: 'Grid 浏览路径说明', content: facts + '\n\n' + '合成补充段落，仅用于阅读位置检查。\n'.repeat(500) }); }
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  const input = JSON.parse(body.messages[1].content); assert.equal(body.response_format.type, 'json_object'); assert.ok(!('tools' in body));
  const summary = body.max_tokens === 700;
  const insufficient = input.question.includes('没有说明');
  return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: insufficient ? '这版正文没有说明重启恢复的实现时间，无法据此回答。' : summary ? '可以沿地图找回已访问的分支。已保存的任务可在下次启动恢复。' : '可以返回旧分支，且不会因此自动重新搜索。保存完成后可在下次启动恢复任务。', insufficient,
    citations: insufficient ? [] : [{ source: 1, quote: badQuote ? '这不是来源文字' : summary ? 'Grid 的地图保留已访问的分支。' : '返回旧节点不会自动重新搜索。' }] }) } }] });
};
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
const deadline = setTimeout(() => app.exit(1), 120000);
const pause = () => new Promise(r => setTimeout(r,30));
async function until(check, label) { for (let i=0;i<250;i++) { if(await check()) return; await pause(); } throw new Error((label||'UI')+' timeout'); }
app.whenReady().then(async () => {
 let stage = 'startup'; const win=BrowserWindow.getAllWindows()[0]; const ui=code=>win.webContents.executeJavaScript(code); const state=()=>ui('window.grid.state()');
 const click=id=>ui(`document.getElementById(${JSON.stringify(id)}).click()`);
 const paint=()=>ui('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const animations=()=>ui('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
 const saved = name => { report.push(name); console.log(JSON.stringify({stage:name,status:'passed'})); };
 const modelCalls=()=>calls.filter(c=>c.url.endsWith('/chat/completions'));
 const type=async text=>ui(`document.querySelector('#question-input').value=${JSON.stringify(text)};document.querySelector('#question-input').dispatchEvent(new Event('input',{bubbles:true}))`);
 const ask=async text=>{ await type(text); await ui('document.querySelector("#question-form").requestSubmit()'); await until(async()=>!(await state()).pending,'answer'); await paint(); await animations(); };
 const jump=async id=>{const s=await state();await ui(`window.grid.jump(${JSON.stringify(id)},${JSON.stringify(s.ownerId)},${JSON.stringify(s.entryId)})`);await paint();};
 try {
  mkdirSync(directory,{recursive:true}); nativeTheme.themeSource='light';
  await until(async()=>{try{return await ui('Boolean(window.grid && document.querySelector("#question-form"))');}catch{return false;}});
  await ui('window.grid.submit("如何找回浏览分支？",{scene:"learning",contextual:false})'); await paint();
  await until(()=>ui('!document.querySelector("#results").classList.contains("hidden") && document.querySelectorAll("#result-list article").length===4 && document.querySelector("#summary-slot").offsetHeight>0'),'visible results');await animations();await paint();
  const search=await state(); assert.equal(modelCalls().length,0);
  win.setMinimumSize(320,480);
  for(const appearance of ['light','dark']) {nativeTheme.themeSource=appearance;for(const width of [320,375,414,768,1180]) {
    win.setContentSize(width,820);await paint();await animations();
    assert.ok(await ui('document.documentElement.scrollWidth<=innerWidth+1'),'results do not overflow');
    assert.ok(await ui('(()=>{const r=document.querySelector("#result-list article").getBoundingClientRect();return r.width>0&&r.top<innerHeight-50})()'),'first result remains reachable on the initial screen');
    assert.equal(await ui('document.querySelector("#search-details").open'),false);
    if(width===375)writeFileSync(path.join(directory,'understanding-results-compact-'+appearance+'.png'),(await win.capturePage()).toPNG());
  }}
  nativeTheme.themeSource='light';await paint();await animations();
  await ui('document.querySelector("#search-details").open=true');assert.ok(await ui('document.querySelector("#search-context").textContent.includes("实际查询")'));assert.equal(modelCalls().length,0);
  await ui('document.querySelector("#search-details").open=false');await paint();
  const resultTop=await ui('document.querySelector("#result-list").getBoundingClientRect().top');
  assert.ok(resultTop<650,'first result is visible before requesting a summary');
  assert.ok(await ui('document.querySelector("#summary-slot").getBoundingClientRect().height<160'),'idle summary is compact');
  writeFileSync(path.join(directory,'understanding-results-compact.png'),(await win.capturePage()).toPNG());
  const initialSummary={};initialSummary.promise=new Promise(r=>initialSummary.resolve=r);held=initialSummary;waiting=undefined;
  await click('summarize');await until(()=>Boolean(waiting),'explicit summary request');await paint();
  const expandedTop=await ui('document.querySelector("#result-list").getBoundingClientRect().top');
  assert.ok(expandedTop>resultTop,'only the explicit click expands the summary');
  initialSummary.resolve(json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'可以沿地图找回已访问的分支。',insufficient:false,citations:[{source:1,quote:'Grid 的地图保留已访问的分支。'}]})}}]}));
  await until(async()=>Boolean((await state()).summary) && await ui('Boolean(document.querySelector("#summary-text").textContent)'),'summary'); await animations();
  assert.equal((await state()).entryId,search.entryId); assert.equal((await state()).path.nodes.length,search.path.nodes.length);
  assert.equal(await ui('document.querySelector("#result-list").getBoundingClientRect().top'),expandedTop,'async answer never moves results');
  assert.equal(await ui('document.querySelectorAll("#result-list article").length'),4);
  assert.ok(await ui('document.querySelector("#summary-slot").textContent.includes("未核对原文")'));
  writeFileSync(path.join(directory,'understanding-results-light.png'),(await win.capturePage()).toPNG());
  saved('compact-results-first-explicit-summary-expansion-stable-async-slot-and-citations');

  stage='summary failure and cancellation';
  await ui('window.grid.submit("总结失败仍可打开来源",{contextual:false})'); badQuote=true;
  await click('summarize'); await until(async()=>(await state()).issue?.kind==='summary'); badQuote=false;
  assert.equal(await ui('document.querySelectorAll("#result-list article").length'),4);
  const summaryLate={};summaryLate.promise=new Promise(r=>summaryLate.resolve=r); held=summaryLate; waiting=undefined;
  await click('summarize'); await until(()=>Boolean(waiting)); await click('summary-cancel'); await until(async()=>!(await state()).pending);
  assert.ok(await ui('document.querySelector("#summary-label").textContent.includes("停止")')); assert.ok(modelCalls().at(-1).signal.aborted);
  waiting.resolve(json({choices:[{finish_reason:'stop',message:{content:'{}'}}]}));await pause(); assert.equal((await state()).summary,undefined);
  await jump(search.entryId);
  saved('summary-failure-and-stop-retain-openable-results');

  stage='independent question';
  await ui('window.grid.read("https://example.com/0")'); await paint(); const reading=await state();
  await ui('document.querySelector("#surface").scrollTop=480'); await until(async()=>(await state()).presentation.scrollTop>=470);
  const readCalls=calls.length; await click('ask-reading'); await until(async()=>(await state()).mode==='question'); await paint();
  assert.equal(calls.length,readCalls); assert.ok(await ui('document.querySelector("#reading").classList.contains("hidden")'));
  const draft=await state(); await ask('返回旧分支会重新搜索吗？'); const answered=await state();
  assert.equal(answered.question.source.readingId,reading.reading.id); assert.equal(answered.path.nodes.length,draft.path.nodes.length+1);
  assert.equal(answered.path.nodes.at(-1).status,'ready'); assert.ok(answered.question.answer.citations.length);
  await ui('document.querySelector("#answer-citations button").click()'); assert.ok(await ui('document.querySelector("#question-evidence").open'));
  assert.equal(await ui('document.querySelector("#question-source-text mark").textContent'),'返回旧节点不会自动重新搜索。');
  await ui('document.querySelector("#question-evidence").open=false;document.querySelector("#surface").scrollTop=0');
  await paint(); await animations(); writeFileSync(path.join(directory,'understanding-answer-light.png'),(await win.capturePage()).toPNG());
  saved('independent-question-submit-one-node-and-versioned-exact-evidence');

  stage='branch drafts';
  await type('还没有提交的草稿'); await until(async()=>(await state()).presentation.questionDraft==='还没有提交的草稿');
  const beforeReturn=calls.length; await click('question-origin'); await until(async()=>(await state()).entryId===reading.entryId); await paint();
  assert.ok(await ui('document.querySelector("#surface").scrollTop>=470'));
  await jump(answered.entryId); assert.equal(await ui('document.querySelector("#question-input").value'),'还没有提交的草稿'); assert.equal(calls.length,beforeReturn);
  await jump(draft.entryId); await ask('另一条分支，没有说明实现时间？'); const branch=await state(); assert.ok(branch.question.answer.insufficient);
  await jump(answered.entryId); assert.ok((await state()).path.nodes.some(n=>n.id===branch.entryId));
  await jump(search.entryId); const cached=calls.length; await click('summarize'); assert.equal(calls.length,cached);
  saved('cached-summary-answer-drafts-branches-and-original-reading-position');

  stage='failure and cancel';
  await jump(draft.entryId); badQuote=true; await ask('引用失败例子'); assert.ok((await state()).issue.message.includes('不匹配')); assert.equal((await state()).question.answer,undefined); badQuote=false;
  const late={}; late.promise=new Promise(r=>late.resolve=r); held=late; waiting=undefined;
  await type('等待后取消'); await ui('document.querySelector("#question-form").requestSubmit()'); await until(()=>Boolean(waiting),'held model');
  const pending=await state(); await click('question-cancel'); await until(async()=>!(await state()).pending);
  assert.ok(modelCalls().at(-1).signal.aborted); assert.ok(await ui('document.querySelector("#question-status").textContent.includes("停止")'));
  waiting.resolve(json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'不应出现',insufficient:true,citations:[]})}}]})); await pause();
  assert.equal((await state()).entryId,pending.entryId); assert.equal((await state()).question.answer,undefined);
  saved('invalid-evidence-rejected-cancel-aborts-transport-and-late-answer-stays-discarded');

  stage='owner fences';
  const old=await state(); await ui('window.grid.tabNew()');
  await assert.rejects(ui(`window.grid.ask("旧请求",${JSON.stringify(old.ownerId)},${JSON.stringify(old.entryId)},${JSON.stringify(old.question.id)})`));
  await ui(`window.grid.tabSelect(${JSON.stringify(old.ownerId)})`);
  await assert.rejects(ui(`window.grid.beginQuestion(${JSON.stringify(old.ownerId)},"wrong-node")`));
  saved('tab-owner-node-and-version-fences');

  stage='keyboard reload and safe text';
  await jump(answered.entryId); await paint(); win.webContents.focus();
  await ui('document.querySelector("#question-input").focus()');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await until(()=>ui('document.activeElement.id === "question-submit"'));
  const beforeReload=calls.length; win.webContents.reload();
  await until(async()=>{try{return await ui('document.querySelector("#question-input").value === "还没有提交的草稿"');}catch{return false;}});
  assert.equal(calls.length,beforeReload);await ask('<script>window.unsafeQuestion=true</script>');
  assert.equal(await ui('Boolean(window.unsafeQuestion)'),false); assert.equal(await ui('document.querySelectorAll("#question-view script").length'),0);
  saved('native-keyboard-order-ui-reload-restores-draft-and-untrusted-question-is-plain-text');

  stage='public-page fallback';
  // HTTPS navigation is intercepted in the isolated session; no external website is loaded.
  const profile=require('electron').session.fromPartition('persist:grid-m0');
  profile.protocol.handle('https',()=>new Response('<title>公开合成原页</title><h1>公开合成原页</h1><input value="PRIVATE_INPUT_NOT_MODEL"><div contenteditable>PRIVATE_EDIT_NOT_MODEL</div>',{headers:{'Content-Type':'text/html'}}));
  await ui('window.grid.open("https://example.com/native")'); await until(async()=>(await state()).agent?.page);
  win.setMinimumSize(320,480);
  for(const width of [320,375,414,768,1180]) { win.setContentSize(width,820); await paint();
    assert.ok(await ui('(()=>{const r=document.querySelector("#ask-page").getBoundingClientRect();const a=document.querySelector("#agent-toggle").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&a.right<=innerWidth&&document.querySelector("#input").getBoundingClientRect().width>=50})()'),'native question and editable address remain visible');
  }
  const beforeOpen=modelCalls().length; await click('ask-page'); await until(async()=>(await state()).mode==='question'); assert.equal(modelCalls().length,beforeOpen);
  assert.ok(await ui('document.querySelector("#question-scope").textContent.includes("登录态")'));
  failRead=true; await ask('没有公开正文怎么办？'); assert.equal(modelCalls().length,beforeOpen); assert.ok((await state()).issue.message.includes('不可用'));
  failRead=false; await ask('公开正文说了什么？'); assert.equal((await state()).question.source.url,'https://example.com/native');
  assert.ok(!JSON.stringify(modelCalls().at(-1).body).includes('PRIVATE_'));
  saved('native-entry-fetches-only-public-text-no-logged-in-or-editable-page-capture');

  stage='responsive and contrast';
  const samples=[]; const ratio=(a,b)=>{const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  for(const appearance of ['light','dark']) { nativeTheme.themeSource=appearance;
    for(const width of [320,375,414,768,1180]) { win.webContents.setZoomFactor(1); win.setMinimumSize(200,200); win.setContentSize(width,820); await paint();
      assert.ok(await ui('document.documentElement.scrollWidth<=innerWidth+1'),'horizontal viewport overflow');
      assert.ok(await ui('document.querySelector("#question-input").getBoundingClientRect().width>100'));
      for(const scene of ['professional','learning','living','entertainment','inspiration']) { await ui(`window.grid.setScene(${JSON.stringify(scene)})`); await paint();
        await animations(); const colors=await ui('(()=>{const s=getComputedStyle(document.querySelector("#question-input"));const t=getComputedStyle(document.querySelector("#question-status"));return [s.color,s.backgroundColor,t.color,getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim()]})()');
        const button=await ui('(()=>{const b=getComputedStyle(document.querySelector("#question-origin"));return [b.color,b.backgroundColor]})()');
        samples.push({appearance,width,scene,field:ratio(colors[0],colors[1]),button:ratio(button[0],button[1])});
      }
    }
  }
  assert.ok(samples.every(s=>s.field>=4.5 && s.button>=4.5)); nativeTheme.themeSource='dark'; win.setContentSize(1180,820); await paint(); await animations();
  writeFileSync(path.join(directory,'understanding-answer-dark.png'),(await win.capturePage()).toPNG());
  win.webContents.setZoomFactor(1.5); await paint(); assert.ok(await ui('document.documentElement.scrollWidth<=innerWidth+1')); win.webContents.setZoomFactor(1);
  win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await ui('getComputedStyle(document.querySelector("#question-origin")).transitionDuration'),'0s'); win.webContents.debugger.detach();
  saved('question-light-dark-five-scenes-narrow-widths-zoom-reduced-motion-and-contrast');
  nativeTheme.themeSource='light'; win.setContentSize(1180,820); await jump(answered.entryId); await paint();
  await animations(); await ui('document.querySelector("#surface").scrollTop=0');
  const tokens=readFileSync(path.join(__dirname,'../../../tokens.css'),'utf8'); const css=readFileSync(path.join(__dirname,'../src/renderer/understanding.css'),'utf8');
  const states=['default','hover','focus','active','disabled','loading','error','success'];
  writeFileSync(path.join(directory,'understanding.preview.html'),`<!doctype html><meta charset="utf-8"><title>理解组件八状态 · 合成检查</title><style>${tokens}\n${css}\nbody{background:var(--color-paper);color:var(--color-ink);font-family:var(--font-body);padding:var(--space-lg)}article{margin-block:var(--space-md)}</style><h1>提问控件八状态</h1><p>合成设计检查，不属于生产页面。</p>${states.map(s=>`<article class="understanding"><p>${s}</p><button class="${['hover','focus','active'].includes(s)?'is-'+s:''}" data-state="${s}" ${s==='disabled'?'disabled':''}>${s==='loading'?'正在回答…':s==='error'?'引用未匹配，请重问':s==='success'?'已生成，可核对依据':'提问'}</button></article>`).join('')}`);
  const preview=new BrowserWindow({width:620,height:1060,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await preview.loadFile(path.join(directory,'understanding.preview.html')); await preview.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(path.join(directory,'understanding-states.png'),(await preview.capturePage()).toPNG());preview.close();
  writeFileSync(path.join(directory,'understanding-e2e-report.json'),JSON.stringify({status:'passed',report,modelCalls:modelCalls().length,contrastMinimum:Math.min(...samples.flatMap(s=>[s.field,s.button])),scope:'synthetic provider only; no live model quality claim'},null,2));
  console.log(JSON.stringify({status:'passed',groups:report.length}));
 }catch(error){process.exitCode=1;console.error(JSON.stringify({status:'failed',stage,message:error.message}));}
 finally{clearTimeout(deadline);for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.close();app.quit();}
});
