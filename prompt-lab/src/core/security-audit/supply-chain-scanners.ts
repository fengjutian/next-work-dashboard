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

const osvCache = new Map<string, { expires: number; vulnerabilities: Array<Record<string, unknown>> }>();
function ecosystemFor(source: string): string { if (/Cargo\.lock$/i.test(source)) return 'crates.io'; if (/requirements/i.test(source)) return 'PyPI'; return 'npm'; }
export async function queryOsvForLocks(context: ScanContext): Promise<SecurityFinding[]> {
  if (context.networkPolicy !== 'allow') return [];
  const dependencies: LockedDependency[] = [];
  for (const file of context.files.filter((item) => /(?:(?:package-lock|npm-shrinkwrap)\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|requirements(?:-[^.]+)?\.txt)$/i.test(item))) { try { dependencies.push(...parseDependencyLock(file, fs.readFileSync(path.join(context.projectDir, file), 'utf8'))); } catch { /* malformed manifests are handled by the lockfile scanner */ } }
  const unique = [...new Map(dependencies.filter((item) => item.name && item.version).map((item) => [`${ecosystemFor(item.source)}:${item.name}:${item.version}`, item])).values()].slice(0, 2_000); const findings: SecurityFinding[] = []; const now = Date.now();
  for (let offset = 0; offset < unique.length; offset += 250) {
    const batch = unique.slice(offset, offset + 250); const uncached = batch.filter((item) => !osvCache.has(`${ecosystemFor(item.source)}:${item.name}:${item.version}`) || (osvCache.get(`${ecosystemFor(item.source)}:${item.name}:${item.version}`)?.expires ?? 0) < now);
    if (uncached.length) {
      const response = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', signal: context.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: uncached.map((item) => ({ package: { name: item.name, ecosystem: ecosystemFor(item.source) }, version: item.version })) }) });
      if (!response.ok) throw new Error(`OSV_HTTP_${response.status}`); const body = await response.json() as { results?: Array<{ vulns?: Array<Record<string, unknown>> }> };
      uncached.forEach((item, index) => osvCache.set(`${ecosystemFor(item.source)}:${item.name}:${item.version}`, { expires: now + 60 * 60 * 1000, vulnerabilities: body.results?.[index]?.vulns ?? [] }));
    }
    for (const dependency of batch) for (const vulnerability of osvCache.get(`${ecosystemFor(dependency.source)}:${dependency.name}:${dependency.version}`)?.vulnerabilities ?? []) {
      const id = String(vulnerability.id ?? 'OSV-UNKNOWN'); const aliases = Array.isArray(vulnerability.aliases) ? vulnerability.aliases.map(String) : []; const cve = aliases.find((alias) => alias.startsWith('CVE-')); const excerpt = `${dependency.name}@${dependency.version}`; const key = fingerprint('osv-lockfile', id, dependency.source, excerpt);
      findings.push({ id: findingId(key), fingerprint: key, scannerId: 'osv-lockfile', ruleId: id, category: 'sca', severity: 'P1', confidence: 'high', confidenceRationale: 'The exact locked package ecosystem, name and version matched the OSV vulnerability database.', status: 'open', title: `${id}: ${String(vulnerability.summary ?? dependency.name)}`, description: String(vulnerability.details ?? vulnerability.summary ?? 'Known dependency vulnerability.').slice(0, 2000), location: { file: dependency.source, line: 1 }, evidence: [{ kind: 'dependency', excerpt }], recommendation: 'Upgrade to a non-affected version listed by the package advisory and regenerate the lockfile.', cve, firstSeenAt: now, lastSeenAt: now });
    }
  }
  return findings;
}
export const osvLockfileScanner: SecurityScanner = { id: 'osv-lockfile', name: 'OSV Exact Lockfile Vulnerability Match', async detect(context) { return context.networkPolicy === 'allow' && context.files.some((file) => /(?:lock|requirements)/i.test(file)); }, scan: queryOsvForLocks };

const secretPattern = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?([^\s"']{12,})|\b((?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,})\b/gi;
const lastGitCommit = new Map<string, string>();
const gitFindingCache = new Map<string, SecurityFinding[]>();
async function verifySecret(secret: string, signal: AbortSignal): Promise<{ provider: string; status: 'valid' | 'invalid' | 'unknown'; checkedAt: number }> {
  const checkedAt = Date.now(); if (!/^(?:ghp_|github_pat_)/.test(secret)) return { provider: 'unknown', status: 'unknown', checkedAt };
  try { const response = await fetch('https://api.github.com/user', { signal, headers: { authorization: `Bearer ${secret}`, accept: 'application/vnd.github+json', 'user-agent': 'next-work-dashboard-security-audit' } }); return { provider: 'GitHub', status: response.ok ? 'valid' : response.status === 401 || response.status === 403 ? 'invalid' : 'unknown', checkedAt }; } catch { return { provider: 'GitHub', status: 'unknown', checkedAt }; }
}
export async function scanGitHistory(context: ScanContext): Promise<SecurityFinding[]> {
  if (!fs.existsSync(path.join(context.projectDir, '.git'))) return [];
  let output = ''; let head = ''; try { ({ stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: context.projectDir, windowsHide: true, timeout: 5_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } })); const previous = lastGitCommit.get(context.projectDir); const range = previous && previous.trim() !== head.trim() ? [`${previous.trim()}..${head.trim()}`] : previous ? [] : ['--all']; if (!range.length) return gitFindingCache.get(context.projectDir) ?? []; ({ stdout: output } = await execFileAsync('git', ['log', ...range, '--format=commit:%H', '-p', '--no-ext-diff', '--unified=0', '--diff-filter=AM'], { cwd: context.projectDir, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, signal: context.signal, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } })); lastGitCommit.set(context.projectDir, head.trim()); } catch (error) { if (context.signal.aborted) throw error; return gitFindingCache.get(context.projectDir) ?? []; }
  const findings: SecurityFinding[] = []; let commit = 'unknown'; let file = 'git-history'; let line = 1; const now = Date.now();
  for (const raw of output.split(/\r?\n/)) {
    if (raw.startsWith('commit:')) { commit = raw.slice(7, 19); continue; }
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw); if (header) { line = Number(header[1]); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    secretPattern.lastIndex = 0; const match = secretPattern.exec(raw.slice(1)); if (!match) { line += 1; continue; } const rawSecret = match[1] ?? match[2] ?? '';
    const ruleId = 'secret.git-history'; const excerpt = `Secret material exists in commit ${commit}`; const key = fingerprint('git-history-secrets', ruleId, file, `${commit}:${line}`);
    const verification = context.verifySecrets && context.networkPolicy === 'allow' ? await verifySecret(rawSecret, context.signal) : undefined;
    findings.push({ id: findingId(key), fingerprint: key, scannerId: 'git-history-secrets', ruleId, category: 'secret', severity: 'P0', confidence: verification?.status === 'valid' ? 'high' : 'medium', confidenceRationale: verification?.status === 'valid' ? 'The provider confirmed this redacted credential is currently valid.' : 'The value matches a credential structure in committed history; validity was not confirmed.', status: 'open', title: 'Secret found in Git history', description: `A credential-like value was added in commit ${commit}. The secret is redacted and was not persisted by the scanner.`, location: { file, line }, evidence: [{ kind: 'tool', excerpt, location: { file, line } }], secretVerification: verification, recommendation: 'Revoke and rotate the credential, then remove it from Git history with an approved history-rewrite procedure.', cwe: 'CWE-798', firstSeenAt: now, lastSeenAt: now }); line += 1;
  }
  const combined = new Map([...(gitFindingCache.get(context.projectDir) ?? []), ...findings].map((finding) => [finding.fingerprint, finding])); const result = [...combined.values()]; gitFindingCache.set(context.projectDir, result); return result;
}
export const gitHistoryScanner: SecurityScanner = { id: 'git-history-secrets', name: 'Git History Secret Scan', async detect(context) { return fs.existsSync(path.join(context.projectDir, '.git')); }, scan: scanGitHistory };
