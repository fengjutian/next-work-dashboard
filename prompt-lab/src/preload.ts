import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron';
import type { ElectronAPI, MemoryFile } from './types/electron';
import { workBrowserBridge } from './preload/work-browser';
import { securityAuditBridge } from './preload/security-audit';

// ── 暴露给渲染进程的安全 API ──
const electronAPI: ElectronAPI = {
  outlineProjects: {
    load: () => ipcRenderer.invoke('outline-projects:load'),
    save: (projects) => ipcRenderer.invoke('outline-projects:save', projects),
  },
  outlineSecrets: {
    load: (kind) => ipcRenderer.invoke('outline-secrets:load', kind),
    save: (kind, value) => ipcRenderer.invoke('outline-secrets:save', kind, value),
  },
  outlineResearch: {
    search: (queries) => ipcRenderer.invoke('outline-research:search', queries),
  },
  outlineGithub: {
    pagesStatus: (remoteUrl) => ipcRenderer.invoke('outline-github:pages-status', remoteUrl),
  },
  rss: {
    fetch: (url: string) => ipcRenderer.invoke('rss:fetch', url),
    loadState: () => ipcRenderer.invoke('rss:state:load'),
    saveState: (state) => ipcRenderer.invoke('rss:state:save', state),
    refreshAll: () => ipcRenderer.invoke('rss:refresh:all'),
    setRefreshMinutes: (minutes: number) => ipcRenderer.invoke('rss:settings:refresh', minutes),
    setRetentionDays: (days: number) => ipcRenderer.invoke('rss:settings:retention', days),
    setNotificationsEnabled: (enabled: boolean) => ipcRenderer.invoke('rss:settings:notifications', enabled),
    extractArticle: (feedId: string, articleId: string, url: string) => ipcRenderer.invoke('rss:article:extract', feedId, articleId, url),
    search: (query: string) => ipcRenderer.invoke('rss:search', query),
    listRules: () => ipcRenderer.invoke('rss:rules:list'),
    saveRule: (rule) => ipcRenderer.invoke('rss:rules:save', rule),
    deleteRule: (id: string) => ipcRenderer.invoke('rss:rules:delete', id),
  },
  plugins: {
    loadDefinitions: () => ipcRenderer.invoke('plugins:definitions:load'),
    saveDefinitions: (definitions) => ipcRenderer.invoke('plugins:definitions:save', definitions),
    getCachedCatalog: () => ipcRenderer.invoke('plugins:marketplace:cached'),
    fetchCatalog: (url) => ipcRenderer.invoke('plugins:marketplace:fetch', url),
    install: (entry) => ipcRenderer.invoke('plugins:marketplace:install', entry),
  },
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
  hide: () => ipcRenderer.invoke('window-hide'),
  show: () => ipcRenderer.invoke('window-show'),

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
  documentCache: {
    save: (documentId: string, buffer: ArrayBuffer) => ipcRenderer.invoke('document-cache:save', documentId, buffer),
    load: (documentId: string) => ipcRenderer.invoke('document-cache:load', documentId),
    delete: (documentId: string) => ipcRenderer.invoke('document-cache:delete', documentId),
  },
  office: {
    status: () => ipcRenderer.invoke('office:status'),
    create: (kind) => ipcRenderer.invoke('office:create', kind),
    outline: (filePath) => ipcRenderer.invoke('office:outline', filePath),
    get: (filePath, domPath, depth) => ipcRenderer.invoke('office:get', filePath, domPath, depth),
    query: (filePath, selector) => ipcRenderer.invoke('office:query', filePath, selector),
    set: (request) => ipcRenderer.invoke('office:set', request),
    add: (request) => ipcRenderer.invoke('office:add', request),
    remove: (filePath, domPath) => ipcRenderer.invoke('office:remove', filePath, domPath),
    save: (filePath) => ipcRenderer.invoke('office:save', filePath),
    undo: (filePath) => ipcRenderer.invoke('office:undo', filePath),
    redo: (filePath) => ipcRenderer.invoke('office:redo', filePath),
    merge: (filePath, data) => ipcRenderer.invoke('office:merge', filePath, data),
    saveAs: (filePath) => ipcRenderer.invoke('office:saveAs', filePath),
    render: (filePath) => ipcRenderer.invoke('office:render', filePath),
    renderPage: (filePath, page) => ipcRenderer.invoke('office:renderPage', filePath, page),
    close: (filePath) => ipcRenderer.invoke('office:close', filePath),
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
  listConversationFolders: () => ipcRenderer.invoke('list-conversation-folders'),
  createConversationFolder: (relativePath: string) => ipcRenderer.invoke('create-conversation-folder', relativePath),
  moveConversation: (filePath: string, targetFolder: string) => ipcRenderer.invoke('move-conversation', filePath, targetFolder),
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
  llmChat: (payload) => ipcRenderer.invoke('llm:chat', payload),
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),
  videoGeneration: {
    create: (payload: import('./plugins/video-generation/types').VideoGenerationRequest) =>
      ipcRenderer.invoke('video-generation:create', payload),
    query: (payload: { baseUrl?: string; apiKey: string; taskId: string }) =>
      ipcRenderer.invoke('video-generation:query', payload),
    download: (payload: { taskId: string; videoUrl: string; recordId: string }) =>
      ipcRenderer.invoke('video-generation:download', payload),
    cancel: (payload: { baseUrl?: string; apiKey: string; taskId: string }) =>
      ipcRenderer.invoke('video-generation:cancel', payload),
    uploadReference: (payload: { name: string; mimeType: string; data: ArrayBuffer; ttlHours?: number }) =>
      ipcRenderer.invoke('video-generation:upload-reference', payload) as Promise<{ success: boolean; url?: string; ttlHours?: number; bytes?: number; error?: string }>,
    readBlob: (filePath: string) =>
      ipcRenderer.invoke('video-generation:read-blob', filePath) as Promise<{ success: boolean; bytes?: number; mimeType?: string; data?: ArrayBuffer; error?: string }>,
    reveal: (filePath: string) => ipcRenderer.invoke('video-generation:reveal', filePath),
    openFolder: () => ipcRenderer.invoke('video-generation:open-folder') as Promise<{ success: boolean; path?: string; error?: string }>,
    cleanup: (filePath: string) => ipcRenderer.invoke('video-generation:cleanup', filePath),
  },
  screenCapture: {
    setTarget: (target, systemAudio) => ipcRenderer.invoke('screen-capture:set-target', { target, systemAudio }),
    getPrimaryScreenSourceId: () => ipcRenderer.invoke('screen-capture:primary-source'),
    setRecordingState: (state) => ipcRenderer.send('screen-capture:recording-state', state),
  },
  createEmbeddings: (payload: { baseUrl: string; apiKey: string; model: string; inputs: string[] }) =>
    ipcRenderer.invoke('embedding:create', payload),
  memoryIndex: {
    replace: (chunks: unknown[]) => ipcRenderer.invoke('memory:index:replace', chunks),
    search: (vector: number[], limit: number) => ipcRenderer.invoke('memory:index:search', vector, limit),
    clear: () => ipcRenderer.invoke('memory:index:clear'),
  },
  ragWorker: {
    status: () => ipcRenderer.invoke('rag-worker:status'),
    upsertDocument: (document) => ipcRenderer.invoke('rag-worker:upsert-document', document),
    deleteDocument: (documentId) => ipcRenderer.invoke('rag-worker:delete-document', documentId),
    keywordSearch: (request) => ipcRenderer.invoke('rag-worker:keyword-search', request),
    vectorSearch: (request) => ipcRenderer.invoke('rag-worker:vector-search', request),
    fuseResults: (request) => ipcRenderer.invoke('rag-worker:fuse-results', request),
    indexStatus: () => ipcRenderer.invoke('rag-worker:index-status'),
    retryFailed: (documentId) => ipcRenderer.invoke('rag-worker:retry-failed', documentId),
    pendingOutbox: (limit) => ipcRenderer.invoke('rag-worker:pending-outbox', limit),
    completeOutbox: (id) => ipcRenderer.invoke('rag-worker:complete-outbox', id),
    failOutbox: (id, error) => ipcRenderer.invoke('rag-worker:fail-outbox', id, error),
  },
  mycast: {
    start: () => ipcRenderer.invoke('mycast:start'),
    state: () => ipcRenderer.invoke('mycast:state'),
    systemInfo: () => ipcRenderer.invoke('mycast:system-info'),
    issuePairing: () => ipcRenderer.invoke('mycast:issue-pairing'),
    listSessions: () => ipcRenderer.invoke('mycast:list-sessions'),
    listTransfers: () => ipcRenderer.invoke('mycast:list-transfers'),
    openTransfer: (transferId: string) => ipcRenderer.invoke('mycast:open-transfer', transferId),
    sendToPhone: (deviceId: string, frame: Record<string, unknown>) => ipcRenderer.invoke('mycast:send-to-phone', deviceId, frame),
    endSession: (sessionId: string) => ipcRenderer.invoke('mycast:end-session', sessionId),
    cancelTransfer: (uploadId: string) => ipcRenderer.invoke('mycast:cancel-transfer', uploadId),
    onEvent: (handler: (event: import('./plugins/mycast/backend/mycast-types').MyCastEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: import('./plugins/mycast/backend/mycast-types').MyCastEvent) => handler(payload);
      ipcRenderer.on('mycast:event', listener);
      return () => { ipcRenderer.removeListener('mycast:event', listener); };
    },
  },
  phone: {
    start: () => ipcRenderer.invoke('phone:start'),
    stop: () => ipcRenderer.invoke('phone:stop'),
    state: () => ipcRenderer.invoke('phone:state'),
    listMessages: (peerId: string) => ipcRenderer.invoke('phone:list-messages', peerId),
    listConversations: () => ipcRenderer.invoke('phone:list-conversations'),
    pair: (peerId: string) => ipcRenderer.invoke('phone:pair', peerId),
    respondPairing: (requestId: string, peerId: string, accepted: boolean) => ipcRenderer.invoke('phone:respond-pairing', requestId, peerId, accepted),
    removePeer: (peerId: string) => ipcRenderer.invoke('phone:remove-peer', peerId),
    updateProfile: (profile: { nickname: string; avatar?: string }) => ipcRenderer.invoke('phone:update-profile', profile),
    updatePeer: (peerId: string, patch: { remark?: string }) => ipcRenderer.invoke('phone:update-peer', peerId, patch),
    sendText: (peerId: string, text: string) => ipcRenderer.invoke('phone:send-text', peerId, text),
    selectAndSendFiles: (peerId: string) => ipcRenderer.invoke('phone:send-files', peerId),
    retryFile: (messageId: string) => ipcRenderer.invoke('phone:retry-file', messageId),
    cancelFile: (fileId: string) => ipcRenderer.invoke('phone:cancel-file', fileId),
    markRead: (peerId: string, messageIds: string[]) => ipcRenderer.invoke('phone:mark-read', peerId, messageIds),
    sendSignal: (peerId: string, signal: import('./plugins/phone/types').PhoneSignal) => ipcRenderer.invoke('phone:send-signal', peerId, signal),
    recordCall: (input: Parameters<import('./plugins/phone/types').PhoneApi['recordCall']>[0]) => ipcRenderer.invoke('phone:record-call', input),
    openFile: (messageId: string) => ipcRenderer.invoke('phone:open-file', messageId),
    onEvent: (handler: (event: import('./plugins/phone/types').PhoneEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: import('./plugins/phone/types').PhoneEvent) => handler(payload);
      ipcRenderer.on('phone:event', listener);
      return () => { ipcRenderer.removeListener('phone:event', listener); };
    },
  },
  voice: {
    start: () => ipcRenderer.invoke('voice:start'),
    state: () => ipcRenderer.invoke('voice:state'),
    ping: () => ipcRenderer.invoke('voice:ping'),
    requestState: () => ipcRenderer.invoke('voice:request-state'),
    requestModels: () => ipcRenderer.invoke('voice:request-models'),
    startRecording: (durationSecs: number) => ipcRenderer.invoke('voice:start-recording', durationSecs),
    listRecordings: () => ipcRenderer.invoke('voice:list-recordings'),
    transcribe: (payload: {
      audioPath: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      language?: string;
    }) => ipcRenderer.invoke('voice:transcribe', payload),
    onEvent: (handler: (event: import('./plugins/voice-input/backend/voice-types').VoiceEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: import('./plugins/voice-input/backend/voice-types').VoiceEvent) => handler(payload);
      ipcRenderer.on('voice:event', listener);
      return () => { ipcRenderer.removeListener('voice:event', listener); };
    },
  },
  videoPlayer: {
    open: (filePath?: string) => ipcRenderer.invoke('video-player:open', filePath),
    openUrl: (url: string) => ipcRenderer.invoke('video-player:open-url', url),
    pickFile: () => ipcRenderer.invoke('video-player:pick-file'),
    pickSubtitle: () => ipcRenderer.invoke('video-player:pick-subtitle'),
    close: () => ipcRenderer.invoke('video-player:close'),
    play: () => ipcRenderer.invoke('video-player:play'),
    pause: () => ipcRenderer.invoke('video-player:pause'),
    toggle: () => ipcRenderer.invoke('video-player:toggle'),
    stop: () => ipcRenderer.invoke('video-player:stop'),
    seek: (seconds: number, mode?: 'absolute' | 'relative') => ipcRenderer.invoke('video-player:seek', seconds, mode),
    setVolume: (volume: number) => ipcRenderer.invoke('video-player:set-volume', volume),
    setMute: (muted: boolean) => ipcRenderer.invoke('video-player:set-mute', muted),
    setSpeed: (speed: number) => ipcRenderer.invoke('video-player:set-speed', speed),
    selectAudio: (id: number | 'no') => ipcRenderer.invoke('video-player:select-audio', id),
    selectSubtitle: (id: number | 'no') => ipcRenderer.invoke('video-player:select-subtitle', id),
    addSubtitle: (filePath: string) => ipcRenderer.invoke('video-player:add-subtitle', filePath),
    getTracks: () => ipcRenderer.invoke('video-player:get-tracks'),
    getStatus: () => ipcRenderer.invoke('video-player:status'),
    addToPlaylist: (sources: string[]) => ipcRenderer.invoke('video-player:playlist-add', sources),
    removeFromPlaylist: (id: string) => ipcRenderer.invoke('video-player:playlist-remove', id),
    clearPlaylist: () => ipcRenderer.invoke('video-player:playlist-clear'),
    playIndex: (index: number) => ipcRenderer.invoke('video-player:playlist-play-index', index),
    playNext: () => ipcRenderer.invoke('video-player:playlist-next'),
    playPrev: () => ipcRenderer.invoke('video-player:playlist-prev'),
    setPlaylistMode: (mode: 'sequential' | 'loop-one' | 'loop-all' | 'shuffle') => ipcRenderer.invoke('video-player:playlist-mode', mode),
    reorderPlaylist: (from: number, to: number) => ipcRenderer.invoke('video-player:playlist-reorder', from, to),
    setWindowMode: (mode: 'mpv' | 'browser') => ipcRenderer.invoke('video-player:window-mode', mode),
    detachVideoWindow: () => ipcRenderer.invoke('video-player:window-detach'),
    attachVideoWindow: () => ipcRenderer.invoke('video-player:window-attach'),
    focusVideoWindow: () => ipcRenderer.invoke('video-player:window-focus'),
    onStatus: (callback: (status: import('./plugins/video-player/types').VideoPlayerStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: import('./plugins/video-player/types').VideoPlayerStatus) => callback(status);
      ipcRenderer.on('video-player:status', handler);
      return () => { ipcRenderer.removeListener('video-player:status', handler); };
    },
    onEvent: (callback: (event: import('./plugins/video-player/types').VideoPlayerEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: import('./plugins/video-player/types').VideoPlayerEvent) => callback(event);
      ipcRenderer.on('video-player:event', handler);
      return () => { ipcRenderer.removeListener('video-player:event', handler); };
    },
  },
  // 通用 HTTP fetch（主进程，绕过 CORS）
  fetchUrl: (url: string, options?: { headers?: Record<string, string> }) =>
    ipcRenderer.invoke('fetch-url', url, options),
  wereadRequest: (apiKey: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke('weread:request', apiKey, payload),
  wereadAiSummary: (payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ bookId: string; title: string; author: string; highlights: string[]; reviews: string[] }> }) =>
    ipcRenderer.invoke('weread:ai-summary', payload),
  wereadAiRecommend: (payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ title: string; author: string; highlights: string[]; reviews: string[] }> }) =>
    ipcRenderer.invoke('weread:ai-recommend', payload),
  // webview preload 路径
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // 文件对话框
  pickFile: (options?: { accept?: string; multiple?: boolean }) =>
    ipcRenderer.invoke('dialog:pickFile', options),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
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
    listAgentScripts: (rootPath: string) => ipcRenderer.invoke('workspace:listAgentScripts', rootPath),
    runAgentScript: (rootPath: string, script: string, timeoutMs?: number) => ipcRenderer.invoke('workspace:runAgentScript', rootPath, script, timeoutMs),
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
    gitInit: (rootPath: string) => ipcRenderer.invoke('workspace:gitInit', rootPath),
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
    gitCommit: (rootPath: string, message: string, relativePaths?: string[]) => ipcRenderer.invoke('workspace:gitCommit', rootPath, message, relativePaths),
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
    writeBinaryFile: (
      rootPath: string,
      relativePath: string,
      content: string,
      options?: { expectedModifiedAt?: number; force?: boolean },
    ) => ipcRenderer.invoke('workspace:writeBinaryFile', rootPath, relativePath, content, options),
  },
  knowledge: {
    scanWorkspace: (rootPath: string) => ipcRenderer.invoke('knowledge:scanWorkspace', rootPath),
    captureState: (rootPath: string, documentPaths?: string[]) => ipcRenderer.invoke('knowledge:captureState', rootPath, documentPaths),
    createFromTemplate: (rootPath: string, templateId: string, values: Record<string, string>) =>
      ipcRenderer.invoke('knowledge:createFromTemplate', rootPath, templateId, values),
    readDocument: (rootPath: string, relativePath: string) =>
      ipcRenderer.invoke('knowledge:readDocument', rootPath, relativePath),
    searchWorkspace: (rootPath: string, query: string, limit?: number, filters?: import('./core/knowledge').KnowledgeSearchFilters) =>
      ipcRenderer.invoke('knowledge:searchWorkspace', rootPath, query, limit, filters),
    renameDocument: (rootPath: string, relativePath: string, nextRelativePath: string) =>
      ipcRenderer.invoke('knowledge:renameDocument', rootPath, relativePath, nextRelativePath),
  },
  saveFile: (content: string, defaultName?: string, options?: Pick<import('./types/electron').WorkspaceWriteOptions, 'encoding' | 'lineEnding'>) =>
    ipcRenderer.invoke('dialog:saveFile', content, defaultName, options),
  writeTextFile: (filePath: string, content: string, options?: import('./types/electron').WorkspaceWriteOptions) =>
    ipcRenderer.invoke('dialog:writeTextFile', filePath, content, options),

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

  diskSpace: {
    systemInfo: () => ipcRenderer.invoke('disk-space:system-info'),
    pickRoot: () => ipcRenderer.invoke('disk-space:pick-root'),
    chooseDrive: (drive: string) => ipcRenderer.invoke('disk-space:choose-drive', drive),
    listDirectory: (rootPath: string, directoryPath?: string) => ipcRenderer.invoke('disk-space:list-directory', rootPath, directoryPath),
    preview: (rootPath: string, filePath: string) => ipcRenderer.invoke('disk-space:preview', rootPath, filePath),
    probeSpecialties: () => ipcRenderer.invoke('disk-space:probe-specialties'),
    usnInfo: (rootPath: string) => ipcRenderer.invoke('disk-space:usn-info', rootPath),
    runCleanup: (action: 'docker-build-cache' | 'npm-cache' | 'pnpm-store', rootPath?: string) => ipcRenderer.invoke('disk-space:run-cleanup', action, rootPath),
    start: (scanId: string, rootPath: string, options?: { exclusions?: string[]; skipDuplicates?: boolean; minDuplicateSize?: number }) => ipcRenderer.invoke('disk-space:start', scanId, rootPath, options),
    cancel: (scanId: string) => ipcRenderer.invoke('disk-space:cancel', scanId),
    pause: (scanId: string) => ipcRenderer.invoke('disk-space:pause', scanId),
    resume: (scanId: string) => ipcRenderer.invoke('disk-space:resume', scanId),
    trash: (scanId: string, paths: string[]) => ipcRenderer.invoke('disk-space:trash', scanId, paths),
    open: (rootPath: string, filePath: string) => ipcRenderer.invoke('disk-space:open', rootPath, filePath),
    onEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, scanId: string, payload: import('./types/electron').DiskScanEvent) => callback(scanId, payload);
      ipcRenderer.on('disk-space:event', handler);
      return () => ipcRenderer.removeListener('disk-space:event', handler);
    },
    onExit: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, scanId: string, result: { code: number | null; error?: string }) => callback(scanId, result);
      ipcRenderer.on('disk-space:exit', handler);
      return () => ipcRenderer.removeListener('disk-space:exit', handler);
    },
    listArchive: () => ipcRenderer.invoke('disk-space:list-archive'),
    loadArchive: (id: string) => ipcRenderer.invoke('disk-space:load-archive', id),
    deleteArchive: (id: string) => ipcRenderer.invoke('disk-space:delete-archive', id),
    saveArchive: (payload: import('./types/electron').DiskArchiveEntry & { data: import('./types/electron').DiskPersistedResult }) => ipcRenderer.invoke('disk-space:save-archive', payload),
    listSnapshots: () => ipcRenderer.invoke('disk-space:list-snapshots'),
    loadSnapshot: (id: string) => ipcRenderer.invoke('disk-space:load-snapshot', id),
    deleteSnapshot: (id: string) => ipcRenderer.invoke('disk-space:delete-snapshot', id),
    saveSnapshot: (payload: import('./types/electron').DiskSnapshotEntry & { data: import('./types/electron').DiskDirectorySnapshotData }) => ipcRenderer.invoke('disk-space:save-snapshot', payload),
    clearArchive: () => ipcRenderer.invoke('disk-space:clear-archive'),
  },

  netProbe: {
    start: () => ipcRenderer.invoke('net-probe:start'),
    state: () => ipcRenderer.invoke('net-probe:state'),
    systemInfo: () => ipcRenderer.invoke('net-probe:system-info'),
    listTargets: () => ipcRenderer.invoke('net-probe:list-targets'),
    addTarget: (input) => ipcRenderer.invoke('net-probe:add-target', input),
    removeTarget: (id) => ipcRenderer.invoke('net-probe:remove-target', id),
    updateTarget: (id, patch) => ipcRenderer.invoke('net-probe:update-target', id, patch),
    setTargetEnabled: (id, enabled) => ipcRenderer.invoke('net-probe:set-target-enabled', id, enabled),
    listResults: (opts) => ipcRenderer.invoke('net-probe:list-results', opts),
    heatmap: (opts) => ipcRenderer.invoke('net-probe:heatmap', opts),
    listAlertRules: () => ipcRenderer.invoke('net-probe:list-alert-rules'),
    addAlertRule: (input) => ipcRenderer.invoke('net-probe:add-alert-rule', input),
    removeAlertRule: (id) => ipcRenderer.invoke('net-probe:remove-alert-rule', id),
    listIncidents: (opts) => ipcRenderer.invoke('net-probe:list-incidents', opts),
    closeIncident: (id) => ipcRenderer.invoke('net-probe:close-incident', id),
    openIncidentsSnapshot: () => ipcRenderer.invoke('net-probe:open-incidents-snapshot'),
    listLanHosts: (opts) => ipcRenderer.invoke('net-probe:list-lan-hosts', opts),
    deleteLanHost: (id) => ipcRenderer.invoke('net-probe:delete-lan-host', id),
    scanLan: (opts) => ipcRenderer.invoke('net-probe:scan-lan', opts),
    testChannel: (args: { notify: string; notifyConfig?: string }) => ipcRenderer.invoke('net-probe:test-channel', args),
    onEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: import('./types/electron').NetProbeEvent) => callback(payload);
      ipcRenderer.on('net-probe:event', handler);
      return () => { ipcRenderer.removeListener('net-probe:event', handler); };
    },
  },

  // Shell 操作
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },

  // Work Browser（work-browser 插件）
  workBrowser: workBrowserBridge,

  // Security Audit（security-audit 插件）
  securityAudit: securityAuditBridge,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
