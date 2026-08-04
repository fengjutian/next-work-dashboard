import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentWorktreeSpec, parseWorktreeList } from '../src/main/agent-worktree';

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
});
