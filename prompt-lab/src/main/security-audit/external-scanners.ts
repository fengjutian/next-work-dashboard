import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { findingId, fingerprint, redactSecrets, type FindingCategory, type ScanContext, type SecurityFinding, type SecurityScanner, type SecuritySeverity } from '../../core/security-audit';
import { inspectScannerCommand, runScannerProcess, ScannerProcessError, type ExternalScannerCommand } from './external-process';

type JsonObject = Record<string, unknown>;
const MAX_REPORT_BYTES = 20 * 1024 * 1024;
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
export function parseScannerJson(output: string): JsonObject {
  const start = Math.min(...['{', '['].map((character) => { const index = output.indexOf(character); return index < 0 ? Number.POSITIVE_INFINITY : index; }));
  if (!Number.isFinite(start)) throw new Error('SCANNER_INVALID_JSON');
  return JSON.parse(output.slice(start)) as JsonObject;
}

export function readLimitedJsonReport(reportPath: string): JsonObject {
  const realTemp = fs.realpathSync(os.tmpdir());
  if (fs.realpathSync(path.dirname(path.resolve(reportPath))) !== realTemp || fs.lstatSync(reportPath).isSymbolicLink()) throw new Error('SCANNER_REPORT_UNTRUSTED_PATH');
  const descriptor = fs.openSync(reportPath, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) throw new Error('SCANNER_REPORT_LIMIT');
    const buffer = Buffer.alloc(stat.size);
    const bytesRead = fs.readSync(descriptor, buffer, 0, stat.size, 0);
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as JsonObject;
  } finally { fs.closeSync(descriptor); }
}

function externalScanner(command: ExternalScannerCommand, name: string, args: (context: ScanContext) => string[], parser: (json: JsonObject, context: ScanContext) => SecurityFinding[], projectDetect: (context: ScanContext) => boolean = () => true): SecurityScanner {
  return {
    id: command, name,
    async detect(context) {
      const status = await inspectScannerCommand(command); this.version = status.version;
      if (!status.available) { this.skipReason = status.error ?? '扫描器未安装'; return false; }
      if (!projectDetect(context)) {
        this.skipReason = command === 'semgrep' ? '项目缺少本地 Semgrep 配置' : context.networkPolicy === 'deny' ? '网络策略禁止该扫描器联网' : '项目未满足扫描条件';
        return false;
      }
      this.skipReason = undefined; return true;
    },
    async scan(context) {
      const result = await runScannerProcess(command, args(context), context.projectDir, context.signal);
      this.lastExitCode = result.exitCode;
      // Security scanners commonly return non-zero when findings exist. Parse any JSON output first.
      if (!result.stdout.trim()) throw new ScannerProcessError(`${command.toUpperCase().replace('-', '_')}_FAILED: ${redactSecrets(result.stderr).slice(0, 300)}`, result.exitCode);
      return parser(parseScannerJson(result.stdout), context);
    },
  };
}

export function parseSemgrepOutput(json: JsonObject, context: ScanContext): SecurityFinding[] {
  const results = Array.isArray(json.results) ? json.results as JsonObject[] : [];
  return results.map((item) => {
    const extra = (item.extra ?? {}) as JsonObject; const start = (item.start ?? {}) as JsonObject;
    return makeFinding('semgrep', String(item.check_id ?? 'semgrep.unknown'), 'sast', extra.severity, String(extra.message ?? item.check_id ?? 'Semgrep finding'), String(extra.message ?? 'Semgrep detected a code security issue.'), context.projectDir, item.path, start.line, extra.lines, String(((extra.metadata ?? {}) as JsonObject).fix ?? '根据 Semgrep 规则修复代码。'));
  });
}
export const semgrepScanner = externalScanner('semgrep', 'Semgrep SAST', (context) => ['scan', '--json', '--quiet', '--metrics', 'off', '--config', fs.existsSync(path.join(context.projectDir, '.semgrep.yml')) ? '.semgrep.yml' : '.semgrep.yaml', '.'], parseSemgrepOutput, (context) => fs.existsSync(path.join(context.projectDir, '.semgrep.yml')) || fs.existsSync(path.join(context.projectDir, '.semgrep.yaml')));

export function parseGitleaksOutput(json: JsonObject, context: ScanContext): SecurityFinding[] {
  const items = Array.isArray(json) ? json as unknown as JsonObject[] : Array.isArray(json.findings) ? json.findings as JsonObject[] : [];
  return items.map((item) => makeFinding('gitleaks', String(item.RuleID ?? item.ruleId ?? 'gitleaks.secret'), 'secret', 'critical', String(item.Description ?? 'Gitleaks 检测到密钥'), '扫描器确认文件中存在疑似凭据。', context.projectDir, item.File, item.StartLine, item.Match, '立即轮换凭据并从版本历史清除。'));
}

export const gitleaksScanner: SecurityScanner = {
  id: 'gitleaks', name: 'Gitleaks Secret Scan',
  async detect() { const status = await inspectScannerCommand('gitleaks'); this.version = status.version; this.skipReason = status.available ? undefined : status.error ?? '扫描器未安装'; return status.available; },
  async scan(context) {
    const reportPath = path.join(os.tmpdir(), `nwd-gitleaks-${crypto.randomUUID()}.json`);
    try {
      const result = await runScannerProcess('gitleaks', ['dir', '.', '--report-format', 'json', '--report-path', reportPath, '--no-banner', '--redact=100'], context.projectDir, context.signal);
      this.lastExitCode = result.exitCode;
      if (!fs.existsSync(reportPath)) {
        if (result.exitCode === 0) return [];
        throw new ScannerProcessError(`GITLEAKS_FAILED: ${redactSecrets(result.stderr).slice(0, 300)}`, result.exitCode);
      }
      return parseGitleaksOutput(readLimitedJsonReport(reportPath), context);
    } finally {
      try { fs.rmSync(reportPath, { force: true }); } catch { /* best-effort cleanup of exact temporary report */ }
    }
  },
};

export function parseOsvOutput(json: JsonObject, context: ScanContext): SecurityFinding[] {
  const results = Array.isArray(json.results) ? json.results as JsonObject[] : [];
  const findings: SecurityFinding[] = [];
  for (const result of results) for (const pkg of (Array.isArray(result.packages) ? result.packages as JsonObject[] : [])) for (const vulnerability of (Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities as JsonObject[] : [])) {
    const packageInfo = (pkg.package ?? {}) as JsonObject; const id = String(vulnerability.id ?? 'OSV-UNKNOWN');
    findings.push(makeFinding('osv-scanner', id, 'sca', ((vulnerability.database_specific ?? {}) as JsonObject).severity ?? 'high', `${id}: ${String(packageInfo.name ?? '依赖漏洞')}`, String(vulnerability.summary ?? 'OSV 检测到已知依赖漏洞。'), context.projectDir, String(result.source ?? 'dependency-lock'), 1, `${String(packageInfo.name ?? '')}@${String(packageInfo.version ?? '')}`, '升级到不受影响的依赖版本。', id.startsWith('CVE-') ? id : undefined));
  }
  return findings;
}
export const osvScanner = externalScanner('osv-scanner', 'OSV Dependency Scan', () => ['scan', 'source', '--format=json', '--verbosity=error', '--recursive', '.'], parseOsvOutput, (context) => context.networkPolicy === 'allow');

export function parseTrivyOutput(json: JsonObject, context: ScanContext): SecurityFinding[] {
  const results = Array.isArray(json.Results) ? json.Results as JsonObject[] : [];
  const findings: SecurityFinding[] = [];
  for (const result of results) {
    const target = result.Target ?? 'unknown';
    for (const vulnerability of (Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities as JsonObject[] : [])) findings.push(makeFinding('trivy', String(vulnerability.VulnerabilityID ?? 'trivy.vulnerability'), 'sca', vulnerability.Severity, String(vulnerability.Title ?? vulnerability.VulnerabilityID ?? '依赖漏洞'), String(vulnerability.Description ?? 'Trivy 检测到依赖漏洞。'), context.projectDir, target, 1, `${String(vulnerability.PkgName ?? '')}@${String(vulnerability.InstalledVersion ?? '')}`, `升级到 ${String(vulnerability.FixedVersion ?? '安全版本')}。`, String(vulnerability.VulnerabilityID ?? '').startsWith('CVE-') ? String(vulnerability.VulnerabilityID) : undefined));
    for (const misconfiguration of (Array.isArray(result.Misconfigurations) ? result.Misconfigurations as JsonObject[] : [])) {
      const cause = (misconfiguration.CauseMetadata ?? {}) as JsonObject;
      findings.push(makeFinding('trivy', String(misconfiguration.ID ?? 'trivy.misconfiguration'), 'iac', misconfiguration.Severity, String(misconfiguration.Title ?? 'IaC 配置风险'), String(misconfiguration.Description ?? 'Trivy 检测到基础设施配置风险。'), context.projectDir, target, cause.StartLine, misconfiguration.Message, String(misconfiguration.Resolution ?? '按最小权限原则修复配置。')));
    }
    for (const secret of (Array.isArray(result.Secrets) ? result.Secrets as JsonObject[] : [])) findings.push(makeFinding('trivy', String(secret.RuleID ?? 'trivy.secret'), 'secret', secret.Severity ?? 'critical', String(secret.Title ?? 'Trivy 检测到密钥'), 'Trivy 在项目文件中检测到疑似凭据。', context.projectDir, target, secret.StartLine, secret.Match, '立即轮换凭据，并从代码与版本历史中移除。'));
  }
  return findings;
}
export const trivyScanner = externalScanner('trivy', 'Trivy Vulnerability/IaC Scan', (context) => ['fs', '--format', 'json', '--scanners', 'vuln,misconfig,secret', ...(context.networkPolicy === 'deny' ? ['--skip-db-update', '--skip-check-update'] : []), '.'], parseTrivyOutput);

export const externalScanners: SecurityScanner[] = [semgrepScanner, gitleaksScanner, osvScanner, trivyScanner];
export async function listExternalScannerAvailability(projectDir: string | undefined, networkPolicy: 'deny' | 'allow', force = false): Promise<Array<{ id: string; name: string; installed: boolean; ready: boolean; version?: string; reason?: string; checkedAt: number; requiresNetwork?: boolean }>> {
  return Promise.all(externalScanners.map(async (scanner) => {
    const installed = await inspectScannerCommand(scanner.id as ExternalScannerCommand, force);
    let ready = installed.available;
    let reason = installed.error;
    const requiresNetwork = scanner.id === 'osv-scanner' || scanner.id === 'trivy';
    if (ready && scanner.id === 'semgrep' && (!projectDir || (!fs.existsSync(path.join(projectDir, '.semgrep.yml')) && !fs.existsSync(path.join(projectDir, '.semgrep.yaml'))))) { ready = false; reason = '项目缺少 .semgrep.yml 或 .semgrep.yaml'; }
    if (ready && scanner.id === 'osv-scanner' && networkPolicy !== 'allow') { ready = false; reason = '网络策略为拒绝；请显式允许 OSV 查询或配置受管离线数据库'; }
    if (ready && scanner.id === 'trivy' && networkPolicy !== 'allow') {
      try {
        const versionResult = await runScannerProcess('trivy', ['version', '--format', 'json'], projectDir ?? process.cwd(), new AbortController().signal, 5_000);
        const versionJson = parseScannerJson(versionResult.stdout);
        const database = versionJson.VulnerabilityDB ?? versionJson.Database;
        ready = Boolean(database && typeof database === 'object');
        if (!ready) reason = '未检测到本地 Trivy Vulnerability DB；联网更新未获授权';
      } catch { ready = false; reason = '无法验证本地 Trivy Vulnerability DB'; }
    }
    return { id: scanner.id, name: scanner.name, installed: installed.available, ready, version: installed.version, reason, checkedAt: installed.checkedAt, requiresNetwork };
  }));
}
