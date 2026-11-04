const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!(process.env.DEEPSEEK_API_KEY || process.env.DeepSeek_ApiKeyN)) throw Error('Configure DeepSeek key locally first');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'grid-scenes-live-')));
require('../dist/main.js');
const report=[];
app.once('will-quit',()=>{if(process.exitCode)app.exit(Number(process.exitCode));});
const deadline=setTimeout(()=>{console.error('Live scene test timeout');app.exit(1);},180000);
app.whenReady().then(async()=>{
 try {
  const win=BrowserWindow.getAllWindows()[0];const ui=s=>win.webContents.executeJavaScript(s);
  for(let i=0;i<200;i++){try{if(await ui('Boolean(window.grid)'))break;}catch{}await new Promise(r=>setTimeout(r,30));}
  for(const scene of ['professional','learning','living','entertainment','inspiration']){
   const started=Date.now();
   const result=await ui(`window.grid.submit('Chromium 浏览器', {scene:${JSON.stringify(scene)},contextual:true})`);
   assert.equal(result.scene,scene);assert.ok(Array.isArray(result.results));
   report.push({stage:'search',scene,count:result.results.length,milliseconds:Date.now()-started});console.log(JSON.stringify(report.at(-1)));
  }
  const raw=await ui(`window.grid.submit('Chromium 浏览器',{scene:'professional',contextual:false})`);
  assert.equal(raw.actualQuery,'Chromium 浏览器');report.push({stage:'raw-search',count:raw.results.length});
  const url='https://www.electronjs.org/docs/latest/api/web-contents-view';
  const reading=await ui(`window.grid.read(${JSON.stringify(url)})`);assert.ok(reading.content.length>0);
  report.push({stage:'fetch',source:url,characters:reading.content.length});console.log(JSON.stringify(report.at(-1)));
  for(const scene of ['professional','learning','living','entertainment','inspiration']){
   const started=Date.now();const result=await ui(`window.grid.extract(${JSON.stringify(url)},${JSON.stringify(scene)})`);
   assert.equal(result.scene,scene);assert.ok(result.text.trim().length>0);
   report.push({stage:'extract',scene,characters:result.text.length,milliseconds:Date.now()-started});console.log(JSON.stringify(report.at(-1)));
  }
 }catch(error){report.push({stage:'failure',message:error.message});process.exitCode=1;}
 finally{
  clearTimeout(deadline);mkdirSync(path.join(__dirname,'../.local'),{recursive:true});
  const result={status:process.exitCode?'failed':'passed',scope:'Live API connectivity and nonempty outputs; relevance and faithfulness require human review',report};
  writeFileSync(path.join(__dirname,'../.local/scenes-live-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.quit();
 }
});
