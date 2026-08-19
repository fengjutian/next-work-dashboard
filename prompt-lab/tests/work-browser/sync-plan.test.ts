import { describe, expect, it } from 'vitest';
import { buildIncrementalSyncPlan, detectSyncConflicts, normalizeSyncPath } from '@/core/work-browser/sync';

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

  it('propagates one-sided edits and deletions from a baseline', () => {
    const entry = (path: string, hash: string) => ({ path, hash, size: 1, modifiedAt: 1 });
    const base = [entry('edit.md', 'base'), entry('remote-deleted.md', 'same'), entry('local-deleted.md', 'same')];
    const local = [entry('edit.md', 'local'), entry('remote-deleted.md', 'same')];
    const remote = [entry('edit.md', 'base'), entry('local-deleted.md', 'same')];
    const plan = buildIncrementalSyncPlan(base, local, remote);
    expect(plan.upload).toEqual(['edit.md']);
    expect(plan.deleteLocal).toEqual(['remote-deleted.md']);
    expect(plan.deleteRemote).toEqual(['local-deleted.md']);
  });
});
