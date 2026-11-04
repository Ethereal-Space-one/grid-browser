import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('grid', {
  actionPreview: (value: string) => ipcRenderer.invoke('grid:action-preview', value),
  actionConfirm: (id: string) => ipcRenderer.invoke('grid:action-confirm', id),
  actionPause: () => ipcRenderer.invoke('grid:action-pause'),
  actionResume: () => ipcRenderer.invoke('grid:action-resume'),
  actionCancel: () => ipcRenderer.invoke('grid:action-cancel'),
  setScene: (scene: string) => ipcRenderer.invoke('grid:scene', scene),
  extract: (url: string, scene: string) => ipcRenderer.invoke('grid:extract', url, scene),
  submit: (input: string, options?: object) => ipcRenderer.invoke('grid:submit', input, options),
  open: (url: string) => ipcRenderer.invoke('grid:open', url),
  read: (url: string) => ipcRenderer.invoke('grid:read', url),
  back: () => ipcRenderer.invoke('grid:back'),
  forward: () => ipcRenderer.invoke('grid:forward'),
  reload: () => ipcRenderer.invoke('grid:reload'),
  home: () => ipcRenderer.invoke('grid:home'),
  results: () => ipcRenderer.invoke('grid:results'),
  state: () => ipcRenderer.invoke('grid:state'),
  agentPanel: (open: boolean) => ipcRenderer.invoke('grid:agent-panel', open),
  agentGrant: (id: string) => ipcRenderer.invoke('grid:agent-grant', id),
  agentRevoke: (id: string) => ipcRenderer.invoke('grid:agent-revoke', id),
  agentCopyConfig: (format: 'json' | 'codex' = 'json') => ipcRenderer.invoke('grid:agent-copy-config', format),
  agentExport: () => ipcRenderer.invoke('grid:agent-export'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('grid:state', listener);
    return () => ipcRenderer.removeListener('grid:state', listener);
  }
});
