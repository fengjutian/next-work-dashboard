import { describe, expect, it } from 'vitest';
import { detectSyncConflicts, normalizeSyncPath } from '@/core/work-browser/sync';

describe('work-browser sync plan', () => {
  it('normalizes portable relative paths', () => {
    expect(normalizeSyncPath('documents\\a.md')).toBe('documents/a.md');
  });

  it.each(['../secret', '/a/../../b', '', './a'])('rejects unsafe path %s', (path) => {
    expect(() => normalizeSyncPath(path)).toThrow('INVALID_SYNC_PATH');
  });

  it('detects a true three-way conflict', () => {
    const entry = (hash: string) => ({ path: 'documents/a.md', hash, size: 1, modifiedAt: 1 });
    expect(detectSyncConflicts([entry('base')], [entry('local')], [entry('remote')])).toHaveLength(1);
    expect(detectSyncConflicts([entry('base')], [entry('base')], [entry('remote')])).toHaveLength(0);
  });
});
