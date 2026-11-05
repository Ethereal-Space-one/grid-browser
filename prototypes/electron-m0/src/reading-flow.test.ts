import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationStore } from './application/navigation-store';
import { parseTask } from './contracts/task-storage';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
const page=(value:string)=>({mode:'page' as const,value,scene:'professional' as const});
test('remove projects descendants to retained ancestors; undo keeps a new branch and persistent source records',()=>{
  const tree=new NavigationStore();const root=tree.rootId;
  const a=tree.visit(page('https://example.com/a'));const b=tree.visit(page('https://example.com/b'));const c=tree.visit(page('https://example.com/c'));
  tree.remove(b);assert.equal(tree.snapshot().nodes.find(n=>n.id===c)?.parentId,a);
  assert.equal(tree.navigationTarget(-1),a);assert.equal(tree.get(b)?.content.value,'https://example.com/b');
  tree.jump(a);const d=tree.visit(page('https://example.com/d'));tree.undoRemoval();
  assert.equal(tree.snapshot().nodes.find(n=>n.id===c)?.parentId,b);assert.ok(tree.snapshot().nodes.some(n=>n.id===d));
  tree.remove(root);const visible=tree.snapshot();assert.equal(visible.nodes.find(n=>n.id===a)?.parentId,undefined);
  const restored=new NavigationStore({},parseTask(tree.exportTask()));assert.equal(restored.snapshot().nodes.some(n=>n.id===root),false);assert.ok(restored.get(root));
  tree.remove(d);assert.equal(tree.current().id,d);assert.equal(tree.snapshot().currentRemoved,true);assert.equal(tree.navigationTarget(-1),a);
  tree.undoRemoval();assert.equal(tree.current().id,d);
});
test('page summary stays on its page, uses public bounded source, persists and rejects late results',async()=>{
  let release:((v:any)=>void)|undefined;let held=false;let received:any;
  const provider:BrowsingProvider={search:async()=>[],read:async()=>({title:'公开资料',content:'公开依据。'.repeat(5000)}),extract:async()=>({text:'',truncated:false}),
    model:async(request,signal)=>{received={request,signal};if(held)return new Promise(resolve=>{release=resolve;});return{text:'概括',insufficient:false,citations:[]};}};
  const s=new BrowsingSession(provider,()=>{});s.open('https://example.com/a');const entry=s.snapshot().entryId;const count=s.snapshot().path.nodes.length;
  await s.summarizePage();assert.equal(s.snapshot().entryId,entry);assert.equal(s.snapshot().path.nodes.length,count);assert.equal(received.request.sources[0].text.length,16000);
  assert.equal(s.snapshot().summary?.searchId,`page:${entry}`);assert.ok(parseTask(s.exportTask()).records.some(r=>r.kind==='summary'));
  const stored=parseTask(s.exportTask()).records.find(r=>r.kind==='summary');
  assert.equal(stored?.value.pageSource?.url,'https://example.com/a');assert.ok(stored?.value.pageSource?.fetchedAt);assert.ok(!JSON.stringify(stored).includes('公开依据。'));
  s.open('https://example.com/b');held=true;const pending=s.summarizePage();await new Promise(r=>setTimeout(r,0));s.home();release?.({text:'late',insufficient:false,citations:[]});await pending;
  assert.equal(received.signal.aborted,true);assert.notEqual(s.snapshot().summary?.text,'late');
});
