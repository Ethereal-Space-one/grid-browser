const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-scenes-')));
process.env.DEEPSEEK_API_KEY = 'synthetic-test-key';
const requests = [];
global.fetch = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) });
  const payload = url.endsWith('/search') ? { results: [{title:'场景测试',url:'https://example.com/article',snippet:'测试摘要'}] }
    : url.endsWith('/fetch') ? {title:'测试原文',content:'完整测试正文：预算 100 元；仅适用于本次实验。'}
    : {choices:[{message:{content:'仅依据原文：预算 100 元。'}}]};
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
};
require('../dist/main.js');
app.once('will-quit', () => { if (process.exitCode) app.exit(Number(process.exitCode)); });
async function until(check) { for(let n=0;n<200;n++){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI timeout'); }
const deadline = setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 try {
  const win=BrowserWindow.getAllWindows()[0]; const ui=s=>win.webContents.executeJavaScript(s);
  await until(async()=>{try{return !!await ui('Boolean(window.grid)');}catch{return false;}});
  for(const scene of ['professional','learning','living','entertainment','inspiration']){
   await ui(`window.grid.home()`);
   await ui(`document.querySelector('input[value="${scene}"]').click()`);
   await until(async()=>(await ui('window.grid.state()')).scene===scene);
   await ui(`document.querySelector('#home-query').value='浏览器 site:github.com'; document.querySelector('#home-search').requestSubmit()`);
   await until(async()=>await ui(`!document.querySelector('#results').classList.contains('hidden') && document.querySelector('#search-context').textContent.includes('${scene === 'professional' ? '专业' : scene === 'learning' ? '学习' : scene === 'living' ? '生活' : scene === 'entertainment' ? '娱乐' : '灵感'}场景')`));
   assert.ok(requests.at(-1).body.query.startsWith('浏览器 site:github.com '));
  }
  await ui('window.grid.home()');
  await ui(`document.querySelector('#contextual-search').checked=false;document.querySelector('#home-query').value='原样查询';document.querySelector('#home-search').requestSubmit()`);
  await until(async()=>requests.at(-1).body.query==='原样查询');
  await until(async()=>await ui('document.querySelector("#results-title").textContent === "原样查询"'));
  await ui('document.querySelectorAll(".result-actions button")[1].click()');
  await until(async()=>await ui('!document.querySelector("#reading").classList.contains("hidden")'));
  assert.equal(requests.at(-1).url.endsWith('/fetch'),true);
  assert.deepEqual(Object.keys(requests.at(-1).body),['url']);
  const original=await ui('document.querySelector("#reading-content").textContent');
  await ui('document.querySelector("#extract-scene").click()');
  await until(async()=>await ui('document.querySelector("#extraction-content").textContent.includes("100")'));
  assert.equal(requests.at(-1).url,'https://api.deepseek.com/chat/completions');
  assert.ok(requests.at(-1).body.messages[0].content.includes('灵感'));
  assert.equal(await ui('document.querySelector("#reading-content").textContent'),original);
  global.fetch=async()=>{throw Error('synthetic failure');};
  await ui('document.querySelector("#extract-scene").click()');
  await until(async()=>await ui('document.querySelector("#extraction-label").textContent.includes("失败")'));
  assert.equal(await ui('document.querySelector("#reading-content").textContent'),original);
  await ui('window.grid.home()');
  await ui('document.querySelector("input[value=entertainment]").click()');
  await until(async()=>(await ui('window.grid.state()')).scene==='entertainment');
  await new Promise(r=>setTimeout(r,350));
  mkdirSync(path.join(__dirname,'../.local'),{recursive:true});
  writeFileSync(path.join(__dirname,'../.local/scenes-home.png'),(await win.capturePage()).toPNG());
  console.log(JSON.stringify({status:'passed',checks:['five-scenes-affect-search','raw-query-opt-out','fetch-schema','scene-model-prompt','original-retained','extraction-failure-fallback'],network:'mocked; production IPC and UI'}));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{clearTimeout(deadline);app.quit();}
});
