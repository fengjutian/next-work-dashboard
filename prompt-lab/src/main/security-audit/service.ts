import { safeStorage, type WebContents } from 'electron';
import { SecurityScanOrchestrator, buildScanCoverage, builtinScanners, findingsToSarif, mergeWithBaseline, progressFor, resolveScanFiles, type BaselineComparison, type FindingStatus, type ScanRecord, type ScanRequest, type SecurityFinding } from '../../core/security-audit';
import { externalScanners, listExternalScannerAvailability } from './external-scanners';
import { createBaseline, listBaselines, readSecurityAuditData, recordFindingEvent, removeBaseline, writeSecurityAuditData, type StoredSecurityAuditData } from './database';
import { backgroundSemanticScanner } from './worker-client';

const jobs = new Map<string, AbortController>();
const runtimeBuiltinScanners = builtinScanners.map((scanner) => scanner.id === 'semantic-analysis' ? backgroundSemanticScanner : scanner);
const orchestrator = new SecurityScanOrchestrator([...runtimeBuiltinScanners, ...externalScanners]);

function load(): StoredSecurityAuditData { return readSecurityAuditData(); }
function save(data: StoredSecurityAuditData): void { writeSecurityAuditData(data); }

export function getSetting(key: string): string | null {
  const value = load().settings[key];
  if (!value) return null;
  if (key.endsWith('apiKey') && value.startsWith('encrypted:')) {
    try { return safeStorage.decryptString(Buffer.from(value.slice(10), 'base64')); } catch { return null; }
  }
  return value;
}

export function setSetting(key: string, value: string): void {
  if (!/^securityAudit\.(?:ai\.(?:baseUrl|apiKey|model)|sandboxMode)$/.test(key)) throw new Error('INVALID_SETTING');
  const data = load();
  if (key.endsWith('apiKey') && value && !safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
  data.settings[key] = key.endsWith('apiKey') && value
    ? `encrypted:${safeStorage.encryptString(value).toString('base64')}` : value;
  save(data);
}

function lastFindings(data: StoredSecurityAuditData, projectDir: string): SecurityFinding[] {
  return data.scans.find((scan) => scan.projectDir === projectDir && scan.status === 'completed')?.findings ?? [];
}

async function reviewWithAI(findings: SecurityFinding[], signal: AbortSignal, runtime?: ScanRequest['aiConfig']): Promise<SecurityFinding[]> {
  const apiKey = runtime?.apiKey?.trim();
  if (!apiKey || findings.length === 0) return findings;
  const baseUrl = (runtime?.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = new URL(baseUrl);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname))) || endpoint.username || endpoint.password) return findings;
  const model = runtime?.model?.trim() || 'gpt-4o-mini';
  const payload = findings.slice(0, 50).map(({ id, ruleId, title, description, location, evidence }) => ({ id, ruleId, title, description, location, evidence }));
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: '你是安全发现复核员。扫描器是事实来源；你只评估误报，不创造新发现。返回 JSON：{"reviews":[{"id":"...","verdict":"confirmed|likely|uncertain|false-positive","rationale":"简短理由"}]}' }, { role: 'user', content: JSON.stringify(payload) }] }) });
    if (!response.ok) return findings;
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { reviews?: Array<{ id: string; verdict: 'confirmed' | 'likely' | 'uncertain' | 'false-positive'; rationale: string }> };
    const reviews = new Map((parsed.reviews ?? []).map((item) => [item.id, item]));
    return findings.map((finding) => {
      const review = reviews.get(finding.id);
      return review ? { ...finding, aiReview: { verdict: review.verdict, rationale: String(review.rationale).slice(0, 1000), reviewedAt: Date.now() } } : finding;
    });
  } catch { return findings; }
}

export async function startScan(input: ScanRequest, sender: WebContents): Promise<{ jobId: string; projectDir: string }> {
  const jobId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  jobs.set(jobId, controller);
  const record: ScanRecord = { id: jobId, projectDir: input.projectDir, mode: input.mode ?? 'full', baselineRef: input.baselineRef, networkPolicy: input.networkPolicy ?? 'deny', startedAt: Date.now(), status: 'scanning', findings: [], scannerRuns: [] };
  const data = load(); data.scans.unshift(record); data.scans = data.scans.slice(0, 100); save(data);
  const emit = (progress: Parameters<typeof progressFor>[1]): void => { if (!sender.isDestroyed()) sender.send('security-audit:event:progress', { ...progressFor(jobId, progress), projectDir: input.projectDir }); };
  void (async () => {
    try {
      const files = await resolveScanFiles(input.projectDir, input.mode ?? 'full', input.baselineRef);
      const coverage = buildScanCoverage(input.projectDir, files, input.mode ?? 'full', input.baselineRef);
      emit({ phase: 'scanning', percent: 2, message: `已确定 ${files.length} 个扫描文件` });
      const selectedScanners = [...new Set([...builtinScanners.map((scanner) => scanner.id), ...(input.scanners ?? [])])];
      const scanResult = await orchestrator.runDetailed({ projectDir: input.projectDir, files, signal: controller.signal, networkPolicy: input.networkPolicy ?? 'deny', verifySecrets: Boolean(input.verifySecrets), emit }, selectedScanners);
      let findings = scanResult.findings;
      if (input.aiReview) { emit({ phase: 'triaging', percent: 85, message: '系统默认 AI 正在复核确定性扫描结果', findingsCount: findings.length }); findings = await reviewWithAI(findings, controller.signal, input.aiConfig); }
      const current = load();
      findings = mergeWithBaseline(findings, lastFindings(current, input.projectDir), Date.now(), input.mode === 'incremental' ? new Set(files) : undefined);
      const saved = current.scans.find((scan) => scan.id === jobId);
      if (saved) Object.assign(saved, { findings, scannerRuns: scanResult.scannerRuns, coverage, status: 'completed', completedAt: Date.now() });
      save(current);
      emit({ phase: 'completed', percent: 100, message: '扫描完成', findingsCount: findings.filter((item) => item.status !== 'fixed').length });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const current = load(); const saved = current.scans.find((scan) => scan.id === jobId);
      const scannerRuns = error && typeof error === 'object' && 'scannerRuns' in error && Array.isArray(error.scannerRuns) ? error.scannerRuns : [];
      if (saved) Object.assign(saved, { scannerRuns, status: cancelled ? 'cancelled' : 'failed', completedAt: Date.now() });
      save(current);
      emit({ phase: cancelled ? 'cancelled' : 'failed', percent: 100, message: cancelled ? '扫描已取消' : error instanceof Error ? error.message : '扫描失败' });
    } finally { jobs.delete(jobId); }
  })();
  return { jobId, projectDir: input.projectDir };
}

export function cancelScan(jobId: string): boolean { const job = jobs.get(jobId); if (!job) return false; job.abort(); return true; }
export function listFindings(projectDir: string): SecurityFinding[] { return lastFindings(load(), projectDir); }
export function updateFinding(projectDir: string, findingId: string, status: FindingStatus, reason?: string): SecurityFinding {
  const data = load(); const scan = data.scans.find((item) => item.projectDir === projectDir && item.status === 'completed'); const finding = scan?.findings.find((item) => item.id === findingId);
  if (!finding) throw new Error('FINDING_NOT_FOUND');
  finding.status = status;
  finding.suppressed = status === 'false-positive' || status === 'accepted' ? { reason: String(reason ?? '').trim().slice(0, 1000) || status, at: Date.now() } : undefined;
  save(data); recordFindingEvent(projectDir, findingId, status, reason); return finding;
}
export { createBaseline, listBaselines, removeBaseline };
export function compareBaseline(projectDir: string, baselineId: string): BaselineComparison {
  const baseline = listBaselines(projectDir).find((item) => item.id === baselineId); if (!baseline) throw new Error('BASELINE_NOT_FOUND'); const scans = listScans(projectDir); const baselineScan = scans.find((item) => item.id === baseline.scanId); const current = scans.find((item) => item.status === 'completed');
  const before = new Map((baselineScan?.findings ?? []).filter((item) => item.status !== 'fixed').map((item) => [item.fingerprint, item])); const after = new Map((current?.findings ?? []).filter((item) => item.status !== 'fixed').map((item) => [item.fingerprint, item]));
  return { baseline, currentScanId: current?.id, newFindings: [...after.values()].filter((item) => !before.has(item.fingerprint)), fixedFindings: [...before.values()].filter((item) => !after.has(item.fingerprint)), unchangedCount: [...after.keys()].filter((key) => before.has(key)).length };
}
export function listScans(projectDir: string): ScanRecord[] { return load().scans.filter((scan) => scan.projectDir === projectDir); }
export async function listScanners(projectDir?: string, networkPolicy: 'deny' | 'allow' = 'deny', force = false): Promise<import('../../core/security-audit').ScannerStatus[]> {
  const external = await listExternalScannerAvailability(projectDir, networkPolicy, force);
  return [
    ...builtinScanners.map((scanner) => ({ id: scanner.id, name: scanner.name, installed: true, ready: true, builtIn: true, version: '内置', checkedAt: Date.now() })),
    ...external.map((scanner) => ({ ...scanner, builtIn: false })),
  ];
}
export function createSarif(projectDir: string): string { return JSON.stringify(findingsToSarif(listFindings(projectDir), projectDir), null, 2); }
