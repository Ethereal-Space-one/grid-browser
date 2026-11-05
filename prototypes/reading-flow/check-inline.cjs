// Runs the actual generated fragment inside the bundled preview kit, offline.
// Pass: electron check-inline.cjs <fragment.html> <visualize skill directory>
const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const [fragmentPath,skillDirectory]=process.argv.slice(2);
if(!fragmentPath||!skillDirectory)throw new Error('Pass fragment path and visualize skill directory');
const fragment=readFileSync(fragmentPath,'utf8');
const kit=readFileSync(path.join(skillDirectory,'assets/visualize.html'),'utf8');
const css=readFileSync(path.join(skillDirectory,'assets/visualize.css'),'utf8');
const profile=mkdtempSync(path.join(tmpdir(),'grid-inline-'));
const output=path.join(__dirname,'.local');mkdirSync(output,{recursive:true});
app.setPath('userData',profile);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Same script-error classification as the host. Ordinary runtime errors stay visible.
const errorProbe=`<script>
window.inlineErrors=[];
addEventListener('error',event=>{
 if(event.target?.localName==='script'){
  const handled=typeof event.target.onerror==='function';
  queueMicrotask(()=>{if(!handled&&!event.defaultPrevented)inlineErrors.push('Visualization script could not be loaded');});
 }else if(event.target===window)inlineErrors.push(event.message);
},true);
addEventListener('unhandledrejection',event=>inlineErrors.push(String(event.reason)));
</script>`;
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let win,exitCode=0;
app.whenReady().then(async()=>{
 const blocked=[];
 try{
  win=new BrowserWindow({width:1180,height:850,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(details,done)=>{blocked.push(details.url);done({cancel:true});});
  const inner=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${errorProbe}${kit.replace('<!--__INLINE_VISUALIZATION_FRAGMENT__-->',()=>fragment)}</body></html>`;
  const wrapper=path.join(output,'inline-check.html');
  writeFileSync(wrapper,`<!doctype html><meta charset="utf-8"><iframe sandbox="allow-scripts" style="border:0;width:100%;height:810px" srcdoc="${escape(inner)}"></iframe>`);
  await win.loadFile(wrapper);await pause(250);
  const frame=win.webContents.mainFrame.frames[0];assert.ok(frame,'preview iframe exists');
  const ui=code=>frame.executeJavaScript(code);
  for(let attempt=0;attempt<30;attempt++){
    if(await ui('document.querySelector("#map-chain-trigger") && document.readyState==="complete"'))break;
    await pause(100);
  }
  await ui('if(document.querySelector("#navigation").hidden)document.querySelector("[data-act=nav]").click()');
  assert.equal(await ui('document.querySelectorAll("#navigation .chain-option").length'),2);
  assert.ok(blocked.some(url=>url.includes('floating-ui.core')),'tooltip dependency was blocked');
  assert.ok(blocked.some(url=>url.includes('/lucide@')),'icon dependency was blocked');
  assert.deepEqual(await ui('inlineErrors'),[],'optional preview helpers must degrade without a load failure');
  await ui('document.querySelector("#map-chain-trigger").click();document.querySelector("#chain-picker [aria-pressed=false]").click()');
  assert.equal(await ui('document.querySelector("#grid-flow").dataset.page'),'c');
  await ui('document.querySelector("#navigation [aria-pressed=false]").click()');
  assert.equal(await ui('document.querySelector("#grid-flow").dataset.page'),'a');
  await ui('document.querySelector("[data-act=summary]").click()');await pause(950);
  assert.ok(await ui('document.querySelector("#summary-panel").textContent.includes("文章")'));
  // Hidden Electron windows change activeElement without firing native focus events.
  win.show();win.focus();win.webContents.focus();await pause(100);
  await ui('document.activeElement.blur();document.querySelector("#map-chain-trigger").focus()');await pause(100);
  assert.ok(await ui('!!document.querySelector("[data-grid-tooltip]")'),'offline full-name tooltip remains available');
  // An unrelated script failure must still be reported by the host.
  await ui(`(()=>{const s=document.createElement('script');s.src='https://example.invalid/required.js';document.head.append(s);})()`);await pause(100);
  assert.deepEqual(await ui('inlineErrors'),['Visualization script could not be loaded']);
  await ui('inlineErrors.length=0');
  await ui(`dispatchEvent(new ErrorEvent('error',{message:'intentional runtime failure'}))`);
  assert.deepEqual(await ui('inlineErrors'),['intentional runtime failure']);
  await ui('inlineErrors.length=0');
  writeFileSync(path.join(output,'inline-preview.png'),(await win.capturePage()).toPNG());
  const report={status:'passed',scope:'generated fragment in sandboxed iframe with bundled preview kit; optional CDN requests deliberately blocked',checks:['two seeded chains render','switch chains in both directions','summary works','local full-name tooltip','unrelated script failures stay reported','runtime failures stay reported'],blocked};
  writeFileSync(path.join(output,'inline-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error(error);exitCode=1;writeFileSync(path.join(output,'inline-report.json'),JSON.stringify({status:'failed',message:error.message}));}
 finally{win?.destroy();rmSync(profile,{recursive:true,force:true});app.exit(exitCode);}
});
