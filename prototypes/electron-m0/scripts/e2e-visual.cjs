const {app,BrowserWindow,nativeTheme}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'grid-visual-')));
delete process.env.DEEPSEEK_API_KEY;delete process.env.DeepSeek_ApiKeyN;
require('../dist/main.js');
app.once('will-quit',()=>{if(process.exitCode)app.exit(Number(process.exitCode));});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 try{
  const win=BrowserWindow.getAllWindows()[0];const ui=s=>win.webContents.executeJavaScript(s);
  for(let i=0;i<100;i++){try{if(await ui('Boolean(window.grid)'))break;}catch{}await pause(40);}
  win.setMinimumSize(320,480);
  const dir=path.join(__dirname,'../.local');mkdirSync(dir,{recursive:true});
  for(const appearance of ['light','dark']){
   nativeTheme.themeSource=appearance;
   for(const width of [320,375,414,768,1180]){
    win.setContentSize(width,820);await pause(200);
    assert.equal(await ui('document.documentElement.scrollWidth <= innerWidth'),true,`${appearance} ${width} overflow`);
    assert.equal(await ui(`(() => { const r=document.querySelector('#home-search button').getBoundingClientRect();return r.right<=innerWidth && r.top>=0 && r.bottom<innerHeight;})()`),true,'search action visible');
    if(width===1180)writeFileSync(path.join(dir,`preview-${appearance}.png`),(await win.capturePage()).toPNG());
   }
  }
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await ui('document.querySelector("input[value=learning]").click()');
  await pause(300);assert.equal(await ui('document.querySelector("#welcome").getAnimations().length'),0);win.webContents.debugger.detach();
  console.log(JSON.stringify({status:'passed',appearances:['light','dark'],widths:[320,375,414,768,1180],reducedMotion:true}));
 }catch(e){console.error(e);process.exitCode=1;}finally{app.quit();}
});
