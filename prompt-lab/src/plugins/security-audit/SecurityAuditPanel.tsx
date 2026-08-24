/**
 * Security Audit — 主面板
 *
 * Phase 1 目标：命令面板触发 → 弹 finding 列表（mock 数据）→ 点 finding 看详情。
 * Phase 2 会把 mock 数据换成真实 deepsec 进程输出流。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Play, ShieldAudit } from '@/components/icons';
import { useStore } from '../../store';
import { Alert, Button, Card, Empty, Modal, Progress, Space, Spin, Tag, ToastHost, message } from './ui';
import { COMMAND_EVENT, type CommandEventDetail, type Finding, type ScanProgress } from './constants';

type SeverityColor = 'red' | 'orange' | 'blue' | 'green';
type ScannerInfo = import('../../core/security-audit').ScannerStatus;
const SCANNER_SELECTION_KEY = 'security-audit:selected-scanners:v1';

function securityAuditErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('No handler registered for') && text.includes('security-audit:')) {
    return 'Security Audit 主进程尚未更新。请完整退出并重新启动应用（仅刷新页面无效）。';
  }
  return text || 'Security Audit 操作失败';
}

const SEVERITY_COLORS: Record<Finding['severity'], SeverityColor> = {
  P0: 'red',
  P1: 'orange',
  P2: 'blue',
  P3: 'green',
};

const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};
const CONFIDENCE_LABEL = { low: '低', medium: '中', high: '高' } as const;
const TRACE_KIND_LABEL = { source: '输入源', propagation: '传播', call: '函数调用', sink: '危险点' } as const;
const EVIDENCE_KIND_LABEL: Record<string, string> = { code: '代码', tool: '扫描工具', dependency: '依赖' };
const FINDING_STATUS_LABEL: Record<string, string> = { open: '待处理', confirmed: '已确认', 'false-positive': '误报', accepted: '已接受风险', fixed: '已修复' };
const SCANNER_STATUS_LABEL: Record<string, string> = { succeeded: '成功', failed: '失败', skipped: '已跳过', cancelled: '已取消' };
function localizeFinding(finding: Finding): Finding {
  if (finding.ruleId !== 'secret.git-history' || finding.secretDetails) return finding;
  const commit = /(?:commit|提交)\s+([a-f0-9]{7,40})/i.exec(`${finding.description} ${finding.evidence?.map((item) => item.excerpt).join(' ') ?? ''}`)?.[1] ?? '未知提交';
  return { ...finding, title: 'Git 历史中发现疑似密钥', description: `提交 ${commit} 中曾加入疑似凭据。扫描器已对密钥脱敏，且不会持久化原始值。`, recommendation: '立即撤销并轮换该凭据，然后按照经过审批的历史重写流程从 Git 历史中移除。', confidenceRationale: finding.secretVerification?.status === 'valid' ? '密钥供应商已确认该脱敏凭据当前仍然有效。' : '该值符合凭据结构并出现在 Git 提交历史中，但尚未确认当前是否有效。', evidence: finding.evidence?.map((item) => ({ ...item, excerpt: `提交 ${commit} 中存在疑似密钥材料` })) };
}

// ── Mock 数据（v1 用，Phase 2 换成 IPC 真实结果） ──

function buildMockFindings(): Finding[] {
  const now = Date.now();
  return [
    {
      id: 'f-001',
      severity: 'P0',
      title: 'SQL 注入风险 — 字符串拼接',
      description: '检测到在数据库查询中使用字符串拼接而非参数化查询，攻击者可通过输入注入恶意 SQL。',
      location: { file: 'src/api/users.ts', line: 42 },
      recommendation: '使用参数化查询（prepared statement）或 ORM 的安全方法替换字符串拼接。',
      ruleId: 'sqli.string-concat',
      detectedAt: now,
    },
    {
      id: 'f-002',
      severity: 'P0',
      title: '硬编码的 API 密钥',
      description: '在源代码中检测到高熵字符串疑似为 API 密钥/Token，存在凭据泄露风险。',
      location: { file: 'src/config/secrets.ts', line: 7 },
      recommendation: '将密钥移至环境变量或密钥管理服务（如 Vercel Env / AWS Secrets Manager），并在 .gitignore 中排除 .env。',
      ruleId: 'secret.hardcoded',
      detectedAt: now,
    },
    {
      id: 'f-003',
      severity: 'P1',
      title: '路径穿越漏洞',
      description: '用户输入未经验证即拼接到文件路径中，可能允许访问预期目录之外的文件。',
      location: { file: 'src/api/files.ts', line: 118 },
      recommendation: '使用 path.resolve 后校验仍在 baseDir 内，或采用白名单允许的目录列表。',
      ruleId: 'path.traversal',
      detectedAt: now,
    },
    {
      id: 'f-004',
      severity: 'P1',
      title: '缺少 CSRF 保护',
      description: '修改状态的端点未检测 CSRF token，存在跨站请求伪造风险。',
      location: { file: 'src/api/account.ts', line: 89 },
      recommendation: '引入 CSRF token 中间件，或改用 SameSite=Strict 的 cookie + Authorization header 模式。',
      ruleId: 'csrf.missing',
      detectedAt: now,
    },
    {
      id: 'f-005',
      severity: 'P2',
      title: '依赖项存在已知漏洞',
      description: 'package.json 引用了 lodash@4.17.20（已知原型污染漏洞 CVE-2021-23337）。',
      location: { file: 'package.json', line: 24 },
      recommendation: '升级到 lodash@4.17.21 或更高版本；CI 接入 npm audit 自动拦截。',
      ruleId: 'dep.vulnerable',
      detectedAt: now,
    },
    {
      id: 'f-006',
      severity: 'P2',
      title: 'console.log 残留',
      description: '检测到 console.log 调用，发布构建前应清理或替换为正式 logger。',
      location: { file: 'src/utils/debug.ts', line: 12 },
      recommendation: '替换为项目统一的 logger（如 winston / pino），并设置 production 环境的 log level。',
      ruleId: 'quality.console-log',
      detectedAt: now,
    },
    {
      id: 'f-007',
      severity: 'P3',
      title: '未使用的导出',
      description: '导出符号 ReactVersion 未在项目其它位置被使用。',
      location: { file: 'src/lib/version.ts', line: 3 },
      recommendation: '删除未使用导出，或补充注释说明保留原因。',
      ruleId: 'quality.dead-code',
      detectedAt: now,
    },
  ];
}

const MOCK_PROGRESS_TIMELINE: ScanProgress[] = [
  { phase: 'scanning', percent: 15, message: '扫描源码文件...' },
  { phase: 'scanning', percent: 45, message: '正则预筛完成，找到 24 个候选点' },
  { phase: 'scanning', percent: 70, message: 'AI agent 深度调查...' },
  { phase: 'triaging', percent: 90, message: '便宜模型分流 P0/P1/P2...' },
  { phase: 'completed', percent: 100, message: '扫描完成' },
];

// ── 主面板 ──

export function SecurityAuditPanel(): JSX.Element {
  const aiApi = useStore((state) => state.aiApi);
  const [progress, setProgress] = useState<ScanProgress>({ phase: 'idle', percent: 0, message: '待扫描' });
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [scannedDir, setScannedDir] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Finding['severity'] | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suppressed' | 'fixed'>('active');
  const [categoryFilter, setCategoryFilter] = useState<'all' | NonNullable<Finding['category']>>('all');
  const [findingQuery, setFindingQuery] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'full' | 'incremental'>('full');
  const [baselineRef, setBaselineRef] = useState('HEAD');
  const [commandScanRequested, setCommandScanRequested] = useState(false);
  const [scanners, setScanners] = useState<ScannerInfo[]>([]);
  const [selectedScanners, setSelectedScanners] = useState<string[]>([]);
  const [scannerStateReady, setScannerStateReady] = useState(false);
  const [scannerDetectionRunning, setScannerDetectionRunning] = useState(false);
  const [networkAllowed, setNetworkAllowed] = useState(false);
  const [verifySecrets, setVerifySecrets] = useState(false);
  const [scannerRuns, setScannerRuns] = useState<import('../../core/security-audit').ScannerRunResult[]>([]);
  const [lastScan, setLastScan] = useState<import('../../core/security-audit').ScanRecord | null>(null);
  const [baselines, setBaselines] = useState<import('../../core/security-audit').SecurityBaseline[]>([]);
  const [baselineComparison, setBaselineComparison] = useState<import('../../core/security-audit').BaselineComparison | null>(null);

  const loadScanners = useCallback((force = false) => {
    setScannerDetectionRunning(true);
    void window.electronAPI.securityAudit.scanners.list({ projectDir: scannedDir ?? undefined, networkPolicy: networkAllowed ? 'allow' : 'deny', force }).then((items) => {
      setScanners(items);
      let saved: string[] = [];
      try { saved = JSON.parse(localStorage.getItem(SCANNER_SELECTION_KEY) ?? '[]') as string[]; } catch { saved = []; }
      const available = new Set(items.filter((item) => item.ready).map((item) => item.id));
      const defaults = items.filter((item) => item.ready && (item.builtIn || saved.length === 0 || saved.includes(item.id))).map((item) => item.id);
      setSelectedScanners(defaults.filter((id) => available.has(id)));
      setScannerStateReady(true);
    }).catch((error: unknown) => message.warning(`扫描器检测失败：${securityAuditErrorMessage(error)}`)).finally(() => setScannerDetectionRunning(false));
  }, [networkAllowed, scannedDir]);

  useEffect(() => {
    loadScanners();
  }, [loadScanners]);

  useEffect(() => { if (scannedDir) void window.electronAPI.securityAudit.baselines.list(scannedDir).then(setBaselines); else setBaselines([]); }, [scannedDir]);

  useEffect(() => {
    if (scannerStateReady) localStorage.setItem(SCANNER_SELECTION_KEY, JSON.stringify(selectedScanners));
  }, [scannerStateReady, selectedScanners]);

  // 监听命令面板触发的命令（"Security Scan" 等）
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CommandEventDetail>).detail;
      if (detail.command === 'run-scan') {
        setCommandScanRequested(true);
      } else if (detail.command === 'show-finding') {
        const f = findings?.find((x) => x.id === detail.findingId);
        if (f) setActiveFinding(f);
      }
    };
    window.addEventListener(COMMAND_EVENT, handler);
    return () => window.removeEventListener(COMMAND_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings]);

  // 监听主进程真实扫描进度，并在完成后读取持久化结果。
  useEffect(() => {
    const api = window.electronAPI?.securityAudit;
    if (!api) return undefined;
    return api.scan.onProgress((detail) => {
      setProgress(detail);
      const resultDir = detail.projectDir ?? scannedDir;
      if (detail.phase === 'completed' && resultDir) {
        setScannedDir(resultDir);
        void api.findings.list(resultDir).then((items) => setFindings(items.map((item) => localizeFinding({ ...item, detectedAt: item.lastSeenAt }))));
      }
      if (resultDir && ['completed', 'failed', 'cancelled'].includes(detail.phase)) void api.scans.list(resultDir).then((items) => { setScannerRuns(items[0]?.scannerRuns ?? []); setLastScan(items[0] ?? null); });
    });
  }, [scannedDir]);

  const runMockScan = useCallback(async () => {
    setFindings(null);
    setScannerRuns([]);
    setScannedDir(null);
    setProgress({ phase: 'scanning', percent: 0, message: '准备扫描...' });

    // 模拟进度推进（Phase 2 会被真实 stream 替代）
    for (const step of MOCK_PROGRESS_TIMELINE) {
      setProgress(step);
      await new Promise((r) => setTimeout(r, 600));
    }

    const mock = buildMockFindings();
    setFindings(mock);
    setScannedDir('/mock/project/src');
    message.success(`扫描完成：发现 ${mock.length} 个问题`);
  }, []);

  const runScan = useCallback(() => {
    const api = window.electronAPI?.securityAudit;
    if (!api) { void runMockScan(); return; }
    setFindings(null);
    setProgress({ phase: 'scanning', percent: 0, message: '请选择项目目录…' });
    void api.scan.start({ projectDir: scannedDir ?? '', mode: scanMode, baselineRef, scanners: selectedScanners, networkPolicy: networkAllowed ? 'allow' : 'deny', verifySecrets: networkAllowed && verifySecrets, aiReview: true, aiConfig: { baseUrl: aiApi.baseUrl, apiKey: aiApi.apiKey, model: aiApi.model } }).then((result) => {
      if (!result.ok || !result.projectDir || !result.jobId) { setProgress({ phase: 'idle', percent: 0, message: '已取消' }); return; }
      setScannedDir(result.projectDir);
      setJobId(result.jobId);
    }).catch((error: unknown) => setProgress({ phase: 'failed', percent: 100, message: securityAuditErrorMessage(error) }));
  }, [aiApi.apiKey, aiApi.baseUrl, aiApi.model, baselineRef, networkAllowed, runMockScan, scanMode, scannedDir, selectedScanners, verifySecrets]);

  const selectProject = useCallback(() => {
    void window.electronAPI.securityAudit.project.select().then((result) => {
      if (result.ok && result.projectDir) {
        setScannedDir(result.projectDir);
        setFindings(null);
        setProgress({ phase: 'idle', percent: 0, message: '项目已选择' });
      }
    }).catch((error: unknown) => message.warning(securityAuditErrorMessage(error)));
  }, []);

  const updateFindingStatus = useCallback((finding: Finding, status: import('../../core/security-audit').FindingStatus) => {
    if (!scannedDir) return;
    const reason = status === 'false-positive' || status === 'accepted' ? window.prompt(status === 'false-positive' ? '请输入误报原因' : '请输入接受风险的原因') : undefined;
    if ((status === 'false-positive' || status === 'accepted') && reason === null) return;
    void window.electronAPI.securityAudit.findings.update({ projectDir: scannedDir, findingId: finding.id, status, reason }).then((updated) => {
      const next = localizeFinding({ ...updated, detectedAt: updated.lastSeenAt });
      setFindings((current) => current?.map((item) => item.id === updated.id ? next : item) ?? null);
      setActiveFinding((current) => current?.id === updated.id ? next : current);
      message.success('发现项状态已更新');
    }).catch((error: unknown) => message.warning(securityAuditErrorMessage(error)));
  }, [scannedDir]);

  const addBaseline = useCallback(() => {
    if (!scannedDir) return; const name = window.prompt('基线名称'); if (!name) return;
    void window.electronAPI.securityAudit.baselines.create({ projectDir: scannedDir, name, gitRef: baselineRef || 'HEAD', scanId: lastScan?.id }).then((item) => { setBaselines((current) => [item, ...current.filter((entry) => entry.id !== item.id)]); message.success('基线已创建'); }).catch((error: unknown) => message.warning(securityAuditErrorMessage(error)));
  }, [baselineRef, lastScan?.id, scannedDir]);
  const deleteSelectedBaseline = useCallback(() => { const item = baselines.find((entry) => entry.gitRef === baselineRef); if (!scannedDir || !item || !window.confirm(`删除基线“${item.name}”？`)) return; void window.electronAPI.securityAudit.baselines.remove({ projectDir: scannedDir, id: item.id }).then(() => { setBaselines((current) => current.filter((entry) => entry.id !== item.id)); setBaselineRef('HEAD'); }); }, [baselineRef, baselines, scannedDir]);
  const compareSelectedBaseline = useCallback(() => { const item = baselines.find((entry) => entry.gitRef === baselineRef); if (!scannedDir || !item) return; void window.electronAPI.securityAudit.baselines.compare({ projectDir: scannedDir, id: item.id }).then(setBaselineComparison).catch((error: unknown) => message.warning(securityAuditErrorMessage(error))); }, [baselineRef, baselines, scannedDir]);

  useEffect(() => {
    if (!commandScanRequested) return;
    setCommandScanRequested(false);
    runScan();
  }, [commandScanRequested, runScan]);

  const sortedFindings = findings
    ? [...findings].sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity])
    : [];
  const filteredFindings = sortedFindings.filter((finding) => {
    if (severityFilter !== 'all' && finding.severity !== severityFilter) return false;
    if (categoryFilter !== 'all' && finding.category !== categoryFilter) return false;
    if (statusFilter === 'active' && ['false-positive', 'accepted', 'fixed'].includes(finding.status ?? 'open')) return false;
    if (statusFilter === 'suppressed' && !['false-positive', 'accepted'].includes(finding.status ?? 'open')) return false;
    if (statusFilter === 'fixed' && finding.status !== 'fixed') return false;
    const query = findingQuery.trim().toLowerCase(); return !query || `${finding.title} ${finding.ruleId ?? ''} ${finding.location.file}`.toLowerCase().includes(query);
  });

  const counts = findings
    ? (['P0', 'P1', 'P2', 'P3'] as const).reduce<Record<Finding['severity'], number>>(
        (acc, s) => {
          acc[s] = findings.filter((f) => f.severity === s).length;
          return acc;
        },
        { P0: 0, P1: 0, P2: 0, P3: 0 },
      )
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        <Space>
          <ShieldAudit className="h-4 w-4" />
          <span className="text-sm font-semibold">Security Audit</span>
          {scannedDir && <Tag>{scannedDir}</Tag>}
        </Space>
        <Space>
          <Button icon={<FolderOpen size={14} />} onClick={selectProject} disabled={progress.phase === 'scanning' || progress.phase === 'triaging'}>
            {scannedDir ? '切换项目' : '选择项目'}
          </Button>
          <select className="h-8 rounded border border-border bg-background px-2 text-xs" value={scanMode} onChange={(event) => setScanMode(event.target.value as 'full' | 'incremental')} disabled={progress.phase === 'scanning' || progress.phase === 'triaging'}>
            <option value="incremental">增量扫描</option>
            <option value="full">全文件扫描</option>
          </select>
          {scanMode === 'incremental' && <select aria-label="扫描基线" className="h-8 w-36 rounded border border-border bg-background px-2 text-xs" value={baselineRef} onChange={(event) => setBaselineRef(event.target.value)} disabled={progress.phase === 'scanning' || progress.phase === 'triaging'}><option value="HEAD">HEAD</option>{baselines.map((item) => <option key={item.id} value={item.gitRef}>{item.name} · {item.gitRef}</option>)}</select>}
          {scannedDir && <Button onClick={addBaseline}>保存基线</Button>}
          {scanMode === 'incremental' && baselines.some((item) => item.gitRef === baselineRef) && <Button onClick={deleteSelectedBaseline}>删除基线</Button>}
          {scanMode === 'incremental' && baselines.some((item) => item.gitRef === baselineRef) && <Button onClick={compareSelectedBaseline}>对比基线</Button>}
          {(progress.phase === 'scanning' || progress.phase === 'triaging') && jobId && <Button onClick={() => { void window.electronAPI.securityAudit.scan.cancel(jobId); }}>取消</Button>}
          {scannedDir && findings && <Button onClick={() => { void window.electronAPI.securityAudit.report.exportSarif(scannedDir).then((result) => { if (result.ok) message.success(`SARIF 已导出：${result.filePath}`); }); }}>导出 SARIF</Button>}
          <Button icon={<Play size={14} />} type="primary" onClick={runScan} loading={progress.phase === 'scanning' || progress.phase === 'triaging'}>
            扫描项目
          </Button>
        </Space>
      </header>

      {scanners.length > 0 && <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-muted/20 px-5 py-2 text-[11px]">
        <span className="shrink-0 text-muted-foreground">扫描引擎</span>
        {scanners.map((scanner) => <label key={scanner.id} className={`flex shrink-0 items-center gap-1 rounded border px-2 py-1 ${scanner.ready ? 'border-border bg-card' : 'cursor-not-allowed border-border/50 text-muted-foreground opacity-60'}`} title={scanner.ready ? `${scanner.name}${scanner.version ? ` · ${scanner.version}` : ''}` : `${scanner.name}${scanner.installed ? ' 未就绪' : ' 未安装'}${scanner.reason ? `：${scanner.reason}` : ''}`}>
          <input type="checkbox" checked={selectedScanners.includes(scanner.id)} disabled={!scanner.ready || scanner.builtIn || progress.phase === 'scanning' || progress.phase === 'triaging'} onChange={(event) => setSelectedScanners((current) => event.target.checked ? [...current, scanner.id] : current.filter((id) => id !== scanner.id))} />
          {scanner.name}{scanner.builtIn ? '（内置）' : scanner.ready ? '' : scanner.installed ? '（未就绪）' : '（未安装）'}
        </label>)}
        <label className="flex shrink-0 items-center gap-1 rounded border border-orange-300 bg-orange-50 px-2 py-1 text-orange-800"><input type="checkbox" checked={networkAllowed} disabled={progress.phase === 'scanning' || progress.phase === 'triaging'} onChange={(event) => setNetworkAllowed(event.target.checked)} />允许扫描器联网（OSV/Trivy）</label>
        <label className="flex shrink-0 items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800" title="仅对支持的供应商执行只读验证；凭据不会保存或发送给 AI"><input type="checkbox" checked={verifySecrets} disabled={!networkAllowed || progress.phase === 'scanning' || progress.phase === 'triaging'} onChange={(event) => setVerifySecrets(event.target.checked)} />验证密钥有效性</label>
        <Button className="ml-auto shrink-0" loading={scannerDetectionRunning} onClick={() => loadScanners(true)}>重新检测</Button>
      </div>}

      {scannerRuns.length > 0 && <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-5 py-2 text-[11px]">
        <span className="shrink-0 text-muted-foreground">本次运行</span>
        {scannerRuns.map((run) => <Tag key={`${run.scannerId}:${run.startedAt}`} color={run.status === 'succeeded' ? 'green' : run.status === 'failed' ? 'red' : run.status === 'cancelled' ? 'orange' : 'blue'}>{run.name}: {SCANNER_STATUS_LABEL[run.status]} · {run.findingsCount} 项 · {run.durationMs}ms{run.exitCode !== undefined ? ` · 退出码 ${run.exitCode}` : ''}</Tag>)}
      </div>}

      {lastScan?.coverage && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-5 py-2 text-[11px]">
        <span className="font-medium">扫描覆盖</span>
        <Tag color={lastScan.coverage.skippedFiles ? 'orange' : 'green'}>{lastScan.coverage.scannedFiles}/{lastScan.coverage.discoveredFiles} 文件</Tag>
        <Tag>{(lastScan.coverage.scannedBytes / 1024).toFixed(1)} KB</Tag>
        <Tag color={lastScan.coverage.mode === 'full' ? 'green' : 'blue'}>{lastScan.coverage.mode === 'full' ? '全文件范围' : `增量范围 · ${lastScan.coverage.baselineRef ?? 'HEAD'}`}</Tag>
        <Tag color={lastScan.coverage.capability === 'full' ? 'green' : lastScan.coverage.capability === 'partial' ? 'orange' : 'red'}>{lastScan.coverage.capability === 'full' ? '能力覆盖完整' : lastScan.coverage.capability === 'partial' ? '能力覆盖部分' : '能力覆盖有限'}</Tag>
        {Object.entries(lastScan.coverage.languages).map(([name, count]) => <Tag key={name}>{name} {count}</Tag>)}
        {lastScan.coverage.frameworks.map((name) => <Tag key={name} color="purple">{name}</Tag>)}
      </div>}
      {lastScan?.coverage && lastScan.coverage.capability !== 'full' && <div className="shrink-0 border-b border-border px-5 py-2"><Alert type="warning" message="本次结果不代表完整安全审计" description={lastScan.coverage.capabilitySummary} /></div>}
      {baselineComparison && <div className="flex shrink-0 items-center gap-2 border-b border-border bg-blue-50 px-5 py-2 text-xs text-blue-900"><strong>{baselineComparison.baseline.name}</strong><Tag color="red">新增 {baselineComparison.newFindings.length}</Tag><Tag color="green">修复 {baselineComparison.fixedFindings.length}</Tag><Tag>未变化 {baselineComparison.unchangedCount}</Tag><Button className="ml-auto" onClick={() => setBaselineComparison(null)}>关闭</Button></div>}

      {/* Progress */}
      {progress.phase !== 'idle' && (
        <div className="shrink-0 border-b border-border bg-muted/40 px-5 py-3">
          <Space direction="vertical" size="middle" className="w-full">
            <Space className="w-full" style={{ justifyContent: 'space-between' }}>
              <span className="text-xs text-muted-foreground">{progress.message}</span>
              <span className="text-xs text-muted-foreground">{progress.percent}%</span>
            </Space>
            <Progress percent={progress.percent} />
          </Space>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!findings && progress.phase === 'idle' && (
          <Empty
            description={
              <Space direction="vertical" size="small" className="items-center">
                <span>命令面板输入 <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Security Scan</code> 或点上方按钮开始扫描</span>
                <span className="text-[11px] text-muted-foreground">内置规则始终可用；已安装的 Semgrep、Gitleaks、OSV-Scanner、Trivy 可按需启用</span>
              </Space>
            }
          />
        )}

        {(progress.phase === 'scanning' || progress.phase === 'triaging') && !findings && (
          <div className="grid place-items-center py-16">
            <Spin tip="扫描中..." />
          </div>
        )}

        {findings && counts && (
          <Space direction="vertical" size="middle" className="w-full">
            {/* 严重度统计 */}
            <Space size="small" wrap>
              {(['P0', 'P1', 'P2', 'P3'] as const).map((s) => (
                <Tag key={s} color={SEVERITY_COLORS[s]}>
                  {s}: {counts[s]}
                </Tag>
              ))}
              <Tag color="purple">共 {findings.length}</Tag>
            </Space>
            <Space size="small" wrap>
              <input aria-label="搜索发现项" className="h-8 w-56 rounded border border-border bg-background px-2 text-xs" value={findingQuery} onChange={(event) => setFindingQuery(event.target.value)} placeholder="搜索标题、规则或文件" />
              <select aria-label="状态筛选" className="h-8 rounded border border-border bg-background px-2 text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="active">活动问题</option><option value="all">全部状态</option><option value="suppressed">误报/接受风险</option><option value="fixed">已修复</option></select>
              <select aria-label="类别筛选" className="h-8 rounded border border-border bg-background px-2 text-xs" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}><option value="all">全部类别</option><option value="sast">SAST</option><option value="sca">依赖</option><option value="secret">密钥</option><option value="iac">IaC</option><option value="config">配置</option></select>
              <Tag>{filteredFindings.length}/{findings.length}</Tag>
            </Space>

            {/* 过滤 */}
            <Space size="small" wrap>
              {(['all', 'P0', 'P1', 'P2', 'P3'] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSeverityFilter(s)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                    severityFilter === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  {s === 'all' ? '全部' : s}
                </button>
              ))}
            </Space>

            {/* 列表 */}
            {filteredFindings.length === 0 ? (
              <Empty description="当前过滤条件下没有问题" />
            ) : (
              <Space direction="vertical" size="small" className="w-full">
                {filteredFindings.map((f) => (
                  <Card
                    key={f.id}
                    hoverable
                    onClick={() => setActiveFinding(f)}
                    className="w-full"
                  >
                    <div className="flex items-start gap-3">
                      <Tag color={SEVERITY_COLORS[f.severity]}>{f.severity}</Tag>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{f.title}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FolderOpen size={11} />
                          <span className="truncate">
                            {f.location.file}:{f.location.line}
                          </span>
                          {f.ruleId && <span className="ml-2 rounded bg-muted px-1 text-[10px]">{f.ruleId}</span>}
                          {f.confidence && <span className="ml-2">置信度 {CONFIDENCE_LABEL[f.confidence]}</span>}
                          {f.status && f.status !== 'open' && <span className="ml-2">· {FINDING_STATUS_LABEL[f.status] ?? f.status}</span>}
                          {f.secretDetails && <span className="ml-2">· 当前{f.secretDetails.currentExists ? '存在' : '不存在'} · 历史{f.secretDetails.historyExists ? '存在' : '不存在'} · 重复 {f.secretDetails.occurrences} 次 · 验证{f.secretVerification?.status === 'valid' ? '有效' : f.secretVerification?.status === 'invalid' ? '无效' : '未确认'}</span>}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </Space>
            )}

            {progress.phase === 'completed' && (
              <Alert
                type="success"
                message="扫描完成"
                description={`共发现 ${findings.length} 个问题，其中 P0 ${counts.P0} 个 / P1 ${counts.P1} 个。点击任意条目查看详情和修复建议。`}
              />
            )}
          </Space>
        )}

        {progress.phase === 'failed' && (
          <Alert
            type="error"
            message="扫描失败"
            description="请确认已选择并授权项目目录；AI 复核会自动使用系统默认 AI 配置。"
          />
        )}
      </div>

      {/* 详情 modal */}
      <Modal
        open={!!activeFinding}
        onCancel={() => setActiveFinding(null)}
        onOk={() => setActiveFinding(null)}
        title={activeFinding ? (
          <Space>
            {activeFinding && <Tag color={SEVERITY_COLORS[activeFinding.severity]}>{activeFinding.severity}</Tag>}
            <span>{activeFinding?.title}</span>
          </Space>
        ) : null}
        width={640}
        okText="关闭"
        cancelText={null}
        footer={null}
      >
        {activeFinding && (
          <Space direction="vertical" size="middle" className="w-full">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">位置</div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                {activeFinding.location.file}:{activeFinding.location.line}
                {activeFinding.location.column !== undefined && `:${activeFinding.location.column}`}
              </div>
              {scannedDir && <Button className="mt-2" onClick={() => { void window.electronAPI.codeVisualizer.source.openExternal(scannedDir, activeFinding.location.file, activeFinding.location.line); }}>在编辑器中打开</Button>}
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">描述</div>
              <div className="text-sm leading-relaxed">{activeFinding.description}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">修复建议</div>
              <div className="text-sm leading-relaxed">{activeFinding.recommendation}</div>
            </div>
            {activeFinding.evidence && activeFinding.evidence.length > 0 && <div><div className="mb-1 text-xs text-muted-foreground">证据</div>{activeFinding.evidence.map((item, index) => <pre key={`${item.kind}:${index}`} className="overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs"><Tag>{EVIDENCE_KIND_LABEL[item.kind] ?? item.kind}</Tag>{' '}{item.excerpt}</pre>)}</div>}
            {activeFinding.ruleId && (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">规则</div>
                <Tag color="purple">{activeFinding.ruleId}</Tag>
              </div>
            )}
            {activeFinding.trace && activeFinding.trace.length > 0 && <div><div className="mb-1 text-xs text-muted-foreground">数据流 / 调用路径</div><div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">{activeFinding.trace.map((step, index) => <div key={`${step.kind}:${step.location.file}:${step.location.line}:${index}`} className="font-mono text-xs"><Tag color={step.kind === 'source' ? 'blue' : step.kind === 'sink' ? 'red' : 'purple'}>{TRACE_KIND_LABEL[step.kind]}</Tag> {step.label} <span className="text-muted-foreground">— {step.location.file}:{step.location.line}</span></div>)}</div></div>}
            {activeFinding.suppressed && <Alert type="warning" message={FINDING_STATUS_LABEL[activeFinding.status ?? 'open']} description={activeFinding.suppressed.reason} />}
            {activeFinding.secretVerification && <Alert type={activeFinding.secretVerification.status === 'valid' ? 'error' : 'info'} message={`密钥验证：${activeFinding.secretVerification.status}`} description={`${activeFinding.secretVerification.provider} · ${new Date(activeFinding.secretVerification.checkedAt).toLocaleString()}`} />}
            {activeFinding.secretDetails && <div><div className="mb-1 text-xs text-muted-foreground">密钥状态</div><Space wrap><Tag color={activeFinding.secretDetails.currentExists ? 'red' : 'green'}>当前代码：{activeFinding.secretDetails.currentExists ? '存在' : '不存在'}</Tag><Tag color={activeFinding.secretDetails.historyExists ? 'orange' : 'green'}>Git 历史：{activeFinding.secretDetails.historyExists ? '存在' : '不存在'}</Tag><Tag>重复 {activeFinding.secretDetails.occurrences} 次</Tag><Tag>位置 {activeFinding.secretDetails.locations.length} 个</Tag><Tag>验证：{activeFinding.secretVerification?.status === 'valid' ? '有效' : activeFinding.secretVerification?.status === 'invalid' ? '无效' : '未确认'}</Tag></Space></div>}
            {activeFinding.confidenceRationale && <Alert type="info" message={`置信度：${activeFinding.confidence ? CONFIDENCE_LABEL[activeFinding.confidence] : '未知'}`} description={activeFinding.confidenceRationale} />}
            <Space wrap>
              <Button onClick={() => updateFindingStatus(activeFinding, 'confirmed')}>确认问题</Button>
              <Button onClick={() => updateFindingStatus(activeFinding, 'false-positive')}>标记误报</Button>
              <Button onClick={() => updateFindingStatus(activeFinding, 'accepted')}>接受风险</Button>
              {activeFinding.status !== 'open' && <Button onClick={() => updateFindingStatus(activeFinding, 'open')}>重新打开</Button>}
            </Space>
            {activeFinding.aiReview && <div><div className="mb-1 text-xs text-muted-foreground">AI 复核（辅助判断）</div><Alert type={activeFinding.aiReview.verdict === 'false-positive' ? 'warning' : 'info'} message={activeFinding.aiReview.verdict} description={activeFinding.aiReview.rationale} /></div>}
          </Space>
        )}
      </Modal>

      <ToastHost />
    </div>
  );
}
