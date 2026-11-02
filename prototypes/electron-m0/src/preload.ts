import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('grid', {
  submit: (input: string) => ipcRenderer.invoke('grid:submit', input),
  open: (url: string) => ipcRenderer.invoke('grid:open', url),
  read: (url: string) => ipcRenderer.invoke('grid:read', url),
  back: () => ipcRenderer.invoke('grid:back'),
  forward: () => ipcRenderer.invoke('grid:forward'),
  reload: () => ipcRenderer.invoke('grid:reload'),
  home: () => ipcRenderer.invoke('grid:home'),
  results: () => ipcRenderer.invoke('grid:results'),
  state: () => ipcRenderer.invoke('grid:state'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('grid:state', listener);
    return () => ipcRenderer.removeListener('grid:state', listener);
  }
});
