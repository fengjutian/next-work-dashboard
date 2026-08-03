import type {
  ConversationMemoryProvider,
  MemoryIndexStats,
  MemorySource,
  MemorySyncOptions,
} from './conversation-memory';

export interface TencentDbMemoryConfig {
  baseUrl: string;
  userKey: string;
  serviceId?: string;
}

export interface TencentDbMemoryCapabilities {
  reachable: boolean;
  remoteSearch: boolean;
  remoteIngest: boolean;
  status?: number;
  message?: string;
}

type HealthFetcher = (
  url: string,
  options?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text?: string; error?: string }>;

/**
 * TencentDB Agent Memory compatibility boundary.
 *
 * The upstream project currently documents its services and authentication, but
 * not a stable public search/ingest OpenAPI. Until such a contract is configured,
 * all memory operations deliberately fall back to the local provider. This keeps
 * history retrieval available without pretending that data was stored remotely.
 */
export class TencentDbMemoryAdapter implements ConversationMemoryProvider {
  readonly id = 'tencentdb-agent-memory';

  constructor(
    private readonly local: ConversationMemoryProvider,
    private readonly config: TencentDbMemoryConfig,
    private readonly fetchHealth?: HealthFetcher,
  ) {}

  async getCapabilities(): Promise<TencentDbMemoryCapabilities> {
    if (!this.config.baseUrl || !this.config.userKey) {
      return {
        reachable: false,
        remoteSearch: false,
        remoteIngest: false,
        message: 'MISSING_CONFIGURATION',
      };
    }

    const fetcher = this.fetchHealth ?? window.electronAPI?.fetchUrl;
    if (!fetcher) {
      return {
        reachable: false,
        remoteSearch: false,
        remoteIngest: false,
        message: 'FETCH_UNAVAILABLE',
      };
    }

    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    try {
      const response = await fetcher(`${baseUrl}/health`, {
        headers: {
          'x-tdai-user-key': this.config.userKey,
          ...(this.config.serviceId ? { 'x-tdai-service-id': this.config.serviceId } : {}),
        },
      });
      return {
        reachable: response.ok,
        status: response.status,
        remoteSearch: false,
        remoteIngest: false,
        message: response.ok ? 'REMOTE_OPENAPI_NOT_CONFIGURED' : (response.error || 'HEALTH_CHECK_FAILED'),
      };
    } catch (error) {
      return {
        reachable: false,
        remoteSearch: false,
        remoteIngest: false,
        message: String(error),
      };
    }
  }

  sync(options?: MemorySyncOptions): Promise<MemoryIndexStats> {
    return this.local.sync(options);
  }

  search(query: string, limit?: number): Promise<MemorySource[]> {
    return this.local.search(query, limit);
  }

  removeDocument(filePath: string): Promise<void> {
    return this.local.removeDocument(filePath);
  }
}
