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

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  close: () => Promise<void>;
  injectPrompt: (payload: InjectPayload) => Promise<InjectResult>;
  onToggleSearchPanel: (callback: () => void) => () => void;
  saveData: (data: string) => Promise<{ success: boolean }>;
  loadData: () => Promise<unknown>;
  db: {
    load: () => Promise<ArrayBuffer | null>;
    save: (buffer: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
  };
  toggleAlwaysOnTop: () => Promise<boolean>;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  onInjectFromContextMenu: (callback: () => void) => () => void;
  onSaveBeforeQuit: (callback: () => void) => () => void;
  copyText: (text: string) => void;
  fetchFavicon: (siteUrl: string) => Promise<string | null>;
  fetchUrl: (url: string, options?: { headers?: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    text: string;
    contentType?: string;
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
  searchConversations: (query: string) => Promise<ConversationSearchResult[]>;
  readConversation: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeConversation: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameConversation: (filePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  deleteConversation: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  revealConversation: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openConversationFolder: () => Promise<{ success: boolean; error?: string }>;
  getWebviewPreloadPath: () => Promise<string>;
  /** 打开文件选择对话框，返回文件信息(base64 content) */
  pickFile: (options?: { accept?: string; multiple?: boolean }) => Promise<FilePickResult | FilePickResult[] | null>;
  pickFolder: () => Promise<FolderPickResult | null>;
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
    runTask: (rootPath: string, taskName: string, runId: string, environment?: Record<string, string>) => Promise<WorkspaceResult<WorkspaceTaskRunResult>>;
    cancelTask: (runId: string) => Promise<{ success: boolean }>;
    onTaskEvent: (callback: (event: WorkspaceTaskEvent) => void) => () => void;
    listFiles: (rootPath: string) => Promise<WorkspaceResult<WorkspaceEntry[]>>;
    search: (rootPath: string, query: string, options?: WorkspaceSearchOptions) => Promise<WorkspaceResult<WorkspaceSearchResult[]>>;
    semanticSearch: (rootPath: string, symbol: string) => Promise<WorkspaceResult<WorkspaceSemanticResult[]>>;
    languageSemanticSearch: (rootPath: string, relativePath: string, line: number, column: number) => Promise<WorkspaceResult<WorkspaceSemanticResult[]>>;
    gitStatus: (rootPath: string) => Promise<WorkspaceResult<WorkspaceGitStatus[]>>;
    gitShowHead: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<string>>;
    gitStage: (rootPath: string, relativePaths: string[]) => Promise<WorkspaceResult<void>>;
    gitUnstage: (rootPath: string, relativePaths: string[]) => Promise<WorkspaceResult<void>>;
    gitCommit: (rootPath: string, message: string) => Promise<WorkspaceResult<string>>;
    gitOperation: <T = unknown>(rootPath: string, operation: WorkspaceGitOperation, payload?: Record<string, unknown>) => Promise<WorkspaceResult<T>>;
    cancelGitOperation: (rootPath: string, operationId: string) => Promise<{ success: boolean }>;
    onGitProgress: (callback: (event: WorkspaceGitProgress) => void) => () => void;
    watch: (rootPath: string) => Promise<WorkspaceResult<void>>;
    unwatch: () => Promise<void>;
    onFileChanged: (callback: (event: WorkspaceFileChange) => void) => () => void;
  };
  knowledge: {
    scanWorkspace: (rootPath: string) => Promise<WorkspaceResult<import('../core/knowledge').KnowledgeIndex & {
      skipped: Array<{ path: string; reason: 'too-large' | 'unreadable' }>;
      templates: import('../core/knowledge').KnowledgeTemplate[];
      rules: import('../core/knowledge').KnowledgeContentRule[];
      diagnostics: import('../core/knowledge').KnowledgeDiagnostic[];
    }>>;
    createFromTemplate: (rootPath: string, templateId: string, values: Record<string, string>) => Promise<WorkspaceResult<{
      path: string; modifiedAt: number; diagnostics: import('../core/knowledge').KnowledgeDiagnostic[];
    }>>;
    readDocument: (rootPath: string, relativePath: string) => Promise<WorkspaceResult<{ content: string; modifiedAt: number }>>;
    searchWorkspace: (rootPath: string, query: string, limit?: number, filters?: import('../core/knowledge').KnowledgeSearchFilters) => Promise<WorkspaceResult<import('../core/knowledge').KnowledgeSearchHit[]>>;
  };
  /** 保存文件对话框，写入内容 */
  saveFile: (content: string, defaultName?: string) => Promise<{ success: boolean; path?: string }>;
  /** 保存到已经打开的文本文件。 */
  writeTextFile: (filePath: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>;
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
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
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
