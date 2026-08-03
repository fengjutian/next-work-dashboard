import { describe, expect, it, vi } from 'vitest';
import type { ConversationMemoryProvider } from '../src/core/conversation-memory';
import { TencentDbMemoryAdapter } from '../src/core/tencentdb-memory-adapter';

function localProvider(): ConversationMemoryProvider {
  return {
    id: 'local',
    sync: vi.fn().mockResolvedValue({ documents: 1, chunks: 2, failedFiles: [], durationMs: 1, embeddingFallback: false }),
    search: vi.fn().mockResolvedValue([]),
    removeDocument: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TencentDbMemoryAdapter', () => {
  it('reports missing configuration without making a request', async () => {
    const fetchHealth = vi.fn();
    const adapter = new TencentDbMemoryAdapter(localProvider(), { baseUrl: '', userKey: '' }, fetchHealth);

    await expect(adapter.getCapabilities()).resolves.toMatchObject({
      reachable: false,
      remoteSearch: false,
      remoteIngest: false,
      message: 'MISSING_CONFIGURATION',
    });
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  it('checks health with TencentDB authentication and exposes honest capabilities', async () => {
    const fetchHealth = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const adapter = new TencentDbMemoryAdapter(localProvider(), {
      baseUrl: 'http://localhost:8420/',
      userKey: 'secret',
      serviceId: 'memory-service',
    }, fetchHealth);

    await expect(adapter.getCapabilities()).resolves.toMatchObject({
      reachable: true,
      remoteSearch: false,
      remoteIngest: false,
      message: 'REMOTE_OPENAPI_NOT_CONFIGURED',
    });
    expect(fetchHealth).toHaveBeenCalledWith('http://localhost:8420/health', {
      headers: {
        'x-tdai-user-key': 'secret',
        'x-tdai-service-id': 'memory-service',
      },
    });
  });

  it('falls back to the local provider for every memory operation', async () => {
    const local = localProvider();
    const adapter = new TencentDbMemoryAdapter(local, { baseUrl: '', userKey: '' });

    await adapter.sync();
    await adapter.search('历史问题', 3);
    await adapter.removeDocument('history.md');

    expect(local.sync).toHaveBeenCalledOnce();
    expect(local.search).toHaveBeenCalledWith('历史问题', 3);
    expect(local.removeDocument).toHaveBeenCalledWith('history.md');
  });
});
