/**
 * Security Audit — 主面板
 *
 * Phase 1 目标：命令面板触发 → 弹 finding 列表（mock 数据）→ 点 finding 看详情。
 * Phase 2 会把 mock 数据换成真实 deepsec 进程输出流。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Play, Shield, X } from '@/components/icons';
import { Alert, Button, Card, Empty, Modal, Progress, Space, Spin, Tag, ToastHost, message } from './ui';
import { COMMAND_EVENT, type CommandEventDetail, type Finding, type ScanPhase, type ScanProgress } from './constants';

type SeverityColor = 'red' | 'orange' | 'blue' | 'green';

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
  const [progress, setProgress] = useState<ScanProgress>({ phase: 'idle', percent: 0, message: '待扫描' });
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [scannedDir, setScannedDir] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Finding['severity'] | 'all'>('all');

  // 监听命令面板触发的命令（"Security Scan" 等）
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CommandEventDetail>).detail;
      if (detail.command === 'run-scan') {
        void runMockScan();
      } else if (detail.command === 'show-finding') {
        const f = findings?.find((x) => x.id === detail.findingId);
        if (f) setActiveFinding(f);
      }
    };
    window.addEventListener(COMMAND_EVENT, handler);
    return () => window.removeEventListener(COMMAND_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings]);

  // 监听 IPC 进度事件（Phase 2 启用，v1 stub 备用）
  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<ScanProgress>).detail;
      setProgress(detail);
    };
    window.addEventListener('security-audit:event:progress', onProgress);
    return () => window.removeEventListener('security-audit:event:progress', onProgress);
  }, []);

  const runMockScan = useCallback(async () => {
    setFindings(null);
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
    // Phase 1: 走 mock；Phase 2 会改成调 IPC
    if (window.electronAPI?.securityAudit?.scan) {
      // 真实路径（暂时未启用，先注释掉以免触发未实现的 IPC）
      // void window.electronAPI.securityAudit.scan.start({ projectDir: scannedDir ?? '' });
      void runMockScan();
    } else {
      void runMockScan();
    }
  }, [runMockScan]);

  const sortedFindings = findings
    ? [...findings].sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity])
    : [];
  const filteredFindings = severityFilter === 'all' ? sortedFindings : sortedFindings.filter((f) => f.severity === severityFilter);

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
          <Shield className="h-4 w-4" />
          <span className="text-sm font-semibold">Security Audit</span>
          {scannedDir && <Tag>{scannedDir}</Tag>}
        </Space>
        <Space>
          <Button icon={<Play size={14} />} type="primary" onClick={runScan} loading={progress.phase === 'scanning' || progress.phase === 'triaging'}>
            扫描项目
          </Button>
        </Space>
      </header>

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
                <span className="text-[11px] text-muted-foreground">v1 用 mock 数据演示流程；v2 接入真实 deepsec CLI</span>
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
            description="请检查 deepsec CLI 是否安装，或在 Settings 里配置 AI key。"
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
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">描述</div>
              <div className="text-sm leading-relaxed">{activeFinding.description}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">修复建议</div>
              <div className="text-sm leading-relaxed">{activeFinding.recommendation}</div>
            </div>
            {activeFinding.ruleId && (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">规则</div>
                <Tag color="purple">{activeFinding.ruleId}</Tag>
              </div>
            )}
          </Space>
        )}
      </Modal>

      <ToastHost />
    </div>
  );
}
