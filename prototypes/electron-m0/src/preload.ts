import { contextBridge, ipcRenderer } from 'electron';
import type { GridApi, State } from './contracts/browsing';

contextBridge.exposeInMainWorld('grid', {
  storagePanel: open => ipcRenderer.invoke('grid:storage-panel', open),
  storageFlush: () => ipcRenderer.invoke('grid:storage-flush'),
  storageRestore: id => ipcRenderer.invoke('grid:storage-restore', id),
  storageDelete: id => ipcRenderer.invoke('grid:storage-delete', id),
  temporaryPath: () => ipcRenderer.invoke('grid:temporary-path'),
  actionPreview: (value: string, ownerId?: string) => ipcRenderer.invoke('grid:action-preview', value, ownerId),
  actionConfirm: (id: string, ownerId?: string) => ipcRenderer.invoke('grid:action-confirm', id, ownerId),
  actionPause: (ownerId?: string) => ipcRenderer.invoke('grid:action-pause', ownerId),
  actionResume: (ownerId?: string) => ipcRenderer.invoke('grid:action-resume', ownerId),
  actionCancel: (ownerId?: string) => ipcRenderer.invoke('grid:action-cancel', ownerId),
  configureKey: (key: string) => ipcRenderer.invoke('grid:configure-key', key),
  setScene: (scene: string, ownerId?: string) => ipcRenderer.invoke('grid:scene', scene, ownerId),
  extract: (url: string, scene: string, readingId: string, ownerId?: string) => ipcRenderer.invoke('grid:extract', url, scene, readingId, ownerId),
  summarize: (searchId, ownerId, entryId) => ipcRenderer.invoke('grid:summarize', searchId, ownerId, entryId),
  summarizePage: (ownerId, entryId) => ipcRenderer.invoke('grid:page-summary', ownerId, entryId),
  beginQuestion: (ownerId, entryId) => ipcRenderer.invoke('grid:question', ownerId, entryId),
  ask: (question, ownerId, entryId, questionId) => ipcRenderer.invoke('grid:ask', question, ownerId, entryId, questionId),
  judgmentBegin: (ownerId, entryId) => ipcRenderer.invoke('grid:judgment-begin', ownerId, entryId),
  judgmentEdit: (edit, ownerId, entryId) => ipcRenderer.invoke('grid:judgment-edit', edit, ownerId, entryId),
  judgmentSave: (save, ownerId, entryId) => ipcRenderer.invoke('grid:judgment-save', save, ownerId, entryId),
  comparisonChoose: (selector, ownerId, entryId) => ipcRenderer.invoke('grid:comparison-choose', selector, ownerId, entryId),
  comparisonRemove: (id, ownerId, entryId) => ipcRenderer.invoke('grid:comparison-remove', id, ownerId, entryId),
  comparisonStart: (ownerId, entryId) => ipcRenderer.invoke('grid:comparison-start', ownerId, entryId),
  comparisonRetry: (id, ownerId, entryId) => ipcRenderer.invoke('grid:comparison-retry', id, ownerId, entryId),
  comparisonRecover: (ownerId, entryId) => ipcRenderer.invoke('grid:comparison-recover', ownerId, entryId),
  submit: (input: string, options?: object, ownerId?: string) => ipcRenderer.invoke('grid:submit', input, options, ownerId),
  open: (url: string, ownerId?: string) => ipcRenderer.invoke('grid:open', url, ownerId),
  read: (url: string, ownerId?: string) => ipcRenderer.invoke('grid:read', url, ownerId),
  back: (ownerId?: string) => ipcRenderer.invoke('grid:back', ownerId),
  forward: (ownerId?: string) => ipcRenderer.invoke('grid:forward', ownerId),
  jump: (nodeId, ownerId, fromEntryId) => ipcRenderer.invoke('grid:jump', nodeId, ownerId, fromEntryId),
  reopenPage: (nodeId, ownerId, recoveryId) => ipcRenderer.invoke('grid:reopen-page', nodeId, ownerId, recoveryId),
  pathMap: (open, ownerId) => ipcRenderer.invoke('grid:path-map', open, ownerId),
  reportLayout: (ownerId, layoutId, value) => ipcRenderer.invoke('grid:layout', ownerId, layoutId, value),
  reload: (ownerId?: string) => ipcRenderer.invoke('grid:reload', ownerId),
  home: (ownerId?: string) => ipcRenderer.invoke('grid:home', ownerId),
  results: (ownerId?: string) => ipcRenderer.invoke('grid:results', ownerId),
  cancelRequest: (ownerId?: string) => ipcRenderer.invoke('grid:cancel-request', ownerId),
  state: () => ipcRenderer.invoke('grid:state'),
  tabNew: (url?: string) => ipcRenderer.invoke('grid:tab-new', url),
  tabSelect: (id: string) => ipcRenderer.invoke('grid:tab-select', id),
  tabClose: (id: string) => ipcRenderer.invoke('grid:tab-close', id),
  windowNew: () => ipcRenderer.invoke('grid:window-new'),
  savePresentation: (ownerId, entryId, value) => ipcRenderer.invoke('grid:presentation', ownerId, entryId, value),
  onFocusAddress: callback => {
    const listener = () => callback(); ipcRenderer.on('grid:focus-address', listener);
    return () => ipcRenderer.removeListener('grid:focus-address', listener);
  },
  agentPanel: (open: boolean) => ipcRenderer.invoke('grid:agent-panel', open),
  agentGrant: (id: string, documentId: string) => ipcRenderer.invoke('grid:agent-grant', id, documentId),
  agentRevoke: (id: string) => ipcRenderer.invoke('grid:agent-revoke', id),
  agentCopyConfig: (format: 'json' | 'codex' = 'json') => ipcRenderer.invoke('grid:agent-copy-config', format),
  agentExport: () => ipcRenderer.invoke('grid:agent-export'),
  onState: (callback: (state: State) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: State) => callback(state);
    ipcRenderer.on('grid:state', listener);
    return () => ipcRenderer.removeListener('grid:state', listener);
  }
} satisfies GridApi);
