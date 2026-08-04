import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AgentWorktreeInfo {
  sessionId: string;
  path: string;
  branch: string;
  head?: string;
  dirty: boolean;
}

export interface AgentWorktreeSpec { sessionId: string; path: string; branch: string }
type GitRunner = (cwd: string, args: string[]) => Promise<string>;

function validateSessionId(sessionId: string): string {
  const value = sessionId.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('INVALID_AGENT_SESSION_ID');
  return value;
}

export function buildAgentWorktreeSpec(rootPath: string, storageRoot: string, sessionId: string): AgentWorktreeSpec {
  const safeId = validateSessionId(sessionId);
  const repositoryId = createHash('sha256').update(path.resolve(rootPath).toLocaleLowerCase()).digest('hex').slice(0, 16);
  const base = path.resolve(storageRoot, repositoryId);
  const target = path.resolve(base, safeId);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('INVALID_WORKTREE_PATH');
  return { sessionId: safeId, path: target, branch: `agent/${safeId}` };
}

export function parseWorktreeList(output: string): Array<{ path: string; head?: string; branch?: string }> {
  return output.trim().split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const values = new Map(block.split(/\r?\n/).map((line) => {
      const index = line.indexOf(' ');
      return index < 0 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
    }));
    return { path: values.get('worktree') ?? '', head: values.get('HEAD'), branch: values.get('branch')?.replace(/^refs\/heads\//, '') };
  }).filter((item) => Boolean(item.path));
}

const defaultRunner: GitRunner = async (cwd, args) => {
  const result = await execFileAsync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
  return result.stdout.trim();
};

export async function createAgentWorktree(rootPath: string, storageRoot: string, sessionId: string, runGit: GitRunner = defaultRunner): Promise<AgentWorktreeInfo> {
  const root = fs.realpathSync(path.resolve(rootPath));
  const spec = buildAgentWorktreeSpec(root, storageRoot, sessionId);
  fs.mkdirSync(path.dirname(spec.path), { recursive: true });
  const topLevel = fs.realpathSync(await runGit(root, ['rev-parse', '--show-toplevel']));
  if (topLevel !== root) throw new Error('WORKSPACE_NOT_GIT_ROOT');
  const existing = parseWorktreeList(await runGit(root, ['worktree', 'list', '--porcelain']))
    .find((item) => path.resolve(item.path) === spec.path);
  if (!existing) await runGit(root, ['worktree', 'add', '-b', spec.branch, spec.path, 'HEAD']);
  const status = await runGit(spec.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  const head = await runGit(spec.path, ['rev-parse', 'HEAD']);
  return { ...spec, head, dirty: Boolean(status) };
}

export async function getAgentWorktreeStatus(rootPath: string, storageRoot: string, sessionId: string, runGit: GitRunner = defaultRunner): Promise<AgentWorktreeInfo | null> {
  const root = fs.realpathSync(path.resolve(rootPath));
  const spec = buildAgentWorktreeSpec(root, storageRoot, sessionId);
  const existing = parseWorktreeList(await runGit(root, ['worktree', 'list', '--porcelain']))
    .find((item) => path.resolve(item.path) === spec.path);
  if (!existing) return null;
  const status = await runGit(spec.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  return { ...spec, head: existing.head, branch: existing.branch ?? spec.branch, dirty: Boolean(status) };
}

export async function discardAgentWorktree(rootPath: string, storageRoot: string, sessionId: string, runGit: GitRunner = defaultRunner): Promise<void> {
  const root = fs.realpathSync(path.resolve(rootPath));
  const spec = buildAgentWorktreeSpec(root, storageRoot, sessionId);
  const existing = parseWorktreeList(await runGit(root, ['worktree', 'list', '--porcelain']))
    .find((item) => path.resolve(item.path) === spec.path);
  if (!existing) return;
  await runGit(root, ['worktree', 'remove', '--force', spec.path]);
  try { await runGit(root, ['branch', '-D', spec.branch]); } catch { /* worktree is already removed; stale/missing branch is harmless */ }
}

