const {app,BrowserWindow,safeStorage}=require('electron');
const {mkdtempSync,readFileSync}=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=mkdtempSync('/private/tmp/grid-key-test-');app.setPath('userData',directory);
delete process.env.DEEPSEEK_API_KEY;delete process.env.DeepSeek_ApiKeyN;require('../dist/main.js');
app.once('will-quit',()=>{if(process.exitCode)app.exit(Number(process.exitCode));});
app.whenReady().then(async()=>{
 try{
  const ui=code=>BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code);
  for(let i=0;i<100;i++){try{if(await ui('Boolean(window.grid)'))break;}catch{}await new Promise(r=>setTimeout(r,30));}
  if(await safeStorage.isAsyncEncryptionAvailable()){
   await ui(`document.querySelector('#provider-key').value='synthetic-key-for-storage-only';document.querySelector('#provider-form').requestSubmit()`);
   for(let i=0;i<100;i++){if((await ui('window.grid.state()')).keyReady)break;await new Promise(r=>setTimeout(r,30));}
   assert.equal((await ui('window.grid.state()')).keyReady,true);
   assert.equal(await ui('document.querySelector("#provider-key").value'),'');
   const bytes=readFileSync(path.join(directory,'provider-key.bin'));assert.ok(!bytes.includes(Buffer.from('synthetic-key-for-storage-only')));
   assert.equal((await safeStorage.decryptStringAsync(bytes)).result,'synthetic-key-for-storage-only');
   console.log(JSON.stringify({status:'passed',encryptedAtRest:true,inputCleared:true}));
  }else{await assert.rejects(ui(`window.grid.configureKey('synthetic-key-for-storage-only')`));console.log(JSON.stringify({status:'passed',unavailableStorageRejected:true}));}
 }catch(e){console.error(e);process.exitCode=1;}finally{app.quit();}
});
