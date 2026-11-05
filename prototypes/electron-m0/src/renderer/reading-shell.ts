namespace ReadingShell {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id)! as T;
  export class Controller {
    private summaries=new Set<string>(); private signature='';
    constructor(private hooks:{state:()=>State|undefined;grid:GridApi;save:()=>Promise<boolean>;work:(action:()=>Promise<unknown>)=>unknown;measure:()=>void}) {
      el('explorations').append(el('tab-list'));
      el('sidebar-footer').append(el('storage-toggle'),el('agent-toggle'),el('new-window'));
      el('exploration-heading').append(el('new-tab'));
      document.querySelector('.toolbar')!.append(el('busy'));
      el('page-tools').append(el('ask-page'));
      el('tab-list').setAttribute('aria-orientation','vertical');
      el('sidebar-toggle').addEventListener('click',()=>{
        const open=el('exploration-sidebar').getBoundingClientRect().width>0;
        hooks.work(async()=>{
          const s=hooks.state();
          if(!open && s?.companion && innerWidth<=960){
            if(!await hooks.save())return;
            await hooks.grid.jump(s.companion.id,s.ownerId,s.entryId);
          }
          document.body.dataset.sidebar=open?'closed':'open';
          el('sidebar-toggle').setAttribute('aria-expanded',String(!open));hooks.measure();
        });
      });
      el('summarize-page').addEventListener('click',()=>{
        const s=hooks.state();if(!s)return;this.summaries.add(s.entryId);this.render(s);hooks.measure();
        hooks.work(()=>hooks.grid.summarizePage(s.ownerId,s.entryId));
      });
      el('page-summary-close').addEventListener('click',()=>{const s=hooks.state();if(!s)return;this.summaries.delete(s.entryId);this.render(s);hooks.measure();el('summarize-page').focus();});
      el('page-summary-stop').addEventListener('click',()=>{const s=hooks.state();if(s)hooks.work(()=>hooks.grid.cancelRequest(s.ownerId));});
      el('page-clean').addEventListener('click',()=>{const s=hooks.state();if(!s)return;(el('page-more') as HTMLDetailsElement).open=false;hooks.work(async()=>{if(await hooks.save())await hooks.grid.read(s.companion?.url||s.value,s.ownerId);});});
      el('page-map').addEventListener('click',()=>{const s=hooks.state();if(!s)return;(el('page-more') as HTMLDetailsElement).open=false;hooks.work(()=>hooks.grid.pathMap(true,s.ownerId));});
      el('companion-close').addEventListener('click',()=>{const s=hooks.state();if(!s?.companion)return;hooks.work(async()=>{if(await hooks.save())await hooks.grid.jump(s.companion!.id,s.ownerId,s.entryId);});});
      for(const id of ['page-more'])el(id).addEventListener('toggle',hooks.measure);
    }
    render(s:State) {
      document.body.dataset.mode=s.mode;document.body.dataset.companion=String(Boolean(s.companion));
      el('companion-close').hidden=!s.companion;
      el('page-tools').hidden=s.mode!=='page'&&!s.companion;
      el('page-scene').textContent=({professional:'专业',learning:'学习',living:'生活',entertainment:'娱乐',inspiration:'灵感'})[s.scene];
      el<HTMLButtonElement>('summarize-page').hidden=s.mode!=='page';
      el<HTMLButtonElement>('summarize-page').disabled=Boolean(s.pageRecovery || s.pending);
      const visible=s.mode==='page' && this.summaries.has(s.entryId);
      el('page-summary').hidden=!visible;
      const summary=s.summary?.searchId===`page:${s.entryId}`?s.summary:undefined;
      el('page-summary-text').textContent=summary?.text||'';
      el('page-summary-status').textContent=s.pending?.kind==='summary'?'正在整理公开正文…':s.issue?.kind==='summary'?s.issue.message:summary?'AI 总结 · 未核对原文'+(summary.pageSource?' · '+new Date(summary.pageSource.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 获取':''):'准备获取公开正文…';
      el('page-summary').setAttribute('aria-busy',String(s.pending?.kind==='summary'));
      el('page-summary-stop').hidden=s.pending?.kind!=='summary';
      const citations=el('page-summary-citations');citations.replaceChildren();
      for(const c of summary?.citations||[]){const quote=document.createElement('blockquote');quote.textContent=c.quote;citations.append(quote);}
      const sig=JSON.stringify([s.ownerId,s.entryId,s.path]);if(sig===this.signature)return;this.signature=sig;
      const pages=el('exploration-pages');const focused=document.activeElement?.id;pages.replaceChildren();
      const nodes=s.path.nodes.filter(n=>n.kind==='page').map(n=>({id:n.id,label:n.label,excerpt:n.excerpt,target:n.target}));
      // Removing a map node must not make the still-open document disappear
      // from the exploration sidebar.
      const currentPage=s.companion||(s.mode==='page'?{id:s.entryId,url:s.value,title:s.value}:undefined);
      if(currentPage&&!nodes.some(n=>n.id===currentPage.id))nodes.push({id:currentPage.id,label:currentPage.title,excerpt:'当前网页 · 已从地图移除',target:currentPage.url});
      el('pages-label').textContent=nodes.length?'这次打开的网页':'搜索后，网页会留在这里';
      for(const n of nodes){const b=document.createElement('button');b.type='button';b.id='page-'+n.id;b.className='sidebar-page';
        const title=document.createElement('span');title.textContent=n.label;const excerpt=document.createElement('small');excerpt.textContent=n.excerpt||n.target||'已访问网页';b.append(title,excerpt);b.title=n.label;
        if(n.id===s.entryId||n.id===s.companion?.id)b.setAttribute('aria-current','page');
        b.addEventListener('click',()=>{if(n.id!==s.entryId)hooksJump(this.hooks,n.id,s);});pages.append(b);
      }
      if(focused?.startsWith('page-'))document.getElementById(focused)?.focus({preventScroll:true});
    }
  }
  function hooksJump(hooks:{save:()=>Promise<boolean>;grid:GridApi;work:(action:()=>Promise<unknown>)=>unknown},id:string,s:State){hooks.work(async()=>{if(await hooks.save())await hooks.grid.jump(id,s.ownerId,s.entryId);});}
}
