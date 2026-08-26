import React from 'react';
import { invoke as defaultInvoke } from '@tauri-apps/api/core';
import { WereadPanel, WereadProvider } from '../react';
import type { WereadAdapter, WereadAiConfig, WereadHostApi, WereadHostServices, WereadTaskRepository } from '../react/adapter';
import { createTransportWereadApi } from '../platform/api';
import { createBrowserWereadHost } from '../platform/host';
import { createLocalStorageWereadRepository } from '../platform/storage';

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriWereadOptions {
  invoke?: TauriInvoke;
  ai?: Partial<WereadAiConfig>;
  api?: WereadHostApi;
  host?: WereadHostServices;
  tasks?: WereadTaskRepository;
  command?: string;
}

export function createTauriWereadAdapter(options: TauriWereadOptions = {}): WereadAdapter {
  const command = options.command ?? 'weread';
  const invoke = options.invoke ?? defaultInvoke;
  return {
    api: options.api ?? createTransportWereadApi((operation, payload) => invoke(command, { operation, payload })),
    ai: { baseUrl: '', apiKey: '', model: '', ...options.ai },
    tasks: options.tasks ?? createLocalStorageWereadRepository(),
    host: options.host ?? createBrowserWereadHost(),
    reader: { mode: 'external', url: 'https://weread.qq.com/' },
  };
}

export function TauriWereadApp({ options = {} }: { options?: TauriWereadOptions }) {
  const adapter = React.useMemo(() => createTauriWereadAdapter(options), [options]);
  return <WereadProvider adapter={adapter}><WereadPanel /></WereadProvider>;
}

export { createLocalStorageWereadRepository };
