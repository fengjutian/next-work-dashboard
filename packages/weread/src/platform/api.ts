import type { WereadHostApi } from '../react/adapter';

export type WereadTransport = (operation: 'request' | 'ai-summary' | 'ai-recommend', payload: unknown) => Promise<unknown>;

export function createTransportWereadApi(transport: WereadTransport): WereadHostApi {
  return {
    wereadRequest: (apiKey, payload) => transport('request', { apiKey, payload }) as ReturnType<WereadHostApi['wereadRequest']>,
    wereadAiSummary: (payload) => transport('ai-summary', payload) as ReturnType<WereadHostApi['wereadAiSummary']>,
    wereadAiRecommend: (payload) => transport('ai-recommend', payload) as ReturnType<WereadHostApi['wereadAiRecommend']>,
  };
}

export interface HttpWereadApiOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
}

export function createHttpWereadApi(options: HttpWereadApiOptions = {}): WereadHostApi {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? '/api/weread').replace(/\/$/, '');
  return createTransportWereadApi(async (operation, payload) => {
    const response = await fetcher(`${baseUrl}/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`WeRead API HTTP ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as never;
  });
}
