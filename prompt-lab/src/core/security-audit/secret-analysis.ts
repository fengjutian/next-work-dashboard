import crypto from 'node:crypto';
import type { FindingConfidence, SecretFindingDetails, SecurityFinding, SecuritySeverity } from './types';
import { findingId, fingerprint } from './security';

export interface SecretCandidate {
  variableName: string;
  value: string;
  kind: SecretFindingDetails['kind'];
  severity: SecuritySeverity;
  confidence: FindingConfidence;
  rationale: string;
}

const ignoredPath = /(^|\/)(?:tests?|__tests__|fixtures?|mocks?|examples?|docs?|samples?)(?:\/|$)|\.(?:test|spec|snap)\.[^/]+$/i;
export function isLikelyTestPath(file: string): boolean { return ignoredPath.test(file.replace(/\\/g, '/')); }
const placeholder = /^(?:example|sample|dummy|test|mock|changeme|change-me|replace-me|your[-_ ]?(?:api[-_ ]?key|token|secret|password)|xxx+|todo|none|null|undefined|<[^>]+>|\$\{[^}]+\})$/i;
export function shannonEntropy(value: string): number { const counts = new Map<string, number>(); for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1); return [...counts.values()].reduce((sum, count) => { const probability = count / value.length; return sum - probability * Math.log2(probability); }, 0); }
export function secretDigest(value: string): string { return crypto.createHmac('sha256', 'next-work-dashboard/security-audit/secret-fingerprint/v1').update(value).digest('hex'); }
export function classifySecret(variableName: string, value: string, file: string): SecretCandidate | null {
  const normalized = value.trim(); if (!normalized || isLikelyTestPath(file) || placeholder.test(normalized) || /^(.)\1{7,}$/.test(normalized) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalized)) return null;
  if (/^(?:process\.env|os\.getenv|os\.environ|env\.)/i.test(normalized)) return null;
  if (/^github_pat_[A-Za-z0-9_]{20,}$|^gh[pousr]_[A-Za-z0-9]{20,}$/.test(normalized)) return { variableName, value: normalized, kind: 'github', severity: 'P1', confidence: 'high', rationale: '符合 GitHub 凭据的明确格式。' };
  if (/^sk-[A-Za-z0-9_-]{20,}$/.test(normalized)) return { variableName, value: normalized, kind: 'openai', severity: 'P1', confidence: 'high', rationale: '符合 OpenAI API 密钥的明确格式。' };
  if (/^AKIA[0-9A-Z]{16}$/.test(normalized)) return { variableName, value: normalized, kind: 'aws', severity: 'P1', confidence: 'high', rationale: '符合 AWS Access Key ID 的明确格式。' };
  const entropy = shannonEntropy(normalized); const kind = /password|passwd|pwd/i.test(variableName) ? 'password' : /token/i.test(variableName) ? 'token' : 'generic';
  if (normalized.length < 16 || entropy < 3.2) return null;
  return { variableName, value: normalized, kind, severity: entropy >= 4 && normalized.length >= 24 ? 'P1' : 'P2', confidence: entropy >= 4 ? 'medium' : 'low', rationale: `变量 ${variableName} 被赋予长度 ${normalized.length}、熵值 ${entropy.toFixed(2)} 的字符串，但尚未确认它是有效凭据。` };
}
export function extractSecretCandidate(line: string, file: string): SecretCandidate | null {
  const match = /\b(api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token)\b(?:\s*:\s*[^=]+)?\s*[:=]\s*["']([^"'\r\n]+)["']/i.exec(line);
  return match ? classifySecret(match[1], match[2], file) : null;
}
const severityWeight: Record<SecuritySeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
export function correlateSecretFindings(findings: SecurityFinding[]): SecurityFinding[] {
  const regular: SecurityFinding[] = []; const groups = new Map<string, SecurityFinding[]>();
  for (const finding of findings) { const valueFingerprint = finding.secretDetails?.valueFingerprint; if (!valueFingerprint) regular.push(finding); else groups.set(valueFingerprint, [...(groups.get(valueFingerprint) ?? []), finding]); }
  for (const [valueFingerprint, matches] of groups) {
    const primary = matches.find((item) => item.secretDetails?.currentExists) ?? matches[0]; const details = matches.map((item) => item.secretDetails).filter((item): item is SecretFindingDetails => Boolean(item)); const locations = new Map(details.flatMap((item) => item.locations).map((location) => [`${location.file}:${location.line}`, location])); const commits = [...new Set(details.flatMap((item) => item.commits ?? []))]; const currentExists = details.some((item) => item.currentExists); const historyExists = details.some((item) => item.historyExists); const occurrences = Math.max(...details.map((item) => item.occurrences)); const verification = matches.map((item) => item.secretVerification).find((item) => item?.status === 'valid') ?? matches.map((item) => item.secretVerification).find(Boolean); const detectedSeverity = [...matches].sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity])[0].severity; const severity: SecuritySeverity = verification?.status === 'valid' ? currentExists ? 'P0' : 'P1' : verification?.status === 'invalid' ? 'P3' : detectedSeverity; const key = fingerprint('secret-correlation', 'secret.correlated', 'secret', valueFingerprint); const variableName = details.map((item) => item.variableName).find(Boolean);
    regular.push({ ...primary, id: findingId(key), fingerprint: key, ruleId: 'secret.correlated', severity, secretVerification: verification, title: `${variableName ?? '凭据'} 疑似硬编码${historyExists ? '，Git 历史中也存在' : ''}`, description: `该疑似凭据${currentExists ? '当前仍存在于代码中' : '当前代码中已不存在'}，${historyExists ? `Git 历史中出现 ${occurrences} 次` : '未在 Git 历史扫描中发现'}，有效性${verification?.status === 'valid' ? '已确认' : verification?.status === 'invalid' ? '已确认失效' : '尚未确认'}。`, evidence: [...new Map(matches.flatMap((item) => item.evidence).map((item) => [`${item.location?.file}:${item.location?.line}:${item.excerpt}`, item])).values()].slice(0, 20), secretDetails: { ...details[0], variableName, currentExists, historyExists, occurrences, locations: [...locations.values()].slice(0, 100), commits: commits.slice(0, 100), valueFingerprint }, recommendation: currentExists ? '立即轮换凭据，并将当前代码改为环境变量或密钥管理服务；确认影响后再清理 Git 历史。' : '确认凭据已经撤销或轮换；若仍有效，请立即撤销，并评估是否需要清理 Git 历史。' });
  }
  return regular;
}
