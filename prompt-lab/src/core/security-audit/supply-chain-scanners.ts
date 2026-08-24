import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findingId, fingerprint } from './security';
import type { ScanContext, SecurityFinding, SecurityScanner } from './types';

const execFileAsync = promisify(execFile);
export type LockedDependency = { name: string; version: string; integrity?: string; source: string };

export function parseNpmLock(content: string): LockedDependency[] {
  const json = JSON.parse(content) as { lockfileVersion?: number; packages?: Record<string, { version?: string; integrity?: string }>; dependencies?: Record<string, { version?: string; integrity?: string }> };
  if (json.packages) return Object.entries(json.packages).filter(([key]) => key.includes('node_modules/')).map(([key, value]) => ({ name: key.slice(key.lastIndexOf('node_modules/') + 13), version: String(value.version ?? ''), integrity: value.integrity, source: 'package-lock.json' }));
  return Object.entries(json.dependencies ?? {}).map(([name, value]) => ({ name, version: String(value.version ?? ''), integrity: value.integrity, source: 'package-lock.json' }));
}

export function parseDependencyLock(file: string, content: string): LockedDependency[] {
  const base = path.basename(file).toLowerCase();
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return parseNpmLock(content).map((item) => ({ ...item, source: file }));
  if (base === 'cargo.lock') return [...content.matchAll(/\[\[package\]\][\s\S]*?\nname\s*=\s*"([^"]+)"[\s\S]*?\nversion\s*=\s*"([^"]+)"/g)].map((match) => ({ name: match[1], version: match[2], source: file }));
  if (base === 'yarn.lock') return [...content.matchAll(/^"?([^"\s][^:\n]*?)"?:\s*\n\s+version\s+"([^"]+)"/gm)].map((match) => ({ name: match[1].replace(/@[^@]+$/, ''), version: match[2], source: file }));
  if (base === 'pnpm-lock.yaml') return [...content.matchAll(/^\s{2,}\/([^/\s]+(?:\/[^/\s]+)?)\/([^:\s]+):/gm)].map((match) => ({ name: match[1], version: match[2], source: file }));
  if (/^requirements(?:-[^.]+)?\.txt$/.test(base)) return content.split(/\r?\n/).map((line) => /^\s*([A-Za-z0-9_.-]+)\s*==\s*([^\s;]+)/.exec(line)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => ({ name: match[1], version: match[2], source: file }));
  return [];
}

function lockFindings(context: ScanContext): SecurityFinding[] {
  const now = Date.now(); const findings: SecurityFinding[] = [];
  for (const file of context.files.filter((item) => /(^|\/)(?:(?:package-lock|npm-shrinkwrap)\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|requirements(?:-[^.]+)?\.txt)$/i.test(item))) {
    let dependencies: LockedDependency[]; try { dependencies = parseDependencyLock(file, fs.readFileSync(path.join(context.projectDir, file), 'utf8')); } catch { continue; }
    for (const dependency of dependencies) {
      if (!/(?:package-lock|npm-shrinkwrap)\.json$/i.test(file) || dependency.integrity || /^(?:file:|link:)/.test(dependency.version)) continue;
      const ruleId = 'sca.lockfile-missing-integrity'; const excerpt = `${dependency.name}@${dependency.version}`;
      const key = fingerprint('lockfile-analysis', ruleId, file, excerpt);
      findings.push({ id: findingId(key), fingerprint: key, scannerId: 'lockfile-analysis', ruleId, category: 'sca', severity: 'P2', confidence: 'high', status: 'open', title: 'Locked dependency has no integrity hash', description: `${excerpt} is resolved without a recorded package integrity hash.`, location: { file, line: 1 }, evidence: [{ kind: 'dependency', excerpt }], recommendation: 'Regenerate the lockfile with a current trusted package manager and review the resolved registry.', cwe: 'CWE-494', firstSeenAt: now, lastSeenAt: now });
    }
  }
  return findings;
}

export const lockfileScanner: SecurityScanner = { id: 'lockfile-analysis', name: 'Dependency Lockfile Analysis', async detect(context) { return context.files.some((file) => /(?:(?:package-lock|npm-shrinkwrap)\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|requirements(?:-[^.]+)?\.txt)$/i.test(file)); }, async scan(context) { return lockFindings(context); } };

const secretPattern = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?([^\s"']{12,})|\b((?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,})\b/gi;
export async function scanGitHistory(context: ScanContext): Promise<SecurityFinding[]> {
  if (!fs.existsSync(path.join(context.projectDir, '.git'))) return [];
  let output = ''; try { ({ stdout: output } = await execFileAsync('git', ['log', '--all', '--format=commit:%H', '-p', '--no-ext-diff', '--unified=0'], { cwd: context.projectDir, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, signal: context.signal, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } })); } catch (error) { if (context.signal.aborted) throw error; return []; }
  const findings: SecurityFinding[] = []; let commit = 'unknown'; let file = 'git-history'; let line = 1; const now = Date.now();
  for (const raw of output.split(/\r?\n/)) {
    if (raw.startsWith('commit:')) { commit = raw.slice(7, 19); continue; }
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw); if (header) { line = Number(header[1]); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    secretPattern.lastIndex = 0; if (!secretPattern.test(raw.slice(1))) { line += 1; continue; }
    const ruleId = 'secret.git-history'; const excerpt = `Secret material exists in commit ${commit}`; const key = fingerprint('git-history-secrets', ruleId, file, `${commit}:${line}`);
    findings.push({ id: findingId(key), fingerprint: key, scannerId: 'git-history-secrets', ruleId, category: 'secret', severity: 'P0', confidence: 'high', status: 'open', title: 'Secret found in Git history', description: `A credential-like value was added in commit ${commit}. The secret is redacted and was not persisted by the scanner.`, location: { file, line }, evidence: [{ kind: 'tool', excerpt, location: { file, line } }], recommendation: 'Revoke and rotate the credential, then remove it from Git history with an approved history-rewrite procedure.', cwe: 'CWE-798', firstSeenAt: now, lastSeenAt: now }); line += 1;
  }
  return findings;
}
export const gitHistoryScanner: SecurityScanner = { id: 'git-history-secrets', name: 'Git History Secret Scan', async detect(context) { return fs.existsSync(path.join(context.projectDir, '.git')); }, scan: scanGitHistory };
