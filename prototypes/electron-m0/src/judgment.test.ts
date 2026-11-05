import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowsingSession, type BrowsingProvider } from './application/browsing-session';
import { judgmentEditSchema } from './contracts/judgment';
const text = '个人方案保留 7 天。仅供个人使用。';
const provider = (): BrowsingProvider => ({search:async()=>[],read:async()=>({title:'合成来源',content:text}),extract:async()=>({text:'重点',truncated:false}),model:async()=>({text:'AI 建议先核对适用对象。',insufficient:false,citations:[{source:1,title:'合成来源',url:'https://example.com/a',quote:'个人方案保留 7 天。'}]}),compare:async()=>({overview:'两边说明不同。',limitations:'未核对',rows:[{aspect:'适用范围',relation:'different-scope',left:{status:'supported',text:'个人',quotes:['仅供个人使用。']},right:{status:'supported',text:'个人',quotes:['个人方案保留 7 天。']}}]})});
async function question(s:BrowsingSession){await s.read('https://example.com/a');s.beginQuestion();await s.ask('适用谁？',s.snapshot().question!.id);return s.snapshot();}
function edit(s:BrowsingSession, text='我的结论：先核实账户。', checks='核对最新条款。', citationIds?:string[], revision?:number) {const j=s.snapshot().judgment!;s.editJudgment({draftId:j.draftId,revision:revision??j.revision+1,text,checks,citationIds:citationIds??j.citationIds.slice()});}
function save(s:BrowsingSession){const j=s.snapshot().judgment!;s.saveJudgment({draftId:j.draftId,revision:j.revision});}

test('judgment begins only from completed understanding; author text starts empty and no provider is called',async()=>{
 const p=provider();let calls=0;for(const name of ['read','search','model','compare'] as const){const fn=p[name]!; (p as any)[name]=(...args:any[])=>{calls++;return (fn as any)(...args);};}
 const s=new BrowsingSession(p,()=>{});assert.throws(()=>s.beginJudgment(),/问答/);const q=await question(s);const count=calls;
 s.beginJudgment();const j=s.snapshot().judgment!;assert.equal(calls,count);assert.equal(j.text,'');assert.equal(j.checks,'');assert.equal(j.citationIds.length,0);assert.equal(j.modelNote,q.question!.answer!.text);
 assert.equal(j.citations[0].readingId,q.question!.source!.readingId);assert.equal(j.originRecordId,q.question!.id);assert.ok(Object.isFrozen(j.citations));assert.throws(()=>s.beginJudgment(),/现有草稿/);
});
test('draft edits replace one payload, preserve branch state, and reject stale, unknown or oversized edits atomically',async()=>{
 const s=new BrowsingSession(provider(),()=>{});await question(s);s.beginJudgment();const before=s.snapshot();const ref=before.judgment!.citations[0].id;
 edit(s,'<img src=x onerror=alert(1)>','待核', [ref],10);const good=s.snapshot();assert.equal(good.entryId,before.entryId);assert.equal(good.path.nodes.length,before.path.nodes.length);assert.notEqual(good.judgment!.id,before.judgment!.id);
 assert.throws(()=>edit(s,'old','',[],9),/变化/);assert.throws(()=>edit(s,'forged','',['foreign']),/引用/);assert.throws(()=>edit(s,'duplicate','',[ref,ref]),/引用/);assert.throws(()=>edit(s,'x'.repeat(4001)),/参数/);assert.equal(s.snapshot(),good);
 s.home();s.jump(good.entryId);assert.equal(s.snapshot().judgment!.text,good.judgment!.text);assert.deepEqual(s.snapshot().judgment!.citationIds,[ref]);
 assert.equal(judgmentEditSchema.safeParse({draftId:'x',revision:1,text:'x',checks:'',citationIds:[],url:'https://foreign.example'}).success,false);
});
test('saving creates immutable versions; sibling revisions are unique and old drafts remain editable',async()=>{
 const s=new BrowsingSession(provider(),()=>{});await question(s);s.beginJudgment();assert.throws(()=>save(s),/先写下/);edit(s);const draft=s.snapshot();save(s);const v1=s.snapshot();assert.notEqual(v1.entryId,draft.entryId);assert.equal(v1.judgment!.version,1);
 assert.throws(()=>save(s),/更新/);assert.throws(()=>edit(s),/变化/);
 s.beginJudgment();edit(s,'第二次结论');save(s);const v2=s.snapshot();assert.equal(v2.judgment!.version,2);assert.equal(v2.judgment!.basedOnId,v1.judgment!.id);
 s.jump(v1.entryId);assert.equal(s.snapshot().judgment!.text,v1.judgment!.text);s.beginJudgment();edit(s,'另一种结论');save(s);assert.equal(s.snapshot().judgment!.version,3);
 s.jump(draft.entryId);assert.equal(s.snapshot().judgment!.status,'draft');assert.equal(s.snapshot().judgment!.text,draft.judgment!.text);assert.equal(v2.judgment!.text,'第二次结论');
 assert.equal(JSON.stringify(v1.path.nodes.find(n=>n.id===v1.entryId)!.judgmentScope).includes(v1.judgment!.text),false);
});
test('citations stay on their original versions even after public source changes, comparison reorder or retry',async()=>{
 const p=provider();const s=new BrowsingSession(p,()=>{});await s.read('https://example.com/a');s.chooseComparison({kind:'reading',readingId:s.snapshot().reading!.id});await s.read('https://example.com/b');s.chooseComparison({kind:'reading',readingId:s.snapshot().reading!.id});await s.startComparison();const c=s.snapshot();s.beginJudgment();const j=s.snapshot().judgment!;
 assert.equal(j.originKind,'comparison');assert.equal(j.citations.length,2);edit(s,'由我判断','',[j.citations[1].id]);save(s);const saved=s.snapshot();p.read=async()=>({title:'新资料',content:'已变更为 30 天。'});await s.read('https://example.com/a');s.jump(saved.entryId);assert.equal(s.snapshot().judgment!.citations[1].quote,'个人方案保留 7 天。');assert.equal(s.snapshot().judgment!.originRecordId,c.comparison!.id);
});
test('source text mismatch cannot become a judgment citation, and no editable value can inject a new citation',async()=>{
 const p=provider();p.model=async()=>({text:'AI 合成建议',insufficient:true,citations:[{source:1,title:'forged',url:'https://foreign.example',quote:'原文没有这个句子。'}]});
 const s=new BrowsingSession(p,()=>{});await question(s);s.beginJudgment();assert.equal(s.snapshot().judgment!.citations.length,0);edit(s,'仍可独立记录');save(s);assert.equal(s.snapshot().judgment!.citationIds.length,0);
});
test('author payloads survive provider cache churn; at capacity or insufficient budget, save never pretends success',async()=>{
 const p=provider();const s=new BrowsingSession(p,()=>{}, {textBudget:6000,nodeLimit:20});await question(s);s.beginJudgment();edit(s);save(s);const saved=s.snapshot();p.read=async()=>({title:'占用',content:'x'.repeat(5000)});for(let i=0;i<8;i++)await s.read('https://example.com/'+i);s.jump(saved.entryId);assert.equal(s.snapshot().judgment!.text,saved.judgment!.text);
 const tooLarge=s.snapshot();s.beginJudgment();const beforeLarge=s.snapshot();assert.throws(()=>edit(s,'界'.repeat(4000)),/内存预算/);assert.equal(s.snapshot(),beforeLarge);assert.equal(tooLarge.judgment!.text,saved.judgment!.text);
 const capped=new BrowsingSession(provider(),()=>{}, {nodeLimit:5});await question(capped);capped.beginJudgment();edit(capped);const before=capped.snapshot();assert.throws(()=>save(capped),/上限/);assert.equal(capped.snapshot(),before);assert.equal(capped.snapshot().judgment!.status,'draft');
});
test('draft and saved text never cross session owners; disposed sessions reject mutations',async()=>{
 const a=new BrowsingSession(provider(),()=>{}),b=new BrowsingSession(provider(),()=>{});await question(a);a.beginJudgment();edit(a);const draft=a.snapshot().judgment!;await question(b);b.beginJudgment();assert.throws(()=>b.editJudgment({draftId:draft.draftId,revision:1,text:'cross-owner',checks:'',citationIds:[]}),/变化/);assert.equal(b.snapshot().judgment!.text,'');a.dispose();assert.throws(()=>edit(a),/变化/);assert.throws(()=>save(a),/更新/);
});
