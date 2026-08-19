import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncthingFolderAdapter } from '@/main/work-browser/syncthing-sync';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe('Syncthing folder adapter', () => {
  it('round-trips files and lists portable paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-sync-')); roots.push(root);
    const adapter = new SyncthingFolderAdapter(root);
    await adapter.put('ws', { path: 'documents/a.md', data: new TextEncoder().encode('hello') });
    expect(new TextDecoder().decode((await adapter.get('ws', 'documents/a.md')).data)).toBe('hello');
    expect(await adapter.list('ws')).toMatchObject([{ path: 'documents/a.md', size: 5 }]);
    await adapter.remove('ws', 'documents/a.md');
    expect(await adapter.list('ws')).toEqual([]);
  });

  it('rejects traversal before touching disk', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-sync-')); roots.push(root);
    const adapter = new SyncthingFolderAdapter(root);
    await expect(adapter.put('ws', { path: '../escape', data: new Uint8Array() })).rejects.toThrow('INVALID_SYNC_PATH');
  });
});
