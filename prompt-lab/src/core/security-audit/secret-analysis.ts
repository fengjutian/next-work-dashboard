import crypto from 'node:crypto';
import type { FindingConfidence, SecretFindingDetails, SecuritySeverity } from './types';

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
  const match = /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token)\b\s*[:=]\s*["']([^"'\r\n]+)["']/i.exec(line);
  return match ? classifySecret(match[1], match[2], file) : null;
}
