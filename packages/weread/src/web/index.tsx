import React from 'react';
import { WereadPanel, WereadProvider } from '../react';
import type { WereadAdapter, WereadAiConfig, WereadHostApi, WereadHostServices, WereadTaskRepository } from '../react/adapter';
import { createHttpWereadApi, type HttpWereadApiOptions } from '../platform/api';
import { createBrowserWereadHost } from '../platform/host';
import { createLocalStorageWereadRepository } from '../platform/storage';

export interface WebWereadOptions {
  ai?: Partial<WereadAiConfig>;
  api?: WereadHostApi;
  http?: HttpWereadApiOptions;
  host?: WereadHostServices;
  tasks?: WereadTaskRepository;
  readerMode?: 'iframe' | 'external';
}

export function createWebWereadAdapter(options: WebWereadOptions = {}): WereadAdapter {
  return {
    api: options.api ?? createHttpWereadApi(options.http),
    ai: { baseUrl: '', apiKey: '', model: '', ...options.ai },
    tasks: options.tasks ?? createLocalStorageWereadRepository(),
    host: options.host ?? createBrowserWereadHost(),
    reader: { mode: options.readerMode ?? 'iframe', url: 'https://weread.qq.com/' },
  };
}

export function WebWereadApp({ options = {} }: { options?: WebWereadOptions }) {
  const adapter = React.useMemo(() => createWebWereadAdapter(options), [options]);
  return <WereadProvider adapter={adapter}><WereadPanel /></WereadProvider>;
}

export { createBrowserWereadHost, createHttpWereadApi, createLocalStorageWereadRepository };
