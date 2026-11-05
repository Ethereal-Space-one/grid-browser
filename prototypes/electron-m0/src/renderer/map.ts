(() => {
  type State=import('../contracts/map').MapState; type Command=import('../contracts/map').MapCommand;
  const api=(window as unknown as {gridMap:import('../contracts/map').MapApi}).gridMap;
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
  const kinds={home:'起点',search:'搜索',page:'网页',reading:'正文',question:'问答',comparison:'对照',judgment:'判断'};
  let state:State|undefined,chooser=false,composing=false,signature='',owner='',draftNode:string|undefined,chooserCollapsed=false,submitting=false;
  async function send(kind:Command['kind'],value?:string,nodeId?:string){if(!state)return;const origin=state.ownerId;el('map-error').hidden=true;
    try{await api.command({kind,value,nodeId,ownerId:state.ownerId,entryId:state.entryId});}
    catch{if(origin===state?.ownerId){el('map-error').textContent='这一步未完成，请核对当前页面后重试。';el('map-error').hidden=false;}}
  }
  function button(id:string,label:string,action:()=>void){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',action);return b;}
  function begin(id:string){draftNode=id;el<HTMLFormElement>('continue-form').hidden=false;el('continue-label').textContent='从所选节点继续';
    void send('draft',el<HTMLInputElement>('continue-input').value,id);el<HTMLInputElement>('continue-input').focus();}
  async function choose(id?:string){const collapse=chooserCollapsed;chooser=false;chooserCollapsed=false;if(collapse)await send('close');await send(id?'select':'new',id);}
  function dismissChooser(){chooser=false;if(chooserCollapsed){chooserCollapsed=false;void send('close');}else if(state)render(state);el('chain').focus();}
  function render(next:State){const previous=state;state=next;document.body.dataset.scene=next.scene;document.body.dataset.open=String(next.open);document.body.dataset.orientation=next.orientation;
    if(owner!==next.ownerId || previous?.entryId!==next.entryId && next.draftNode!==draftNode){owner=next.ownerId;draftNode=next.draftNode;el<HTMLInputElement>('continue-input').value=next.draft;chooser=false;}
    if(draftNode&&!next.path.nodes.some(n=>n.id===draftNode)){draftNode=undefined;void send('draft','');}
    el('chain-name').textContent=next.title;el('count').textContent=`${next.path.nodes.length} 步`;
    el('toggle').textContent=next.open?'收起':'展开';el('toggle').setAttribute('aria-expanded',String(next.open));
    el('chain').setAttribute('aria-expanded',String(chooser&&next.open));
    el('orientation').hidden=!next.open||chooser;el('locate').hidden=!next.open||chooser;
    el('orientation').textContent=next.orientation==='horizontal'?'纵向':'横向';
    el('chains').hidden=!next.open||!chooser;el('map-content').hidden=!next.open||chooser;
    el('continue-form').hidden=!draftNode;el('continue-label').textContent='从「'+(next.path.nodes.find(n=>n.id===draftNode)?.label||'所选节点')+'」继续';el('undo').hidden=!next.path.canUndo;
    el('map-note').textContent=next.path.currentRemoved?'当前节点已移除；网页仍保留，可撤销。':next.path.canUndo?'只移除了地图节点，后续分支保留。':next.path.notice||'点击返回 · 从任意节点继续';
    const stamp=JSON.stringify([next.path,next.tabs,next.open,chooser,next.orientation,next.ownerId]);
    if(stamp!==signature){signature=stamp;const focus=document.activeElement?.id;
      const chains=el('chains');chains.replaceChildren();for(const tab of next.tabs){
        const b=button('chain-'+tab.id,'',()=>{void choose(tab.id);});
        const title=document.createElement('strong');title.textContent=`${tab.ordinal}. ${tab.title}`;
        const meta=document.createElement('small');meta.textContent=`${tab.id===next.ownerId?'当前探索 · ':''}${tab.count} 步 · ${tab.last}`;
        b.append(title,meta);if(tab.id===next.ownerId)b.setAttribute('aria-current','true');chains.append(b);
      }
      chains.append(button('chain-new','＋ 新的探索',()=>{void choose();}));
      const graph=el('graph');const sx=graph.scrollLeft,sy=graph.scrollTop;graph.replaceChildren();const nodes=new Map(next.path.nodes.map(n=>[n.id,n]));const seen=new Set<string>();const trail=new Set<string>();let cursor=nodes.get(next.entryId);while(cursor){trail.add(cursor.id);cursor=cursor.parentId?nodes.get(cursor.parentId):undefined;}
      function branch(id:string):HTMLElement{const lane=document.createElement('div');lane.className='lane';const n=nodes.get(id);if(!n||seen.has(id))return lane;seen.add(id);
        const card=document.createElement('article');card.className='node';card.dataset.nodeId=id;
        const b=button('node-'+id,'',()=>{void send('jump',undefined,id);});b.className='node-open';b.title=[n.label,n.excerpt||n.context?.query||n.target].filter(Boolean).join('\n');b.setAttribute('aria-label',`${kinds[n.kind]}：${n.label}`);b.setAttribute('aria-description',n.excerpt||n.context?.query||n.target||'');
        if(id===next.entryId){b.setAttribute('aria-current','step');card.classList.add('current');}
        const meta=document.createElement('small');meta.textContent=`${kinds[n.kind]}${n.status==='pending'?' · 正在加载':n.status==='failed'?' · 未完成':n.status==='cancelled'?' · 已停止':''}`;
        const title=document.createElement('strong');title.textContent=n.kind==='search'?n.context?.query||n.label:n.label;
        const excerpt=document.createElement('span');excerpt.className='excerpt';excerpt.textContent=n.excerpt||n.context?.query||n.target||'从一个问题开始，沿着来源继续探索。';
        b.append(meta,title,excerpt);const actions=document.createElement('div');actions.className='node-actions';actions.append(button('continue-'+id,'从这里继续',()=>begin(id)),button('remove-'+id,'移除',()=>{void send('remove',undefined,id);}));card.append(b,actions);lane.append(card);
        const children=document.createElement('div');children.className='branches';for(const child of [...n.childIds].sort((a,b)=>Number(trail.has(b))-Number(trail.has(a))))children.append(branch(child));if(n.childIds.length)lane.append(children);return lane;
      }
      for(const n of next.path.nodes)if(!n.parentId)graph.append(branch(n.id));
      if(!next.path.nodes.length){const empty=document.createElement('p');empty.textContent='地图已清空，当前内容仍在。可撤销移除或新建探索。';graph.append(empty);}
      graph.scrollLeft=sx;graph.scrollTop=sy;
      if(focus&&document.getElementById(focus))document.getElementById(focus)!.focus({preventScroll:true});
      else if(focus?.startsWith('remove-'))el('undo').focus({preventScroll:true});
    }
    if(next.open&&(!previous?.open||next.orientation!==previous.orientation||next.entryId!==previous.entryId))requestAnimationFrame(()=>{if(chooser)el('chains').querySelector<HTMLButtonElement>('[aria-current]')?.focus();else locate();});
    if(!next.open&&previous?.open)el('toggle').focus();
  }
  function locate(){const node=el('graph').querySelector<HTMLElement>('[aria-current="step"]');node?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});node?.focus({preventScroll:true});}
  el('toggle').addEventListener('click',()=>{chooser=false;void send(state?.open?'close':'open');});
  el('chain').addEventListener('click',()=>{if(chooser){dismissChooser();return;}chooserCollapsed=!state?.open;chooser=true;if(!state?.open)void send('open');else if(state)render(state);});
  el('locate').addEventListener('click',locate);
  el('orientation').addEventListener('click',()=>{void send('orientation',state?.orientation==='horizontal'?'vertical':'horizontal');});
  el('undo').addEventListener('click',()=>{void send('undo');});
  el('continue-cancel').addEventListener('click',()=>{const id=draftNode;draftNode=undefined;el('continue-form').hidden=true;void send('draft','');document.getElementById('continue-'+id)?.focus();});
  el('continue-input').addEventListener('compositionstart',()=>{composing=true;});el('continue-input').addEventListener('compositionend',()=>{composing=false;});
  el('continue-input').addEventListener('input',()=>{void send('draft',el<HTMLInputElement>('continue-input').value,draftNode);});
  el('continue-form').addEventListener('submit',event=>{event.preventDefault();if(composing||submitting)return;const input=el<HTMLInputElement>('continue-input');if(!input.value.trim()){input.focus();return;}submitting=true;const b=el<HTMLButtonElement>('continue-submit');b.disabled=true;void send('continue',input.value,draftNode).finally(()=>{submitting=false;b.disabled=false;});});
  el('graph').addEventListener('keydown',event=>{
    if(event.isComposing || !(event.target instanceof HTMLElement) || !event.target.classList.contains('node-open'))return;
    const nodes=Array.from(el('graph').querySelectorAll<HTMLButtonElement>('.node-open'));
    const index=nodes.indexOf(event.target as HTMLButtonElement);let next=index;
    if(event.key==='Home')next=0;else if(event.key==='End')next=nodes.length-1;
    else if(['ArrowRight','ArrowDown'].includes(event.key))next=Math.min(index+1,nodes.length-1);
    else if(['ArrowLeft','ArrowUp'].includes(event.key))next=Math.max(index-1,0);else return;
    event.preventDefault();nodes[next]?.focus();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();if(draftNode){el('continue-cancel').click();}else if(chooser){dismissChooser();}else void send('close');}});
  api.onState(render);void api.state().then(render);
})();
