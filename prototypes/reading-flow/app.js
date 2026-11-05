(() => {
  'use strict';
  const root=document.getElementById('grid-flow');
  const $=s=>root.querySelector(s);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const scenes={professional:'专业',learning:'学习',living:'生活',entertainment:'娱乐',inspiration:'灵感'};
  const angle={professional:'提取论点、边界与可执行建议',learning:'解释概念与实践步骤',living:'聚焦日常可用的方法',entertainment:'轻松浏览，保留有趣的细节',inspiration:'寻找能延伸的新角度'};
  const sampleQuery='如何减少浏览器里的信息干扰？';
  // Build embeds a screenshot of our synthetic article, never a live website.
  const previews={a:'__GRID_ATTENTION_PREVIEW__'};
  const failedPreviews=new Set();
  const pages={
    a:{domain:'fieldnotes.example',brand:'Fieldnotes',title:'留出空间，注意力才会回来',deck:'一次安静的浏览，从一个清楚的问题开始。把工具放在需要它的位置，让内容留在眼前。',heading:'从你想完成的事开始',text:'打开浏览器时，先给这次探索写下一句话：我现在想弄明白什么？这句话不必成为清单，只需要帮你分辨眼前的链接是否值得打开。',quote:'工具可以一直在，但不必一直占据你的注意力。',next:'让辅助工具随需要出现',detail:'读到不理解的地方，再请求解释。需要比较时，再把两份资料放在一起。回到上一页不应意味着重新开始；位置、问题和已写下的想法，都应该还能找到。',summary:'这篇文章主张先明确问题，再按需要展开工具。保留阅读位置和探索分支，有助于继续原来的思路；这些建议还需要通过实际使用检验。'},
    b:{domain:'smallsteps.example',brand:'Small steps',title:'把一次搜索，变成有去有回的探索',deck:'不是每条链接都通向答案。但每次走岔之后，你都应该知道怎样回来。',heading:'保留岔路，也保留方向',text:'试着先读两个不同观点，再决定是否继续。看到新线索时记住从哪里出发，避免用不断新建标签来代替理解。',quote:'保存走过的路，不等于替你决定下一步。',next:'知道什么时候停下来',detail:'当现有资料不足时，先标记还不知道的内容。新的回答不是新的证据；回到来源核对，比叠加更多结论更有用。',summary:'文章建议保留访问分支，并明确区分资料与结论。找不到依据时标记未知，再返回来源核对；地图帮助找回上下文，不代替判断。'},
    c:{domain:'workshop.example',brand:'Workshop',title:'一个关于标签与任务的练习',deck:'把浏览中的临时想法留在原处。下一次回来时，继续，而不是重做。',heading:'用具体任务检查工具',text:'选择一个最近真的遇到的问题。记录哪里需要重复找资料、哪里容易分心，再回看有哪些操作可以简化。',quote:'体验好不好，要让完成任务的人来回答。',next:'从小处验证',detail:'先观察一个完整任务，再评估新的整理方式是否有帮助。界面更整齐，不代表实际任务更容易完成。',summary:'通过一个真实任务找出重复搜索与迷路的位置，再验证改动。界面整洁只是手段，是否更容易完成任务仍需要用户评价。'}
  };
  const nodes=[];let current=0,sequence=0,navOpen=false,panel=null,summaryOpen=false,scene='professional',optimized=true;
  let response='success',generation=0,pending=null,noticeTimer=null,selected=[],compared=false,records=[],agent='off',agentTimer=null,composing=false;
  let mapOpen=false,mapAxis='horizontal',mapContinue=null,mapDraft='';
  const chains=new Map();let chainSequence=0,chainPicker=false,pickerWasCollapsed=false;
  const removedSteps=[];
  const find=id=>nodes.find(n=>n.id===id);
  const visible=id=>{let n=find(id);while(n?.removed)n=find(n.parent);return n||null;};
  const node=()=>nodes.find(n=>n.id===current);
  const page=()=>pages[node().page];
  const label=n=>n.kind==='home'?'新标签页':n.kind==='results'?n.query:(pages[n.page]?.title||n.title);
  const chain=()=>chains.get(node().task);
  const chainTitle=c=>c.title||`新探索 ${c.order}`;
  function rememberChain(){
    const c=chain();if(!c)return;
    const canvas=$('.map-canvas');
    Object.assign(c,{last:current,axis:mapAxis,continueAt:mapContinue,draft:mapDraft,selected:[...selected],compared});
    if(canvas&&!canvas.hidden&&$('#floating-map').dataset.task===String(c.id))c.scroll={x:canvas.scrollLeft,y:canvas.scrollTop};
  }
  function chainButtons(place){return [...chains.values()].map(c=>{
    const last=find(c.last),count=nodes.filter(n=>n.task===c.id&&!n.removed).length;
    return `<button class="chain-option" data-act="chain-select" data-value="${c.id}" data-place="${place}" aria-label="切换探索：${esc(chainTitle(c))}，探索 ${c.order}" aria-pressed="${c.id===node().task}" data-tooltip="${esc(chainTitle(c))}"><span class="chain-option-title">${esc(chainTitle(c))}</span><span class="chain-option-state">${c.id===node().task?'当前':'探索 '+c.order}</span><span class="chain-option-detail">${count} 个节点 · ${esc(last?label(last):'尚未开始')}</span></button>`;
  }).join('');}
  function revealChainChoice(){
    const list=$('#chain-picker .chain-list'),selected=list?.querySelector('[aria-pressed=true]');
    if(!selected)return;
    const item=selected.getBoundingClientRect(),area=list.getBoundingClientRect();
    if(item.bottom>area.bottom-4)list.scrollTop+=item.bottom-area.bottom+4;
    else if(item.top<area.top+4)list.scrollTop+=item.top-area.top-4;
  }
  function closeChainPicker(){
    chainPicker=false;if(pickerWasCollapsed)mapOpen=false;pickerWasCollapsed=false;renderMap();
    (mapOpen?$('#map-chain-trigger'):$('#map-switch'))?.focus({preventScroll:true});
  }
  function selectChain(id,place='map'){
    const c=chains.get(id);if(!c||!find(c.last)){say('这条探索已移除，请选择其他标签。');return;}
    const changed=id!==node().task,collapse=chainPicker&&pickerWasCollapsed;
    chainPicker=false;pickerWasCollapsed=false;if(collapse)mapOpen=false;
    if(changed){jump(c.last);say(`已切换到「${chainTitle(c)}」。`);}else renderMap();
    if(mapOpen)revealCurrent();
    const target=place==='nav'&&navOpen?$(`#navigation [data-act=chain-select][data-value="${id}"]`):mapOpen?$('#map-chain-trigger'):$('#map-switch');
    target?.focus({preventScroll:true});
  }
  function updateFeedback(){const feedback=$('.map-feedback');if(feedback){feedback.textContent=$('#notice').textContent;feedback.hidden=!feedback.textContent;}}
  function say(message){$('#notice').textContent=message;updateFeedback();clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').textContent='';updateFeedback();},3600);}
  function add(kind,extra={},parent=current){
    const source=find(parent),p=visible(parent);parent=p?.id??null;
    const id=++sequence;
    const n={id,parent,task:source?.task??id,temporary:source?.temporary||false,kind,scene,children:[],next:null,scroll:0,summary:null,summaryState:'idle',draft:'',messages:[],note:'',versions:[],...extra};
    nodes.push(n);if(p){p.children.push(n.id);p.next=n.id;}
    if(!chains.has(n.task))chains.set(n.task,{id:n.task,order:++chainSequence,title:'',last:id,axis:'horizontal',scroll:{x:0,y:0},continueAt:null,draft:'',selected:[],compared:false});
    const c=chains.get(n.task);c.last=id;if(!c.title&&kind!=='home')c.title=label(n);
    return n;
  }
  function cancelPending(){generation++;if(pending){clearTimeout(pending.timer);pending.node[pending.type+'State']='idle';if(pending.type==='chat'){if(!pending.node.draft)pending.node.draft=pending.question;delete pending.node.pendingQuestion;}pending=null;}}
  function cancelAgent(){clearTimeout(agentTimer);if(agent!=='off'){agent='off';say('页面已切换，旧授权与操作预览已失效。');}}
  function jump(id){
    const n=nodes.find(x=>x.id===id);if(!n||id===current)return;
    const old=node(),cross=old.task!==n.task;
    old.scroll=$('#main-content').scrollTop;rememberChain();cancelPending();if(id!==current)cancelAgent();
    current=id;scene=n.scene;panel=null;summaryOpen=false;
    chainPicker=false;pickerWasCollapsed=false;
    const c=chain();c.last=id;
    mapContinue=cross&&find(c.continueAt)&&!find(c.continueAt).removed?c.continueAt:null;mapDraft=mapContinue!==null?c.draft:'';
    if(cross){mapAxis=c.axis;selected=[...c.selected];compared=c.compared;}
    let child=n.removed?visible(n.parent):n;while(child&&child.parent!==null){const parent=nodes.find(x=>x.id===child.parent);if(!parent)break;parent.next=child.id;child=parent;}
    if(root.clientWidth<=900)navOpen=false;
    renderMain();renderChrome();$('#address').focus();
  }
  function navigate(kind,extra={},parent=current){const n=add(kind,extra,parent);jump(n.id);}
  function submit(value,parent=current){
    value=value.trim();if(!value)return;
    // The offline prototype recognizes sample URLs, but never navigates to a network origin.
    if(/^(https?:\/\/|localhost|[\w-]+\.\w{2,})/i.test(value)){
      const found=Object.keys(pages).find(k=>value.includes(pages[k].domain));
      if(found){navigate('page',{page:found},parent);return true;}
      say('离线原型仅能打开示例网址；正式应用的网址直达保留。');return;
    }
    navigate('results',{query:value,empty:response==='empty',optimized},parent);response='success';$('#demo-response').value='success';return true;
  }
  function renderMain(){
    const n=node();root.dataset.scene=n.scene;root.dataset.current=String(n.id);root.dataset.task=String(n.task);root.dataset.page=n.page||n.kind;
    if(n.kind==='home')$('#main-content').innerHTML=`<div class="welcome"><div><div class="eyebrow">从你的问题开始</div><h1>这次，想弄明白什么？</h1><p>找资料，读原页。在需要时，多理解一点。</p></div><div><div class="scenes" role="group" aria-label="搜索场景">${Object.entries(scenes).map(([k,v])=>`<button data-act="scene" data-value="${k}" aria-pressed="${n.scene===k}">${v}</button>`).join('')}</div></div><form id="search-form"><label class="sr-only" for="query">搜索问题</label><div class="search-box"><input id="query" value="${esc(n.query||sampleQuery)}" autocomplete="off"><button class="primary" type="submit">搜索 →</button></div><div class="search-settings"><label><input id="optimize" type="checkbox" ${optimized?'checked':''}>按场景优化查询</label><button data-act="settings" type="button">搜索设置</button></div></form><span class="small muted" id="scene-hint">${angle[n.scene]}</span></div>`;
    else if(n.kind==='results')$('#main-content').innerHTML=`<section class="results"><div class="eyebrow">${scenes[n.scene]} · 搜索</div><h1>${esc(n.query)}</h1><div class="results-meta"><span>${n.empty?'0':'3'} 个示例结果</span><button data-act="search-summary" class="secondary">概览结果</button><details><summary>查询与来源说明 ↓</summary><p>输入：${esc(n.query)}<br>实际查询（模拟）：${esc(n.query)}${n.optimized?' '+scenes[n.scene]+'视角':''}<br>录制示例，沿用示例顺序；无画像排序与广告。正式应用显示实际检索提供者。</p></details></div><div id="search-overview" hidden class="search-summary"><p>这些示例分别讨论注意力、分支导航和任务验证。</p><span class="small muted">仅基于示例搜索摘要，未核对原文。</span></div>${n.empty?'<p>没有找到结果。试着缩短问题或换一种表达。</p><button class="secondary" data-act="edit-query">修改查询</button>':Object.entries(pages).map(([k,p])=>`<article class="result"><div class="result-domain">${p.brand} · ${p.domain}</div><a href="https://${p.domain}/reading" class="result-title" data-open="${k}">${p.title}</a><p>${p.deck}</p><div class="result-bottom"><span>示例文章 · 日期未提供</span><button data-act="open-new" data-value="${k}">新标签打开 ↗</button></div></article>`).join('')}</section>`;
    else {const p=page();$('#main-content').innerHTML=`<div class="site"><header class="site-header"><strong>${p.brand}</strong><span>NOTES ON THE WEB</span></header><article class="article"><div class="kicker">数字生活 / 阅读笔记</div><h1>${p.title}</h1><p class="standfirst">${p.deck}</p><div class="small" style="color:var(--site-muted)">编辑部 · 示意文章</div><div class="illustration" aria-label="探索过程：问题、阅读、判断"><span>问题</span><i>→</i><span>阅读</span><i>→</i><span>判断</span></div><h2>${p.heading}</h2><p>${p.text}</p><blockquote>${p.quote}</blockquote><h2 id="passage">${p.next}</h2><p>${p.detail}</p><p>把当前页面放在主要位置，让返回的路径保持清晰。辅助界面只在主动请求时出现，并在关闭之后留下一个明确的回到原文的位置。</p><h2>继续读一篇</h2><p><a href="https://${pages[n.page==='b'?'a':'b'].domain}/reading" data-open="${n.page==='b'?'a':'b'}">${pages[n.page==='b'?'a':'b'].title} →</a></p><label class="small">页内练习（不会提交）<input id="site-input" autocomplete="off" placeholder="你想保留的一句话" value="${esc(n.siteDraft||'')}"></label></article></div>`;}
    $('#main-content').scrollTop=n.scroll;
  }
  function renderNav(){
    $('#navigation').hidden=!navOpen;$('[data-act=nav]').setAttribute('aria-expanded',String(navOpen));
    if(!navOpen)return;
    const content=nodes.filter(n=>n.task===node().task&&n.kind!=='home').map(n=>`<button class="node" data-act="jump" data-value="${n.id}" data-tooltip="${esc(label(n))}" ${n.id===current?'aria-current="page"':''}><span>${esc(label(n))}</span></button>`).join('')||'<p class="small muted">从一次搜索开始。</p>';
    $('#navigation').innerHTML=`<div class="nav-head"><strong>探索标签</strong><button class="icon" data-act="nav" aria-label="关闭导航">×</button></div><div class="nav-content"><div class="chain-list" role="group" aria-label="探索标签">${chainButtons('nav')}</div><button data-act="home">＋ 新建探索</button><div class="nav-section-label">当前链的网页</div>${content}</div><div class="nav-bottom"><button data-act="records">本地记录</button><button data-act="agent">Agent</button><button data-act="settings">设置</button></div>`;
  }
  function mapTree(id){
    const n=find(id);if(!n||n.removed)return '';
    const preview=n.kind==='page'&&!failedPreviews.has(n.page)?previews[n.page]:null;
    const excerpt=n.kind==='page'?pages[n.page]?.deck:'';
    return `<li data-node="${id}" data-parent="${n.parent??''}"><div class="map-step">
      <button class="map-node" data-act="map-jump" data-value="${id}" aria-label="返回：${esc(label(n))}" data-tooltip="${esc(label(n)+(excerpt?' — '+excerpt:''))}" ${excerpt?`aria-describedby="map-excerpt-${id}"`:''} ${id===current?'aria-current="page"':''}>
        <span class="map-node-head"><span class="map-kind">${n.kind==='home'?'起点':n.kind==='results'?'搜索':'网页'}${id===current?' · 当前':''}</span>${preview?`<img class="map-preview" data-page="${n.page}" src="${esc(preview)}" alt="" width="44" height="26" decoding="async" draggable="false">`:''}</span>
        <span class="map-title">${esc(label(n))}</span>
        ${excerpt?`<span class="map-excerpt" id="map-excerpt-${id}">${esc(excerpt)}</span>`:''}
      </button>
      ${n.messages.length||n.versions.length?`<div class="node-info">${n.messages.length?`<button data-act="activity" data-value="${id}:chat">${n.messages.length} 条问答</button>`:''}${n.versions.length?`<button data-act="activity" data-value="${id}:notes">${n.versions.length} 份记录</button>`:''}</div>`:''}
    </div>${n.children.length?`<ul>${n.children.map(mapTree).join('')}</ul>`:''}</li>`;
  }
  function revealCurrent(){
    const canvas=$('.map-canvas'),item=$('.map-node[aria-current=page]');if(!canvas||!item)return;
    const c=canvas.getBoundingClientRect(),r=item.getBoundingClientRect();
    canvas.scrollLeft+=r.left<c.left?r.left-c.left-12:r.right>c.right?r.right-c.right+12:0;
    canvas.scrollTop+=r.top<c.top?r.top-c.top-12:r.bottom>c.bottom?r.bottom-c.bottom+12:0;
  }
  function renderMap(){
    const el=$('#floating-map'),n=node(),items=nodes.filter(x=>!x.removed&&x.task===n.task);
    root.dataset.mapOpen=String(mapOpen);
    $('#map-shortcut').hidden=mapOpen;$('#map-launcher').hidden=mapOpen;$('#map-launcher').setAttribute('aria-expanded',String(mapOpen));
    $('#map-launcher').textContent=`地图 · ${chainTitle(chain())}`;$('#map-launcher').dataset.tooltip=`${chainTitle(chain())} · ${items.length} 个节点`;
    $('#map-switch').setAttribute('aria-expanded',String(chainPicker));el.hidden=!mapOpen;
    if(!mapOpen){el.innerHTML='';return;}
    const canvas=$('.map-canvas'),scroll=canvas&&!canvas.hidden&&el.dataset.task===String(n.task)?{x:canvas.scrollLeft,y:canvas.scrollTop}:chain().scroll;
    const focused=el.contains(document.activeElement)?document.activeElement:null;
    const focusKey=focused?{act:focused.dataset.act,value:focused.dataset.value,id:focused.id,start:focused.selectionStart,end:focused.selectionEnd}:null;
    el.dataset.axis=mapAxis;
    el.dataset.composing=String(mapContinue!==null);
    el.dataset.task=String(n.task);el.dataset.picking=String(chainPicker);
    el.innerHTML=`<div class="map-head"><button id="map-chain-trigger" data-act="chain-picker" aria-expanded="${chainPicker}" aria-controls="chain-picker" aria-label="切换探索标签，当前：${esc(chainTitle(chain()))}" data-tooltip="${esc(chainTitle(chain()))}"><span class="muted">地图</span><span class="chain-title">${esc(chainTitle(chain()))}</span><span aria-hidden="true">${chainPicker?'⌃':'⌄'}</span></button>
      <div class="map-toolbar" ${chainPicker?'hidden':''}><div class="segmented" role="group" aria-label="地图方向"><button data-act="map-axis" data-value="horizontal" aria-pressed="${mapAxis==='horizontal'}">横向</button><button data-act="map-axis" data-value="vertical" aria-pressed="${mapAxis==='vertical'}">纵向</button></div><button class="small" data-act="map-locate" ${n.removed?'disabled':''}>定位当前</button><button class="small" data-act="map-undo" ${removedSteps.some(e=>find(e.id)?.task===n.task)?'':'disabled'}>撤销删除</button></div>
      <button class="icon" data-act="map-toggle" aria-label="收起链式地图">−</button></div>
      <div id="chain-picker" ${chainPicker?'':'hidden'}>${chainPicker?`<div class="chain-picker-hint">切换探索标签，回到上次停留的网页</div><div class="chain-list" role="group" aria-label="切换探索标签">${chainButtons('map')}</div><button class="chain-new" data-act="home">＋ 新建探索</button>`:''}</div>
      <div class="map-canvas" role="region" aria-label="已访问路径" ${chainPicker?'hidden':''}><ul class="map-tree">${items.filter(x=>x.parent===null).map(x=>mapTree(x.id)).join('')}</ul>${items.length?'':'<p class="small muted">地图已清空，当前页面仍可浏览。</p>'}</div>
      <div class="map-detail" ${chainPicker?'hidden':''}><div class="map-selection"><p class="map-feedback" role="status" hidden></p>${mapContinue===null?`<p class="map-caption">${n.removed?'此节点已移除，网页仍保持打开。':esc(label(n))}</p>`:''}</div>
        ${mapContinue!==null?`<form id="map-continue-form"><label for="map-query">从「${esc(label(find(mapContinue)))}」继续</label><div class="map-compose"><input id="map-query" value="${esc(mapDraft)}" placeholder="搜索新问题，或输入网址" autocomplete="off"><button class="primary" type="submit" ${mapDraft.trim()?'':'disabled'}>前往</button><button type="button" data-act="map-cancel">取消</button></div><span class="small muted">保留已有分支</span></form>`:`<div class="map-foot"><button class="secondary" data-act="map-continue" ${n.removed?'disabled':''}>从此处继续 ↗</button><button data-act="map-delete" ${n.removed?'disabled':''}>移除此节点</button></div>`}
      </div>`;
    updateFeedback();
    if(scroll){$('.map-canvas').scrollLeft=scroll.x;$('.map-canvas').scrollTop=scroll.y;}
    if(focusKey){const target=focusKey.id?el.querySelector('#'+focusKey.id):[...el.querySelectorAll('[data-act]')].find(x=>x.dataset.act===focusKey.act&&x.dataset.value===focusKey.value);if(target){target.focus({preventScroll:true});if(focusKey.start!=null&&target.setSelectionRange)target.setSelectionRange(focusKey.start,focusKey.end);}}
  }
  function removeMapNode(){
    const n=node();if(n.removed)return;
    const p=find(n.parent),children=[...n.children];
    removedSteps.push({id:n.id,parent:n.parent,children,next:n.next,index:p?p.children.indexOf(n.id):-1,preferred:p?.next});
    if(p){p.children.splice(p.children.indexOf(n.id),1,...children);if(p.next===n.id)p.next=children.includes(n.next)?n.next:(children[0]??null);}
    children.forEach(id=>find(id).parent=n.parent);
    // Keep the open document alive. Only its entry in the map is removed.
    n.children=[];n.removed=true;mapContinue=null;mapDraft='';
    renderChrome();$('[data-act=map-undo]')?.focus({preventScroll:true});
    say('已移除此节点，后续分支保留。可在地图中撤销。');
  }
  function undoMapRemoval(){
    const index=removedSteps.findLastIndex(e=>find(e.id)?.task===node().task);if(index<0)return;const [edit]=removedSteps.splice(index,1);
    const n=find(edit.id);if(!n)return;
    const p=find(edit.parent),children=edit.children.filter(id=>find(id)&&!find(id).removed&&find(id).parent===edit.parent);
    n.removed=false;n.parent=edit.parent;n.children=children;n.next=children.includes(edit.next)?edit.next:(children[0]??null);
    children.forEach(id=>find(id).parent=n.id);
    if(p){p.children=p.children.filter(id=>!children.includes(id));p.children.splice(Math.min(edit.index,p.children.length),0,n.id);if(children.includes(p.next)||(p.next===null&&edit.preferred===n.id))p.next=n.id;}
    renderChrome();revealCurrent();say('已恢复节点；删除之后新增的分支也保留。');
  }
  function renderTools(){
    const n=node(),isPage=n.kind==='page';$('#page-tools').hidden=!isPage;
    if(isPage)$('#page-tools').innerHTML=`<button class="summary-trigger" data-act="summary" aria-expanded="${summaryOpen}" aria-controls="summary-panel">${summaryOpen?'收起总结 ↑':'总结这页 ↓'}</button><span class="page-scene">${scenes[n.scene]}视角</span>${summaryOpen?'':`<button data-act="chat" aria-expanded="${panel==='chat'}">问这页</button>`}<details class="page-menu"><summary aria-label="更多页面操作">···</summary><div><button data-act="read">干净阅读</button><button data-act="compare">比较来源</button><button data-act="notes">我的记录</button></div></details>`;
    $('#summary-panel').hidden=!summaryOpen||!isPage;
    if(summaryOpen&&isPage){const state=n.summaryState;$('#summary-panel').innerHTML=`<div class="summary-meta"><span>${scenes[n.scene]}视角 · ${page().domain}</span><span>${state==='loading'?'正在提取…':state==='error'?'未能取得正文':'公开文本 · 示例'}</span></div><div class="summary-text" ${state==='error'?'role="alert"':''}>${state==='loading'?'<p>正在读取正文，你可以继续浏览网页。</p>':state==='error'?'<p class="error">公开正文暂时不可用。</p><p>不会拿搜索摘要冒充这页的总结。登录后或动态内容可能不在公开提取范围。</p>':state==='ready'?`<p>${esc(n.summary)}</p>`:'<p>生成已取消，网页仍可继续阅读。</p>'}</div><div class="summary-meta"><span>${state==='ready'?'基于公开提取正文；不代表已读到登录内容。':''}</span>${state==='loading'?'<button data-act="cancel" class="secondary">取消生成</button>':state==='ready'?'<button data-act="chat" class="secondary">继续问这页 →</button>':'<button data-act="retry-summary" class="secondary">重新获取</button>'}</div>`;}
  }
  function openPanel(next){rememberChain();chainPicker=false;pickerWasCollapsed=false;summaryOpen=false;panel=next;mapOpen=false;if(root.clientWidth<=900)navOpen=false;renderChrome();const target=$('#assistant-panel textarea')||$('#assistant-panel [data-act=close-panel]');target?.focus();}
  function panelHeader(title,context){return `<div class="panel-head"><h2>${title}</h2><button class="icon" data-act="close-panel" aria-label="关闭辅助面板">×</button></div><div class="panel-context">${context}</div>`;}
  function renderPanel(){
    const el=$('#assistant-panel'),n=node();el.hidden=!panel;if(!panel){el.innerHTML='';return;}
    const focused=el.contains(document.activeElement)&&document.activeElement.id?{id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    let html='';const p=page();
    if(panel==='chat') html=panelHeader('问这页',`${p.domain} · ${scenes[n.scene]} · 公开文本示例`)+`<div class="panel-content">${n.messages.length?n.messages.map(m=>`<div class="chat-user">${esc(m.q)}</div><p>${esc(m.a)}</p><button data-act="source" class="small">查看本文依据 ↗</button>`).join(''):`<h3>沿着这页，继续理解。</h3><p class="muted">${angle[n.scene]}。问题与回答留在这页，切换页面后分别保存。</p><button class="secondary" data-act="suggest">这篇文章有哪些局限？</button>`}${n.chatState==='loading'?'<p role="status">正在回答，可继续阅读或取消。</p>':''}${n.chatState==='error'?'<p class="error" role="alert">正文不可用，未生成回答。问题草稿已保留。</p>':''}<div class="small muted">此处演示同页连续追问；当前产品尚未接入多轮上下文。</div></div><form class="composer" id="chat-form"><label class="sr-only" for="question">向当前页面提问</label><textarea id="question" placeholder="问这页…">${esc(n.draft)}</textarea><div><span class="small muted">仅当前页 · 示例回答</span>${n.chatState==='loading'?'<button data-act="cancel" type="button" class="secondary">取消</button>':'<button class="primary" type="submit" '+(!n.draft.trim()?'disabled':'')+'>发送 ↑</button>'}</div></form>`;
    if(panel==='read') html=panelHeader('干净阅读',`${p.domain} · 公开正文 · 示例`)+`<div class="panel-content"><h3>${p.title}</h3><p>${p.text}</p><blockquote>${p.quote}</blockquote><p>${p.detail}</p><p class="small muted">公开提取可能缺失登录内容、媒体和交互。原页仍在旁边。</p><button data-act="source" class="secondary">回到原页位置</button></div>`;
    if(panel==='compare') html=panelHeader('比较来源','主动选两份 · 不自动读取其他标签')+`<div class="panel-content">${Object.entries(pages).map(([k,v])=>`<div class="source-row"><label><input type="checkbox" data-compare="${k}" ${selected.includes(k)?'checked':''} ${selected.length===2&&!selected.includes(k)?'disabled':''}><span>${v.title}<br><span class="small muted">${v.domain} · 公开正文示例</span></span></label></div>`).join('')}<button class="primary" data-act="run-compare" ${selected.length!==2?'disabled':''}>比较这两份</button>${compared?`<h3>相同点与差异</h3><p>两篇都建议由具体问题引导浏览。第一份侧重当前注意力，另一份从探索过程或任务验证补充判断。</p><p class="small muted">合成对照，仅演示布局。正式实现需固定两份来源版本与逐字依据。</p><button data-act="notes" class="secondary">记下我的判断 →</button>`:'<p class="small muted">选够两份后再开始；比较不会替代当前网页。</p>'}</div>`;
    if(panel==='notes') html=panelHeader('我的记录',`${p.domain} · 文字留在本原型内存`)+`<div class="panel-content"><label>我的判断<textarea id="note" placeholder="哪些已经确认，哪些还要核对？">${esc(n.note)}</textarea></label><label><input type="checkbox" id="include-quote" ${n.quote?'checked':''}>附上当前页引文</label><blockquote>${p.quote}</blockquote><button data-act="save-note" class="primary" ${!n.note.trim()?'disabled':''}>保存新版本</button>${n.versions.map((v,i)=>`<section class="version"><span class="small muted">版本 ${i+1} · ${esc(v.time)}</span><p>${esc(v.text)}</p>${v.quote?`<blockquote>${esc(v.quote)}</blockquote>`:''}</section>`).join('')}</div>`;
    if(panel==='settings') html=panelHeader('设置','管理入口 · 不打断日常阅读')+`<div class="panel-content"><h3>搜索与理解</h3><p>按本次场景优化查询，可以随时关闭。原问题、实际查询和提供者在结果页可查。</p><label><input id="panel-optimize" type="checkbox" ${optimized?'checked':''}>按场景优化下次查询</label><h3>检索与模型服务</h3><p class="muted">服务与密钥设置沿用正式应用。本原型不接收密钥，也不调用接口。</p><h3>外观与动效</h3><p class="muted">跟随系统浅深色和减少动态效果；场景色只影响 Grid 控件，原页保持自己的样式。</p></div>`;
    if(panel==='records') html=panelHeader('本地记录','本原型仅内存演示；关闭后不保留')+`<div class="panel-content"><p>正式应用保留路径、分支、草稿与已有回答。重新打开网页需明确点击，旧授权不会恢复。</p><button data-act="save-path" class="primary">保存当前路径</button>${records.length?records.map(r=>`<section class="source-row"><p>${esc(r.title)}</p><div class="panel-actions"><button class="secondary" data-act="restore" data-value="${r.id}">恢复位置</button><button data-act="delete-record" data-value="${r.id}">删除</button></div></section>`).join(''):'<p class="muted">尚无保存的示例路径。</p>'}<button data-act="temporary" class="secondary">开始不保存的任务</button><p class="small muted">不保存任务不等同于完整隐私浏览；本原型没有网站资料档。</p></div>`;
    if(panel==='agent') html=panelHeader('Agent','权限与操作演示 · 未连接任何客户端')+`<div class="panel-content"><h3>${agent==='off'?'先确认范围':agent==='granted'?'已授权读取（演示）':agent==='preview'?'确认下一步':agent==='running'?'正在演示':agent==='paused'?'已暂停':agent==='done'?'演示完成':'已交还控制'}</h3><p>客户端：Example Agent（自报名称）<br>范围：${p?p.domain:'需先打开网页'} · 当前文档<br>导航或撤销后失效</p>${n.kind!=='page'?'<p class="warning">先打开一页，再授权或预览。</p>':agent==='off'?'<button data-act="authorize" class="primary">授权读取此页</button>':agent==='granted'?'<p>读取授权不包含填写或提交。</p><button data-act="preview-action" class="secondary">预览填写提案</button><button data-act="revoke">撤销授权</button>':agent==='preview'?'<p>目标：示例页的「页内练习」<br>拟填写：减少无关切换<br>影响：仅填写，不提交。</p><p class="small muted">这里只演示控制状态，不实际修改网页。</p><button data-act="confirm-action" class="primary">确认演示填写</button><button data-act="revoke">取消并撤销</button>':agent==='running'?'<p>演示正在进行，网页仍可浏览。</p><button data-act="pause-agent" class="secondary">暂停</button><button data-act="takeover">我来接管</button>':agent==='paused'?'<button data-act="resume-agent" class="primary">继续演示</button><button data-act="takeover">我来接管</button>':'<p>没有执行网站操作。</p><button data-act="revoke">关闭演示状态</button>'}<details><summary>连接与读取回执 ↓</summary><p class="small muted">正式应用的连接配置、授权撤销和读取元数据回执保留在此入口。本原型不生成凭据或回执。</p></details></div>`;
    el.innerHTML=html;
    if(panel==='chat'&&n.pendingQuestion){const message=document.createElement('div');message.className='chat-user';message.textContent=n.pendingQuestion;el.querySelector('[role=status]')?.before(message);}
    if(focused){const input=document.getElementById(focused.id);if(input&&el.contains(input)){input.focus({preventScroll:true});if(typeof input.setSelectionRange==='function'&&focused.start!==null)input.setSelectionRange(focused.start,focused.end);}}
  }
  function renderChrome(){
    const n=node();$('[data-act=back]').disabled=!visible(n.parent);$('[data-act=forward]').disabled=!find(n.next)||find(n.next).removed;$('[data-act=reload]').disabled=n.kind==='home';
    $('#address').value=n.kind==='page'?`https://${page().domain}/reading`:n.kind==='results'?n.query:'';
    renderNav();renderTools();renderPanel();renderMap();
    const active=['running','paused'].includes(agent);$('#agent-strip').hidden=!active;
    if(active)$('#agent-strip').innerHTML=`<span>Agent ${agent==='running'?'正在演示':'已暂停'} · 当前文档</span><div>${agent==='running'?'<button data-act="pause-agent">暂停</button>':''}<button data-act="takeover">我来接管</button></div>`;
  }
  function generate(type){
    cancelPending();const n=node(),token=++generation,fail=response==='error';response='success';$('#demo-response').value='success';
    n[type+'State']='loading';const question=n.draft;
    if(type==='chat'){n.draft='';n.pendingQuestion=question;}
    pending={node:n,type,question,timer:setTimeout(()=>{
      if(token!==generation||n.id!==current)return;pending=null;n[type+'State']=fail?'error':'ready';
      if(!fail&&type==='summary'){n.summary=`${scenes[n.scene]}视角：${page().summary} ${n.scene==='learning'?'可以先实践“写下当前问题”，再观察是否更容易回到主线。':n.scene==='living'?'可以从关闭暂时用不到的工具面板开始。':n.scene==='entertainment'?'轻松浏览时也可以保留岔路，下次回来继续看。':n.scene==='inspiration'?'可延伸的方向：让工具的位置由当前动作决定。':''}`;}
      if(type==='chat'){delete n.pendingQuestion;if(fail&&!n.draft)n.draft=question;}
      if(!fail&&type==='chat'){n.messages.push({q:question,a:n.messages.length?'沿着前一个问题，示例补充：可以保留探索分支，但不应把每次展开工具都变成新页面。是否更好用，还需要在真实任务中观察。':'示例回答：文章给出设计建议，没有证明它对每个人都有效。可以先用一个具体任务验证，记录是否更少迷路，再决定要不要长期使用。'});}
      renderTools();renderPanel();renderNav();renderMap();if(fail)say('没有生成内容，原页仍可用。');
    },850)};renderTools();renderPanel();
  }
  function runAgent(){clearTimeout(agentTimer);agent='running';renderChrome();agentTimer=setTimeout(()=>{if(agent==='running'){agent='done';renderChrome();say('演示结束，未修改网页。');}},4000);}
  function handle(action,value){
    switch(action){
      case 'reset':cancelPending();clearTimeout(agentTimer);clearTimeout(noticeTimer);$('#notice').textContent='';nodes.length=0;removedSteps.length=0;chains.clear();chainSequence=0;chainPicker=false;pickerWasCollapsed=false;mapOpen=false;mapContinue=null;mapDraft='';mapAxis='horizontal';sequence=0;current=0;scene='professional';panel=null;summaryOpen=false;navOpen=false;records=[];selected=[];compared=false;agent='off';optimized=true;response='success';$('#demo-response').value='success';current=add('home',{},null).id;renderMain();renderChrome();break;
      case 'chains-demo':{
        handle('reset');
        const searchA=add('results',{query:sampleQuery,optimized:true},current);
        const a=add('page',{page:'a'},searchA.id);add('page',{page:'b'},searchA.id);
        scene='learning';const homeB=add('home',{},null),searchB=add('results',{query:'怎样保留阅读中的想法？',optimized:true},homeB.id);add('page',{page:'c'},searchB.id);
        jump(a.id);navOpen=root.clientWidth>900;mapOpen=true;renderChrome();revealCurrent();break;
      }
      case 'home':navigate('home',{},null);mapOpen=false;renderMap();$('#query').focus();break;
      case 'nav':navOpen=!navOpen;renderNav();(navOpen?$('#navigation [data-act=nav]'):$('[data-act=nav]')).focus();break;
      case 'map-toggle':rememberChain();chainPicker=false;pickerWasCollapsed=false;mapOpen=!mapOpen;mapContinue=null;mapDraft='';if(mapOpen&&root.clientWidth<=900){navOpen=false;renderNav();if(root.clientWidth<=650&&panel){panel=null;renderPanel();}}renderMap();if(mapOpen){revealCurrent();$('#floating-map [data-act=map-toggle]').focus({preventScroll:true});}else $('#map-launcher').focus({preventScroll:true});break;
      case 'chain-picker':if(chainPicker){closeChainPicker();}else{rememberChain();pickerWasCollapsed=!mapOpen;chainPicker=true;mapOpen=true;if(root.clientWidth<=900){navOpen=false;renderNav();}if(root.clientWidth<=650&&panel){panel=null;renderPanel();}renderMap();$('#chain-picker [aria-pressed=true]')?.focus({preventScroll:true});revealChainChoice();}break;
      case 'chain-select':selectChain(Number(value));break;
      case 'map-axis':mapAxis=value;renderMap();revealCurrent();break;
      case 'map-locate':revealCurrent();break;
      case 'map-jump':jump(Number(value));revealCurrent();$(`.map-node[data-value="${value}"]`)?.focus({preventScroll:true});break;
      case 'map-continue':if(!node().removed){mapContinue=current;mapDraft='';renderMap();$('#map-query').focus();}break;
      case 'map-cancel':mapContinue=null;mapDraft='';renderMap();$('[data-act=map-continue]').focus();break;
      case 'map-delete':removeMapNode();break;
      case 'map-undo':undoMapRemoval();break;
      case 'jump':jump(Number(value));break;
      case 'activity':{const [id,kind]=value.split(':');jump(Number(id));openPanel(kind);break;}
      case 'back':if(visible(node().parent))jump(visible(node().parent).id);break;
      case 'forward':if(node().next!==null)jump(node().next);break;
      case 'reload':say('演示：实际应用重新加载当前页；返回旧步骤不会重放提交。');break;
      case 'scene':node().query=$('#query').value;scene=value;node().scene=value;root.dataset.scene=value;root.querySelectorAll('[data-act=scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===value)));$('#scene-hint').textContent=angle[value];break;
      case 'edit-query':$('#address').focus();$('#address').select();break;
      case 'open-new':navigate('page',{page:value},null);say('已在新探索标签打开，原来的链保持不变。');break;
      case 'search-summary':$('#search-overview').hidden=!$('#search-overview').hidden;break;
      case 'summary':summaryOpen=!summaryOpen;panel=null;if(summaryOpen&&node().summaryState!=='ready')generate('summary');else renderChrome();break;
      case 'retry-summary':summaryOpen=true;generate('summary');break;
      case 'cancel':cancelPending();renderTools();renderPanel();say('生成已取消。');break;
      case 'chat':case 'read':case 'notes':case 'settings':case 'records':case 'agent':openPanel(action);break;
      case 'compare':if(!selected.length&&node().page)selected=[node().page];openPanel('compare');break;
      case 'run-compare':if(selected.length===2){compared=true;renderPanel();}break;
      case 'close-panel':panel=null;renderChrome();($('[data-act=chat]')||$('[data-act=nav]')).focus();break;
      case 'suggest':node().draft='这篇文章有哪些局限？';renderPanel();$('#question').focus();break;
      case 'source':panel=null;renderChrome();$('#passage').scrollIntoView({block:'start'});say('回到本文相关段落（示例定位）。');break;
      case 'save-note':if(node().note.trim()){node().versions.push({text:node().note,quote:node().quote?page().quote:null,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});renderPanel();renderNav();renderMap();say('已保存新版本，旧版本保留在此页。');}break;
      case 'save-path':{const n=node();if(n.temporary){say('此任务选择了不保存。请在新的普通任务中保存。');break;}const top=nodes.find(x=>x.task===n.task&&!x.removed&&x.kind!=='home')||n;records=records.filter(r=>r.task!==n.task);records.push({id:n.id,task:n.task,title:label(top)});renderPanel();say('路径已存入本原型内存。');break;}
      case 'restore':jump(Number(value));say('已恢复位置，未发出请求或恢复授权。');break;
      case 'delete-record':{const r=records.find(x=>x.id===Number(value));if(!r)break;const ids=new Set(nodes.filter(n=>n.task===r.task).map(n=>n.id));records=records.filter(x=>x!==r);if(ids.has(current)){navigate('home',{},null);panel='records';}for(let i=nodes.length-1;i>=0;i--)if(ids.has(nodes[i].id))nodes.splice(i,1);for(let i=removedSteps.length-1;i>=0;i--)if(ids.has(removedSteps[i].id))removedSteps.splice(i,1);chains.delete(r.task);renderChrome();say('已删除这条演示路径及关联内容。');break;}
      case 'temporary':navigate('home',{temporary:true},null);say('新任务仅在本原型内存中；不等同于隐私浏览。');break;
      case 'authorize':if(node().kind==='page'){agent='granted';renderPanel();}break;
      case 'preview-action':if(agent==='granted'){agent='preview';renderPanel();}break;
      case 'confirm-action':if(agent==='preview')runAgent();break;
      case 'pause-agent':if(agent==='running'){clearTimeout(agentTimer);agent='paused';renderChrome();}break;
      case 'resume-agent':if(agent==='paused')runAgent();break;
      case 'takeover':clearTimeout(agentTimer);agent='taken';renderChrome();say('已交还控制，不再继续演示。');break;
      case 'revoke':clearTimeout(agentTimer);agent='off';renderChrome();break;
    }
  }
  root.addEventListener('click',e=>{
    const link=e.target.closest('[data-open]');if(link){e.preventDefault();navigate('page',{page:link.dataset.open});return;}
    const b=e.target.closest('[data-act]');if(b&&!b.disabled){root.querySelectorAll('.page-menu[open],.review-options[open]').forEach(d=>d.open=false);if(b.dataset.act==='chain-select')selectChain(Number(b.dataset.value),b.dataset.place);else handle(b.dataset.act,b.dataset.value);}
  });
  root.addEventListener('error',e=>{
    const img=e.target;if(!(img instanceof HTMLImageElement)||!img.matches('.map-preview'))return;
    failedPreviews.add(img.dataset.page);
    root.querySelectorAll('.map-preview').forEach(peer=>{if(peer.dataset.page===img.dataset.page)peer.remove();});
  },true);
  root.addEventListener('compositionstart',()=>composing=true);
  root.addEventListener('compositionend',()=>composing=false);
  root.addEventListener('submit',e=>{e.preventDefault();if(composing||e.isComposing)return;if(e.target.id==='map-continue-form'){const id=mapContinue;if(id!==null&&find(id)&&!find(id).removed&&submit(mapDraft,id)){revealCurrent();say('已从所选节点新开分支，原有路线保留。');}}else if(e.target.id==='search-form')submit($('#query').value);else if(e.target.id==='address-form')submit($('#address').value);else if(e.target.id==='chat-form'&&node().draft.trim()&&node().chatState!=='loading')generate('chat');});
  root.addEventListener('input',e=>{
    if(e.target.id==='map-query'){mapDraft=e.target.value;$('#map-continue-form [type=submit]').disabled=!mapDraft.trim();}
    if(e.target.id==='query')node().query=e.target.value;
    if(e.target.id==='question'){node().draft=e.target.value;const send=$('#chat-form [type=submit]');if(send)send.disabled=!e.target.value.trim();}
    if(e.target.id==='note'){node().note=e.target.value;$('[data-act=save-note]').disabled=!e.target.value.trim();}
    if(e.target.id==='site-input')node().siteDraft=e.target.value;
  });
  root.addEventListener('change',e=>{
    if(e.target.id==='demo-response')response=e.target.value;
    if(e.target.id==='optimize'||e.target.id==='panel-optimize')optimized=e.target.checked;
    if(e.target.id==='include-quote')node().quote=e.target.checked;
    if(e.target.dataset.compare){const k=e.target.dataset.compare;selected=e.target.checked?[...selected,k]:selected.filter(x=>x!==k);compared=false;renderPanel();$(`[data-compare="${k}"]`).focus();}
  });
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'){const details=root.querySelector('details[open]');if(details){details.open=false;details.querySelector('summary').focus();}else if(chainPicker){closeChainPicker();}else if(mapOpen){if(mapContinue!==null)handle('map-cancel');else handle('map-toggle');}else if(panel){handle('close-panel');}else if(summaryOpen){summaryOpen=false;renderTools();$('[data-act=summary]').focus();}else if(navOpen){handle('nav');}}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='l'){e.preventDefault();$('#address').focus();$('#address').select();}
    if(e.target.id==='question'&&e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing){e.preventDefault();if(node().draft.trim())generate('chat');}
  });
  const mapEl=$('#floating-map');
  // The dock is anchored by CSS; resizing must keep the active step reachable.
  const revealAfterResize=()=>{if(chainPicker)revealChainChoice();else if(mapOpen)revealCurrent();};
  new ResizeObserver(revealAfterResize).observe($('.page-viewport'));
  new ResizeObserver(revealAfterResize).observe(mapEl);
  handle('chains-demo');
})();
