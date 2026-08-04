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
export interface AgentWorktreeMergePreview {
  canMerge: boolean;
  changedPaths: string[];
  conflictingPaths: string[];
  mainDirty: boolean;
  base: string;
  mainHead: string;
  agentHead: string;
}
export interface AgentWorktreeMergeResult { commit: string; changedPaths: string[] }
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

export function parsePorcelainPaths(output: string): string[] {
  const records = output.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (filePath) paths.push(filePath.replace(/\\/g, '/'));
    if ((status[0] === 'R' || status[0] === 'C') && records[index + 1]) {
      paths.push(records[index + 1].replace(/\\/g, '/'));
      index += 1;
    }
  }
  return [...new Set(paths)].sort();
}

function parseNullPaths(output: string): string[] {
  return [...new Set(output.split('\0').map((value) => value.trim()).filter(Boolean).map((value) => value.replace(/\\/g, '/')))].sort();
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

export async function previewAgentWorktreeMerge(rootPath: string, storageRoot: string, sessionId: string, runGit: GitRunner = defaultRunner): Promise<AgentWorktreeMergePreview> {
  const root = fs.realpathSync(path.resolve(rootPath));
  const spec = buildAgentWorktreeSpec(root, storageRoot, sessionId);
  const existing = parseWorktreeList(await runGit(root, ['worktree', 'list', '--porcelain']))
    .find((item) => path.resolve(item.path) === spec.path);
  if (!existing) throw new Error('AGENT_WORKTREE_NOT_FOUND');
  const [mainStatus, agentStatus, mainHead, agentHead] = await Promise.all([
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runGit(spec.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runGit(root, ['rev-parse', 'HEAD']),
    runGit(spec.path, ['rev-parse', 'HEAD']),
  ]);
  const base = await runGit(root, ['merge-base', mainHead, agentHead]);
  const [mainCommitted, agentCommitted] = await Promise.all([
    runGit(root, ['diff', '--name-only', '-z', `${base}..${mainHead}`]),
    runGit(spec.path, ['diff', '--name-only', '-z', `${base}..${agentHead}`]),
  ]);
  const mainPaths = new Set([...parseNullPaths(mainCommitted), ...parsePorcelainPaths(mainStatus)]);
  const changedPaths = [...new Set([...parseNullPaths(agentCommitted), ...parsePorcelainPaths(agentStatus)])].sort();
  const conflictingPaths = changedPaths.filter((filePath) => mainPaths.has(filePath));
  const mainDirty = Boolean(mainStatus);
  return { canMerge: !mainDirty && changedPaths.length > 0 && conflictingPaths.length === 0, changedPaths, conflictingPaths, mainDirty, base, mainHead, agentHead };
}

export interface AgentWorktreeConflictFile {
  path: string;
  base: string;
  main: string;   // ours — main workspace version
  agent: string;  // theirs — agent worktree version
  conflictType: "content" | "add/add" | "delete/modify" | "modify/delete" | "rename/rename";
}

export async function getAgentWorktreeConflictVersions(
  rootPath: string, storageRoot: string, sessionId: string, filePath: string,
  runGit: GitRunner = defaultRunner,
): Promise<AgentWorktreeConflictFile> {
  const root = fs.realpathSync(path.resolve(rootPath));
  const spec = buildAgentWorktreeSpec(root, storageRoot, sessionId);
  const [mainHead, agentHead] = await Promise.all([
    runGit(root, ["rev-parse", "HEAD"]),
    runGit(spec.path, ["rev-parse", "HEAD"]),
  ]);
  const base = await runGit(root, ["merge-base", mainHead, agentHead]);

  // Get the three file versions
  const [baseContent, mainContent, agentContent] = await Promise.all([
    runGitFile(spec.path, base, filePath, runGit).catch(() => ""),
    runGitFile(root, mainHead, filePath, runGit).catch(() => ""),
    runGitFile(spec.path, agentHead, filePath, runGit).catch(() => ""),
  ]);

  // Detect conflict type
  let conflictType: AgentWorktreeConflictFile["conflictType"] = "content";
  if (!baseContent && mainContent && agentContent) conflictType = "add/add";
  else if (baseContent && !mainContent && agentContent) conflictType = "delete/modify";
  else if (baseContent && mainContent && !agentContent) conflictType = "modify/delete";

  return { path: filePath, base: baseContent, main: mainContent, agent: agentContent, conflictType };
}

async function runGitFile(cwd: string, revision: string, filePath: string, runGit: GitRunner): Promise<string> {
  return runGit(cwd, ["show", ]);
}

export async function mergeAgentWorktree(rootPath: string, storageRoot: string, sessionId: string, message: string, runGit: GitRunner = defaultRunner): Promise<AgentWorktreeMergeResult> {
  const root = fs.realpathSync(path.resolve(rootPath));
  const spec = buildAgentWorktreeSpec(root, storageRoot, sessionId);
  const preview = await previewAgentWorktreeMerge(root, storageRoot, sessionId, runGit);
  if (preview.mainDirty) throw new Error('MAIN_WORKSPACE_DIRTY');
  if (preview.conflictingPaths.length > 0) throw new Error(`AGENT_MERGE_CONFLICT:${preview.conflictingPaths.join(',')}`);
  if (preview.changedPaths.length === 0) throw new Error('AGENT_WORKTREE_NO_CHANGES');

  const agentDirty = await runGit(spec.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (agentDirty) {
    await runGit(spec.path, ['add', '-A']);
    await runGit(spec.path, ['-c', 'user.name=Next Work Agent', '-c', 'user.email=agent@next-work.local', 'commit', '-m', message]);
  }
  try {
    await runGit(root, ['merge', '--squash', '--no-commit', spec.branch]);
    await runGit(root, ['-c', 'user.name=Next Work Agent', '-c', 'user.email=agent@next-work.local', 'commit', '-m', message]);
  } catch (error) {
    try { await runGit(root, ['reset', '--merge', 'HEAD']); } catch { /* preserve the original merge error */ }
    throw error;
  }
  const commit = await runGit(root, ['rev-parse', 'HEAD']);
  await runGit(root, ['worktree', 'remove', '--force', spec.path]);
  await runGit(root, ['branch', '-D', spec.branch]);
  return { commit, changedPaths: preview.changedPaths };
}
