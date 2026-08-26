import type { WereadHostServices } from '../react/adapter';

export interface BrowserHostOptions {
  storage?: Storage;
  tokenPrefix?: string;
}

export function createBrowserWereadHost(options: BrowserHostOptions = {}): WereadHostServices {
  const storage = options.storage ?? globalThis.localStorage;
  const prefix = options.tokenPrefix ?? 'next-work-dashboard.weread.token.';
  return {
    getToken: async (service) => storage.getItem(`${prefix}${service}`),
    saveToken: async (service, token) => { storage.setItem(`${prefix}${service}`, token); },
    async saveFile(content, defaultName) {
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = defaultName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      return { success: true, path: defaultName };
    },
    async openExternal(url) {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error('浏览器阻止了新窗口，请允许弹出窗口后重试');
    },
  };
}
