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

  // SQLite 数据库
  db: {
    load: () => ipcRenderer.invoke('db:load'),
    save: (buffer: ArrayBuffer) => ipcRenderer.invoke('db:save', buffer),
  },

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

  // 对话历史管理
  listConversations: () => ipcRenderer.invoke('list-conversations'),
  readConversation: (filePath: string) => ipcRenderer.invoke('read-conversation', filePath),
  deleteConversation: (filePath: string) => ipcRenderer.invoke('delete-conversation', filePath),
  openConversationFolder: () => ipcRenderer.invoke('open-conversation-folder'),

  // 剪贴板（绕过 web 层，避免焦点问题）
  copyText: (text: string) => clipboard.writeText(text),

  // favicon 获取（主进程 HTTP，绕过浏览器限制）
  fetchFavicon: (siteUrl: string) => ipcRenderer.invoke('fetch-favicon', siteUrl),
  // 通用 HTTP fetch（主进程，绕过 CORS）
  fetchUrl: (url: string, options?: { headers?: Record<string, string> }) =>
    ipcRenderer.invoke('fetch-url', url, options),
  // webview preload 路径
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // 文件对话框
  pickFile: (options?: { accept?: string; multiple?: boolean }) =>
    ipcRenderer.invoke('dialog:pickFile', options),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  workspace: {
    openFolder: () => ipcRenderer.invoke('workspace:openFolder'),
    listDirectory: (rootPath: string, relativePath = '') =>
      ipcRenderer.invoke('workspace:listDirectory', rootPath, relativePath),
    readTextFile: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('workspace:readTextFile', rootPath, relativePath),
    writeTextFile: (rootPath: string, relativePath: string, content: string) =>
      ipcRenderer.invoke('workspace:writeTextFile', rootPath, relativePath, content),
  },
  saveFile: (content: string, defaultName?: string) =>
    ipcRenderer.invoke('dialog:saveFile', content, defaultName),
  writeTextFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('dialog:writeTextFile', filePath, content),

  // 按路径读取文件（供 AI 工具使用）
  readFileBuffer: (filePath: string) =>
    ipcRenderer.invoke('dialog:readFileBuffer', filePath),

  // ── Token 安全存储 ──
  auth: {
    isAvailable: () => ipcRenderer.invoke('auth:is-available'),
    saveToken: (service: string, token: string, label?: string) =>
      ipcRenderer.invoke('auth:save-token', service, token, label),
    getToken: (service: string) => ipcRenderer.invoke('auth:get-token', service),
    deleteToken: (service: string) => ipcRenderer.invoke('auth:delete-token', service),
    listServices: () => ipcRenderer.invoke('auth:list-services'),
    clearAll: () => ipcRenderer.invoke('auth:clear-all'),
  },

  // ── 终端 (Terminal) ──
  terminal: {
    create: (id: string, cwd?: string, profile?: { name: string; shell: string; args?: string[]; env?: Record<string, string> }) =>
      ipcRenderer.invoke('terminal:create', id, cwd, profile),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    destroy: (id: string) => ipcRenderer.invoke('terminal:destroy', id),
    onData: (id: string, callback: (data: string) => void) => {
      const channel = `terminal:data:${id}`;
      const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
    onExit: (id: string, callback: (exitCode: number) => void) => {
      const channel = `terminal:exit:${id}`;
      const handler = (_event: Electron.IpcRendererEvent, exitCode: number) => callback(exitCode);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
  },

  // Shell 操作
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },
});
