import { contextBridge, ipcRenderer } from 'electron';
import type { MapApi } from './contracts/map';
const api: MapApi = {
  state: () => ipcRenderer.invoke('grid-map:state'),
  command: command => ipcRenderer.invoke('grid-map:command', command),
  onState: callback => { ipcRenderer.on('grid-map:state', (_event, state) => callback(state)); }
};
contextBridge.exposeInMainWorld('gridMap', api);
