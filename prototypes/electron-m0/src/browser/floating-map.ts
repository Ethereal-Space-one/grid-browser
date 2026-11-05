import { WebContentsView } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WindowHost } from './window-registry';
import type { MapCommand, MapState } from '../contracts/map';
import { checkedUrl, classifyInput } from '../intent';

/** Trusted chrome above the native page; never a script injected into a website. */
export class FloatingMap {
  readonly file: string;
  readonly url: string;
  view?: WebContentsView;
  private ready = false;
  private attached = false;
  private suspended = false;
  constructor(private host: WindowHost) {
    this.file = path.join(path.dirname(host.registry.uiFile), 'map.html'); this.url = pathToFileURL(this.file).href;
  }
  state(): MapState {
    const tab = this.host.active; const state = tab.browsing.snapshot();
    return { ownerId:tab.id, entryId:state.entryId, scene:state.scene, path:state.path, open:tab.pathMapOpen,
      title:tab.label(), tabs:this.host.tabs.all().map((t,i) => {const s=t.browsing.snapshot();return {id:t.id,title:t.label(),count:s.path.nodes.length,last:s.path.nodes.find(n=>n.id===s.entryId)?.label||s.value||'首页',ordinal:i+1};}),
      orientation:tab.mapOrientation, draft:tab.mapDraft, draftNode:tab.mapDraftNode };
  }
  publish() { if(this.ready && this.view && !this.view.webContents.isDestroyed() && this.host.tabs.active()) this.view.webContents.send('grid-map:state', this.state()); }
  suspend(value:boolean) { this.suspended=value;this.host.resize(); }
  resize(bounds: Electron.Rectangle, visible: boolean) {
    visible=visible&&!this.suspended&&this.host.win.isVisible()&&!this.host.win.isMinimized();
    if (!visible) { if(this.attached && this.view) this.host.win.contentView.removeChildView(this.view); this.attached=false;if(this.view)this.view.webContents.backgroundThrottling=true;return; }
    if (!this.view) {
      this.view = new WebContentsView({webPreferences:{preload:path.join(path.dirname(this.host.registry.preload),'map-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
      this.view.setBackgroundColor('#00000000'); const web=this.view.webContents;
      web.setWindowOpenHandler(()=>({action:'deny'})); web.on('will-navigate',event=>event.preventDefault());
      web.on('did-start-navigation',()=>{this.ready=false;});
      web.on('did-finish-load',()=>{this.ready=true;this.publish();});
      void web.loadFile(this.file);
    }
    // An occluded/throttled macOS view may retain its old renderer viewport
    // after setBounds. Keep visible browser chrome responsive; restore normal
    // throttling when the dock or its window is hidden/minimized.
    this.view.webContents.backgroundThrottling=false;
    if(!this.attached || this.host.win.contentView.children.at(-1)!==this.view) {
      this.host.win.contentView.addChildView(this.view); this.attached=true;
    }
    this.view.setBounds(bounds);
  }

  async command(command: MapCommand) {
    const valid = () => {
      const tab=this.host.active;
      if(tab.id!==command.ownerId || tab.browsing.snapshot().entryId!==command.entryId) throw new Error('页面已变化，请重新选择地图节点');
      return tab;
    };
    let tab=valid();
    if(command.kind==='draft'){tab.mapDraft=command.value||'';tab.mapDraftNode=command.nodeId;return;}
    if(command.kind==='orientation'){tab.mapOrientation=command.value==='vertical'?'vertical':'horizontal';this.host.refresh();return;}
    if(command.kind==='open' || command.kind==='close') {
      tab.pathMapOpen=command.kind==='open';
      if(tab.pathMapOpen && tab.companion() && this.host.win.getContentSize()[0]<960) {
        await this.host.registry.flushTasks();tab=valid();await tab.jump(tab.companion()!.id);
      }
      this.host.refresh();return;
    }
    await this.host.registry.flushTasks(); tab=valid();
    const node=command.nodeId;
    if(['jump','remove','continue'].includes(command.kind) && !tab.browsing.snapshot().path.nodes.some(n=>n.id===node)) throw new Error('节点已移除，请重新选择');
    if(command.kind==='jump') await tab.jump(node!);
    else if(command.kind==='remove') tab.browsing.removeNode(node!);
    else if(command.kind==='undo') tab.browsing.undoRemoval();
    else if(command.kind==='select') { this.host.select(command.value!); }
    else if(command.kind==='new') { await this.host.newTab(); this.host.win.webContents.focus(); this.host.win.webContents.send('grid:focus-address'); }
    else if(command.kind==='continue') {
      const input=command.value?.trim(); if(!input)throw new Error('先输入想继续了解的问题或网址');
      const intent=classifyInput(input); await tab.jump(node!);
      if(tab.disposed || this.host.tabs.active()!==tab || tab.browsing.snapshot().entryId!==node)throw new Error('标签已切换，未发起新的探索');
      tab.mapDraft='';tab.mapDraftNode=undefined;tab.pathMapOpen=false;
      if(intent.kind==='url') await tab.open(checkedUrl(intent.url));
      else await tab.browsing.search(intent.query,tab.browsing.snapshot().scene,tab.browsing.snapshot().presentation.contextual);
    }
    this.host.refresh();
  }
  dispose() { this.ready=false;const web=this.view?.webContents;if(web&&!web.isDestroyed())web.close(); }
}
