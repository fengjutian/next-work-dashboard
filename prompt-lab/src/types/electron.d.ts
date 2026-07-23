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
  getWebviewPreloadPath: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
