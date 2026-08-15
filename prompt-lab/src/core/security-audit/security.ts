import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SecurityFinding, ScanMode } from './types';

const execFileAsync = promisify(execFile);
export const DEFAULT_EXCLUDES = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', 'target', 'vendor']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 20_000;

export function fingerprint(scannerId: string, ruleId: string, file: string, excerpt: string): string {
  return crypto.createHash('sha256').update([scannerId, ruleId, file.replace(/\\/g, '/'), excerpt.trim()].join('\0')).digest('hex');
}

export function findingId(fingerprintValue: string): string { return `finding-${fingerprintValue.slice(0, 20)}`; }

export function redactSecrets(value: string): string {
  return value
    .replace(/(api[_-]?key|token|secret|password)(\s*[:=]\s*)["']?[^\s"']+/gi, '$1$2[REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
}

function safeRelative(root: string, candidate: string): string | null {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

export function enumerateTextFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (dir: string): void => {
    if (output.length >= MAX_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || DEFAULT_EXCLUDES.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && fs.statSync(absolute).size <= MAX_FILE_BYTES) {
        const relative = safeRelative(root, absolute);
        if (relative) output.push(relative);
      }
    }
  };
  visit(root);
  return output;
}

export async function resolveScanFiles(root: string, mode: ScanMode, baselineRef = 'HEAD'): Promise<string[]> {
  if (mode === 'full') return enumerateTextFiles(root);
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${baselineRef}...HEAD`], {
      cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    const files = stdout.split(/\r?\n/).map((file) => safeRelative(root, file)).filter((file): file is string => Boolean(file));
    return files.filter((file) => {
      try { return fs.statSync(path.join(root, file)).isFile() && fs.statSync(path.join(root, file)).size <= MAX_FILE_BYTES; } catch { return false; }
    });
  } catch {
    return enumerateTextFiles(root);
  }
}

export function mergeWithBaseline(current: SecurityFinding[], previous: SecurityFinding[], now = Date.now()): SecurityFinding[] {
  const before = new Map(previous.map((item) => [item.fingerprint, item]));
  const active = current.map((item) => {
    const old = before.get(item.fingerprint);
    return old ? { ...item, status: old.status === 'fixed' ? 'open' as const : old.status, firstSeenAt: old.firstSeenAt, lastSeenAt: now } : item;
  });
  const currentKeys = new Set(current.map((item) => item.fingerprint));
  return [...active, ...previous.filter((item) => !currentKeys.has(item.fingerprint) && item.status !== 'fixed').map((item) => ({ ...item, status: 'fixed' as const, fixedAt: now, lastSeenAt: now }))];
}
