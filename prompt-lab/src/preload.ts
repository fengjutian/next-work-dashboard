import { contextBridge, ipcRenderer, clipboard } from 'electron';
import type { ElectronAPI, MemoryFile } from './types/electron';

// ── 暴露给渲染进程的安全 API ──
const electronAPI: ElectronAPI = {
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window-maximized-changed', handler);
    return () => ipcRenderer.removeListener('window-maximized-changed', handler);
  },
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
    title?: string;
    notes?: string;
    createNew?: boolean;
    contentMode?: 'exchange' | 'document';
  }) => ipcRenderer.invoke('store-conversation', payload),

  // 对话历史管理
  listConversations: () => ipcRenderer.invoke('list-conversations'),
  searchConversations: (query: string) => ipcRenderer.invoke('search-conversations', query),
  readConversation: (filePath: string) => ipcRenderer.invoke('read-conversation', filePath),
  writeConversation: (filePath: string, content: string) => ipcRenderer.invoke('write-conversation', filePath, content),
  renameConversation: (filePath: string, fileName: string) => ipcRenderer.invoke('rename-conversation', filePath, fileName),
  deleteConversation: (filePath: string) => ipcRenderer.invoke('delete-conversation', filePath),
  revealConversation: (filePath: string) => ipcRenderer.invoke('reveal-conversation', filePath),
  openConversationFolder: () => ipcRenderer.invoke('open-conversation-folder'),

  // 手动记忆管理
  listMemories: () => ipcRenderer.invoke('list-memories') as Promise<MemoryFile[]>,
  readMemory: (filePath: string) => ipcRenderer.invoke('read-memory', filePath) as Promise<{ success: boolean; content?: string; error?: string }>,
  writeMemory: (filePath: string, content: string) => ipcRenderer.invoke('write-memory', filePath, content) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  deleteMemory: (filePath: string) => ipcRenderer.invoke('delete-memory', filePath) as Promise<{ success: boolean; error?: string }>,
  setMemoryEnabled: (filePath: string, enabled: boolean) => ipcRenderer.invoke('set-memory-enabled', filePath, enabled) as Promise<{ success: boolean; error?: string }>,

  // 剪贴板（绕过 web 层，避免焦点问题）
  copyText: (text: string) => clipboard.writeText(text),

  // favicon 获取（主进程 HTTP，绕过浏览器限制）
  fetchFavicon: (siteUrl: string) => ipcRenderer.invoke('fetch-favicon', siteUrl),
  createEmbeddings: (payload: { baseUrl: string; apiKey: string; model: string; inputs: string[] }) =>
    ipcRenderer.invoke('embedding:create', payload),
  memoryIndex: {
    replace: (chunks: unknown[]) => ipcRenderer.invoke('memory:index:replace', chunks),
    search: (vector: number[], limit: number) => ipcRenderer.invoke('memory:index:search', vector, limit),
    clear: () => ipcRenderer.invoke('memory:index:clear'),
  },
  // 通用 HTTP fetch（主进程，绕过 CORS）
  fetchUrl: (url: string, options?: { headers?: Record<string, string> }) =>
    ipcRenderer.invoke('fetch-url', url, options),
  wereadRequest: (apiKey: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke('weread:request', apiKey, payload),
  // webview preload 路径
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // 文件对话框
  pickFile: (options?: { accept?: string; multiple?: boolean }) =>
    ipcRenderer.invoke('dialog:pickFile', options),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  workspace: {
    openFolder: () => ipcRenderer.invoke('workspace:openFolder'),
    reauthorize: (rootPath: string) => ipcRenderer.invoke('workspace:reauthorize', rootPath),
    listDirectory: (rootPath: string, relativePath = '') =>
      ipcRenderer.invoke('workspace:listDirectory', rootPath, relativePath),
    readTextFile: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('workspace:readTextFile', rootPath, relativePath),
    writeTextFile: (
      rootPath: string,
      relativePath: string,
      content: string,
      options?: {
        encoding?: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk';
        lineEnding?: 'LF' | 'CRLF';
        expectedModifiedAt?: number;
        force?: boolean;
      },
    ) => ipcRenderer.invoke('workspace:writeTextFile', rootPath, relativePath, content, options),
    writeTextFiles: (rootPath: string, edits: import('./types/electron').WorkspaceTextEdit[]) =>
      ipcRenderer.invoke('workspace:writeTextFiles', rootPath, edits),
    mutateFiles: (rootPath: string, mutations: import('./types/electron').WorkspaceFileMutation[]) =>
      ipcRenderer.invoke('workspace:mutateFiles', rootPath, mutations),
    createFile: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('workspace:createFile', rootPath, relativePath),
    createDirectory: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('workspace:createDirectory', rootPath, relativePath),
    renameEntry: (rootPath: string, relativePath: string, nextRelativePath: string) =>
      ipcRenderer.invoke('workspace:renameEntry', rootPath, relativePath, nextRelativePath),
    deleteEntry: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('workspace:deleteEntry', rootPath, relativePath),
    trashEntry: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('workspace:trashEntry', rootPath, relativePath),
    copyEntry: (rootPath: string, sourcePath: string, targetPath: string) =>
      ipcRenderer.invoke('workspace:copyEntry', rootPath, sourcePath, targetPath),
    revealEntry: (rootPath: string, relativePath: string) => ipcRenderer.invoke('workspace:revealEntry', rootPath, relativePath),
    listTasks: (rootPath: string) => ipcRenderer.invoke('workspace:listTasks', rootPath),
    runTask: (rootPath: string, taskName: string, runId: string, environment?: Record<string, string>) => ipcRenderer.invoke('workspace:runTask', rootPath, taskName, runId, environment),
    cancelTask: (runId: string) => ipcRenderer.invoke('workspace:cancelTask', runId),
    onTaskEvent: (callback: (event: import('./types/electron').WorkspaceTaskEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: import('./types/electron').WorkspaceTaskEvent) => callback(payload);
      ipcRenderer.on('workspace:taskEvent', handler);
      return () => ipcRenderer.removeListener('workspace:taskEvent', handler);
    },
    listFiles: (rootPath: string) =>
      ipcRenderer.invoke('workspace:listFiles', rootPath),
    search: (rootPath: string, query: string, options?: import('./types/electron').WorkspaceSearchOptions) =>
      ipcRenderer.invoke('workspace:search', rootPath, query, options),
    semanticSearch: (rootPath: string, symbol: string) => ipcRenderer.invoke('workspace:semanticSearch', rootPath, symbol),
    languageSemanticSearch: (rootPath: string, relativePath: string, line: number, column: number) => ipcRenderer.invoke('workspace:languageSemanticSearch', rootPath, relativePath, line, column),
    gitStatus: (rootPath: string) => ipcRenderer.invoke('workspace:gitStatus', rootPath),
    createAgentWorktree: (rootPath: string, sessionId: string) => ipcRenderer.invoke('workspace:createAgentWorktree', rootPath, sessionId),
    getAgentWorktreeStatus: (rootPath: string, sessionId: string) => ipcRenderer.invoke('workspace:getAgentWorktreeStatus', rootPath, sessionId),
    discardAgentWorktree: (rootPath: string, sessionId: string) => ipcRenderer.invoke('workspace:discardAgentWorktree', rootPath, sessionId),
    previewAgentWorktreeMerge: (rootPath: string, sessionId: string) => ipcRenderer.invoke('workspace:previewAgentWorktreeMerge', rootPath, sessionId),
    getAgentWorktreeConflictVersions: (rootPath: string, sessionId: string, filePath: string) => ipcRenderer.invoke('workspace:getAgentWorktreeConflictVersions', rootPath, sessionId, filePath),
    deliverAgentPR: (rootPath: string, branch: string, config: any, title: string, body: string, token?: string) => ipcRenderer.invoke("agent:deliverPR", rootPath, branch, config, title, body, token),
        mergeAgentWorktree: (rootPath: string, sessionId: string, message: string) => ipcRenderer.invoke('workspace:mergeAgentWorktree', rootPath, sessionId, message),
    // Agent task operations
    agentTaskCreate: (config: import("./types/electron").AgentTaskConfig) => ipcRenderer.invoke("agent-task:create", config),
    agentTaskGet: (taskId: string) => ipcRenderer.invoke("agent-task:get", taskId),
    agentTaskList: (sessionId?: string) => ipcRenderer.invoke("agent-task:list", sessionId),
    agentTaskCancel: (taskId: string) => ipcRenderer.invoke("agent-task:cancel", taskId),
    agentTaskRetry: (taskId: string) => ipcRenderer.invoke("agent-task:retry", taskId),
    agentTaskSnapshot: () => ipcRenderer.invoke("agent-task:snapshot"),
    agentTaskRestore: (tasks: any[]) => ipcRenderer.invoke("agent-task:restore", tasks),
    agentTaskSubscribe: (taskId: string) => { ipcRenderer.send("agent-task:subscribe", taskId); },
    onAgentTaskEvent: (handler: (event: import("./types/electron").AgentTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: import("./types/electron").AgentTaskEvent) => handler(data);
      ipcRenderer.on("agent-task:event", listener);
      return () => { ipcRenderer.removeListener("agent-task:event", listener); };
    },
    gitShowHead: (rootPath: string, relativePath: string) => ipcRenderer.invoke('workspace:gitShowHead', rootPath, relativePath),
    gitStage: (rootPath: string, relativePaths: string[]) => ipcRenderer.invoke('workspace:gitStage', rootPath, relativePaths),
    gitUnstage: (rootPath: string, relativePaths: string[]) => ipcRenderer.invoke('workspace:gitUnstage', rootPath, relativePaths),
    gitCommit: (rootPath: string, message: string) => ipcRenderer.invoke('workspace:gitCommit', rootPath, message),
    gitOperation: (rootPath: string, operation: import('./types/electron').WorkspaceGitOperation, payload?: Record<string, unknown>) => ipcRenderer.invoke('workspace:gitOperation', rootPath, operation, payload),
    cancelGitOperation: (rootPath: string, operationId: string) => ipcRenderer.invoke('workspace:cancelGitOperation', rootPath, operationId),
    onGitProgress: (callback: (event: import('./types/electron').WorkspaceGitProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: import('./types/electron').WorkspaceGitProgress) => callback(payload);
      ipcRenderer.on('workspace:gitProgress', handler);
      return () => ipcRenderer.removeListener('workspace:gitProgress', handler);
    },
    watch: (rootPath: string) => ipcRenderer.invoke('workspace:watch', rootPath),
    unwatch: () => ipcRenderer.invoke('workspace:unwatch'),
    onFileChanged: (callback: (event: { path: string; type: 'change' | 'rename' }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { path: string; type: 'change' | 'rename' }) =>
        callback(payload);
      ipcRenderer.on('workspace:fileChanged', handler);
      return () => ipcRenderer.removeListener('workspace:fileChanged', handler);
    },
  },
  knowledge: {
    scanWorkspace: (rootPath: string) => ipcRenderer.invoke('knowledge:scanWorkspace', rootPath),
    createFromTemplate: (rootPath: string, templateId: string, values: Record<string, string>) =>
      ipcRenderer.invoke('knowledge:createFromTemplate', rootPath, templateId, values),
    readDocument: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('knowledge:readDocument', rootPath, relativePath),
    searchWorkspace: (rootPath: string, query: string, limit?: number, filters?: import('./core/knowledge').KnowledgeSearchFilters) =>
      ipcRenderer.invoke('knowledge:searchWorkspace', rootPath, query, limit, filters),
    renameDocument: (rootPath: string, relativePath: string, nextRelativePath: string) =>
      ipcRenderer.invoke('knowledge:renameDocument', rootPath, relativePath, nextRelativePath),
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

  // ── Model Context Protocol ──
  mcp: {
    listServers: () => ipcRenderer.invoke('mcp:list-servers'),
    saveServer: (config) => ipcRenderer.invoke('mcp:save-server', config),
    removeServer: (serverId) => ipcRenderer.invoke('mcp:remove-server', serverId),
    connect: (serverId) => ipcRenderer.invoke('mcp:connect', serverId),
    disconnect: (serverId) => ipcRenderer.invoke('mcp:disconnect', serverId),
    listTools: (serverId) => ipcRenderer.invoke('mcp:list-tools', serverId),
    callTool: (serverId, name, args) => ipcRenderer.invoke('mcp:call-tool', serverId, name, args),
    recordDenial: (serverId, name, args) => ipcRenderer.invoke('mcp:record-denial', serverId, name, args),
    listAudit: (limit) => ipcRenderer.invoke('mcp:list-audit', limit),
    clearAudit: () => ipcRenderer.invoke('mcp:clear-audit'),
  },

  // ── 终端 (Terminal) ──
  terminal: {
    profiles: () => ipcRenderer.invoke('terminal:profiles'),
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
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
