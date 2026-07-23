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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
