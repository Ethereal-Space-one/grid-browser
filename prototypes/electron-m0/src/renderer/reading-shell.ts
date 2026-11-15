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
      el('page-summary-status').textContent=s.pending?.kind==='summary'?'正在整理公开正文…':s.issue?.kind==='summary'?s.issue.message:summary?'AI 总结 · 未核对原文':'准备获取公开正文…';
      el('page-summary-source').textContent=summary?.pageSource?summary.pageSource.title+' · Fetch 来源取得于 '+new Date(summary.pageSource.fetchedAt).toLocaleString('zh-CN'):'Fetch 来源取得时间不可用';
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

namespace OriginalQuoteLocator {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  export class Controller {
    private visible = false;
    private lastAnnouncement = '';
    private commands = new Set<string>();
    constructor(private hooks: { state: () => State | undefined; grid: GridApi; work: (action: () => Promise<unknown>) => unknown; measure: () => void }) {
      el('quote-locate').addEventListener('click', () => this.command('locate'));
      el('quote-return').addEventListener('click', () => this.command('return'));
      el('quote-dismiss').addEventListener('click', () => this.command('dismiss'));
      el('quote-locator-bar').addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        // Only a key from this bar is ours. Dialogs, menus, and the native map
        // keep their own Escape handling and higher-level dismissal order.
        event.preventDefault(); event.stopPropagation(); this.command('dismiss');
      });
    }
    private command(kind: 'locate' | 'dismiss' | 'return') {
      const s = this.hooks.state(), locator = s?.quoteLocator;
      if (!s || s.mode !== 'page' || !locator || (kind === 'locate' && locator.status !== 'ready') || (kind === 'return' && !locator.returnLabel)) return;
      const key = `${s.ownerId}:${s.entryId}:${locator.id}:${kind}`;
      if (this.commands.has(key)) return;
      this.commands.add(key);
      this.hooks.work(async () => {
        try {
          if (kind === 'locate') await this.hooks.grid.quoteLocate(locator.id, s.ownerId, s.entryId);
          else if (kind === 'return') await this.hooks.grid.quoteReturn(locator.id, s.ownerId, s.entryId);
          else await this.hooks.grid.quoteDismiss(locator.id, s.ownerId, s.entryId);
        } catch (error) {
          const current = this.hooks.state();
          if (current?.ownerId === s.ownerId && current.entryId === s.entryId && current.quoteLocator?.id === locator.id) {
            const message = kind === 'locate' ? '定位未完成，请直接阅读原页核对。' : kind === 'return' ? '未能返回当时的判断，未打开其他版本；可使用浏览后退或地图核对。' : '未能关闭引文定位，请重试。';
            el('quote-locator-message').textContent = message; this.announce(`${locator.id}:${kind}:error`, message);
          }
          throw error;
        } finally { this.commands.delete(key); }
      });
    }
    private announce(key: string, text: string) {
      if (key === this.lastAnnouncement) return;
      this.lastAnnouncement = key;
      el('quote-locator-announcement').textContent = text;
    }
    render(s: State) {
      const bar = el('quote-locator-bar');
      const locator = s.mode === 'page' ? s.quoteLocator : undefined;
      // Electron keeps document.activeElement after native focus has moved away.
      // Test both ownership and actual document focus before restoring anything.
      const ownedFocus = this.visible && bar.contains(document.activeElement) && document.hasFocus();
      const visible = Boolean(locator);
      bar.hidden = !visible;
      if (locator) {
        bar.dataset.state = locator.status;
        el('quote-locator-source').textContent = locator.sourceTitle;
        el('quote-locator-source').title = locator.sourceUrl;
        el('quote-locator-message').textContent = locator.message;
        const back = el<HTMLButtonElement>('quote-return');
        back.hidden = !locator.returnLabel;
        back.title = '返回打开这条引用时的同一判断版本和阅读位置，不重新生成';
        const locate = el<HTMLButtonElement>('quote-locate');
        // aria-disabled keeps the stable focused control in the tab order.
        // The guarded handler prevents duplicate work without blurring it.
        locate.setAttribute('aria-disabled', String(locator.status !== 'ready'));
        locate.setAttribute('aria-busy', String(locator.status === 'locating'));
        this.announce(`${s.ownerId}:${s.entryId}:${locator.id}:${locator.status}:${locator.message}`, locator.message);
      } else if (this.visible) {
        this.announce(`closed:${s.ownerId}:${s.entryId}`, '引文定位已关闭。');
      }
      if (visible !== this.visible) this.hooks.measure();
      this.visible = visible;
      // Never restore from an async command callback. A newer Tab destination,
      // dialog, or native page focus always wins. Only removal of our focused
      // controls permits an immediate move to a visible logical destination.
      if (!visible && ownedFocus) {
        const candidates = s.mode === 'page' ? ['summarize-page', 'back', 'input'] : s.mode === 'home' ? ['home-query', 'input'] : s.mode === 'judgment' ? ['judgment-title', 'input'] : ['input'];
        for (const id of candidates) {
          const next = document.getElementById(id);
          if (!(next instanceof HTMLElement) || !next.getClientRects().length || next.closest('[hidden],.hidden,[inert]') || (next instanceof HTMLButtonElement && next.disabled)) continue;
          next.focus({ preventScroll: true }); break;
        }
      }
    }
  }
}
