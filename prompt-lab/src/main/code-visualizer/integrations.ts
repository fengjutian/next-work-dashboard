import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitRepositoryInfo, HttpMethod, RuntimeEndpointMetric } from '../../core/code-visualizer';
import { normalizeApiPath } from '../../core/code-visualizer';

const execFileAsync = promisify(execFile);

export async function readGitInfo(rootPath: string): Promise<GitRepositoryInfo> {
  try {
    const options = { cwd: rootPath, windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 } as const;
    const [{ stdout: branch }, { stdout: commit }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], options),
      execFileAsync('git', ['rev-parse', '--short', 'HEAD'], options),
      execFileAsync('git', ['status', '--porcelain=v1', '-z'], options),
    ]);
    const changedFiles = status.split('\0').filter(Boolean).map((line) => line.slice(3).replace(/\\/g, '/'));
    return { available: true, branch: branch.trim() || 'HEAD', commit: commit.trim(), dirty: changedFiles.length > 0, changedFiles };
  } catch { return { available: false, changedFiles: [] }; }
}

export async function parseRuntimeMetrics(filePath: string): Promise<RuntimeEndpointMetric[]> {
  const content = await fs.readFile(filePath, 'utf8');
  const aggregates = new Map<string, { method: HttpMethod; path: string; durations: number[]; errors: number; requests: number }>();
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const entry = parseRuntimeLine(line);
    if (!entry) continue;
    const normalized = normalizeApiPath(entry.path);
    const key = `${entry.method}:${normalized}`;
    const aggregate = aggregates.get(key) ?? { method: entry.method, path: entry.path, durations: [], errors: 0, requests: 0 };
    aggregate.requests += 1;
    if (entry.durationMs !== undefined) aggregate.durations.push(entry.durationMs);
    if (entry.status >= 500) aggregate.errors += 1;
    aggregates.set(key, aggregate);
  }
  return [...aggregates.values()].map((item) => {
    const durations = item.durations.sort((a, b) => a - b);
    const requests = item.requests;
    return { method: item.method, path: item.path, normalizedPath: normalizeApiPath(item.path), requests, errors: item.errors, errorRate: requests ? item.errors / requests : 0, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), p99Ms: percentile(durations, .99) };
  });
}

function parseRuntimeLine(line: string): { method: HttpMethod; path: string; status: number; durationMs?: number } | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    const method = String(value.method ?? value.http_method ?? '').toUpperCase() as HttpMethod;
    const url = String(value.path ?? value.url ?? value.route ?? '');
    if (!method || !url) return null;
    return { method, path: url, status: Number(value.status ?? value.statusCode ?? 200), durationMs: value.duration_ms === undefined ? undefined : Number(value.duration_ms) };
  } catch {
    const nginx = /"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+([^\s?]+)[^"]*"\s+(\d{3})[^\n]*?(?:request_time[=:]\s*|\s)(\d+(?:\.\d+)?)?/.exec(line);
    return nginx ? { method: nginx[1] as HttpMethod, path: nginx[2], status: Number(nginx[3]), durationMs: nginx[4] ? Number(nginx[4]) * 1000 : undefined } : null;
  }
}

function percentile(values: number[], ratio: number): number | undefined { return values.length ? values[Math.min(values.length - 1, Math.floor(values.length * ratio))] : undefined; }

export function resolveSourceTarget(rootPath: string, relativePath: string): string {
  const target = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('源码路径超出已授权仓库');
  return target;
}
