import React from 'react';
import { WereadPanel, WereadProvider } from '../react';
import type { WereadAdapter, WereadAiConfig, WereadHostApi, WereadHostServices, WereadTaskRepository } from '../react/adapter';
import { createLocalStorageWereadRepository } from '../platform/storage';

export interface ElectronWereadOptions {
  api: WereadHostApi;
  ai?: Partial<WereadAiConfig>;
  host: WereadHostServices;
  tasks?: WereadTaskRepository;
}

export function createElectronWereadAdapter(options: ElectronWereadOptions): WereadAdapter {
  return {
    api: options.api,
    ai: { baseUrl: '', apiKey: '', model: '', ...options.ai },
    tasks: options.tasks ?? createLocalStorageWereadRepository(),
    host: options.host,
    reader: { mode: 'electron', url: 'https://weread.qq.com/' },
  };
}

export function ElectronWereadApp({ options }: { options: ElectronWereadOptions }) {
  const adapter = React.useMemo(() => createElectronWereadAdapter(options), [options]);
  return <WereadProvider adapter={adapter}><WereadPanel /></WereadProvider>;
}
