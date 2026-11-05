namespace LocalPaths {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id)! as T;
  export class Controller {
    private signature=''; private confirming?:string; private busy=false;
    constructor(private hooks:{state:()=>State|undefined;grid:GridApi;save:()=>Promise<boolean>;work:(action:()=>Promise<unknown>)=>unknown}) {
      el('storage-toggle').addEventListener('click',()=>{const state=hooks.state();hooks.work(()=>hooks.grid.storagePanel(!state?.storagePanelOpen));});
      el('storage-close').addEventListener('click',()=>hooks.work(async()=>{await hooks.grid.storagePanel(false);el('storage-toggle').focus({preventScroll:true});}));
      el('storage-panel').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();hooks.work(async()=>{await hooks.grid.storagePanel(false);el('storage-toggle').focus({preventScroll:true});});}});
      el('storage-save').addEventListener('click',()=>this.action(async()=>{await hooks.save();await hooks.grid.storageFlush();}));
      el('storage-temporary').addEventListener('click',()=>this.action(async()=>{await hooks.save();await hooks.grid.temporaryPath();await hooks.grid.storagePanel(false);el('home-query').focus();}));
    }
    private action(action:()=>Promise<unknown>) {
      if(this.busy)return;this.busy=true;this.render(this.hooks.state());
      this.hooks.work(async()=>{try{await action();}finally{this.busy=false;this.render(this.hooks.state());}});
    }
    render(state:State|undefined) {
      if(!state)return;const storage=state.storage;const temporary=!storage.persistent;
      const labels={ready:'本地',dirty:'待保存',saving:'保存中',saved:'已保存',error:'未保存',blocked:'受保护'};
      el('storage-toggle').textContent=`记录 · ${temporary?'临时':labels[storage.status]}`;
      el('storage-toggle').dataset.state=storage.status==='error'||storage.status==='blocked'?'error':storage.status==='saving'?'loading':storage.status==='saved'?'success':'default';
      el('storage-toggle').title=temporary?'非持久路径，不写入任务文件':storage.message||'本地记录、保存状态和最近任务';
      el('storage-toggle').setAttribute('aria-expanded',String(state.storagePanelOpen));el('storage-panel').hidden=!state.storagePanelOpen;
      el('storage-status').textContent=storage.message || (storage.status==='saved'?`最近提交：${storage.committedAt?new Date(storage.committedAt).toLocaleString('zh-CN'):'本次启动'}。恢复不会自动联网或恢复授权。`:storage.status==='saving'?'正在写入并提交本地任务…':storage.status==='dirty'?'有更改等待本地提交；完成后才显示已保存。':'开始浏览后会自动保留本地路径。');
      el('storage-status').dataset.state=el('storage-toggle').dataset.state;
      el('storage-capacity').textContent=`${storage.paths.length} / ${storage.limit} 条路径 · 任务内容 ${(storage.bytes/1024/1024).toFixed(1)} / 24 MiB · 不自动删除旧判断`;
      el<HTMLButtonElement>('storage-save').disabled=this.busy||storage.status==='blocked';el('storage-save').textContent=this.busy?'正在处理…':storage.status==='error'?'重试保存与清理':'立即保存';
      el('storage-panel').setAttribute('aria-busy',String(this.busy||storage.status==='saving'));el('storage-save').dataset.state=this.busy?'loading':storage.status==='error'?'error':storage.status==='saved'?'success':'default';
      el<HTMLButtonElement>('storage-temporary').disabled=this.busy;
      const signature=JSON.stringify([state.path.id,storage.paths,storage.status==='blocked',this.confirming,this.busy]);if(signature===this.signature)return;this.signature=signature;
      const focused=document.activeElement?.id;const list=el('storage-list');list.replaceChildren();
      if(!storage.paths.length){const empty=document.createElement('li');empty.textContent='还没有可恢复的本地路径。';list.append(empty);}
      for(const item of storage.paths){const row=document.createElement('li');row.className='storage-row';const info=document.createElement('div');const title=document.createElement('strong');title.textContent=item.title;title.title=item.title;
        const meta=document.createElement('p');meta.className='storage-caption';meta.textContent=`${item.step ? item.step+' · ' : ''}${item.nodes} 个步骤 · ${new Date(item.updatedAt).toLocaleString('zh-CN')}`;info.append(title,meta);
        const actions=document.createElement('div');actions.className='understanding-actions';const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=this.busy;b.addEventListener('click',action);actions.append(b);return b;};
        if(this.confirming===item.id){const notice=document.createElement('p');notice.className='storage-caption';notice.textContent='删除整条路径、回答和笔记，并关闭对应标签？';info.append(notice);
          const confirm=button('确认删除',()=>this.action(async()=>{await this.hooks.grid.storageDelete(item.id);this.confirming=undefined;el('storage-title').focus({preventScroll:true});}));confirm.id='storage-confirm-'+item.id;confirm.disabled=this.busy||storage.status==='blocked';
          button('保留',()=>{this.confirming=undefined;this.signature='';this.render(this.hooks.state());document.getElementById('storage-delete-'+item.id)?.focus();});
        }else{const restore=button(item.id===state.path.id?'当前路径':'恢复',()=>this.action(async()=>{await this.hooks.save();await this.hooks.grid.storageRestore(item.id);await this.hooks.grid.storagePanel(false);}));restore.id='storage-restore-'+item.id;restore.disabled=this.busy||item.id===state.path.id;
          const remove=button('删除',()=>{this.confirming=item.id;this.signature='';this.render(this.hooks.state());document.getElementById('storage-confirm-'+item.id)?.focus();});remove.id='storage-delete-'+item.id;remove.disabled=this.busy||storage.status==='blocked';}
        row.append(info,actions);list.append(row);
      }
      if(focused?.startsWith('storage-'))document.getElementById(focused)?.focus({preventScroll:true});
    }
  }
}
