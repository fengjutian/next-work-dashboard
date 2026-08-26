import React from 'react';
import { WereadPanel, WereadProvider } from '../react';
import type { WereadAdapter, WereadAiConfig, WereadHostApi, WereadHostServices, WereadTaskRepository } from '../react/adapter';
import { createLocalStorageWereadRepository } from '../platform/storage';

export interface ElectronWereadOptions {
  api?: WereadHostApi;
  ai?: Partial<WereadAiConfig>;
  host?: WereadHostServices;
  tasks?: WereadTaskRepository;
}

export function createElectronWereadAdapter(options: ElectronWereadOptions = {}): WereadAdapter {
  const bridge = window.electronAPI;
  const api = options.api ?? {
    wereadRequest: (apiKey: string, payload: Record<string, unknown>) => {
      if (!bridge.wereadRequest) throw new Error('Electron preload 未暴露 wereadRequest');
      return bridge.wereadRequest(apiKey, payload);
    },
    wereadAiSummary: (payload) => {
      if (!bridge.wereadAiSummary) throw new Error('Electron preload 未暴露 wereadAiSummary');
      return bridge.wereadAiSummary(payload);
    },
    wereadAiRecommend: (payload) => {
      if (!bridge.wereadAiRecommend) throw new Error('Electron preload 未暴露 wereadAiRecommend');
      return bridge.wereadAiRecommend(payload);
    },
  } satisfies WereadHostApi;
  const host = options.host ?? {
    getToken: (service: string) => bridge.auth.getToken(service),
    saveToken: (service: string, token: string, label?: string) => bridge.auth.saveToken(service, token, label),
    saveFile: (content: string, defaultName: string) => bridge.saveFile(content, defaultName),
    openExternal: (url: string) => bridge.shell.openExternal(url),
  };
  return {
    api,
    ai: { baseUrl: '', apiKey: '', model: '', ...options.ai },
    tasks: options.tasks ?? createLocalStorageWereadRepository(),
    host,
    reader: { mode: 'electron', url: 'https://weread.qq.com/' },
  };
}

export function ElectronWereadApp({ options = {} }: { options?: ElectronWereadOptions }) {
  const adapter = React.useMemo(() => createElectronWereadAdapter(options), [options]);
  return <WereadProvider adapter={adapter}><WereadPanel /></WereadProvider>;
}
