import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCleanAgentWorktreeBase, buildAgentWorktreeSpec, parsePorcelainPaths, parseWorktreeList } from '../src/main/agent/worktree';

describe('agent worktree safety', () => {
  it('builds a deterministic target below the storage root', () => {
    const spec = buildAgentWorktreeSpec('C:/repo', 'C:/data/worktrees', 'agent_123');
    expect(spec.branch).toBe('agent/agent_123');
    expect(path.relative(path.resolve('C:/data/worktrees'), spec.path).startsWith('..')).toBe(false);
  });

  it('rejects session ids that could escape the storage root', () => {
    expect(() => buildAgentWorktreeSpec('C:/repo', 'C:/data/worktrees', '../escape')).toThrow('INVALID_AGENT_SESSION_ID');
  });

  it('parses porcelain worktree output', () => {
    expect(parseWorktreeList('worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/agent\nHEAD def\nbranch refs/heads/agent/task\n')).toEqual([
      { path: 'C:/repo', head: 'abc', branch: 'main' },
      { path: 'C:/agent', head: 'def', branch: 'agent/task' },
    ]);
  });

  it('parses modified, untracked and renamed paths from nul porcelain output', () => {
    expect(parsePorcelainPaths(' M src/a.ts\0?? src/new.ts\0R  src/next.ts\0src/old.ts\0')).toEqual([
      'src/a.ts', 'src/new.ts', 'src/next.ts', 'src/old.ts',
    ]);
  });

  it('refuses to create a new isolated baseline from a dirty workspace', () => {
    expect(() => assertCleanAgentWorktreeBase(' M src/app.ts\0')).toThrow('MAIN_WORKSPACE_DIRTY_CREATE_WORKTREE');
    expect(() => assertCleanAgentWorktreeBase('')).not.toThrow();
  });
});
