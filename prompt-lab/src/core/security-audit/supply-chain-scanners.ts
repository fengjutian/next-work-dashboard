import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findingId, fingerprint } from './security';
import type { ScanContext, SecurityFinding, SecurityScanner } from './types';
import { classifySecret, extractSecretCandidate, isLikelyTestPath, secretDigest, type SecretCandidate } from './secret-analysis';

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
      findings.push({ id: findingId(key), fingerprint: key, scannerId: 'lockfile-analysis', ruleId, category: 'sca', severity: 'P2', confidence: 'high', status: 'open', title: '锁定依赖缺少完整性哈希', description: `${excerpt} 的解析结果没有记录包完整性哈希。`, location: { file, line: 1 }, evidence: [{ kind: 'dependency', excerpt }], recommendation: '使用当前可信的包管理器重新生成锁文件，并检查实际使用的软件源。', cwe: 'CWE-494', firstSeenAt: now, lastSeenAt: now });
    }
  }
  return findings;
}

export const lockfileScanner: SecurityScanner = { id: 'lockfile-analysis', name: '依赖锁文件分析', async detect(context) { return context.files.some((file) => /(?:(?:package-lock|npm-shrinkwrap)\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|requirements(?:-[^.]+)?\.txt)$/i.test(file)); }, async scan(context) { return lockFindings(context); } };

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
      findings.push({ id: findingId(key), fingerprint: key, scannerId: 'osv-lockfile', ruleId: id, category: 'sca', severity: 'P1', confidence: 'high', confidenceRationale: '锁文件中的软件生态、包名和精确版本与 OSV 漏洞数据库匹配。', status: 'open', title: `${id}：${String(vulnerability.summary ?? dependency.name)}`, description: `OSV 已确认该锁定版本存在已知漏洞。原始公告：${String(vulnerability.details ?? vulnerability.summary ?? '未提供详细说明').slice(0, 1800)}`, location: { file: dependency.source, line: 1 }, evidence: [{ kind: 'dependency', excerpt }], recommendation: '升级到安全公告列出的不受影响版本，并重新生成锁文件。', cve, firstSeenAt: now, lastSeenAt: now });
    }
  }
  return findings;
}
export const osvLockfileScanner: SecurityScanner = { id: 'osv-lockfile', name: 'OSV 精确版本漏洞匹配', async detect(context) { return context.networkPolicy === 'allow' && context.files.some((file) => /(?:lock|requirements)/i.test(file)); }, scan: queryOsvForLocks };

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
    const ruleId = 'secret.git-history'; const excerpt = `提交 ${commit} 中存在疑似密钥材料`; const key = fingerprint('git-history-secrets', ruleId, file, `${commit}:${line}`);
    const verification = context.verifySecrets && context.networkPolicy === 'allow' ? await verifySecret(rawSecret, context.signal) : undefined;
    findings.push({ id: findingId(key), fingerprint: key, scannerId: 'git-history-secrets', ruleId, category: 'secret', severity: 'P0', confidence: verification?.status === 'valid' ? 'high' : 'medium', confidenceRationale: verification?.status === 'valid' ? '密钥供应商已确认该脱敏凭据当前仍然有效。' : '该值符合凭据结构并出现在 Git 提交历史中，但尚未确认当前是否有效。', status: 'open', title: 'Git 历史中发现疑似密钥', description: `提交 ${commit} 中曾加入疑似凭据。扫描器已对密钥脱敏，且不会持久化原始值。`, location: { file, line }, evidence: [{ kind: 'tool', excerpt, location: { file, line } }], secretVerification: verification, recommendation: '立即撤销并轮换该凭据，然后按照经过审批的历史重写流程从 Git 历史中移除。', cwe: 'CWE-798', firstSeenAt: now, lastSeenAt: now }); line += 1;
  }
  const combined = new Map([...(gitFindingCache.get(context.projectDir) ?? []), ...findings].map((finding) => [finding.fingerprint, finding])); const result = [...combined.values()]; gitFindingCache.set(context.projectDir, result); return result;
}
export async function scanGitHistoryAggregated(context: ScanContext): Promise<SecurityFinding[]> {
  if (!fs.existsSync(path.join(context.projectDir, '.git'))) return [];
  const currentDigests = new Set<string>(); for (const candidateFile of context.files) { if (isLikelyTestPath(candidateFile)) continue; try { for (const sourceLine of fs.readFileSync(path.join(context.projectDir, candidateFile), 'utf8').split(/\r?\n/)) { let candidate = extractSecretCandidate(sourceLine, candidateFile); if (!candidate) { const provider = /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/.exec(sourceLine)?.[0]; if (provider) candidate = classifySecret('token', provider, candidateFile); } if (candidate) currentDigests.add(secretDigest(candidate.value)); } } catch { /* file changed while scanning */ } }
  const refreshCurrentState = (items: SecurityFinding[]): SecurityFinding[] => items.map((item) => { if (!item.secretDetails) return item; const currentExists = currentDigests.has(item.secretDetails.valueFingerprint); const severity = item.secretVerification?.status === 'valid' ? currentExists ? 'P0' as const : 'P1' as const : currentExists ? item.severity === 'P3' ? 'P2' as const : item.severity : item.confidence === 'high' ? 'P2' as const : 'P3' as const; return { ...item, severity, description: `同一疑似凭据在 ${item.secretDetails.commits?.length ?? 0} 个提交、${item.secretDetails.locations.length} 个位置中出现 ${item.secretDetails.occurrences} 次；${currentExists ? '当前代码中仍然存在' : '当前代码中已不存在'}。`, secretDetails: { ...item.secretDetails, currentExists } }; });
  let output = ''; let head = ''; try { ({ stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: context.projectDir, windowsHide: true, timeout: 5_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } })); const previous = lastGitCommit.get(context.projectDir); const range = previous && previous !== head.trim() ? [`${previous}..${head.trim()}`] : previous ? [] : ['--all']; if (!range.length) return refreshCurrentState(gitFindingCache.get(context.projectDir) ?? []); ({ stdout: output } = await execFileAsync('git', ['log', ...range, '--format=commit:%H', '-p', '--no-ext-diff', '--unified=0', '--diff-filter=AM'], { cwd: context.projectDir, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, signal: context.signal, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } })); lastGitCommit.set(context.projectDir, head.trim()); } catch (error) { if (context.signal.aborted) throw error; return refreshCurrentState(gitFindingCache.get(context.projectDir) ?? []); }
  type Group = { candidate: SecretCandidate; commits: Set<string>; locations: Map<string, { file: string; line: number }>; occurrences: number };
  const groups = new Map<string, Group>(); let commit = 'unknown'; let file = 'git-history'; let line = 1;
  for (const raw of output.split(/\r?\n/)) {
    if (raw.startsWith('commit:')) { commit = raw.slice(7, 19); continue; }
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw); if (header) { line = Number(header[1]); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const added = raw.slice(1); let candidate = extractSecretCandidate(added, file); if (!candidate) { const provider = /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/.exec(added)?.[0]; if (provider) candidate = classifySecret('token', provider, file); }
    if (!candidate || isLikelyTestPath(file)) { line += 1; continue; } const digest = secretDigest(candidate.value); const group = groups.get(digest) ?? { candidate, commits: new Set(), locations: new Map(), occurrences: 0 }; group.commits.add(commit); group.locations.set(`${file}:${line}`, { file, line }); group.occurrences += 1; groups.set(digest, group); line += 1;
  }
  const findings: SecurityFinding[] = []; const now = Date.now();
  for (const [digest, group] of groups) {
    const currentExists = currentDigests.has(digest);
    const verification = context.verifySecrets && context.networkPolicy === 'allow' ? await verifySecret(group.candidate.value, context.signal) : undefined; const locations = [...group.locations.values()].slice(0, 100); const primary = locations[0] ?? { file: 'git-history', line: 1 }; const commits = [...group.commits].slice(0, 100);
    const severity = verification?.status === 'valid' && currentExists ? 'P0' : currentExists ? group.candidate.severity : verification?.status === 'valid' ? 'P1' : group.candidate.confidence === 'high' ? 'P2' : 'P3'; const confidence = verification?.status === 'valid' ? 'high' : group.candidate.confidence; const key = fingerprint('git-history-secrets', 'secret.git-history', 'git-history', digest);
    findings.push({ id: findingId(key), fingerprint: key, scannerId: 'git-history-secrets', ruleId: 'secret.git-history', category: 'secret', severity, confidence, confidenceRationale: verification?.status === 'valid' ? '密钥供应商已确认该脱敏凭据当前仍然有效。' : group.candidate.rationale, status: 'open', title: `Git 历史中发现疑似${group.candidate.kind === 'password' ? '密码' : '密钥'}`, description: `同一疑似凭据在 ${commits.length} 个提交、${locations.length} 个位置中出现 ${group.occurrences} 次；${currentExists ? '当前代码中仍然存在' : '当前代码中已不存在'}。`, location: primary, evidence: locations.slice(0, 10).map((location) => ({ kind: 'tool' as const, excerpt: `Git 历史位置：${location.file}:${location.line}`, location })), secretVerification: verification, secretDetails: { kind: group.candidate.kind, variableName: group.candidate.variableName, currentExists, historyExists: true, occurrences: group.occurrences, locations, commits, valueFingerprint: digest }, recommendation: currentExists ? '立即撤销并轮换凭据，将当前代码改为安全的密钥存储方式，并清理 Git 历史。' : '确认凭据已撤销或轮换；如仍然有效，请立即撤销，并评估是否需要清理 Git 历史。', cwe: 'CWE-798', firstSeenAt: now, lastSeenAt: now });
  }
  const combined = new Map((gitFindingCache.get(context.projectDir) ?? []).map((item) => [item.fingerprint, item])); for (const finding of findings) { const previous = combined.get(finding.fingerprint); if (previous?.secretDetails && finding.secretDetails) { const locations = new Map([...previous.secretDetails.locations, ...finding.secretDetails.locations].map((location) => [`${location.file}:${location.line}`, location])); const commits = [...new Set([...(previous.secretDetails.commits ?? []), ...(finding.secretDetails.commits ?? [])])]; finding.secretDetails = { ...finding.secretDetails, occurrences: previous.secretDetails.occurrences + finding.secretDetails.occurrences, locations: [...locations.values()].slice(0, 100), commits: commits.slice(0, 100) }; } combined.set(finding.fingerprint, finding); } const result = refreshCurrentState([...combined.values()]); gitFindingCache.set(context.projectDir, result); return result;
}
export const gitHistoryScanner: SecurityScanner = { id: 'git-history-secrets', name: 'Git 历史密钥扫描（聚合）', async detect(context) { return fs.existsSync(path.join(context.projectDir, '.git')); }, scan: scanGitHistoryAggregated };
