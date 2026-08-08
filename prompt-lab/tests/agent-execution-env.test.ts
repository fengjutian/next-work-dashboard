import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalWorktreeEnv } from '../src/main/agent/execution-env';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('local Agent execution environment', () => {
  it('rejects paths outside the worktree', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-'));
    roots.push(root);
    const env = createLocalWorktreeEnv(root);
    await expect(env.readFile('../outside.txt')).rejects.toThrow();
    await expect(env.writeFiles([{ path: '../outside.txt', content: 'unsafe' }])).rejects.toThrow();
  });

  it('writes a batch through the workspace transaction', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-'));
    roots.push(root);
    const env = createLocalWorktreeEnv(root);
    await env.writeFiles([{ path: 'a.txt', content: 'A' }, { path: 'nested/b.txt', content: 'B' }]);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(root, 'nested/b.txt'), 'utf8')).toBe('B');
  });
});
