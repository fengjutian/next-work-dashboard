import { contextBridge, ipcRenderer } from 'electron';

// ── 暴露给渲染进程的安全 API ──
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // 提示词注入（传递到主进程执行）
  injectPrompt: (payload: {
    webviewId: number;
    text: string;
    inputSelector: string;
    submitSelector?: string;
    autoSubmit: boolean;
  }) => ipcRenderer.invoke('inject-prompt', payload),

  // 监听主进程事件
  onToggleSearchPanel: (callback: () => void) => {
    ipcRenderer.on('toggle-search-panel', callback);
    return () => {
      ipcRenderer.removeListener('toggle-search-panel', callback);
    };
  },
});
