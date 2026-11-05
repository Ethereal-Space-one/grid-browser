(() => {
  'use strict';
  // The preview kit adds these optional CDN helpers after this fragment.
  // Grid uses text icons; tooltips have a local fallback. Do not swallow other errors.
  const optionalHelpers=new Map([
    ['https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js','tooltip'],
    ['https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js','tooltip'],
    ['https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js','icons']
  ]);
  let fallbackInstalled=false;
  function useLocalTooltips(){
    if(fallbackInstalled)return;
    const root=document.getElementById('grid-flow');
    if(!root)return;
    fallbackInstalled=true;
    let target=null,tip=null;
    const hide=()=>{
      tip?.remove();target=null;tip=null;
    };
    // Leave the unavailable host tooltip engine no triggers to handle.
    const localize=()=>root.querySelectorAll('[data-tooltip]').forEach(el=>{
      el.dataset.gridTooltipText=el.dataset.tooltip;
      el.removeAttribute('data-tooltip');
    });
    const show=el=>{
      if(!el||el===target)return;
      hide();target=el;
      tip=document.createElement('div');tip.className='inline-tooltip';
      tip.id='grid-inline-tooltip';tip.dataset.gridTooltip='';tip.setAttribute('role','tooltip');
      tip.textContent=el.dataset.gridTooltipText;root.append(tip);
      const anchor=el.getBoundingClientRect(),bounds=root.getBoundingClientRect();
      const x=Math.max(8,Math.min(anchor.left-bounds.left,bounds.width-tip.offsetWidth-8));
      const below=anchor.bottom-bounds.top+6;
      const y=below+tip.offsetHeight<=bounds.height-8?below:Math.max(8,anchor.top-bounds.top-tip.offsetHeight-6);
      tip.style.left=`${x}px`;tip.style.top=`${y}px`;
    };
    const trigger=event=>{
      // A freshly rendered button can receive focus before the mutation callback.
      const el=event.target.closest?.('[data-tooltip],[data-grid-tooltip-text]');
      if(el?.hasAttribute('data-tooltip')){
        el.dataset.gridTooltipText=el.dataset.tooltip;el.removeAttribute('data-tooltip');
      }
      return el;
    };
    root.addEventListener('pointerover',event=>show(trigger(event)));
    root.addEventListener('focusin',event=>show(trigger(event)));
    root.addEventListener('pointerout',event=>{if(target&&!target.contains(event.relatedTarget)&&document.activeElement!==target)hide();});
    root.addEventListener('focusout',hide);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
    root.addEventListener('scroll',hide,true);
    window.addEventListener('resize',hide);
    localize();
    new MutationObserver(()=>{localize();if(target&&!target.isConnected)hide();}).observe(root,{childList:true,subtree:true});
    show(document.activeElement?.closest('[data-grid-tooltip-text]'));
  }
  function handleHelper(script){
    const kind=optionalHelpers.get(script.src);
    if(!kind||script.onerror)return;
    script.onerror=()=>{if(kind==='tooltip')useLocalTooltips();return true;};
  }
  document.querySelectorAll('script[src]').forEach(handleHelper);
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const added of record.addedNodes){
      if(added.nodeType!==Node.ELEMENT_NODE)continue;
      if(added.matches('script[src]'))handleHelper(added);
      added.querySelectorAll('script[src]').forEach(handleHelper);
    }
  });
  observer.observe(document,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
})();
