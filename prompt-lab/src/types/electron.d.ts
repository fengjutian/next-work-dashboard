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
  copyText: (text: string) => void;
  fetchFavicon: (siteUrl: string) => Promise<string | null>;
  saveConversation: (payload: {
    site: string;
    timestamp: number;
    requestBody: unknown;
    responseContent: string;
  }) => Promise<{ success: boolean; filePath?: string }>;
  listConversations: () => Promise<ConversationFile[]>;
  readConversation: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  deleteConversation: (filePath: string) => Promise<{ success: boolean; error?: string }>;
}

export interface ConversationFile {
  site: string;
  date: string;
  fileName: string;
  path: string;
  size: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
