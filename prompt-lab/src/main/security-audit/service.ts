import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage, type WebContents } from 'electron';
import { SecurityScanOrchestrator, builtinScanners, mergeWithBaseline, progressFor, resolveScanFiles, type ScanRecord, type ScanRequest, type SecurityFinding } from '../../core/security-audit';

interface StoredData { version: 1; settings: Record<string, string>; scans: ScanRecord[] }
const jobs = new Map<string, AbortController>();
const orchestrator = new SecurityScanOrchestrator(builtinScanners);

function storageFile(): string { return path.join(app.getPath('userData'), 'security-audit', 'data.json'); }
function load(): StoredData {
  try { return JSON.parse(fs.readFileSync(storageFile(), 'utf8')) as StoredData; } catch { return { version: 1, settings: {}, scans: [] }; }
}
function save(data: StoredData): void {
  fs.mkdirSync(path.dirname(storageFile()), { recursive: true });
  const temporary = `${storageFile()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, storageFile());
}

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
  data.settings[key] = key.endsWith('apiKey') && value && safeStorage.isEncryptionAvailable()
    ? `encrypted:${safeStorage.encryptString(value).toString('base64')}` : value;
  save(data);
}

function lastFindings(data: StoredData, projectDir: string): SecurityFinding[] {
  return data.scans.find((scan) => scan.projectDir === projectDir && scan.status === 'completed')?.findings ?? [];
}

async function reviewWithAI(findings: SecurityFinding[], signal: AbortSignal): Promise<SecurityFinding[]> {
  const apiKey = getSetting('securityAudit.ai.apiKey');
  if (!apiKey || findings.length === 0) return findings;
  const baseUrl = (getSetting('securityAudit.ai.baseUrl') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = getSetting('securityAudit.ai.model') ?? 'gpt-4o-mini';
  const payload = findings.slice(0, 50).map(({ id, ruleId, title, description, location, evidence }) => ({ id, ruleId, title, description, location, evidence }));
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: '你是安全发现复核员。扫描器是事实来源；你只评估误报，不创造新发现。返回 JSON：{"reviews":[{"id":"...","verdict":"confirmed|likely|uncertain|false-positive","rationale":"简短理由"}]}' }, { role: 'user', content: JSON.stringify(payload) }] }) });
    if (!response.ok) return findings;
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { reviews?: Array<{ id: string; verdict: SecurityFinding['aiReview'] extends infer R ? R extends { verdict: infer V } ? V : never : never; rationale: string }> };
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
  const record: ScanRecord = { id: jobId, projectDir: input.projectDir, mode: input.mode ?? 'full', baselineRef: input.baselineRef, startedAt: Date.now(), status: 'scanning', findings: [] };
  const data = load(); data.scans.unshift(record); data.scans = data.scans.slice(0, 100); save(data);
  const emit = (progress: Parameters<typeof progressFor>[1]): void => { if (!sender.isDestroyed()) sender.send('security-audit:event:progress', progressFor(jobId, progress)); };
  void (async () => {
    try {
      const files = await resolveScanFiles(input.projectDir, input.mode ?? 'full', input.baselineRef);
      emit({ phase: 'scanning', percent: 2, message: `已确定 ${files.length} 个扫描文件` });
      let findings = await orchestrator.run({ projectDir: input.projectDir, files, signal: controller.signal, emit }, input.scanners);
      if (input.aiReview) { emit({ phase: 'triaging', percent: 85, message: 'AI 正在复核确定性扫描结果', findingsCount: findings.length }); findings = await reviewWithAI(findings, controller.signal); }
      const current = load();
      findings = mergeWithBaseline(findings, lastFindings(current, input.projectDir));
      const saved = current.scans.find((scan) => scan.id === jobId);
      if (saved) Object.assign(saved, { findings, status: 'completed', completedAt: Date.now() });
      save(current);
      emit({ phase: 'completed', percent: 100, message: '扫描完成', findingsCount: findings.filter((item) => item.status !== 'fixed').length });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const current = load(); const saved = current.scans.find((scan) => scan.id === jobId);
      if (saved) Object.assign(saved, { status: cancelled ? 'cancelled' : 'failed', completedAt: Date.now() });
      save(current);
      emit({ phase: cancelled ? 'cancelled' : 'failed', percent: 100, message: cancelled ? '扫描已取消' : error instanceof Error ? error.message : '扫描失败' });
    } finally { jobs.delete(jobId); }
  })();
  return { jobId, projectDir: input.projectDir };
}

export function cancelScan(jobId: string): boolean { const job = jobs.get(jobId); if (!job) return false; job.abort(); return true; }
export function listFindings(projectDir: string): SecurityFinding[] { return lastFindings(load(), projectDir); }
export function listScans(projectDir: string): ScanRecord[] { return load().scans.filter((scan) => scan.projectDir === projectDir); }
