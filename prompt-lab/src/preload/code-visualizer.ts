import { ipcRenderer } from 'electron';

export const codeVisualizerBridge = {
  repository: {
    select: () => ipcRenderer.invoke('code-visualizer:repository:select'),
    scan: (rootPath: string) => ipcRenderer.invoke('code-visualizer:repository:scan', rootPath),
  },
  source: {
    read: (rootPath: string, relativePath: string) => ipcRenderer.invoke('code-visualizer:source:read', rootPath, relativePath),
  },
};
