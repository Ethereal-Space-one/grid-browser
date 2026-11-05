const {spawnSync}=require('node:child_process');const path=require('node:path');const assert=require('node:assert/strict');const {mkdtempSync}=require('node:fs');
const {Client}=require('@modelcontextprotocol/client');const {StdioClientTransport}=require('@modelcontextprotocol/client/stdio');const {LocalBridge}=require('../dist/local-bridge');
const bundle=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../.local/release/Grid Preview.app');const binary=path.join(bundle,'Contents/MacOS/Grid Preview');
const env={...process.env};delete env.DEEPSEEK_API_KEY;delete env.DeepSeek_ApiKeyN;
const smoke=spawnSync(binary,['--preview-smoke','--user-data-dir='+mkdtempSync('/private/tmp/grid-bundle-')],{env,encoding:'utf8',timeout:20000});
assert.equal(smoke.status,0);assert.ok(smoke.stdout.includes('"packagedPreview":"passed"'));
const page={documentId:'bundle-fixture',url:'http://127.0.0.1:8765/actions.html',title:'synthetic'};
const bridge=new LocalBridge(()=>page,async()=>({...page,text:'packaged-runtime-ok',truncated:false,trust:'test'}),()=>{});
const client=new Client({name:'Package smoke client',version:'1.0'});
(async()=>{try{
 await bridge.start();
 await client.connect(new StdioClientTransport({command:binary,args:[path.join(bundle,'Contents/Resources/app/dist/mcp.js'),'--connection-file',bridge.connectionFile],env:{...env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'}));
 await client.callTool({name:'grid_connection_status',arguments:{}});bridge.grant(bridge.state().connections[0].id);
 const result=await client.callTool({name:'grid_page_snapshot',arguments:{}});assert.ok(!result.isError);assert.ok(result.content[0].text.includes('packaged-runtime-ok'));
 console.log(JSON.stringify({status:'passed',packagedUi:true,bundledMcpRuntime:true}));
}catch(e){console.error(e);process.exitCode=1;}finally{await client.close();bridge.close();}})();
