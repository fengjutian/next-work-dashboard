import { ipcRenderer } from 'electron';

export const codeVisualizerBridge = {
  repository: {
    select: () => ipcRenderer.invoke('code-visualizer:repository:select'),
    scan: (rootPath: string) => ipcRenderer.invoke('code-visualizer:repository:scan', rootPath),
  },
  source: {
    read: (rootPath: string, relativePath: string) => ipcRenderer.invoke('code-visualizer:source:read', rootPath, relativePath),
  },
  history: {
    list: () => ipcRenderer.invoke('code-visualizer:history:list'),
    open: (rootPath: string) => ipcRenderer.invoke('code-visualizer:history:open', rootPath),
    remove: (rootPath: string) => ipcRenderer.invoke('code-visualizer:history:remove', rootPath),
  },
  snapshot: {
    list: (rootPath: string) => ipcRenderer.invoke('code-visualizer:snapshot:list', rootPath),
    load: (rootPath: string, id: string) => ipcRenderer.invoke('code-visualizer:snapshot:load', rootPath, id),
    diff: (rootPath: string, fromId: string, toId: string) => ipcRenderer.invoke('code-visualizer:snapshot:diff', rootPath, fromId, toId),
  },
};
