namespace HomeEntry {
  type State=import('../contracts/browsing').State;
  type Api=import('../contracts/browsing').GridApi;
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
  export function continuation(state:State|undefined) {
    if(!state || state.mode!=='home' || !state.storage.persistent || state.pending)return;
    return state.storage.paths.find(item=>item.continuation);
  }
  export class Controller {
    private busy=false;
    constructor(private hooks:{state:()=>State|undefined;grid:Api;save:()=>Promise<boolean>;work:(action:()=>Promise<unknown>)=>unknown}) {
      el('home-resume-button').addEventListener('click',()=>{void this.resume();});
      el('home-query').addEventListener('input',()=>this.clearError());
    }
    clearError() { el('home-query-error').hidden=true;el('home-query').removeAttribute('aria-invalid'); }
    validate(raw:string) {
      if(raw.trim()){this.clearError();return true;}
      el('home-query-error').textContent='输入问题或网址';el('home-query-error').hidden=false;
      el('home-query').setAttribute('aria-invalid','true');el('home-query').focus();return false;
    }
    async resume():Promise<void> {
      const origin=this.hooks.state();const item=continuation(origin);const target=item?.continuation;
      if(this.busy || !origin || !item || !target)return;
      this.busy=true;this.render(origin);
      try {
        await this.hooks.work(async()=>{
          if(!await this.hooks.save())return;
          const current=this.hooks.state();
          if(current?.ownerId!==origin.ownerId || current.entryId!==origin.entryId || continuation(current)?.id!==item.id
            || continuation(current)?.continuation?.entryId!==target.entryId)return;
          await this.hooks.grid.storageRestore(item.id,{nodeId:target.entryId,ownerId:origin.ownerId,entryId:origin.entryId});
        });
      } finally {this.busy=false;this.render(this.hooks.state());}
    }
    render(state:State|undefined) {
      const item=continuation(state);const target=item?.continuation;
      el('home-resume').hidden=!target;
      el<HTMLButtonElement>('home-resume-button').disabled=this.busy || !target;
      el('home-resume-button').setAttribute('aria-busy',String(this.busy));
      el('home-resume-title').textContent=target?.title || '';
      el('home-resume-step').textContent=target?`停在：${target.step}`:'';
      if(state?.mode!=='home')this.clearError();
    }
  }
}
