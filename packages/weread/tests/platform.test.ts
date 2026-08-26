import { describe, expect, it, vi } from 'vitest';
import { createTransportWereadApi } from '../src/platform/api';
import { createLocalStorageWereadRepository, type WereadStorageLike } from '../src/platform/storage';

function memoryStorage(): WereadStorageLike {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('cross-platform WeRead adapters', () => {
  it('persists, searches and summarizes cache changes with storage-like hosts', async () => {
    const storage = memoryStorage();
    const repository = createLocalStorageWereadRepository({ storage });
    const first = repository.replaceCache([{
      bookId: 'book-1', title: '设计系统', author: '作者', noteCount: 1, reviewCount: 0,
      bookmarkCount: 1, highlights: [{ bookmarkId: 'note-1', markText: '跨平台组件设计' }], reviews: [],
    }]);
    expect(first).toMatchObject({ addedBooks: 1, totalBooks: 1, totalNotes: 1 });
    expect(repository.loadCache('设计')).toHaveLength(1);
    expect(repository.searchNotes('跨平台')).toMatchObject([{ bookId: 'book-1', noteId: 'note-1' }]);

    repository.markExported([{ bookId: 'book-1', fingerprint: 'abc' }]);
    expect(repository.loadExportStates()[0]).toMatchObject({ bookId: 'book-1', fingerprint: 'abc' });
    await expect(repository.flush()).resolves.toBeUndefined();

    const restored = createLocalStorageWereadRepository({ storage });
    expect(restored.loadCache()).toHaveLength(1);
  });

  it('maps the shared API contract onto web or Tauri transports', async () => {
    const transport = vi.fn(async (_operation: string, payload: unknown) => ({ success: true, data: payload }));
    const api = createTransportWereadApi(transport);
    await api.wereadRequest('wrk-test', { api_name: '/user/notebooks' });
    expect(transport).toHaveBeenCalledWith('request', { apiKey: 'wrk-test', payload: { api_name: '/user/notebooks' } });
  });
});
