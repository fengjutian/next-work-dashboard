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
  close: () => Promise<void>;
  injectPrompt: (payload: InjectPayload) => Promise<InjectResult>;
  onToggleSearchPanel: (callback: () => void) => () => void;
  saveData: (data: string) => Promise<{ success: boolean }>;
  loadData: () => Promise<unknown>;
  toggleAlwaysOnTop: () => Promise<boolean>;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  onInjectFromContextMenu: (callback: () => void) => () => void;
  onSaveBeforeQuit: (callback: () => void) => () => void;
  copyText: (text: string) => void;
  fetchFavicon: (siteUrl: string) => Promise<string | null>;
  saveConversation: (payload: {
    site: string;
    timestamp: number;
    requestBody: unknown;
    responseContent: string;
    title?: string;
    notes?: string;
    createNew?: boolean;
  }) => Promise<{ success: boolean; filePath?: string }>;
  listConversations: () => Promise<ConversationFile[]>;
  readConversation: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  deleteConversation: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openConversationFolder: () => Promise<{ success: boolean; error?: string }>;
  getWebviewPreloadPath: () => Promise<string>;
  /** 打开文件选择对话框，返回文件信息(base64 content) */
  pickFile: (options?: { accept?: string; multiple?: boolean }) => Promise<FilePickResult | FilePickResult[] | null>;
  /** 保存文件对话框，写入内容 */
  saveFile: (content: string, defaultName?: string) => Promise<{ success: boolean; path?: string }>;
  auth: {
    isAvailable: () => Promise<boolean>;
    saveToken: (service: string, token: string, label?: string) => Promise<boolean>;
    getToken: (service: string) => Promise<string | null>;
    deleteToken: (service: string) => Promise<boolean>;
    listServices: () => Promise<Array<{ service: string; savedAt: number; label?: string }>>;
    clearAll: () => Promise<boolean>;
  };
  terminal: {
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
  title?: string;
  notes?: string;
}

export interface FilePickResult {
  path: string;
  name: string;
  size: number;
  content: string;  // base64
  mimeType: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
