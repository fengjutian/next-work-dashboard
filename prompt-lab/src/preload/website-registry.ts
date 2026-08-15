import { ipcRenderer } from 'electron';
export const websiteRegistryBridge = {
  record: {
    list: (filters?: any) => ipcRenderer.invoke('website-registry:record:list', filters),
    create: (input: any) => ipcRenderer.invoke('website-registry:record:create', input),
    update: (id: string, patch: any) => ipcRenderer.invoke('website-registry:record:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('website-registry:record:delete', id),
    open: (id: string) => ipcRenderer.invoke('website-registry:record:open', id),
  },
  category: {
    list: () => ipcRenderer.invoke('website-registry:category:list'),
    create: (name: string, color?: string) => ipcRenderer.invoke('website-registry:category:create', name, color),
    update: (id: string, patch: any) => ipcRenderer.invoke('website-registry:category:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('website-registry:category:delete', id),
  },
  importData: () => ipcRenderer.invoke('website-registry:import'),
  exportData: () => ipcRenderer.invoke('website-registry:export'),
};
