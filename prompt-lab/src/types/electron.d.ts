export interface InjectPayload {
  webviewId: number;
  text: string;
  inputSelector: string;
  submitSelector?: string;
  autoSubmit: boolean;
}

export interface InjectResult {
  success: boolean;
  error?: string;
}

export type DiskScanEvent =
  | { type: 'files'; items: Array<{ path: string; size: number; modifiedAt: number; extension: string }> }
  | { type: 'extension'; extension: string; size: number }
  | { type: 'directories'; items: Array<{ path: string; size: number }> }
  | { type: 'duplicate-progress'; stage: 'hashing' }
  | { type: 'duplicate'; groupId: string; size: number; files: Array<{ path: string; size: number; modifiedAt: number }> }
  | { type: 'scan-status'; currentPath: string; directories: number; files: number; bytes: number; elapsedMs: number }
  | { type: 'scan-error'; path: string; category: 'permission-denied' | 'not-found' | 'busy' | 'io'; message: string }
  | { type: 'progress' | 'done'; files: number; bytes: number; errors: number };

export interface DiskSystemInfo {
  disks: Array<{ path: string; total: number; free: number; used: number }>;
  memory: { total: number; free: number; used: number };
  platform: string;
  hostname: string;
}

export interface DiskDirectoryItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  extension: string;
}

export interface DiskFilePreview {
  path: string;
  name: string;
  kind: 'text' | 'image' | 'unsupported';
  mimeType?: string;
  content?: string;
  size: number;
  modifiedAt: number;
  truncated?: boolean;
  message?: string;
}
export interface DiskSpecialtyProbe { id: 'docker' | 'wsl' | 'ollama' | 'node' | 'rust' | 'java' | 'python' | 'android' | 'virtualization'; label: string; available: boolean; summary: string; details: string[]; }
export interface DiskUsnInfo { supported: boolean; method?: 'native' | 'fsutil'; volume?: string; journalId?: number; firstUsn?: number; nextUsn?: number; lowestValidUsn?: number; maxUsn?: number; maximumSize?: number; allocationDelta?: number; error?: string; }

// Scan 存档：元数据条目（不包含完整数据）。
export interface DiskArchiveEntry {
  id: string;
  root: string;
  savedAt: number;
  stats: { files: number; bytes: number; errors: number };
  duplicates: number;
}
export interface DiskPersistedResult {
  id: string;
  root: string;
  savedAt: number;
  stats: { files: number; bytes: number; errors: number };
  directories: Array<{ path: string; size: number }>;
  largest: Array<{ path: string; size: number; modifiedAt: number; extension: string }>;
  extensions: Record<string, number>;
  duplicates: Array<{ groupId: string; size: number; files: Array<{ path: string; size: number; modifiedAt: number }> }>;
}
export interface DiskSnapshotEntry {
  id: string;
  root: string;
  timestamp: number;
  directoryCount: number;
}
export interface DiskDirectorySnapshotData {
  timestamp: number;
  root: string;
  directories: Array<{ path: string; size: number }>;
}

// --- Network Observatory (nwd-net-probe) ---

export type NetProbeEvent =
  | { type: 'ready'; version: string; pid: number; startedAt: number }
  | {
      type: 'probe_result';
      id: string;
      probe: string;
      timestampMs: number;
      success: boolean;
      latencyMs: number | null;
      error: string | null;
      payload: Record<string, unknown> | null;
    }
  | { type: 'error'; message: string; timestampMs: number }
  | { type: 'exit'; code: number | null; error?: string; timestampMs: number };

export interface NetProbeState {
  ready: boolean;
  version: string | null;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  lastExit: { code: number | null; error?: string; timestampMs: number } | null;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  downloadUrl: string;
  sha256: string;
  size?: number;
  versions?: import('../core/plugin-platform/types').MarketplacePluginVersion[];
}

export type PluginArtifact = import('../core/plugin-platform/types').PluginArtifact;
export type PluginInstallRequest = import('../core/plugin-platform/types').PluginInstallRequest;
export type InstalledPluginState = import('../core/plugin-platform/types').InstalledPluginState;
export type InstalledPluginVersion = import('../core/plugin-platform/types').InstalledPluginVersion;
export type PluginInstallProgress = import('../core/plugin-platform/types').PluginInstallProgress;
export type PluginResourceRequirement = import('../core/plugin-platform/types').PluginResourceRequirement;

export interface MarketplaceCatalog {
  schemaVersion: 1;
  plugins: MarketplacePlugin[];
  fetchedAt?: number;
}

export interface ElectronAPI {
  aiVideoReader: import('../core/ai-video-reader/types').VideoReaderApi;
  outlineProjects: {
    load: () => Promise<ChapterProjectRecord[]>;
    save: (projects: ChapterProjectRecord[]) => Promise<{ success: boolean; error?: string }>;
  };
  outlineSecrets: {
    load: (kind: 'review' | 'minimax') => Promise<{ success: boolean; value?: string; error?: string }>;
    save: (kind: 'review' | 'minimax', value: string) => Promise<{ success: boolean; error?: string }>;
  };
  outlineResearch: {
    search: (queries: string[]) => Promise<{
      results: Array<{ title: string; url: string; snippet: string; domain: string; source: string }>;
      providers: Array<{ providerId: string; ok: boolean; count: number; error: string | null }>;
    }>;
  };
  outlineGithub: {
    pagesStatus: (remoteUrl: string) => Promise<{ success: boolean; data?: { state: string; conclusion?: string; url?: string; updatedAt?: string; branch?: string }; error?: string }>;
  };
  rss: {
    fetch: (url: string) => Promise<import('../plugins/rss-reader/types').RssFeed>;
    loadState: () => Promise<{ subscriptions: import('../plugins/rss-reader/types').RssSubscription[]; articles: import('../plugins/rss-reader/types').RssArticle[] }>;
    saveState: (state: { subscriptions: import('../plugins/rss-reader/types').RssSubscription[]; articles: import('../plugins/rss-reader/types').RssArticle[] }) => Promise<void>;
    refreshAll: () => Promise<{ subscriptions: import('../plugins/rss-reader/types').RssSubscription[]; articles: import('../plugins/rss-reader/types').RssArticle[] }>;
    setRefreshMinutes: (minutes: number) => Promise<void>;
    setRetentionDays: (days: number) => Promise<number>;
    setNotificationsEnabled: (enabled: boolean) => Promise<void>;
    extractArticle: (feedId: string, articleId: string, url: string) => Promise<{ text: string; markdown: string; wordCount: number }>;
    search: (query: string) => Promise<Array<{ feedId: string; articleId: string }>>;
    listRules: () => Promise<import('../plugins/rss-reader/types').RssKeywordRule[]>;
    saveRule: (rule: import('../plugins/rss-reader/types').RssKeywordRule) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
  };
  plugins: {
    loadDefinitions: () => Promise<unknown[]>;
    saveDefinitions: (definitions: unknown[]) => Promise<void>;
    getCachedCatalog: () => Promise<MarketplaceCatalog | null>;
    fetchCatalog: (url: string) => Promise<MarketplaceCatalog>;
    install: (entry: MarketplacePlugin) => Promise<{ path: string; sha256: string; bundle: string }>;
    installPackage: (request: PluginInstallRequest) => Promise<InstalledPluginVersion>;
    installCatalogVersion: (id: string, version: string, activate?: boolean) => Promise<InstalledPluginVersion>;
    listInstalled: () => Promise<InstalledPluginState[]>;
    activateVersion: (id: string, version: string) => Promise<InstalledPluginState>;
    rollback: (id: string) => Promise<InstalledPluginState>;
    uninstallVersion: (id: string, version: string) => Promise<InstalledPluginState>;
    resolvePath: (id: string, relativePath?: string) => Promise<string | null>;
    cancelInstall: (id: string, version: string) => Promise<boolean>;
    getResourceRequirement: (id: string) => Promise<PluginResourceRequirement>;
    ensureResource: (id: string) => Promise<InstalledPluginVersion | null>;
    onInstallProgress: (callback: (progress: PluginInstallProgress) => void) => () => void;
  };
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  close: () => Promise<void>;
  hide: () => Promise<void>;
  show: () => Promise<void>;
  injectPrompt: (payload: InjectPayload) => Promise<InjectResult>;
  onToggleSearchPanel: (callback: () => void) => () => void;
  saveData: (data: string) => Promise<{ success: boolean }>;
  loadData: () => Promise<unknown>;
  db: {
    load: () => Promise<ArrayBuffer | null>;
    save: (buffer: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
  };
  documentCache: {
    save: (documentId: string, buffer: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    load: (documentId: string) => Promise<{ success: boolean; data?: ArrayBuffer; filePath?: string; error?: string }>;
    delete: (documentId: string) => Promise<{ success: boolean; error?: string }>;
  };
  office: import('../plugins/office-studio/types').OfficeStudioAPI;
  toggleAlwaysOnTop: () => Promise<boolean>;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  onInjectFromContextMenu: (callback: () => void) => () => void;
  onSaveBeforeQuit: (callback: () => void) => () => void;
  copyText: (text: string) => void;
  fetchFavicon: (siteUrl: string) => Promise<string | null>;
  llmChat: (payload: { baseUrl: string; apiKey: string; body: Record<string, unknown> }) => Promise<{ ok: boolean; status: number; data?: any; error?: string }>;
  generateImage: (payload: import('../plugins/style-image/types').StyleImageRequest) => Promise<import('../plugins/style-image/types').StyleImageResult>;
  videoGeneration: {
    create: (payload: import('../plugins/video-generation/types').VideoGenerationRequest) => Promise<{ success: boolean; taskId?: string; baseResp?: { statusCode?: number; statusMsg?: string }; error?: string }>;
    query: (payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }) => Promise<{ success: boolean; info?: import('../plugins/video-generation/types').VideoTaskInfo; error?: string }>;
    download: (payload: { taskId: string; videoUrl: string; recordId: string }) => Promise<{ success: boolean; filePath?: string; fileName?: string; bytes?: number; mimeType?: string; error?: string }>;
    cancel: (payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }) => Promise<{ success: boolean; baseResp?: { statusCode?: number; statusMsg?: string }; error?: string }>;
    uploadReference: (payload: { name: string; mimeType: string; data: ArrayBuffer; ttlHours?: number }) => Promise<{ success: boolean; url?: string; ttlHours?: number; bytes?: number; error?: string }>;
    readBlob: (filePath: string) => Promise<{ success: boolean; bytes?: number; mimeType?: string; data?: ArrayBuffer; error?: string }>;
    reveal: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    openFolder: () => Promise<{ success: boolean; path?: string; error?: string }>;
    cleanup: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  };
  screenCapture: {
    setTarget: (target: 'app' | 'screen', systemAudio: boolean) => Promise<{ target: 'app' | 'screen'; systemAudio: boolean }>;
    getPrimaryScreenSourceId: () => Promise<string>;
    setRecordingState: (state: { recording: boolean; paused: boolean; seconds: number }) => void;
  };
  fetchUrl: (url: string, options?: { headers?: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    text: string;
    contentType?: string;
    error?: string;
  }>;
  wereadRequest: (apiKey: string, payload: Record<string, unknown>) => Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }>;
  wereadAiSummary: (payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ bookId: string; title: string; author: string; highlights: string[]; reviews: string[] }> }) => Promise<{
    success: boolean;
    summaries?: Array<{ bookId: string; summary: string; tags: string[] }>;
    error?: string;
  }>;
  wereadAiRecommend: (payload: { baseUrl: string; apiKey: string; model: string; books: Array<{ title: string; author: string; highlights: string[]; reviews: string[] }> }) => Promise<{
    success: boolean;
    recommendations?: Array<{ type: 'same_author' | 'similar' | 'opposite'; title: string; author: string; reason: string }>;
    error?: string;
  }>;
  createEmbeddings: (payload: { baseUrl: string; apiKey: string; model: string; inputs: string[] }) => Promise<{
    success: boolean; embeddings?: number[][]; error?: string;
  }>;
  memoryIndex: {
    replace: (chunks: Array<{
      id: string; documentId: string; filePath: string; fileName: string; title: string; site: string;
      startLine: number; endLine: number; content: string; documentModifiedAt: number; excerptHash: string;
      vector: number[];
    }>) => Promise<void>;
    search: (vector: number[], limit: number) => Promise<Array<{ id: string; distance: number }>>;
    clear: () => Promise<void>;
  };
  ragWorker: {
    status: () => Promise<{ available: boolean; version?: string; schemaVersion?: number; error?: string }>;
    upsertDocument: (document: RagWorkerDocumentInput) => Promise<{ documentId: string; unchanged: boolean; jobId: string | null; chunks?: number }>;
    deleteDocument: (documentId: string) => Promise<{ deleted: boolean }>;
    keywordSearch: (request: { query: string; topK?: number; documentIds?: string[] }) => Promise<{ hits: RagWorkerKeywordHit[] }>;
    vectorSearch: (request: { vector: number[]; modelId: string; topK?: number }) => Promise<Array<{ id: string; distance: number }>>;
    fuseResults: (request: { lists: Array<{ ids: string[]; weight?: number }>; topK?: number; rankConstant?: number }) => Promise<{ hits: Array<{ chunkId: string; score: number; rank: number }> }>;
    indexStatus: () => Promise<RagWorkerIndexStatus>;
    retryFailed: (documentId?: string) => Promise<{ requeued: number }>;
    pendingOutbox: (limit?: number) => Promise<{ operations: RagWorkerOutboxOperation[] }>;
    completeOutbox: (id: number) => Promise<{ completed: boolean }>;
    failOutbox: (id: number, error: string) => Promise<{ failed: boolean }>;
  };
  videoPlayer: import('../plugins/video-player/types').VideoPlayerAPI;
  mycast: import('../plugins/mycast/backend/mycast-types').MyCastApi;
  phone: import('../plugins/phone/types').PhoneApi;
  voice: import('../plugins/voice-input/backend/voice-types').VoiceApi;
  mcp: {
    listServers: () => Promise<McpServerStatus[]>;
    saveServer: (config: McpServerConfig) => Promise<McpOperationResult>;
    removeServer: (serverId: string) => Promise<McpOperationResult>;
    connect: (serverId: string) => Promise<McpOperationResult>;
    disconnect: (serverId: string) => Promise<McpOperationResult>;
    listTools: (serverId?: string) => Promise<McpToolDescriptor[]>;
    callTool: (serverId: string, name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
    recordDenial: (serverId: string, name: string, args: Record<string, unknown>) => Promise<void>;
    listAudit: (limit?: number) => Promise<McpAuditRecord[]>;
    clearAudit: () => Promise<McpOperationResult>;
  };
  saveConversation: (payload: {
    site: string;
    timestamp: number;
    requestBody: unknown;
    responseContent: string;
    title?: string;
    notes?: string;
    createNew?: boolean;
    contentMode?: 'exchange' | 'document';
  }) => Promise<{ success: boolean; filePath?: string }>;
  listConversations: () => Promise<ConversationFile[]>;
  listConversationFolders: () => Promise<Array<{ name: string; path: string }>>;
  createConversationFolder: (relativePath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  moveConversation: (filePath: string, targetFolder: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  searchConversations: (query: string) => Promise<ConversationSearchResult[]>;
  readConversation: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeConversation: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameConversation: (filePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  deleteConversation: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  revealConversation: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openConversationFolder: () => Promise<{ success: boolean; error?: string }>;
  /** 手动记忆管理 */
  listMemories: () => Promise<MemoryFile[]>;
  readMemory: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeMemory: (filePath: string, content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  deleteMemory: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  setMemoryEnabled: (filePath: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getWebviewPreloadPath: () => Promise<string>;
  /** 打开文件选择对话框，返回文件信息(base64 content) */
  pickFile: (options?: { accept?: string; multiple?: boolean }) => Promise<FilePickResult | FilePickResult[] | null>;
  pickFolder: () => Promise<FolderPickResult | null>;
  getPathForFile: (file: File) => string;
  workspace: {
    openFolder: () => Promise<WorkspaceFolder | null>;
    reauthorize: (rootPath: string) => Promise<{ success: boolean }>;
    listDirectory: (rootPath: string, relativePath?: string) => Promise<WorkspaceResult<WorkspaceEntry[]>>;
    readTextFile: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<WorkspaceTextFile>>;
    writeTextFile: (rootPath: string, relativePath: string, content: string, options?: WorkspaceWriteOptions) => Promise<WorkspaceResult<{ size: number; modifiedAt: number }>>;
    writeTextFiles: (rootPath: string, edits: WorkspaceTextEdit[]) => Promise<WorkspaceResult<WorkspaceTextEditResult[]>>;
    mutateFiles: (rootPath: string, mutations: WorkspaceFileMutation[]) => Promise<WorkspaceResult<WorkspaceFileMutationResult[]>>;
    createFile: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<void>>;
    createDirectory: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<void>>;
    renameEntry: (rootPath: string, relativePath: string, nextRelativePath: string) => Promise<WorkspaceResult<void>>;
    deleteEntry: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<void>>;
    trashEntry: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<void>>;
    copyEntry: (rootPath: string, sourcePath: string, targetPath: string) => Promise<WorkspaceResult<void>>;
    revealEntry: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<void>>;
    listTasks: (rootPath: string) => Promise<WorkspaceResult<WorkspaceTask[]>>;
    listAgentScripts: (rootPath: string) => Promise<WorkspaceResult<Record<string, string>>>;
    runAgentScript: (rootPath: string, script: string, timeoutMs?: number) => Promise<WorkspaceResult<AgentScriptResult>>;
    runTask: (rootPath: string, taskName: string, runId: string, environment?: Record<string, string>) => Promise<WorkspaceResult<WorkspaceTaskRunResult>>;
    cancelTask: (runId: string) => Promise<{ success: boolean }>;
    onTaskEvent: (callback: (event: WorkspaceTaskEvent) => void) => () => void;
    listFiles: (rootPath: string) => Promise<WorkspaceResult<WorkspaceEntry[]>>;
    search: (rootPath: string, query: string, options?: WorkspaceSearchOptions) => Promise<WorkspaceResult<WorkspaceSearchResult[]>>;
    semanticSearch: (rootPath: string, symbol: string) => Promise<WorkspaceResult<WorkspaceSemanticResult[]>>;
    languageSemanticSearch: (rootPath: string, relativePath: string, line: number, column: number) => Promise<WorkspaceResult<WorkspaceSemanticResult[]>>;
    gitStatus: (rootPath: string) => Promise<WorkspaceResult<WorkspaceGitStatus[]>>;
    gitGraphMetadata: (rootPath: string) => Promise<WorkspaceResult<Array<{ path: string; churn: number; authors: Array<{ name: string; commits: number }> }>>>;
    gitGraphChangedFiles: (rootPath: string, base: string) => Promise<WorkspaceResult<string[]>>;
    gitInit: (rootPath: string) => Promise<WorkspaceResult<string>>;
    createAgentWorktree: (rootPath: string, sessionId: string) => Promise<WorkspaceResult<AgentWorktreeInfo>>;
    getAgentWorktreeStatus: (rootPath: string, sessionId: string) => Promise<WorkspaceResult<AgentWorktreeInfo | null>>;
    discardAgentWorktree: (rootPath: string, sessionId: string) => Promise<WorkspaceResult<void>>;
    previewAgentWorktreeMerge: (rootPath: string, sessionId: string) => Promise<WorkspaceResult<AgentWorktreeMergePreview>>;
    getAgentWorktreeConflictVersions: (rootPath: string, sessionId: string, filePath: string) => Promise<WorkspaceResult<AgentWorktreeConflictFile>>;
    mergeAgentWorktree: (rootPath: string, sessionId: string, message: string) => Promise<WorkspaceResult<AgentWorktreeMergeResult>>;
    deliverAgentPR: (rootPath: string, branch: string, config: { provider: string; remote: string; baseBranch: string }, title: string, body: string, token?: string) => Promise<WorkspaceResult<{ branch: string; remote: string; prUrl?: string; prNumber?: number; pushed: boolean; error?: string }>>;
    // Agent task operations
    agentTaskCreate: (config: AgentTaskConfig) => Promise<WorkspaceResult<AgentTaskRecord>>;
    agentTaskGet: (taskId: string) => Promise<WorkspaceResult<AgentTaskRecord | null>>;
    agentTaskList: (sessionId?: string) => Promise<WorkspaceResult<AgentTaskRecord[]>>;
    agentTaskCancel: (taskId: string) => Promise<WorkspaceResult<boolean>>;
    agentTaskRetry: (taskId: string) => Promise<WorkspaceResult<AgentTaskRecord>>;
    agentTaskSnapshot: () => Promise<WorkspaceResult<AgentTaskRecord[]>>;
    agentTaskRestore: (tasks: AgentTaskRecord[]) => Promise<WorkspaceResult<number>>;
    agentTaskSubscribe: (taskId: string) => void;
    onAgentTaskEvent: (handler: (event: AgentTaskEvent) => void) => () => void;
    gitShowHead: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<string>>;
    gitStage: (rootPath: string, relativePaths: string[]) => Promise<WorkspaceResult<void>>;
    gitUnstage: (rootPath: string, relativePaths: string[]) => Promise<WorkspaceResult<void>>;
    gitCommit: (rootPath: string, message: string, relativePaths?: string[]) => Promise<WorkspaceResult<string>>;
    gitOperation: <T = unknown>(rootPath: string, operation: WorkspaceGitOperation, payload?: Record<string, unknown>) => Promise<WorkspaceResult<T>>;
    cancelGitOperation: (rootPath: string, operationId: string) => Promise<{ success: boolean }>;
    onGitProgress: (callback: (event: WorkspaceGitProgress) => void) => () => void;
    watch: (rootPath: string) => Promise<WorkspaceResult<void>>;
    unwatch: () => Promise<void>;
    onFileChanged: (callback: (event: WorkspaceFileChange) => void) => () => void;
    writeBinaryFile: (rootPath: string, relativePath: string, content: string, options?: { expectedModifiedAt?: number; force?: boolean }) => Promise<WorkspaceResult<{ size: number; modifiedAt: number }>>;
    readBinaryFile: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<{ content: string }>>;
  };
  knowledge: {
    scanWorkspace: (rootPath: string) => Promise<WorkspaceResult<import('../core/knowledge').KnowledgeIndex & {
      skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
      templates: import('../core/knowledge').KnowledgeTemplate[];
      rules: import('../core/knowledge').KnowledgeContentRule[];
      diagnostics: import('../core/knowledge').KnowledgeDiagnostic[];
      instructions?: string;
      state?: import('../core/knowledge').KnowledgeWorkspaceState;
    }>>;
    captureState: (rootPath: string, documentPaths?: string[]) => Promise<WorkspaceResult<import('../core/knowledge').KnowledgeWorkspaceState>>;
    createFromTemplate: (rootPath: string, templateId: string, values: Record<string, string>) => Promise<WorkspaceResult<{
      path: string; modifiedAt: number; diagnostics: import('../core/knowledge').KnowledgeDiagnostic[];
    }>>;
    readDocument: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<{ content: string; modifiedAt: number }>>;
    searchWorkspace: (rootPath: string, query: string, limit?: number, filters?: import('../core/knowledge').KnowledgeSearchFilters) => Promise<WorkspaceResult<import('../core/knowledge').KnowledgeSearchHit[]>>;
    renameDocument: (rootPath: string, relativePath: string, nextRelativePath: string) => Promise<WorkspaceResult<{ path: string; updatedReferences: string[] }>>;
  };
  /** 保存文件对话框，写入内容 */
  saveFile: (content: string, defaultName?: string, options?: Pick<WorkspaceWriteOptions, 'encoding' | 'lineEnding'>) => Promise<{ success: boolean; path?: string; modifiedAt?: number; error?: string }>;
  /** 保存到已经打开的文本文件。 */
  writeTextFile: (filePath: string, content: string, options?: WorkspaceWriteOptions) => Promise<{
    success: boolean;
    path?: string;
    modifiedAt?: number;
    error?: string;
    current?: Pick<WorkspaceTextFile, 'content' | 'encoding' | 'lineEnding' | 'mixedLineEndings' | 'modifiedAt'>;
  }>;
  /** 按路径读取文件，返回 base64 内容（供 AI 工具使用） */
  readFileBuffer: (filePath: string) => Promise<{
    success: boolean;
    data?: string;
    mimeType?: string;
    name?: string;
    size?: number;
    error?: string;
  }>;
  auth: {
    isAvailable: () => Promise<boolean>;
    saveToken: (service: string, token: string, label?: string) => Promise<boolean>;
    getToken: (service: string) => Promise<string | null>;
    deleteToken: (service: string) => Promise<boolean>;
    listServices: () => Promise<Array<{ service: string; savedAt: number; label?: string }>>;
    clearAll: () => Promise<boolean>;
  };
  terminal: {
    profiles: () => Promise<WorkspaceResult<Array<{ name: string; shell: string; args?: string[]; source: 'system' | 'environment' }>>>;
    create: (id: string, cwd?: string, profile?: { name: string; shell: string; args?: string[]; env?: Record<string, string> }) => Promise<{ success: boolean; error?: string }>;
    write: (id: string, data: string) => Promise<{ success: boolean; error?: string }>;
    resize: (id: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
    destroy: (id: string) => Promise<{ success: boolean; error?: string }>;
    onData: (id: string, callback: (data: string) => void) => () => void;
    onExit: (id: string, callback: (exitCode: number) => void) => () => void;
  };
  diskSpace: {
    systemInfo: () => Promise<DiskSystemInfo>;
    pickRoot: () => Promise<string | null>;
    chooseDrive: (drive: string) => Promise<string>;
    listDirectory: (rootPath: string, directoryPath?: string) => Promise<DiskDirectoryItem[]>;
    preview: (rootPath: string, filePath: string) => Promise<DiskFilePreview>;
    probeSpecialties: () => Promise<DiskSpecialtyProbe[]>;
    usnInfo: (rootPath: string) => Promise<DiskUsnInfo>;
    runCleanup: (action: 'docker-build-cache' | 'npm-cache' | 'pnpm-store', rootPath?: string) => Promise<{ success: boolean; canceled?: boolean; output?: string }>;
    start: (scanId: string, rootPath: string, options?: { exclusions?: string[]; skipDuplicates?: boolean; minDuplicateSize?: number }) => Promise<{ success: boolean }>;
    cancel: (scanId: string) => Promise<boolean>;
    pause: (scanId: string) => Promise<boolean>;
    resume: (scanId: string) => Promise<boolean>;
    trash: (scanId: string, paths: string[]) => Promise<{ success: boolean; canceled: boolean; trashed: string[] }>;
    open: (rootPath: string, filePath: string) => Promise<{ success: boolean }>;
    onEvent: (callback: (scanId: string, event: DiskScanEvent) => void) => () => void;
    onExit: (callback: (scanId: string, result: { code: number | null; error?: string }) => void) => () => void;
    // scan 存档：写到 userData/scan-archive/，列表只存元数据，完整数据按 id 懒加载
    listArchive: () => Promise<DiskArchiveEntry[]>;
    loadArchive: (id: string) => Promise<DiskPersistedResult | null>;
    deleteArchive: (id: string) => Promise<DiskArchiveEntry[]>;
    saveArchive: (payload: DiskArchiveEntry & { data: DiskPersistedResult }) => Promise<DiskArchiveEntry[]>;
    listSnapshots: () => Promise<DiskSnapshotEntry[]>;
    loadSnapshot: (id: string) => Promise<DiskDirectorySnapshotData | null>;
    deleteSnapshot: (id: string) => Promise<DiskSnapshotEntry[]>;
    saveSnapshot: (payload: DiskSnapshotEntry & { data: DiskDirectorySnapshotData }) => Promise<DiskSnapshotEntry[]>;
    clearArchive: () => Promise<boolean>;
  };
  netProbe: {
    start: () => Promise<{ ready: boolean; version: string | null }>;
    state: () => Promise<NetProbeState>;
    systemInfo: () => Promise<{ hostname: string; platform: string; arch: string; cpus: number }>;
    listTargets: () => Promise<import('./net-probe-schema').NetProbeTarget[]>;
    addTarget: (input: import('./net-probe-schema').NetProbeTargetInput) => Promise<import('./net-probe-schema').NetProbeTarget>;
    removeTarget: (id: string) => Promise<{ removed: boolean }>;
    updateTarget: (id: string, patch: Partial<import('./net-probe-schema').NetProbeTargetInput>) => Promise<import('./net-probe-schema').NetProbeTarget | null>;
    setTargetEnabled: (id: string, enabled: boolean) => Promise<import('./net-probe-schema').NetProbeTarget | null>;
    listResults: (opts?: { targetId?: string; sinceMs?: number; untilMs?: number; limit?: number }) => Promise<import('./net-probe-schema').NetProbeResult[]>;
    heatmap: (opts: { targetId: string; sinceMs?: number }) => Promise<Array<{ dayOfWeek: number; hourOfDay: number; avgLatencyMs: number | null; sampleCount: number; lossPct: number }>>;
    listAlertRules: () => Promise<import('./net-probe-schema').NetProbeAlertRule[]>;
    addAlertRule: (input: Omit<import('./net-probe-schema').NetProbeAlertRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Promise<import('./net-probe-schema').NetProbeAlertRule>;
    removeAlertRule: (id: string) => Promise<boolean>;
    listIncidents: (opts?: { openOnly?: boolean; limit?: number }) => Promise<import('./net-probe-schema').NetProbeIncident[]>;
    closeIncident: (id: string) => Promise<boolean>;
    openIncidentsSnapshot: () => Promise<import('./net-probe-schema').NetProbeIncident[]>;
    listLanHosts: (opts?: { scanId?: string; sinceMs?: number; limit?: number }) => Promise<NetProbeLanHost[]>;
    deleteLanHost: (id: string) => Promise<boolean>;
    scanLan: (opts?: { subnet?: string; maxHosts?: number; perPortTimeoutMs?: number }) => Promise<{ scanId: string; subnet: string | null; found: number; hosts: NetProbeLanHost[]; totalMs: number | null }>;
    testChannel: (args: { notify: string; notifyConfig?: string }) => Promise<{ ok: boolean; channel: string; detail?: string; durationMs: number }>;
    onEvent: (callback: (event: NetProbeEvent) => void) => () => void;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  workBrowser: {
    workspace: {
      list: (includeArchived?: boolean) => Promise<unknown[]>;
      get: (id: string) => Promise<unknown>;
      create: (input: { name: string; description?: string; icon?: string; color?: string; storagePath?: string; privacyMode?: 'normal' | 'local-only' }) => Promise<unknown>;
      update: (id: string, patch: any) => Promise<unknown>;
      archive: (id: string) => Promise<void>;
    };
    tab: {
      list: (workspaceId: string) => Promise<unknown[]>;
      create: (input: { workspaceId: string; url: string; title?: string; position?: number }) => Promise<unknown>;
      update: (id: string, patch: any) => Promise<void>;
      remove: (id: string) => Promise<void>;
    };
    document: {
      list: (workspaceId: string, limit?: number) => Promise<unknown[]>;
      get: (id: string) => Promise<unknown>;
      versions: (id: string) => Promise<unknown[]>;
      compare: (id: string) => Promise<{ left: { label: string; content: string }; right: { label: string; content: string } }>;
      save: (input: { workspaceId: string; tabId?: string | null; url: string; html?: string; title?: string }) => Promise<{ documentId: string; contentPath: string; rawPath: string; contentHash: string; wordCount: number; isNewVersion: boolean; diffSummary: string | null }>;
      import: (input: { workspaceId: string; sourcePath: string; title: string; plainText: string; sections?: Array<{ title: string; content: string; page?: number }> }) => Promise<unknown>;
      ocr: (sourcePath: string) => Promise<{ plainText: string; markdown: string; pages: Array<{ page: number; text: string }> }>;
    };
    note: {
      list: (workspaceId: string) => Promise<unknown[]>;
      create: (input: { workspaceId: string; title: string; content: string; documentId?: string; tabId?: string; taskId?: string; tags?: string[] }) => Promise<unknown>;
    };
    task: {
      list: (workspaceId: string, status?: string) => Promise<unknown[]>;
      upsert: (task: any) => Promise<void>;
      templates: () => Promise<Array<{ id: string; name: string; description: string; stepCount: number }>>;
      createFromTemplate: (input: { workspaceId: string; templateId: string; title?: string }) => Promise<unknown>;
      runAuto: (taskId: string) => Promise<unknown>;
    };
    conversation: {
      list: (workspaceId: string) => Promise<unknown[]>;
      get: (id: string) => Promise<unknown>;
      upsert: (conv: any) => Promise<void>;
    };
    search: {
      providers: () => Promise<Array<{ id: string; name: string; capabilities: any }>>;
      run: (input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all'; providerIds?: string[] }) => Promise<{ results: any[]; providers: any[]; aiSummary: string | null; took: number }>;
      start: (requestId: string, input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all'; providerIds?: string[] }) => Promise<{ results: any[]; providers: any[]; aiSummary: string | null; took: number }>;
      cancel: (requestId: string) => Promise<void>;
      onProgress: (callback: (progress: { requestId: string; results: any[]; providers: any[]; took: number }) => void) => () => void;
      suggest: (text: string) => Promise<string[]>;
      history: (limit?: number) => Promise<unknown[]>;
    };
    cleaner: {
      payload: (options?: any) => Promise<{ css: string; js: string; blockedDomains: string[] }>;
      webviewPayload: () => Promise<{ css: string; js: string; blockedDomains: string[] }>;
      webviewPreloadPath: () => Promise<string>;
    };
    annotation: {
      list: (documentId: string) => Promise<unknown[]>;
      listByUrl: (url: string) => Promise<unknown[]>;
      listByWorkspace: (workspaceId: string) => Promise<unknown[]>;
      create: (input: { documentId: string; selector: string; rangeText: string; note: string; color: string }) => Promise<unknown>;
      remove: (id: string) => Promise<void>;
    };
    rag: {
      query: (input: { query: string; workspaceId?: string; topK?: number; scope?: 'workspace' | 'library' }) => Promise<{ systemPrompt: string; citations: any[]; chunks: any[]; context: any }>;
    };
    research: {
      run: (input: { topic: string; workspaceId: string; autoSave?: boolean }) => Promise<{ taskId: string; report: string; citations: any[]; claimEvidence: any[]; reportPath?: string; took: number }>;
      evidenceList: (researchId: string) => Promise<any[]>;
      setEvidenceStatus: (id: string, status: 'clue' | 'verified' | 'disputed') => Promise<void>;
    };
    agent: {
      run: (input: { userMessage: string; workspaceId?: string; systemPrompt?: string; maxSteps?: number; autoApproveDanger?: boolean; contextSources?: { workspace?: boolean; currentPage?: { url: string; title: string }; specificDocuments?: Array<{ id: string; title: string; url: string }> } }) => Promise<{ answer: string; iterations: number; toolCalls: any[]; steps: any[]; availableTools: string[] }>;
    };
    graph: {
      listByDocument: (documentId: string, kinds?: string[]) => Promise<unknown[]>;
      listByWorkspace: (workspaceId: string, kind?: string) => Promise<unknown[]>;
      recordSavedWith: (workspaceId: string, documentIds: string[]) => Promise<number>;
      recordEdge: (input: { kind: string; workspaceId: string; fromType: string; fromId: string; toType: string; toId: string; weight?: number; metadata?: Record<string, unknown> }) => Promise<void>;
    };
    sync: {
      preview: (workspaceId: string, target: { id: string; kind: 'webdav' | 's3' | 'syncthing'; config: Record<string, string> }) => Promise<{ local: any[]; remote: any[]; base: any[]; conflicts: Array<{ path: string; kind: string }>; upload: string[]; download: string[]; deleteLocal: string[]; deleteRemote: string[] }>;
      push: (workspaceId: string, target: { id: string; kind: 'webdav' | 's3' | 'syncthing'; config: Record<string, string> }, overwrite?: boolean) => Promise<{ ok: boolean; conflicts: any[]; transferred: number }>;
      pull: (workspaceId: string, target: { id: string; kind: 'webdav' | 's3' | 'syncthing'; config: Record<string, string> }, overwrite?: boolean) => Promise<{ ok: boolean; conflicts: any[]; transferred: number }>;
      resolve: (workspaceId: string, target: { id: string; kind: 'webdav' | 's3' | 'syncthing'; config: Record<string, string> }, relativePath: string, resolution: 'local' | 'remote' | 'keep-both') => Promise<{ ok: boolean }>;
      listTargets: () => Promise<Array<{ id: string; kind: 'webdav' | 's3' | 'syncthing'; updatedAt: number }>>;
      getTarget: (id: string) => Promise<{ id: string; kind: 'webdav' | 's3' | 'syncthing'; config: Record<string, string> } | null>;
      saveTarget: (target: { id: string; kind: 'webdav' | 's3' | 'syncthing'; config: Record<string, string> }) => Promise<void>;
      deleteTarget: (id: string) => Promise<void>;
    };
    settings: {
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string) => Promise<void>;
    };
    config: {
      setAI: (input: { baseUrl: string; apiKey: string; model: string; local?: boolean }) => Promise<void>;
    };
    autoGroup: {
      suggest: (docSummary: { title: string; url: string; capturedAt: number }) => Promise<Array<{ workspaceId: string; score: number; reasons: string[] }>>;
    };
  };
  codeVisualizer: {
    repository: {
      select: () => Promise<{ ok: boolean; cancelled?: boolean; rootPath?: string }>;
      scan: (rootPath: string) => Promise<import('../core/code-visualizer').RepositoryAnalysis>;
    };
    source: {
      read: (rootPath: string, relativePath: string) => Promise<{ path: string; content: string }>;
      openExternal: (rootPath: string, relativePath: string, line?: number) => Promise<{ ok: boolean }>;
    };
    runtime: {
      import: (rootPath: string) => Promise<{ ok: boolean; cancelled?: boolean; metrics: import('../core/code-visualizer').RuntimeEndpointMetric[] }>;
    };
    openApi: {
      import: (rootPath: string, analysis: import('../core/code-visualizer').RepositoryAnalysis) => Promise<{ ok: boolean; cancelled?: boolean; report?: import('../core/code-visualizer').OpenApiGovernanceReport }>;
    };
    git: {
      impact: (rootPath: string, base: string, analysis: import('../core/code-visualizer').RepositoryAnalysis) => Promise<import('../core/code-visualizer').GitImpactReport>;
    };
    test: {
      run: (rootPath: string, files: string[]) => Promise<import('../core/code-visualizer').TestRunResult>;
    };
    coverage: {
      import: (rootPath: string) => Promise<{ ok: boolean; cancelled?: boolean; report?: import('../core/code-visualizer').CoverageReport }>;
    };
    apiDebug: {
      execute: (input: import('../core/code-visualizer').ApiDebugRequest) => Promise<import('../core/code-visualizer').ApiDebugResponse>;
    };
    explain: {
      import: (rootPath: string) => Promise<{ ok: boolean; cancelled?: boolean; report?: import('../core/code-visualizer').ExplainReport }>;
    };
    database: {
      connectSqlite: () => Promise<{ ok: boolean; cancelled?: boolean; connection?: import('../core/code-visualizer').LiveDatabaseConnection }>;
      connectMySql: (input: import('../core/code-visualizer').LiveMySqlConfig) => Promise<{ ok: boolean; connection: import('../core/code-visualizer').LiveDatabaseConnection }>;
      explain: (id: string, engine: 'sqlite' | 'mysql', sql: string) => Promise<import('../core/code-visualizer').ExplainReport>;
      close: (id: string) => Promise<{ ok: boolean }>;
    };
    history: {
      list: () => Promise<import('../core/code-visualizer').CodeVisualizerProjectHistory[]>;
      open: (rootPath: string) => Promise<{ ok: boolean; rootPath: string }>;
      remove: (rootPath: string) => Promise<{ ok: boolean }>;
    };
    snapshot: {
      list: (rootPath: string) => Promise<import('../core/code-visualizer').CodeVisualizerScanSnapshot[]>;
      load: (rootPath: string, id: string) => Promise<import('../core/code-visualizer').RepositoryAnalysis>;
      diff: (rootPath: string, fromId: string, toId: string) => Promise<import('../core/code-visualizer').CodeVisualizerSnapshotDiff>;
    };
  };
  websiteRegistry: {
    record: {
      list: (filters?: import('../core/website-registry/types').WebsiteRecordFilters) => Promise<import('../core/website-registry/types').WebsiteRecord[]>;
      create: (input: import('../core/website-registry/types').WebsiteRecordInput) => Promise<import('../core/website-registry/types').WebsiteRecord>;
      update: (id: string, patch: Partial<import('../core/website-registry/types').WebsiteRecordInput>) => Promise<import('../core/website-registry/types').WebsiteRecord>;
      remove: (id: string) => Promise<void>;
      open: (id: string) => Promise<import('../core/website-registry/types').WebsiteRecord>;
    };
    category: {
      list: () => Promise<import('../core/website-registry/types').WebsiteCategory[]>;
      create: (name: string, color?: string) => Promise<import('../core/website-registry/types').WebsiteCategory>;
      update: (id: string, patch: Partial<Pick<import('../core/website-registry/types').WebsiteCategory, 'name' | 'color' | 'position'>>) => Promise<import('../core/website-registry/types').WebsiteCategory>;
      remove: (id: string) => Promise<void>;
    };
    assist: {
      metadata: (url: string) => Promise<import('../core/website-registry/metadata').WebsiteMetadata>;
    };
    importData: () => Promise<{ imported: number; skipped: number; invalid: number }>;
    exportData: () => Promise<boolean>;
  };
  securityAudit: {
    project: {
      select: () => Promise<{ ok: boolean; cancelled?: boolean; projectDir?: string }>;
    };
    settings: {
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string) => Promise<{ ok: boolean }>;
    };
    scan: {
      start: (input: { projectDir: string; mode?: 'full' | 'incremental'; baselineRef?: string; scanners?: string[]; networkPolicy?: 'deny' | 'allow'; verifySecrets?: boolean; aiReview?: boolean; aiConfig?: { baseUrl: string; apiKey: string; model: string } }) => Promise<{ ok: boolean; cancelled?: boolean; jobId?: string; projectDir?: string }>;
      cancel: (jobId: string) => Promise<{ ok: boolean }>;
      onProgress: (callback: (progress: import('../core/security-audit').ScanProgress) => void) => () => void;
    };
    findings: {
      list: (projectDir: string) => Promise<import('../core/security-audit').SecurityFinding[]>;
      update: (input: { projectDir: string; findingId: string; status: import('../core/security-audit').FindingStatus; reason?: string }) => Promise<import('../core/security-audit').SecurityFinding>;
    };
    scans: { list: (projectDir: string) => Promise<import('../core/security-audit').ScanRecord[]> };
    baselines: {
      list: (projectDir: string) => Promise<import('../core/security-audit').SecurityBaseline[]>;
      create: (input: { projectDir: string; name: string; gitRef: string; scanId?: string }) => Promise<import('../core/security-audit').SecurityBaseline>;
      remove: (input: { projectDir: string; id: string }) => Promise<{ ok: boolean }>;
      compare: (input: { projectDir: string; id: string }) => Promise<import('../core/security-audit').BaselineComparison>;
    };
    scanners: { list: (input?: { projectDir?: string; networkPolicy?: 'deny' | 'allow'; force?: boolean }) => Promise<import('../core/security-audit').ScannerStatus[]> };
    report: { exportSarif: (projectDir: string) => Promise<{ ok: boolean; cancelled?: boolean; filePath?: string }> };
  };
}

export interface RagWorkerChunkInput {
  id: string;
  content: string;
  chunkIndex: number;
  sectionTitle?: string;
  page?: number;
  startOffset?: number;
  endOffset?: number;
  contentHash?: string;
  vector: number[];
}

export interface RagWorkerDocumentInput {
  id: string;
  name: string;
  kind: string;
  sourcePath?: string;
  fileSize: number;
  contentHash?: string;
  parserVersion: string;
  chunkerVersion: string;
  embeddingIdentity: string;
  force?: boolean;
  chunks: RagWorkerChunkInput[];
}

export interface RagWorkerKeywordHit {
  chunkId: string;
  documentId: string;
  content: string;
  sectionTitle?: string;
  page?: number;
  score: number;
}

export interface RagWorkerOutboxOperation {
  id: number;
  operation: 'upsert_vector' | 'delete_vector' | 'delete_document';
  chunkId?: string;
  documentId?: string;
  payload: { content?: string; sectionTitle?: string; page?: number };
  retryCount: number;
}

export interface RagWorkerIndexStatus {
  documents: number;
  chunks: number;
  pendingOutbox: number;
  failedOutbox: number;
  indexingDocuments: number;
  failedDocuments: number;
}

export interface ConversationFile {
  site: string;
  date: string;
  fileName: string;
  path: string;
  size: number;
  modifiedAt: number;
  title?: string;
  notes?: string;
  folder?: string;
}

export interface MemoryFile {
  fileName: string;
  path: string;
  size: number;
  modifiedAt: number;
  title: string;
  enabled: boolean;
}

export interface ConversationSearchResult {
  file: ConversationFile;
  matchCount: number;
  snippets: Array<{ text: string; line: number }>;
}

export interface FilePickResult {
  path: string;
  name: string;
  size: number;
  content: string;  // base64
  mimeType: string;
  text?: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  mixedLineEndings?: boolean;
  modifiedAt?: number;
  readOnly?: boolean;
}

export interface FolderPickResult {
  path: string;
  name: string;
  files: Array<{ path: string; name: string; size: number }>;
  error?: string;
}

export interface WorkspaceFolder {
  path: string;
  name: string;
}

export interface WorkspaceSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  include?: string;
  exclude?: string;
}

export interface WorkspaceGitStatus {
  path: string;
  status: string;
}

export interface AgentScriptResult {
  script: string;
  command: string;
  output: string;
  exitCode: number;
  startedAt: number;
  endedAt: number;
}

export interface AgentWorktreeInfo {
  sessionId: string;
  path: string;
  branch: string;
  head?: string;
  dirty: boolean;
}

export interface AgentWorktreeConflictFile {
  path: string;
  base: string;
  main: string;
  agent: string;
  conflictType: 'content' | 'add/add' | 'delete/modify' | 'modify/delete' | 'rename/rename';
}

export interface AgentWorktreeMergePreview {
  canMerge: boolean;
  changedPaths: string[];
  conflictingPaths: string[];
  mainDirty: boolean;
  base: string;
  mainHead: string;
  agentHead: string;
}

export interface AgentWorktreeMergeResult { commit: string; changedPaths: string[] }

// ── Agent Task types ──

export type AgentTaskState = 'queued' | 'running' | 'cancelling' | 'interrupted' | 'failed' | 'review' | 'completed';

export interface AgentTaskConfig {
  sessionId: string;
  workspaceRoot: string;
  executionRoot?: string;
  instruction: string;
  modelConfig: { apiKey: string; baseUrl: string; model: string };
  multiFile: boolean;
  tokenBudget: number;
  messages?: Array<{ role: string; content: string }>;
  contextFiles?: string[];
  recovery?: { checkpoint: string; contextPaths: string[] };
}

export interface AgentTaskProgress {
  taskId: string;
  seq: number;
  stage: string;
  message: string;
  delta?: string;
  timestamp: number;
}

export interface AgentTaskRecord {
  taskId: string;
  sessionId: string;
  workspaceRoot: string;
  executionRoot?: string;
  instruction: string;
  modelConfig: { apiKey: string; baseUrl: string; model: string };
  multiFile: boolean;
  tokenBudget: number;
  messages?: Array<{ role: string; content: string }>;
  state: AgentTaskState;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  progress?: AgentTaskProgress;
  error?: string;
  recovery?: { checkpoint: string; contextPaths: string[] };
  result?: {
    proposals: Array<{
      path: string;
      original: string;
      modified: string;
      language: string;
      previousPath?: string;
    }>;
    rawResponse: string;
  };
}

export interface AgentTaskEvent {
  taskId: string;
  sessionId: string;
  state: AgentTaskState;
  progress?: AgentTaskProgress;
  error?: string;
}


export type WorkspaceGitOperation = 'overview' | 'diagnostics' | 'createBranch' | 'deleteBranch' | 'renameBranch' | 'switchBranch' | 'fetch' | 'pull' | 'push' | 'sync' | 'log' | 'showCommit' | 'compareCommits' | 'fileDiff' | 'stagePatch' | 'conflictVersions' | 'stageConflictResult' | 'resolveConflict' | 'continueOperation' | 'abortOperation' | 'stashList' | 'stashShow' | 'stashPush' | 'stashApply' | 'stashPop' | 'stashDrop' | 'createTag' | 'deleteTag' | 'addRemote' | 'removeRemote';

export interface WorkspaceGitProgress {
  operationId: string;
  operation: WorkspaceGitOperation;
  state: 'started' | 'completed' | 'failed' | 'cancelled';
  message: string;
}

export interface WorkspaceGitOverview {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  branches: Array<{ name: string; current: boolean; remote: boolean; upstream?: string; ahead: number; behind: number }>;
  remotes: string[];
  tags: string[];
}

export interface WorkspaceGitCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  author: string;
  authorEmail: string;
  date: string;
  signatureStatus: string;
  signer: string;
  subject: string;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface ChapterProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  subfolder: string;
  source: string;
  requirement?: string;
  chapterBriefs?: Record<string, { goal: string; targetWords: number; keyQuestions: string; requiredSources: string; avoidTopics: string }>;
  chapterStatuses?: Record<string, { state: 'pending' | 'generating' | 'draft' | 'review' | 'revising' | 'quality' | 'complete' | 'error'; error?: string; updatedAt: number }>;
  knowledgeEntries?: Array<{ id: string; kind: 'person' | 'event' | 'place' | 'term' | 'date'; name: string; canonical: string; aliases: string; notes: string }>;
  evidenceRecords?: Array<{ id: string; title: string; url: string; source: string; chapter: string; status: 'clue' | 'verified' | 'disputed'; notes: string; anchor?: { quote: string }; createdAt: number }>;
  qualityReports?: Record<string, { score: number; blockers: string[]; warnings: string[]; wordCount: number; checkedAt: number }>;
  deploymentStatus?: { state: 'unconfigured' | 'configured' | 'publishing' | 'published' | 'failed'; url?: string; message?: string; updatedAt: number };
  splitMode: 'chapter' | 'section' | 'single';
  organizeByPart: boolean;
  template: string;
  files: string[];
  updatedAt: number;
  git?: { remoteUrl: string; remoteName: string; branch: string };
  pages?: { title: string; description: string; author: string; language: string; repositoryName: string; customDomain: string; accentColor?: string };
}

export interface WorkspaceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface WorkspaceTextFile {
  content: string;
  size: number;
  encoding: WorkspaceEncoding;
  lineEnding: 'LF' | 'CRLF';
  mixedLineEndings: boolean;
  modifiedAt: number;
  readOnly: boolean;
}

export interface WorkspaceWriteOptions {
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  expectedModifiedAt?: number;
  force?: boolean;
}

export interface WorkspaceTextEdit extends WorkspaceWriteOptions {
  path: string;
  content: string;
}

export interface WorkspaceTextEditResult {
  path: string;
  size: number;
  modifiedAt: number;
}

export type WorkspaceFileMutation =
  | ({ kind: 'write' } & WorkspaceTextEdit)
  | { kind: 'create'; path: string; content: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF' }
  | { kind: 'delete'; path: string; expectedModifiedAt?: number }
  | { kind: 'rename'; path: string; targetPath: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; expectedModifiedAt?: number };

export interface WorkspaceFileMutationResult {
  kind: WorkspaceFileMutation['kind'];
  path: string;
  size?: number;
  modifiedAt?: number;
}

export type WorkspaceEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk';

export interface WorkspaceSearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface WorkspaceTask {
  name: string;
  command: string;
  argv: string[];
  detail: string;
  dependsOn: string[];
  dependsOrder: 'sequence' | 'parallel';
  isBackground: boolean;
  problemMatcher?: string;
  env?: Record<string, string>;
  presentation?: { reveal?: string; panel?: string; focus?: boolean };
}

export interface WorkspaceTaskRunResult { runId: string; task: string; exitCode: number; startedAt: number; endedAt: number }
export interface WorkspaceTaskEvent {
  runId: string;
  task: string;
  state: 'started' | 'output' | 'completed' | 'failed' | 'cancelled';
  output?: string;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
}

export interface WorkspaceSemanticResult extends WorkspaceSearchResult {
  kind: 'definition' | 'reference' | 'import';
  symbol: string;
  importedFrom?: string;
}

export interface WorkspaceFileChange {
  path: string;
  type: 'change' | 'rename';
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
import type {
  McpAuditRecord,
  McpOperationResult,
  McpServerConfig,
  McpServerStatus,
  McpToolCallResult,
  McpToolDescriptor,
} from './mcp';
