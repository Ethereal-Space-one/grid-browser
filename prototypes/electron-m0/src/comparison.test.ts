import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import { comparisonBody, comparisonCompletion } from './providers/comparison';
import { comparisonSelectorSchema, type ComparisonAnalysis, type ComparisonRequest } from './contracts/comparison';
import { questionSource } from './contracts/understanding';
import { deepSeekProvider } from './providers/deepseek';
const left = questionSource({ id: 'left-version', url: 'https://example.com/a', title: '资料 A', fetchedAt: '2026-11-05T00:00:00Z', content: '免费方案保留 7 天。仅适用于个人账户。' });
const right = questionSource({ id: 'right-version', url: 'https://example.com/b', title: '资料 B', fetchedAt: '2026-11-05T00:01:00Z', content: '免费方案保留 30 天。适用于团队账户。' });
const request: ComparisonRequest = { scene: 'professional', topic: '保留期限有什么差别？', sources: [left, right] };
const supported = (text: string, quote: string) => ({ status: 'supported' as const, text, quotes: [quote] });
const output = () => ({ overview: '两份资料适用对象不同，不能直接当成冲突。', limitations: '仅依据所给片段，未核对原页。', rows: [{ aspect: '期限与账户', relation: 'different-scope' as const, left: supported('个人账户 7 天。', '免费方案保留 7 天。'), right: supported('团队账户 30 天。', '免费方案保留 30 天。') }] });
const payload = (value: object, reason = 'stop') => ({ choices: [{ finish_reason: reason, message: { content: JSON.stringify(value) } }] });
const analysis = (): ComparisonAnalysis => comparisonCompletion(payload(output()), request);
const provider = (patch: Partial<BrowsingProvider> = {}): BrowsingProvider => ({ search: async () => [left,right,{...right,url:'https://example.com/c'}].map(d=>({title:d.title,url:d.url,snippet:d.text,site:'example.com',date:null})), read: async url => ({ title: url === left.url ? left.title : right.title, content: url === left.url ? left.text : right.text }), extract: async () => ({ text: '合成重点', truncated: false }), compare: async () => analysis(), ...patch });
async function selected(s: BrowsingSession) { const search=(await s.search('对照保留期限', 'learning', false))!; for(const index of [0,1]) s.chooseComparison({kind:'result',searchId:search.id,index}); return search; }
const deferred = <T>() => { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; };

test('comparison schemas reject arbitrary URLs, stale results, fragments and excess selections without navigation or requests', async () => {
  let calls=0;const s=new BrowsingSession(provider({read:async()=>{calls++;return {title:'unexpected',content:'unexpected'};}}),()=>{});
  const search=(await s.search('q','professional',false))!;const before=s.snapshot();
  assert.equal(comparisonSelectorSchema.safeParse({kind:'result',searchId:search.id,index:0,url:'https://foreign.example'}).success,false);
  assert.throws(()=>s.chooseComparison({kind:'result',searchId:'old',index:0}),/变化/);
  assert.throws(()=>s.chooseComparison({kind:'result',searchId:search.id,index:99}),/变化/);
  s.chooseComparison({kind:'result',searchId:search.id,index:0});s.chooseComparison({kind:'result',searchId:search.id,index:1});
  assert.equal(s.snapshot().entryId,before.entryId);assert.equal(s.snapshot().path.nodes.length,before.path.nodes.length);assert.equal(calls,0);
  assert.throws(()=>s.chooseComparison({kind:'result',searchId:search.id,index:2}),/两份/);
  const a=s.snapshot().comparisonSelection[0];s.removeComparison(a.id);assert.equal(s.snapshot().comparisonSelection.length,1);assert.throws(()=>s.removeComparison(a.id),/变化/);
  s.open('https://example.com/b#part');await s.read('https://example.com/b#part');assert.throws(()=>s.chooseComparison({kind:'reading',readingId:s.snapshot().reading!.id}),/已选/);
});
test('comparison prompt is bounded by selected versions, does not provide tools, and validates each quote on its own side', async () => {
  const body=comparisonBody(request);assert.equal(body.response_format.type,'json_object');assert.equal(body.thinking.type,'disabled');assert.ok(!('tools' in body));assert.ok(body.messages[0].content.includes('different-scope'));
  assert.equal(analysis().rows[0].relation,'different-scope');
  for(const invalid of ['foreign','missing','length'] as const){const value=output();if(invalid==='foreign')value.rows[0].left.quotes=[right.text];if(invalid==='missing')value.rows[0].right.quotes=[];assert.throws(()=>comparisonCompletion(payload(value,invalid==='length'?'length':'stop'),request));}
  const p=deepSeekProvider(()=> 'synthetic-key',async()=>new Response(JSON.stringify(payload(output()))));assert.equal((await p.compare!(request,new AbortController().signal)).rows.length,1);
});
test('missing information is explicit, cannot be labeled agreement/conflict, and never becomes a negative factual claim',()=>{
  const value={overview:'资料不足',limitations:'缺少右侧依据',rows:[{aspect:'预算',relation:'insufficient',left:supported('个人账户','仅适用于个人账户。'),right:{status:'not-stated',text:'这里不能作为模型的无依据断言',quotes:[]}}]};
  assert.equal(comparisonCompletion(payload(value),request).rows[0].right.text,'这版资料未说明；不能据此判断。');
  for(const relation of ['agreement','conflict','different-scope']) assert.throws(()=>comparisonCompletion(payload({...value,rows:[{...value.rows[0],relation}]}),request));
});
test('starting comparison creates one node, fixes selected sources/query/scene, and cached branches do not request again',async()=>{
  const calls:string[]=[];let input:ComparisonRequest|undefined;
  const s=new BrowsingSession(provider({read:async url=>{calls.push(url);return {title:url,content:url===left.url?left.text:right.text};},compare:async r=>{input=r;return analysis();}}),()=>{});
  const search=await selected(s);const origin=s.snapshot().entryId;const pending=s.startComparison();const node=s.snapshot().entryId;assert.equal(s.snapshot().mode,'comparison');assert.equal(s.snapshot().pending?.nodeId,node);assert.equal(s.snapshot().comparison?.sources.length,2);
  await pending;assert.equal(s.snapshot().entryId,node);assert.equal(s.snapshot().path.nodes.at(-1)?.status,'ready');assert.equal(s.snapshot().path.nodes.length,3);assert.equal(input?.scene,'learning');assert.equal(input?.topic,search.query);assert.deepEqual(calls.sort(),[left.url,right.url]);
  const record=s.snapshot().comparison!;s.jump(origin);await s.read('https://example.com/c');const later=s.snapshot().entryId;s.jump(node);assert.equal(s.snapshot().comparison,record);assert.equal(calls.length,3);assert.ok(s.snapshot().path.nodes.some(n=>n.id===later));
});
test('a chosen reading version stays fixed after a later fetch and never reads unselected tabs or sources',async()=>{
  const first=new BrowsingSession(provider(),()=>{});const doc=(await first.read(left.url))!;first.chooseComparison({kind:'reading',readingId:doc.id});
  const newer=(await first.read(left.url))!;assert.notEqual(newer.id,doc.id);await first.read(right.url);first.chooseComparison({kind:'reading',readingId:first.snapshot().reading!.id});
  const before=first.snapshot().comparisonSelection;const other=new BrowsingSession(provider(),()=>{});await assert.rejects(other.startComparison(),/两份/);assert.equal(other.snapshot().comparisonSelection.length,0);
  await first.startComparison();assert.equal(first.snapshot().comparison?.sources[0].source?.readingId,doc.id);assert.equal(first.snapshot().comparison?.sources[0].source,before[0].source);
});
test('partial Fetch failure keeps successful versions; explicit retry fetches only missing source and preserves old failed node',async()=>{
  const calls:string[]=[];let fail=true;let models=0;
  const s=new BrowsingSession(provider({read:async url=>{calls.push(url);if(url===right.url&&fail)throw new Error('合成 Fetch 失败');return {title:url,content:url===left.url?left.text:right.text};},compare:async()=>{models++;return analysis();}}),()=>{});
  await selected(s);await s.startComparison();const failed=s.snapshot();assert.equal(failed.path.nodes.at(-1)?.status,'failed');assert.ok(failed.comparison!.sources[0].source);assert.ok(failed.comparison!.sources[1].issue);assert.equal(models,0);
  const version=failed.comparison!.sources[0].source!.readingId;fail=false;await s.retryComparison(failed.comparison!.id);assert.equal(models,1);assert.equal(s.snapshot().comparison!.sources[0].source!.readingId,version);assert.deepEqual(calls,[left.url,right.url,right.url]);
  s.jump(failed.entryId);assert.equal(s.snapshot().comparison?.analysis,undefined);assert.ok(s.snapshot().comparison?.sources[1].issue);
});
test('cancellation interrupts both Fetch signals, keeps completed content and discards late work',async()=>{
  const held=deferred<{title:string;content:string}>();let modelCalls=0;const signals:AbortSignal[]=[];
  const s=new BrowsingSession(provider({read:async(url,signal)=>{signals.push(signal);return url===left.url?{title:left.title,content:left.text}:held.promise;},compare:async()=>{modelCalls++;return analysis();}}),()=>{});
  await selected(s);const origin=s.snapshot().entryId;const pending=s.startComparison();await new Promise(r=>setImmediate(r));const node=s.snapshot().entryId;assert.ok(s.snapshot().comparison?.sources[0].source);
  s.jump(origin);assert.equal(await pending,undefined);assert.ok(signals.every(sig=>sig.aborted));held.resolve({title:right.title,content:right.text});await new Promise(r=>setImmediate(r));assert.equal(modelCalls,0);s.jump(node);assert.equal(s.snapshot().comparison?.analysis,undefined);assert.ok(s.snapshot().comparison?.sources[0].source);
});
test('model failure retains both versions for retry; scene change and disposal never accept a late analysis',async()=>{
  for(const action of ['scene','dispose','failure'] as const){const held=deferred<ComparisonAnalysis>();let calls=0;const s=new BrowsingSession(provider({compare:async()=>{calls++;if(action==='failure')throw new Error('合成模型失败');return held.promise;}}),()=>{});
  await selected(s);const pending=s.startComparison();const failure=action==='failure'?assert.rejects(pending,/模型失败/):undefined;await new Promise(r=>setImmediate(r));
  if(action==='failure'){await failure;assert.ok(s.snapshot().comparison?.sources.every(item=>item.source));}
  else{if(action==='scene')s.setScene('living');else s.dispose();await pending;const final=s.snapshot();held.resolve(analysis());await new Promise(r=>setImmediate(r));assert.equal(s.snapshot(),final);assert.equal(s.snapshot().comparison?.analysis,undefined);}
  assert.equal(calls,1);}
});
test('evicted comparison keeps source/version metadata; only explicit recovery fetches new versions in a new node',async()=>{
  let models=0;const fetched:string[]=[];let last:ComparisonRequest|undefined;
  const s=new BrowsingSession(provider({read:async url=>{fetched.push(url);return {title:url,content:url===left.url?left.text:url===right.url?right.text:'x'.repeat(3000)};},compare:async r=>{models++;last=r;return analysis();}}),()=>{}, {textBudget:5000});
  await selected(s);await s.startComparison();const old=s.snapshot().entryId;const oldScope=s.snapshot().path.nodes.find(n=>n.id===old)!.comparisonScope!;
  for(let i=0;i<3;i++)await s.read('https://example.com/extra'+i);
  // The live basket may change; recovery must use this old node's own source handles.
  const currentSearch=(await s.search('new direction','living',false))!;
  for(const item of s.snapshot().comparisonSelection)s.removeComparison(item.id);
  for(const index of [1,2])s.chooseComparison({kind:'result',searchId:currentSearch.id,index});
  s.jump(old);assert.equal(s.snapshot().comparison,undefined);assert.ok(s.snapshot().path.nodes.find(n=>n.id===old)?.missingContent.includes('comparison'));
  const before=fetched.length;assert.equal(models,1);assert.deepEqual(oldScope.sources.map(item=>item.url),[left.url,right.url]);assert.ok(oldScope.sources.every(item=>item.version));
  assert.ok(!JSON.stringify(oldScope).includes(left.text));assert.equal(fetched.length,before);
  await s.recoverComparison();assert.equal(models,2);assert.deepEqual(fetched.slice(before),[left.url,right.url]);assert.equal(last?.scene,'learning');assert.notEqual(s.snapshot().entryId,old);
  assert.notEqual(s.snapshot().comparison!.sources[0].source!.readingId,oldScope.sources[0].version!.readingId);
  assert.deepEqual(s.snapshot().comparisonSelection.map(item=>item.url),[right.url,'https://example.com/c']);
  s.jump(old);assert.equal(s.snapshot().comparison,undefined);assert.equal(models,2);
});
