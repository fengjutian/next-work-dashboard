/**
 * Host globals consumed by WeRead. Hosts should provide an actual
 * implementation matching this shape on `window.electronAPI` (e.g. via an
 * Electron preload script). The package does not bundle any default.
 */

export {};

interface WereadElectronAuth {
  getToken(service: string): Promise<string | null>;
  saveToken(service: string, token: string, label?: string): Promise<void>;
}

interface WereadElectronShell {
  openExternal(url: string): Promise<void>;
}

interface WereadElectronSaveFileResult {
  success: boolean;
  path?: string;
  error?: string;
}

declare global {
  interface Window {
    electronAPI: {
      auth: WereadElectronAuth;
      shell: WereadElectronShell;
      saveFile: (content: string, defaultName: string) => Promise<WereadElectronSaveFileResult>;
    };
  }
}
