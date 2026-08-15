import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { findingId, fingerprint, redactSecrets, type FindingCategory, type ScanContext, type SecurityFinding, type SecurityScanner, type SecuritySeverity } from '../../core/security-audit';
import { commandAvailable, runScannerProcess, type ExternalScannerCommand } from './external-process';

type JsonObject = Record<string, unknown>;
const severity = (value: unknown): SecuritySeverity => {
  const normalized = String(value ?? '').toLowerCase();
  if (['critical', 'error', 'high'].includes(normalized)) return normalized === 'critical' ? 'P0' : 'P1';
  if (['medium', 'warning', 'warn'].includes(normalized)) return 'P2';
  return 'P3';
};
const relativeFile = (root: string, file: unknown): string => {
  const candidate = String(file ?? 'unknown').replace(/\\/g, '/');
  if (!path.isAbsolute(candidate)) return candidate.replace(/^\.\//, '');
  const relative = path.relative(root, candidate).replace(/\\/g, '/');
  return relative.startsWith('..') ? 'unknown' : relative;
};
function makeFinding(scannerId: string, ruleId: string, category: FindingCategory, level: unknown, title: string, description: string, root: string, fileValue: unknown, lineValue: unknown, excerptValue: unknown, recommendation = '根据扫描器规则修复后重新扫描。', cve?: string): SecurityFinding {
  const file = relativeFile(root, fileValue);
  const line = Math.max(1, Number(lineValue) || 1);
  const excerpt = redactSecrets(String(excerptValue ?? description)).slice(0, 500);
  const key = fingerprint(scannerId, ruleId, file, excerpt);
  const now = Date.now();
  return { id: findingId(key), fingerprint: key, scannerId, ruleId, category, severity: severity(level), confidence: 'high', status: 'open', title, description, location: { file, line }, evidence: [{ kind: 'tool', excerpt, location: { file, line } }], recommendation, cve, firstSeenAt: now, lastSeenAt: now };
}
function parseJson(output: string): JsonObject {
  const start = Math.min(...['{', '['].map((character) => { const index = output.indexOf(character); return index < 0 ? Number.POSITIVE_INFINITY : index; }));
  if (!Number.isFinite(start)) throw new Error('SCANNER_INVALID_JSON');
  return JSON.parse(output.slice(start)) as JsonObject;
}

function externalScanner(command: ExternalScannerCommand, name: string, args: (context: ScanContext) => string[], parser: (json: JsonObject, context: ScanContext) => SecurityFinding[], projectDetect: (context: ScanContext) => boolean = () => true): SecurityScanner {
  return {
    id: command, name,
    async detect(context) { return projectDetect(context) && commandAvailable(command); },
    async scan(context) {
      const result = await runScannerProcess(command, args(context), context.projectDir, context.signal);
      // Security scanners commonly return non-zero when findings exist. Parse any JSON output first.
      if (!result.stdout.trim()) throw new Error(`${command.toUpperCase().replace('-', '_')}_FAILED: ${redactSecrets(result.stderr).slice(0, 300)}`);
      return parser(parseJson(result.stdout), context);
    },
  };
}

export const semgrepScanner = externalScanner('semgrep', 'Semgrep SAST', () => ['scan', '--json', '--quiet', '--config', '.semgrep.yml', '.'], (json, context) => {
  const results = Array.isArray(json.results) ? json.results as JsonObject[] : [];
  return results.map((item) => {
    const extra = (item.extra ?? {}) as JsonObject; const start = (item.start ?? {}) as JsonObject;
    return makeFinding('semgrep', String(item.check_id ?? 'semgrep.unknown'), 'sast', extra.severity, String(extra.message ?? item.check_id ?? 'Semgrep finding'), String(extra.message ?? 'Semgrep detected a code security issue.'), context.projectDir, item.path, start.line, extra.lines, String(((extra.metadata ?? {}) as JsonObject).fix ?? '根据 Semgrep 规则修复代码。'));
  });
}, (context) => fs.existsSync(path.join(context.projectDir, '.semgrep.yml')) || fs.existsSync(path.join(context.projectDir, '.semgrep.yaml')));

function parseGitleaks(json: JsonObject, context: ScanContext): SecurityFinding[] {
  const items = Array.isArray(json) ? json as unknown as JsonObject[] : Array.isArray(json.findings) ? json.findings as JsonObject[] : [];
  return items.map((item) => makeFinding('gitleaks', String(item.RuleID ?? item.ruleId ?? 'gitleaks.secret'), 'secret', 'critical', String(item.Description ?? 'Gitleaks 检测到密钥'), '扫描器确认文件中存在疑似凭据。', context.projectDir, item.File, item.StartLine, item.Match, '立即轮换凭据并从版本历史清除。'));
}

export const gitleaksScanner: SecurityScanner = {
  id: 'gitleaks', name: 'Gitleaks Secret Scan',
  async detect() { return commandAvailable('gitleaks'); },
  async scan(context) {
    const reportPath = path.join(os.tmpdir(), `nwd-gitleaks-${crypto.randomUUID()}.json`);
    try {
      const result = await runScannerProcess('gitleaks', ['dir', '.', '--report-format', 'json', '--report-path', reportPath, '--no-banner', '--redact=100'], context.projectDir, context.signal);
      if (!fs.existsSync(reportPath)) {
        if (result.exitCode === 0) return [];
        throw new Error(`GITLEAKS_FAILED: ${redactSecrets(result.stderr).slice(0, 300)}`);
      }
      return parseGitleaks(JSON.parse(fs.readFileSync(reportPath, 'utf8')) as JsonObject, context);
    } finally {
      try { fs.rmSync(reportPath, { force: true }); } catch { /* best-effort cleanup of exact temporary report */ }
    }
  },
};

export const osvScanner = externalScanner('osv-scanner', 'OSV Dependency Scan', () => ['scan', 'source', '--format=json', '--verbosity=error', '--recursive', '.'], (json, context) => {
  const results = Array.isArray(json.results) ? json.results as JsonObject[] : [];
  const findings: SecurityFinding[] = [];
  for (const result of results) for (const pkg of (Array.isArray(result.packages) ? result.packages as JsonObject[] : [])) for (const vulnerability of (Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities as JsonObject[] : [])) {
    const packageInfo = (pkg.package ?? {}) as JsonObject; const id = String(vulnerability.id ?? 'OSV-UNKNOWN');
    findings.push(makeFinding('osv-scanner', id, 'sca', ((vulnerability.database_specific ?? {}) as JsonObject).severity ?? 'high', `${id}: ${String(packageInfo.name ?? '依赖漏洞')}`, String(vulnerability.summary ?? 'OSV 检测到已知依赖漏洞。'), context.projectDir, String(result.source ?? 'dependency-lock'), 1, `${String(packageInfo.name ?? '')}@${String(packageInfo.version ?? '')}`, '升级到不受影响的依赖版本。', id.startsWith('CVE-') ? id : undefined));
  }
  return findings;
});

export const trivyScanner = externalScanner('trivy', 'Trivy Vulnerability/IaC Scan', () => ['fs', '--format', 'json', '--scanners', 'vuln,misconfig,secret', '--skip-db-update', '--skip-check-update', '.'], (json, context) => {
  const results = Array.isArray(json.Results) ? json.Results as JsonObject[] : [];
  const findings: SecurityFinding[] = [];
  for (const result of results) {
    const target = result.Target ?? 'unknown';
    for (const vulnerability of (Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities as JsonObject[] : [])) findings.push(makeFinding('trivy', String(vulnerability.VulnerabilityID ?? 'trivy.vulnerability'), 'sca', vulnerability.Severity, String(vulnerability.Title ?? vulnerability.VulnerabilityID ?? '依赖漏洞'), String(vulnerability.Description ?? 'Trivy 检测到依赖漏洞。'), context.projectDir, target, 1, `${String(vulnerability.PkgName ?? '')}@${String(vulnerability.InstalledVersion ?? '')}`, `升级到 ${String(vulnerability.FixedVersion ?? '安全版本')}。`, String(vulnerability.VulnerabilityID ?? '').startsWith('CVE-') ? String(vulnerability.VulnerabilityID) : undefined));
    for (const misconfiguration of (Array.isArray(result.Misconfigurations) ? result.Misconfigurations as JsonObject[] : [])) {
      const cause = (misconfiguration.CauseMetadata ?? {}) as JsonObject;
      findings.push(makeFinding('trivy', String(misconfiguration.ID ?? 'trivy.misconfiguration'), 'iac', misconfiguration.Severity, String(misconfiguration.Title ?? 'IaC 配置风险'), String(misconfiguration.Description ?? 'Trivy 检测到基础设施配置风险。'), context.projectDir, target, cause.StartLine, misconfiguration.Message, String(misconfiguration.Resolution ?? '按最小权限原则修复配置。')));
    }
  }
  return findings;
});

export const externalScanners: SecurityScanner[] = [semgrepScanner, gitleaksScanner, osvScanner, trivyScanner];
export async function listExternalScannerAvailability(): Promise<Array<{ id: string; name: string; available: boolean }>> {
  return Promise.all(externalScanners.map(async (scanner) => ({ id: scanner.id, name: scanner.name, available: await commandAvailable(scanner.id as ExternalScannerCommand) })));
}
