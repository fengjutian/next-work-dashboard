import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoverageReport, TestRunResult } from '../../core/code-visualizer';

const execFileAsync = promisify(execFile);

export async function listGitChangedFiles(rootPath: string, base: string): Promise<string[]> {
  if (!/^[\w./~^@{}-]+$/.test(base)) throw new Error('非法 Git 基线');
  const options = { cwd: rootPath, windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 } as const;
  if (base === 'WORKTREE') {
    const [{ stdout: diff }, { stdout: status }] = await Promise.all([execFileAsync('git', ['diff', '--name-only', '--relative', 'HEAD'], options), execFileAsync('git', ['status', '--porcelain=v1', '-z'], options)]);
    return [...new Set([...diff.split(/\r?\n/), ...status.split('\0').filter(Boolean).map((line) => line.slice(3))].map((item) => item.trim().replace(/\\/g, '/')).filter(Boolean))];
  }
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--relative', `${base}...HEAD`], options);
  return stdout.split(/\r?\n/).map((item) => item.trim().replace(/\\/g, '/')).filter(Boolean);
}

export async function runRelatedTests(rootPath: string, files: string[]): Promise<TestRunResult> {
  const safeFiles = files.filter((file) => !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && /(^|[\\/])(tests?|__tests__)([\\/]|$)|\.(?:test|spec)\.[jt]sx?$/i.test(file)).slice(0, 50);
  if (!safeFiles.length) throw new Error('没有可执行的关联测试');
  const hasPackage = await exists(path.join(rootPath, 'package.json'));
  const framework: TestRunResult['framework'] = safeFiles.some((file) => file.endsWith('.py')) ? 'pytest' : 'vitest';
  const executable = framework === 'pytest' ? 'python' : process.execPath;
  const args = framework === 'pytest' ? ['-m', 'pytest', ...safeFiles] : hasPackage ? [path.join(rootPath, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...safeFiles] : [];
  if (!args.length) throw new Error('仓库未安装 Vitest');
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, { cwd: rootPath, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: framework === 'vitest' ? '1' : process.env.ELECTRON_RUN_AS_NODE } });
    return { framework, command: `${framework} ${safeFiles.join(' ')}`, ok: true, exitCode: 0, durationMs: Date.now() - startedAt, output: `${stdout}${stderr}`.slice(-100_000) };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return { framework, command: `${framework} ${safeFiles.join(' ')}`, ok: false, exitCode: typeof failure.code === 'number' ? failure.code : null, durationMs: Date.now() - startedAt, output: `${failure.stdout ?? ''}${failure.stderr ?? failure.message}`.slice(-100_000) };
  }
}

export async function parseCoverageFile(filePath: string): Promise<CoverageReport> {
  const content = await fs.readFile(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) return parseCoverageJson(content, filePath);
  const files = content.split(/^end_of_record\s*$/m).map((record) => {
    const source = /^SF:(.+)$/m.exec(record)?.[1]; if (!source) return null;
    const lines = [...record.matchAll(/^DA:(\d+),(\d+)/gm)]; const hit = lines.filter((line) => Number(line[2]) > 0).length;
    return { file: source.replace(/\\/g, '/'), linesFound: lines.length, linesHit: hit, lineRate: lines.length ? hit / lines.length : 0 };
  }).filter((item): item is CoverageReport['files'][number] => Boolean(item));
  return summarize(filePath, files);
}

function parseCoverageJson(content: string, source: string): CoverageReport {
  const root = JSON.parse(content) as Record<string, { s?: Record<string, number>; statementMap?: Record<string, unknown> }>;
  const files = Object.entries(root).map(([file, data]) => { const hits = Object.values(data.s ?? {}); const linesHit = hits.filter((hit) => hit > 0).length; return { file: file.replace(/\\/g, '/'), linesFound: hits.length, linesHit, lineRate: hits.length ? linesHit / hits.length : 0 }; });
  return summarize(source, files);
}
function summarize(source: string, files: CoverageReport['files']): CoverageReport { const linesFound = files.reduce((sum, file) => sum + file.linesFound, 0); const linesHit = files.reduce((sum, file) => sum + file.linesHit, 0); return { source, files, linesFound, linesHit, lineRate: linesFound ? linesHit / linesFound : 0 }; }
async function exists(target: string): Promise<boolean> { try { await fs.access(target); return true; } catch { return false; } }
