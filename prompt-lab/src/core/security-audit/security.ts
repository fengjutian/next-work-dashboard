import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScanCoverage, ScannerRunResult, SecurityFinding, ScanMode } from './types';

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

export function buildScanCoverage(root: string, scannedFiles: string[], mode: ScanMode, baselineRef?: string): ScanCoverage {
  const discovered = enumerateTextFiles(root); const languages: Record<string, number> = {}; let scannedBytes = 0;
  const names: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript React', '.js': 'JavaScript', '.jsx': 'React JSX', '.json': 'JSON', '.rs': 'Rust', '.py': 'Python', '.go': 'Go', '.java': 'Java', '.yml': 'YAML', '.yaml': 'YAML' };
  for (const file of scannedFiles) { const language = names[path.extname(file).toLowerCase()] ?? 'Other'; languages[language] = (languages[language] ?? 0) + 1; try { scannedBytes += fs.statSync(path.join(root, file)).size; } catch { /* file changed during scan */ } }
  const manifests = scannedFiles.map((file) => { try { return fs.readFileSync(path.join(root, file), 'utf8').slice(0, 100_000); } catch { return ''; } }).join('\n');
  const frameworks = [['Express', /["']express["']/], ['React', /["']react["']/], ['Electron IPC', /ipcMain\.|ipcRenderer\.|["']electron["']/], ['Next.js', /["']next["']/]].filter(([, matcher]) => (matcher as RegExp).test(manifests)).map(([name]) => name as string);
  return { discoveredFiles: discovered.length, scannedFiles: scannedFiles.length, skippedFiles: Math.max(0, discovered.length - scannedFiles.length), scannedBytes, languages, frameworks, mode, baselineRef, capability: 'limited', capabilitySummary: '正在评估语言和扫描引擎覆盖能力。', analyzedLanguages: [], unanalyzedLanguages: [] };
}

export function assessScanCoverage(coverage: ScanCoverage, runs: ScannerRunResult[]): ScanCoverage {
  const succeeded = new Set(runs.filter((run) => run.status === 'succeeded').map((run) => run.scannerId)); const semantic = succeeded.has('semantic-analysis'); const python = succeeded.has('bandit') || succeeded.has('semgrep'); const semgrep = succeeded.has('semgrep');
  const analyzedLanguages: string[] = []; const unanalyzedLanguages: string[] = [];
  for (const [language, count] of Object.entries(coverage.languages)) {
    if (!count || ['JSON', 'YAML', 'Other'].includes(language)) continue;
    const analyzed = ['TypeScript', 'TypeScript React', 'JavaScript', 'React JSX'].includes(language) ? semantic : language === 'Python' ? python : semgrep;
    (analyzed ? analyzedLanguages : unanalyzedLanguages).push(language);
  }
  const fileScopeComplete = coverage.mode === 'full' && coverage.skippedFiles === 0; const capability = unanalyzedLanguages.length === 0 && fileScopeComplete ? 'full' : analyzedLanguages.length > 0 ? 'partial' : 'limited';
  const capabilitySummary = `${fileScopeComplete ? '文件范围完整' : coverage.mode === 'incremental' ? '仅扫描增量文件' : `有 ${coverage.skippedFiles} 个文件未扫描`}；${unanalyzedLanguages.length ? `缺少 ${unanalyzedLanguages.join('、')} 语义分析` : '已发现的主要代码语言均有语义扫描器覆盖'}。`;
  return { ...coverage, capability, capabilitySummary, analyzedLanguages, unanalyzedLanguages };
}

export async function resolveScanFiles(root: string, mode: ScanMode, baselineRef = 'HEAD'): Promise<string[]> {
  if (mode === 'full') return enumerateTextFiles(root);
  try {
    const [{ stdout }, { stdout: untracked }] = await Promise.all([
      execFileAsync('git', ['diff', '--name-only', '--diff-filter=ACMR', baselineRef], {
      cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      }),
      execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      }),
    ]);
    const files = [...new Set(`${stdout}\n${untracked}`.split(/\r?\n/).map((file) => safeRelative(root, file)).filter((file): file is string => Boolean(file)))];
    return files.filter((file) => {
      try { return fs.statSync(path.join(root, file)).isFile() && fs.statSync(path.join(root, file)).size <= MAX_FILE_BYTES; } catch { return false; }
    });
  } catch {
    return enumerateTextFiles(root);
  }
}

export function mergeWithBaseline(current: SecurityFinding[], previous: SecurityFinding[], now = Date.now(), scopedFiles?: Set<string>): SecurityFinding[] {
  const before = new Map(previous.map((item) => [item.fingerprint, item]));
  const active = current.map((item) => {
    const old = before.get(item.fingerprint);
    return old ? { ...item, status: old.status === 'fixed' ? 'open' as const : old.status, firstSeenAt: old.firstSeenAt, lastSeenAt: now } : item;
  });
  const currentKeys = new Set(current.map((item) => item.fingerprint));
  const untouched = previous.filter((item) => !currentKeys.has(item.fingerprint) && scopedFiles && !scopedFiles.has(item.location.file));
  const resolved = previous.filter((item) => !currentKeys.has(item.fingerprint) && (!scopedFiles || scopedFiles.has(item.location.file)) && item.status !== 'fixed').map((item) => ({ ...item, status: 'fixed' as const, fixedAt: now, lastSeenAt: now }));
  return [...active, ...untouched, ...resolved];
}

export function applyInlineSuppressions(root: string, findings: SecurityFinding[], now = Date.now()): SecurityFinding[] {
  const cache = new Map<string, string[]>();
  return findings.map((finding) => {
    let lines = cache.get(finding.location.file);
    if (!lines) { try { lines = fs.readFileSync(path.join(root, finding.location.file), 'utf8').split(/\r?\n/); } catch { lines = []; } cache.set(finding.location.file, lines); }
    const nearby = lines.slice(Math.max(0, finding.location.line - 3), finding.location.line).join('\n');
    const directive = /security-audit-ignore(?:\s+|:\s*)(\S+)(?:\s+(.+))?/i.exec(nearby);
    if (!directive || (directive[1] !== '*' && directive[1] !== finding.ruleId)) return finding;
    return { ...finding, status: 'false-positive' as const, suppressed: { reason: directive[2]?.trim() || `Inline suppression for ${directive[1]}`, at: now } };
  });
}
