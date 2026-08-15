import type { ScanContext, ScanProgress, SecurityFinding, SecurityScanner } from './types';

export class SecurityScanOrchestrator {
  constructor(private readonly scanners: SecurityScanner[]) {}

  async run(context: ScanContext, selected?: string[]): Promise<SecurityFinding[]> {
    const candidates = selected?.length ? this.scanners.filter((scanner) => selected.includes(scanner.id)) : this.scanners;
    const enabled: SecurityScanner[] = [];
    for (const scanner of candidates) if (await scanner.detect(context)) enabled.push(scanner);
    const findings: SecurityFinding[] = [];
    for (let index = 0; index < enabled.length; index += 1) {
      if (context.signal.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const scanner = enabled[index];
      context.emit({ phase: 'scanning', percent: Math.round((index / Math.max(enabled.length, 1)) * 80), message: `正在运行 ${scanner.name}`, findingsCount: findings.length });
      findings.push(...await scanner.scan(context));
    }
    const unique = new Map(findings.map((finding) => [finding.fingerprint, finding]));
    return [...unique.values()];
  }
}

export function progressFor(jobId: string, progress: Omit<ScanProgress, 'jobId'>): ScanProgress { return { jobId, ...progress }; }
