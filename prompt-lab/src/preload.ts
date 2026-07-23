import { contextBridge, ipcRenderer, clipboard } from 'electron';

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

  // 数据持久化
  saveData: (data: string) => ipcRenderer.invoke('store-save', data),
  loadData: () => ipcRenderer.invoke('store-load'),

  // V2 功能
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window-toggle-always-on-top'),
  getAutoLaunch: () => ipcRenderer.invoke('auto-launch-get'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('auto-launch-set', enabled),

  // 右键菜单注入事件
  onInjectFromContextMenu: (callback: () => void) => {
    ipcRenderer.on('inject-from-context-menu', callback);
    return () => { ipcRenderer.removeListener('inject-from-context-menu', callback); };
  },

  // 退出前保存
  onSaveBeforeQuit: (callback: () => void) => {
    ipcRenderer.on('save-before-quit', callback);
    return () => { ipcRenderer.removeListener('save-before-quit', callback); };
  },

  // 对话捕获：将 webview 中拦截到的对话数据保存到本地
  saveConversation: (payload: {
    site: string;
    timestamp: number;
    requestBody: unknown;
    responseContent: string;
  }) => ipcRenderer.invoke('store-conversation', payload),

  // 获取 webview preload 脚本路径
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // 剪贴板（绕过 web 层，避免焦点问题）
  copyText: (text: string) => clipboard.writeText(text),

  // favicon 获取（主进程 HTTP，绕过浏览器限制）
  fetchFavicon: (siteUrl: string) => ipcRenderer.invoke('fetch-favicon', siteUrl),
});
