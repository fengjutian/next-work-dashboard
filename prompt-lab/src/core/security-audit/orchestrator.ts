import type { ScannerRunResult, ScanContext, ScanProgress, SecurityFinding, SecurityScanner } from './types';
import { applyInlineSuppressions } from './security';
import { correlateSecretFindings } from './secret-analysis';

export class SecurityScanOrchestrator {
  constructor(private readonly scanners: SecurityScanner[]) {}

  async run(context: ScanContext, selected?: string[]): Promise<SecurityFinding[]> {
    return (await this.runDetailed(context, selected)).findings;
  }

  async runDetailed(context: ScanContext, selected?: string[]): Promise<{ findings: SecurityFinding[]; scannerRuns: ScannerRunResult[] }> {
    const candidates = selected?.length ? this.scanners.filter((scanner) => selected.includes(scanner.id)) : this.scanners;
    const enabled: SecurityScanner[] = [];
    const scannerRuns: ScannerRunResult[] = [];
    for (const scanner of candidates) {
      const detectedAt = Date.now();
      if (await scanner.detect(context)) enabled.push(scanner);
      else scannerRuns.push({ scannerId: scanner.id, name: scanner.name, status: 'skipped', startedAt: detectedAt, completedAt: Date.now(), durationMs: Date.now() - detectedAt, findingsCount: 0, version: scanner.version, reason: scanner.skipReason ?? '未安装或未满足项目就绪条件' });
    }
    const findings: SecurityFinding[] = [];
    for (let index = 0; index < enabled.length; index += 1) {
      if (context.signal.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const scanner = enabled[index];
      const startedAt = Date.now();
      context.emit({ phase: 'scanning', percent: Math.round((index / Math.max(enabled.length, 1)) * 80), message: `正在运行 ${scanner.name}`, findingsCount: findings.length });
      try {
        const scannerFindings = await scanner.scan(context);
        findings.push(...scannerFindings);
        scannerRuns.push({ scannerId: scanner.id, name: scanner.name, status: 'succeeded', startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, findingsCount: scannerFindings.length, version: scanner.version, exitCode: scanner.lastExitCode });
      } catch (error) {
        if (context.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          scannerRuns.push({ scannerId: scanner.id, name: scanner.name, status: 'cancelled', startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, findingsCount: 0, version: scanner.version, reason: '用户取消' });
          if (error && typeof error === 'object') Object.assign(error, { scannerRuns });
          throw error;
        }
        const exitCode = error && typeof error === 'object' && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : undefined;
        scannerRuns.push({ scannerId: scanner.id, name: scanner.name, status: 'failed', startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, findingsCount: 0, version: scanner.version, exitCode, reason: error instanceof Error ? error.message : '未知错误' });
        context.emit({ phase: 'scanning', percent: Math.round(((index + 1) / Math.max(enabled.length, 1)) * 80), message: `${scanner.name} 不可用，已跳过：${error instanceof Error ? error.message : '未知错误'}`, findingsCount: findings.length });
      }
    }
    const unique = new Map(correlateSecretFindings(findings).map((finding) => [finding.fingerprint, finding]));
    return { findings: applyInlineSuppressions(context.projectDir, [...unique.values()]), scannerRuns };
  }
}

export function progressFor(jobId: string, progress: Omit<ScanProgress, 'jobId'>): ScanProgress { return { jobId, ...progress }; }
