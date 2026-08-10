/**
 * Network Observatory panel — V1.1.
 *
 * Features:
 * - Target CRUD with probe-kind selection (icmp / tcp / dns / http)
 * - Per-kind options form (port for tcp, record+resolvers for dns, url+path for http)
 * - Live result table (status, latency, payload summary)
 * - Per-target latency chart (echarts) using persisted history
 * - Aggregate stats (min/p50/p95/p99/jitter/loss) over selected window
 * - Alert rule CRUD + open incidents list
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import {
  CheckCircle,
  Circle,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from '@/components/icons';
import type {
  NetProbeTarget,
  NetProbeTargetInput,
  NetProbeKind,
  NetProbeResult,
  NetProbeAlertRule,
  AlertMetric,
  AlertOp,
  NetProbeIncident,
} from '@/types/net-probe-schema';
import type { NetProbeEvent, NetProbeState } from '@/types/electron';
import { computeStats } from './backend/net-probe-stats';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface NetProbeAPI {
  start: () => Promise<{ ready: boolean; version: string | null }>;
  state: () => Promise<NetProbeState>;
  systemInfo: () => Promise<{ hostname: string; platform: string; arch: string; cpus: number }>;
  listTargets: () => Promise<NetProbeTarget[]>;
  addTarget: (input: NetProbeTargetInput) => Promise<NetProbeTarget>;
  removeTarget: (id: string) => Promise<{ removed: boolean }>;
  updateTarget: (id: string, patch: Partial<NetProbeTargetInput>) => Promise<NetProbeTarget | null>;
  setTargetEnabled: (id: string, enabled: boolean) => Promise<NetProbeTarget | null>;
  listResults: (opts?: { targetId?: string; sinceMs?: number; limit?: number }) => Promise<NetProbeResult[]>;
  listAlertRules: () => Promise<NetProbeAlertRule[]>;
  addAlertRule: (input: Omit<NetProbeAlertRule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<NetProbeAlertRule>;
  removeAlertRule: (id: string) => Promise<boolean>;
  listIncidents: (opts?: { openOnly?: boolean }) => Promise<NetProbeIncident[]>;
  closeIncident: (id: string) => Promise<boolean>;
  onEvent: (callback: (event: NetProbeEvent) => void) => () => void;
}

function getAPI(): NetProbeAPI | null {
  return (window as unknown as { electronAPI?: { netProbe?: NetProbeAPI } }).electronAPI?.netProbe ?? null;
}

const PROBE_KINDS: { value: NetProbeKind; label: string; placeholder: string }[] = [
  { value: 'icmp', label: 'ICMP', placeholder: '8.8.8.8' },
  { value: 'tcp', label: 'TCP', placeholder: 'example.com:443' },
  { value: 'dns', label: 'DNS', placeholder: 'example.com' },
  { value: 'http', label: 'HTTP', placeholder: 'http://example.com' },
];

const ALERT_METRICS: { value: AlertMetric; label: string; unit: string }[] = [
  { value: 'latency_p95', label: 'P95 延迟', unit: 'ms' },
  { value: 'latency_avg', label: '平均延迟', unit: 'ms' },
  { value: 'loss_pct', label: '丢包率', unit: '%' },
  { value: 'jitter', label: '抖动', unit: 'ms' },
  { value: 'status', label: '可用性 (1=失联)', unit: 'flag' },
];
const ALERT_OPS: AlertOp[] = ['>', '<', '==', '!='];

interface ChartProps {
  option: EChartsCoreOption;
  className?: string;
}

function Chart({ option, className }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart: EChartsType = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div ref={ref} className={className} />;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function describeError(code: number | null, msg?: string): string {
  if (code === 0) return 'exited cleanly';
  if (msg) return msg;
  if (code === null) return 'killed';
  return `exit ${code}`;
}

export const NetworkObservatoryPanel: React.FC = () => {
  const api = useMemo(() => getAPI(), []);
  const [targets, setTargets] = useState<NetProbeTarget[]>([]);
  const [rules, setRules] = useState<NetProbeAlertRule[]>([]);
  const [incidents, setIncidents] = useState<NetProbeIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<NetProbeResult[]>([]);
  const [systemInfo, setSystemInfo] = useState<{ hostname: string; platform: string } | null>(null);
  const [daemonState, setDaemonState] = useState<NetProbeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState<boolean>(true);
  const [showRules, setShowRules] = useState<boolean>(false);

  // Add-target form state
  const [draftKind, setDraftKind] = useState<NetProbeKind>('icmp');
  const [draftTarget, setDraftTarget] = useState<string>('1.1.1.1');
  const [draftInterval, setDraftInterval] = useState<number>(5);
  const [draftPort, setDraftPort] = useState<number>(443);
  const [draftIpVersion, setDraftIpVersion] = useState<string>('auto');
  const [draftRecord, setDraftRecord] = useState<string>('A');
  const [draftResolvers, setDraftResolvers] = useState<string>('1.1.1.1, 8.8.8.8, 9.9.9.9');
  const [draftUrl, setDraftUrl] = useState<string>('');
  const [draftPath, setDraftPath] = useState<string>('/');

  const targetMap = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);

  const refreshAll = useCallback(async () => {
    if (!api) return;
    try {
      const [t, r, i, s] = await Promise.all([
        api.listTargets(),
        api.listAlertRules(),
        api.listIncidents(),
        api.state(),
      ]);
      setTargets(t);
      setRules(r);
      setIncidents(i);
      setDaemonState(s);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api]);

  // Boot
  useEffect(() => {
    if (!api) {
      setError('netProbe IPC 未在 preload 中暴露');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sys = await api.systemInfo();
        if (!cancelled) setSystemInfo({ hostname: sys.hostname, platform: sys.platform });
        await refreshAll();
        if (autoStart) {
          await api.start();
          await refreshAll();
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, autoStart, refreshAll]);

  // Subscribe to events
  useEffect(() => {
    if (!api) return;
    const off = api.onEvent((event) => {
      if (event.type === 'ready') {
        setDaemonState((prev) => ({ ...(prev ?? emptyState()), ready: true, version: event.version, pid: event.pid, startedAt: event.startedAt }));
        setError(null);
        return;
      }
      if (event.type === 'error') {
        setError(event.message);
        return;
      }
      if (event.type === 'exit') {
        setDaemonState((prev) => prev ? { ...prev, ready: false, lastExit: { code: event.code, error: event.error, timestampMs: event.timestampMs } } : prev);
        return;
      }
      if (event.type === 'probe_result' && event.id === selectedId) {
        setHistory((prev) => {
          const newRow: NetProbeResult = {
            id: `${event.id}-${event.timestampMs}`,
            targetId: event.id,
            probe: event.probe as NetProbeKind,
            timestampMs: event.timestampMs,
            success: event.success,
            latencyMs: event.latencyMs,
            error: event.error,
            payloadJson: JSON.stringify(event.payload ?? {}),
          };
          return [newRow, ...prev].slice(0, 500);
        });
      }
    });
    return off;
  }, [api, selectedId]);

  // Load history when selection changes
  useEffect(() => {
    if (!api || !selectedId) {
      setHistory([]);
      return;
    }
    (async () => {
      try {
        const rows = await api.listResults({ targetId: selectedId, limit: 500 });
        // Most recent first; sort ascending for chart
        const sorted = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
        setHistory(sorted);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    })();
  }, [api, selectedId]);

  const addTarget = useCallback(async () => {
    if (!api) return;
    const t = draftTarget.trim();
    if (!t) return;
    setError(null);
    try {
      const baseIntervalMs = Math.max(500, Math.floor(draftInterval * 1000));
      const options: Record<string, unknown> = {};
      if (draftKind === 'tcp') options.port = draftPort;
      if ((draftKind === 'icmp' || draftKind === 'tcp') && draftIpVersion !== 'auto') {
        options.ip_version = draftIpVersion;
      }
      if (draftKind === 'dns') {
        options.record = draftRecord;
        options.resolvers = draftResolvers.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (draftKind === 'http') {
        if (draftUrl.trim()) options.url = draftUrl.trim();
        if (draftPath.trim()) options.path = draftPath.trim();
      }
      const created = await api.addTarget({
        target: t,
        probe: draftKind,
        intervalMs: baseIntervalMs,
        options,
      });
      setTargets((prev) => [created, ...prev]);
      setSelectedId(created.id);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api, draftKind, draftTarget, draftInterval, draftPort, draftRecord, draftResolvers, draftUrl, draftPath, draftIpVersion]);

  const removeTarget = useCallback(
    async (id: string) => {
      if (!api) return;
      try {
        await api.removeTarget(id);
        setTargets((prev) => prev.filter((t) => t.id !== id));
        if (selectedId === id) setSelectedId(null);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    },
    [api, selectedId],
  );

  const toggleTarget = useCallback(
    async (t: NetProbeTarget) => {
      if (!api) return;
      try {
        const updated = await api.setTargetEnabled(t.id, !t.enabled);
        if (updated) setTargets((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    },
    [api],
  );

  const restartDaemon = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      await api.start();
      await refreshAll();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api, refreshAll]);

  const chartOption = useMemo<EChartsCoreOption>(() => {
    const data = history
      .filter((r) => r.success && r.latencyMs != null)
      .map((r) => [r.timestampMs, r.latencyMs]);
    return {
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: 'ms' },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'line',
          showSymbol: false,
          smooth: true,
          data,
          lineStyle: { color: '#6366f1', width: 2 },
          areaStyle: { color: 'rgba(99, 102, 241, 0.15)' },
        },
      ],
    };
  }, [history]);

  // Waterfall: for the latest successful HTTP result, show dns / tcp / tls /
  // ttfb / download as a horizontal stacked bar. Empty for non-http probes.
  const waterfallOption = useMemo<EChartsCoreOption | null>(() => {
    if (selectedId == null) return null;
    const target = targets.find((t) => t.id === selectedId);
    if (!target || target.probe !== 'http') return null;
    const last = [...history].reverse().find((r) => r.success && r.payloadJson && r.payloadJson !== '{}');
    if (!last) return null;
    let p: { dns_ms?: number; tcp_ms?: number; tls_ms?: number; ttfb_ms?: number; download_ms?: number; total_ms?: number; status?: number };
    try { p = JSON.parse(last.payloadJson); } catch { return null; }
    const dns = Number(p.dns_ms ?? 0);
    const tcp = Number(p.tcp_ms ?? 0);
    const tls = Number(p.tls_ms ?? 0);
    const ttfb = Number(p.ttfb_ms ?? 0);
    const download = Number(p.download_ms ?? 0);
    return {
      grid: { left: 64, right: 16, top: 8, bottom: 24 },
      xAxis: { type: 'value', name: 'ms' },
      yAxis: { type: 'category', data: ['最近一次'] },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: unknown) => {
        const arr = params as Array<{ seriesName: string; value: number; color: string }>;
        if (!arr?.length) return '';
        const total = arr.reduce((s, x) => s + (x.value || 0), 0);
        const lines = arr.filter((x) => x.value > 0).map((x) => `${x.seriesName}: ${x.value.toFixed(1)} ms`).join('<br/>');
        return `${last.timestampMs ? new Date(last.timestampMs).toLocaleTimeString() : ''}<br/>${lines}<br/>total: ${total.toFixed(1)} ms${p.status ? ` · status ${p.status}` : ''}`;
      } },
      series: [
        { name: 'DNS',  type: 'bar', stack: 'w', data: [dns],      itemStyle: { color: '#60a5fa' } },
        { name: 'TCP',  type: 'bar', stack: 'w', data: [tcp],      itemStyle: { color: '#34d399' } },
        { name: 'TLS',  type: 'bar', stack: 'w', data: [tls],      itemStyle: { color: '#a78bfa' } },
        { name: 'TTFB', type: 'bar', stack: 'w', data: [ttfb],     itemStyle: { color: '#f59e0b' } },
        { name: 'DL',   type: 'bar', stack: 'w', data: [download], itemStyle: { color: '#f472b6' } },
      ],
    };
  }, [history, selectedId, targets]);

  const stats = useMemo(() => {
    const latencies = history.map((r) => (r.success ? r.latencyMs : null));
    return computeStats(latencies, history.length);
  }, [history]);

  if (!api) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        netProbe IPC 未就绪 — 请检查 preload.ts 是否暴露了 electronAPI.netProbe
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">Network Observatory</h1>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">v0.2 · ICMP/TCP/DNS/HTTP</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {systemInfo && <span>{systemInfo.hostname} · {systemInfo.platform}</span>}
          <DaemonStatusBadge state={daemonState} />
          <button
            type="button"
            onClick={restartDaemon}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 重连
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-destructive/70 hover:text-destructive">×</button>
        </div>
      )}

      <div className="grid flex-1 grid-cols-[300px_1fr] overflow-hidden">
        {/* Left: target list + add form */}
        <aside className="flex flex-col border-r border-border overflow-hidden">
          <div className="border-b border-border bg-muted/30 p-3">
            <div className="mb-2 flex gap-1">
              {PROBE_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setDraftKind(k.value)}
                  className={`flex-1 rounded px-2 py-1 text-xs ${draftKind === k.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <input
              value={draftTarget}
              onChange={(e) => setDraftTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTarget()}
              placeholder={PROBE_KINDS.find((k) => k.value === draftKind)?.placeholder}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
            {(draftKind === 'icmp' || draftKind === 'tcp') && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">IP 版本</span>
                <select
                  value={draftIpVersion}
                  onChange={(e) => setDraftIpVersion(e.target.value)}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                  title="auto 解析 host 给的地址;v4/v6 强制单协议栈"
                >
                  <option value="auto">自动</option>
                  <option value="v4">IPv4 only</option>
                  <option value="v6">IPv6 only</option>
                </select>
              </div>
            )}
            {draftKind === 'tcp' && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">端口</span>
                <input
                  type="number"
                  value={draftPort}
                  onChange={(e) => setDraftPort(Number(e.target.value))}
                  className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                />
              </div>
            )}
            {draftKind === 'dns' && (
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-16 text-muted-foreground">记录类型</span>
                  <select
                    value={draftRecord}
                    onChange={(e) => setDraftRecord(e.target.value)}
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="A">A</option>
                    <option value="AAAA">AAAA</option>
                    <option value="CNAME">CNAME</option>
                    <option value="MX">MX</option>
                    <option value="TXT">TXT</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 text-muted-foreground">Resolvers</span>
                  <input
                    value={draftResolvers}
                    onChange={(e) => setDraftResolvers(e.target.value)}
                    placeholder="1.1.1.1, 8.8.8.8"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                  />
                </div>
              </div>
            )}
            {draftKind === 'http' && (
              <div className="mt-2 space-y-1 text-xs">
                <input
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="完整 URL(可省略,默认 http://target)"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                />
                <input
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder="路径(可省略,默认 /)"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                />
              </div>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">间隔</span>
              <input
                type="number"
                min={1}
                value={draftInterval}
                onChange={(e) => setDraftInterval(Number(e.target.value))}
                className="w-16 rounded border border-border bg-background px-2 py-1 text-xs"
              />
              <span className="text-muted-foreground">秒</span>
              <button
                type="button"
                onClick={addTarget}
                className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" /> 添加
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {targets.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">还没有目标</div>
            ) : (
              targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-left text-sm ${selectedId === t.id ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase">{t.probe}</span>
                      <span className="truncate font-mono text-xs">{t.target}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t.intervalMs}ms · {t.enabled ? '运行中' : '已暂停'}</div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleTarget(t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        void toggleTarget(t);
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t.enabled ? '暂停' : '启用'}
                  >
                    {t.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeTarget(t.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        void removeTarget(t.id);
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              className="w-full rounded border border-border px-2 py-1.5 text-xs hover:bg-muted"
            >
              告警规则 ({rules.length}) {showRules ? '▾' : '▸'}
            </button>
          </div>
        </aside>

        {/* Right: detail */}
        <main className="flex flex-col overflow-hidden">
          {selectedId && targetMap.get(selectedId) ? (
            <TargetDetail
              target={targetMap.get(selectedId)!}
              history={history}
              stats={stats}
              chartOption={chartOption}
              waterfallOption={waterfallOption}
            />
          ) : showRules ? (
            <RulesPanel
              rules={rules}
              incidents={incidents}
              targets={targets}
              onRefresh={refreshAll}
              onCloseIncident={async (id) => {
                if (!api) return;
                await api.closeIncident(id);
                await refreshAll();
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Network className="h-10 w-10 opacity-30" />
              <p>添加一个目标,或选择一个目标查看详情</p>
              <p className="text-xs opacity-70">ICMP / TCP / DNS / HTTP · 7 天历史 · 告警</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

function emptyState(): NetProbeState {
  return { ready: false, version: null, pid: null, startedAt: null, lastError: null, lastExit: null };
}

const DaemonStatusBadge: React.FC<{ state: NetProbeState | null }> = ({ state }) => {
  if (!state) return <span className="rounded bg-muted px-2 py-0.5">未知</span>;
  if (state.ready) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-600">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 运行中 · v{state.version}
      </span>
    );
  }
  if (state.lastExit) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-amber-600">
        <Pause className="h-3 w-3" /> {describeError(state.lastExit.code, state.lastExit.error)}
      </span>
    );
  }
  return <span className="rounded bg-muted px-2 py-0.5">未启动</span>;
};

interface TargetDetailProps {
  target: NetProbeTarget;
  history: NetProbeResult[];
  stats: ReturnType<typeof computeStats>;
  chartOption: EChartsCoreOption;
  waterfallOption: EChartsCoreOption | null;
}

const TargetDetail: React.FC<TargetDetailProps> = ({ target, history, stats, chartOption, waterfallOption }) => {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono uppercase">{target.probe}</span>
          <h2 className="font-mono text-sm">{target.target}</h2>
          <span className="text-xs text-muted-foreground">{target.intervalMs}ms</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 border-b border-border bg-muted/30 px-4 py-3 text-xs">
        <Stat label="min" value={stats.min} unit="ms" />
        <Stat label="avg" value={stats.avg} unit="ms" />
        <Stat label="p50" value={stats.p50} unit="ms" />
        <Stat label="p95" value={stats.p95} unit="ms" />
        <Stat label="p99" value={stats.p99} unit="ms" />
        <Stat label="jitter" value={stats.jitter} unit="ms" />
        <Stat label="loss" value={stats.lossPct} unit="%" />
      </div>
      {waterfallOption && (
        <div className="h-24 border-b border-border px-4 py-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Waterfall · 最近一次</span>
          </div>
          <Chart option={waterfallOption} className="h-20 w-full" />
        </div>
      )}
      <div className="h-48 border-b border-border">
        <Chart option={chartOption} className="h-full w-full" />
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-right">延迟</th>
              <th className="px-3 py-2 text-left">Payload</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">暂无历史</td></tr>
            ) : (
              [...history].reverse().slice(0, 100).map((r) => {
                let payloadSummary: string;
                try {
                  const p = JSON.parse(r.payloadJson);
                  if (target.probe === 'http') {
                    payloadSummary = `dns=${p.dns_ms?.toFixed(1)}ms tcp=${p.tcp_ms?.toFixed(1)}ms ttfb=${p.ttfb_ms?.toFixed(1)}ms dl=${p.download_ms?.toFixed(1)}ms status=${p.status} bytes=${p.bytes}`;
                  } else if (target.probe === 'dns') {
                    payloadSummary = `primary=${p.primary} record=${p.record} resolvers=${(p.resolvers ?? []).length}`;
                  } else if (target.probe === 'tcp') {
                    payloadSummary = `remote=${p.remote} ip_version=${p.ip_version}`;
                  } else {
                    payloadSummary = '';
                  }
                } catch {
                  payloadSummary = '';
                }
                return (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono">{formatTimestamp(r.timestampMs)}</td>
                    <td className="px-3 py-1.5">
                      {r.success ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="h-3 w-3" /> 正常</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive" title={r.error ?? ''}>
                          <Circle className="h-3 w-3" /> {r.error ?? '失败'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.latencyMs != null ? `${r.latencyMs.toFixed(1)} ms` : '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{payloadSummary}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | null; unit: string }> = ({ label, value, unit }) => (
  <div className="text-center">
    <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    <div className="font-mono text-sm font-medium">{value == null ? '—' : value.toFixed(1)} <span className="text-[10px] text-muted-foreground">{unit}</span></div>
  </div>
);

interface RulesPanelProps {
  rules: NetProbeAlertRule[];
  incidents: NetProbeIncident[];
  targets: NetProbeTarget[];
  onRefresh: () => void;
  onCloseIncident: (id: string) => Promise<void>;
}

const RulesPanel: React.FC<RulesPanelProps> = ({ rules, incidents, targets, onRefresh, onCloseIncident }) => {
  const api = useMemo(() => getAPI(), []);
  const [name, setName] = useState('高延迟告警');
  const [targetId, setTargetId] = useState<string>(''); // empty = all
  const [metric, setMetric] = useState<AlertMetric>('latency_p95');
  const [op, setOp] = useState<AlertOp>('>');
  const [threshold, setThreshold] = useState<number>(200);

  const addRule = useCallback(async () => {
    if (!api) return;
    try {
      await api.addAlertRule({
        name: name.trim() || '未命名规则',
        targetId: targetId || null,
        probe: null,
        metric,
        op,
        threshold: Math.round(threshold),
        durationSec: 60,
        enabled: true,
        notify: 'desktop',
      });
      await onRefresh();
    } catch (e) {
      // best-effort; the parent shows the error
    }
  }, [api, name, targetId, metric, op, threshold, onRefresh]);

  const removeRule = useCallback(async (id: string) => {
    if (!api) return;
    await api.removeAlertRule(id);
    await onRefresh();
  }, [api, onRefresh]);

  return (
    <div className="flex-1 overflow-auto p-4 text-sm">
      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">新增告警规则</h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" className="rounded border border-border bg-background px-2 py-1 text-sm" />
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
            <option value="">所有目标</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.probe} {t.target}</option>)}
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)} className="rounded border border-border bg-background px-2 py-1 text-sm">
            {ALERT_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <div className="flex gap-1">
            <select value={op} onChange={(e) => setOp(e.target.value as AlertOp)} className="w-20 rounded border border-border bg-background px-2 py-1 text-sm">
              {ALERT_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <button type="button" onClick={addRule} className="mt-2 inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> 新增规则
        </button>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">规则列表 ({rules.length})</h3>
        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有规则</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">名称</th>
                <th className="px-2 py-1 text-left">目标</th>
                <th className="px-2 py-1 text-left">条件</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{r.targetId ?? 'all'}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.metric} {r.op} {r.threshold}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => removeRule(r.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">告警事件 (未关闭: {incidents.filter((i) => i.endedAt == null).length})</h3>
        {incidents.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无事件</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">开始</th>
                <th className="px-2 py-1 text-left">目标</th>
                <th className="px-2 py-1 text-left">信息</th>
                <th className="px-2 py-1 text-left">状态</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id} className="border-b border-border/40">
                  <td className="px-2 py-1.5 font-mono text-[11px]">{formatTimestamp(i.startedAt)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{i.targetId}</td>
                  <td className="px-2 py-1.5">{i.triggerMessage}</td>
                  <td className="px-2 py-1.5">
                    {i.endedAt == null ? <span className="text-destructive">活跃</span> : <span className="text-muted-foreground">已恢复</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {i.endedAt == null && (
                      <button onClick={() => onCloseIncident(i.id)} className="text-xs text-muted-foreground hover:text-foreground">
                        关闭
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
