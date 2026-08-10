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
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import {
  CheckCircle,
  Circle,
  Download,
  FileText,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
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
  AlertNotify,
  NotifyChannelConfig,
  NetProbeIncident,
} from '@/types/net-probe-schema';
import type { NetProbeEvent, NetProbeState } from '@/types/electron';
import { computeStats } from './backend/net-probe-stats';
import {
  buildReportData,
  buildHtmlReport,
  buildMarkdownReport,
  suggestReportFilename,
  type ReportData,
} from './backend/net-probe-report';

echarts.use([BarChart, HeatmapChart, LineChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

interface NetProbeAPI {
  start: () => Promise<{ ready: boolean; version: string | null }>;
  state: () => Promise<NetProbeState>;
  systemInfo: () => Promise<{ hostname: string; platform: string; arch: string; cpus: number }>;
  listTargets: () => Promise<NetProbeTarget[]>;
  addTarget: (input: NetProbeTargetInput) => Promise<NetProbeTarget>;
  removeTarget: (id: string) => Promise<{ removed: boolean }>;
  updateTarget: (id: string, patch: Partial<NetProbeTargetInput>) => Promise<NetProbeTarget | null>;
  setTargetEnabled: (id: string, enabled: boolean) => Promise<NetProbeTarget | null>;
  listResults: (opts?: { targetId?: string; sinceMs?: number; untilMs?: number; limit?: number }) => Promise<NetProbeResult[]>;
  heatmap: (opts: { targetId: string; sinceMs?: number }) => Promise<Array<{ dayOfWeek: number; hourOfDay: number; avgLatencyMs: number | null; sampleCount: number; lossPct: number }>>;
  listAlertRules: () => Promise<NetProbeAlertRule[]>;
  addAlertRule: (input: Omit<NetProbeAlertRule, 'id' | 'createdAt' | 'updatedAt' | 'notifyConfig'> & { notifyConfig?: string }) => Promise<NetProbeAlertRule>;
  removeAlertRule: (id: string) => Promise<boolean>;
  testChannel: (args: { notify: string; notifyConfig?: string }) => Promise<{ ok: boolean; channel: string; detail?: string; durationMs: number }>;
  listIncidents: (opts?: { openOnly?: boolean; limit?: number }) => Promise<NetProbeIncident[]>;
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
  { value: 'traceroute', label: 'Trace', placeholder: 'github.com' },
];

const ALERT_METRICS: { value: AlertMetric; label: string; unit: string }[] = [
  { value: 'latency_p95', label: 'P95 延迟', unit: 'ms' },
  { value: 'latency_avg', label: '平均延迟', unit: 'ms' },
  { value: 'loss_pct', label: '丢包率', unit: '%' },
  { value: 'jitter', label: '抖动', unit: 'ms' },
  { value: 'status', label: '可用性 (1=失联)', unit: 'flag' },
];
const ALERT_OPS: AlertOp[] = ['>', '<', '==', '!='];

const ALERT_CHANNELS: { value: AlertNotify; label: string; help: string }[] = [
  { value: 'desktop', label: '桌面通知 (系统)', help: '通过 Electron 弹系统通知' },
  { value: 'webhook', label: 'Webhook (通用 HTTP)', help: 'POST JSON 到任意 URL,可对接自建服务' },
  { value: 'dingtalk', label: '钉钉机器人', help: '钉钉群自定义机器人,支持加签和 @' },
  { value: 'slack', label: 'Slack', help: 'Slack Incoming Webhook' },
  { value: 'telegram', label: 'Telegram', help: 'Telegram Bot API' },
  { value: 'silent', label: '静默 (仅记录)', help: '不发送任何通知,只入库事件' },
];

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
  const [heatmap, setHeatmap] = useState<Array<{ dayOfWeek: number; hourOfDay: number; avgLatencyMs: number | null; sampleCount: number; lossPct: number }>>([]);
  const [systemInfo, setSystemInfo] = useState<{ hostname: string; platform: string } | null>(null);
  const [daemonState, setDaemonState] = useState<NetProbeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState<boolean>(true);
  const [showRules, setShowRules] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);

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
  const [draftMaxHops, setDraftMaxHops] = useState<number>(15);

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

  // Load history + heatmap when selection changes
  useEffect(() => {
    if (!api || !selectedId) {
      setHistory([]);
      setHeatmap([]);
      return;
    }
    (async () => {
      try {
        const [rows, hm] = await Promise.all([
          api.listResults({ targetId: selectedId, limit: 500 }),
          api.heatmap({ targetId: selectedId }),
        ]);
        const sorted = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
        setHistory(sorted);
        setHeatmap(hm);
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
      if (draftKind === 'traceroute') {
        options.max_hops = Math.max(1, Math.min(64, draftMaxHops));
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
  }, [api, draftKind, draftTarget, draftInterval, draftPort, draftRecord, draftResolvers, draftUrl, draftPath, draftIpVersion, draftMaxHops]);

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

  // Traceroute path: latest successful result's hops array.
  const traceroutePath = useMemo<{ hops: Array<{ hop: number; rttMs: number[]; host: string }>; totalMs: number; timestampMs: number; complete: boolean } | null>(() => {
    if (selectedId == null) return null;
    const target = targets.find((t) => t.id === selectedId);
    if (!target || target.probe !== 'traceroute') return null;
    const last = [...history].reverse().find((r) => r.success && r.payloadJson && r.payloadJson !== '{}');
    if (!last) return null;
    let p: { hops?: Array<{ hop: number; rtt_ms: number[]; host: string }>; complete?: boolean };
    try { p = JSON.parse(last.payloadJson); } catch { return null; }
    if (!Array.isArray(p.hops)) return null;
    return {
      hops: p.hops.map((h) => ({ hop: h.hop, rttMs: h.rtt_ms ?? [], host: h.host ?? '' })),
      totalMs: last.latencyMs ?? 0,
      timestampMs: last.timestampMs,
      complete: Boolean(p.complete),
    };
  }, [history, selectedId, targets]);

  // Heatmap: 7 days × 24 hours grid of average latency. Only meaningful for
  // continuous probes (icmp / tcp / dns / http). Traceroute runs infrequently
  // so its heatmap is sparse — we still show it but with a small dataset.
  const heatmapOption = useMemo<EChartsCoreOption | null>(() => {
    if (selectedId == null) return null;
    if (heatmap.length === 0) return null;
    const days = ['一', '二', '三', '四', '五', '六', '日'];
    const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
    const data: Array<[number, number, number]> = [];
    for (const c of heatmap) {
      if (c.avgLatencyMs != null) {
        data.push([c.hourOfDay, c.dayOfWeek, c.avgLatencyMs]);
      }
    }
    return {
      grid: { left: 36, right: 16, top: 16, bottom: 50 },
      xAxis: { type: 'category', data: hours, splitArea: { show: true }, axisLabel: { fontSize: 9 } },
      yAxis: { type: 'category', data: days, splitArea: { show: true }, axisLabel: { fontSize: 10 } },
      visualMap: {
        min: 0, max: 200, calculable: true, orient: 'horizontal',
        left: 'center', bottom: 0, itemHeight: 60, textStyle: { fontSize: 9 },
        inRange: { color: ['#10b981', '#fbbf24', '#f97316', '#ef4444'] },
      },
      tooltip: {
        position: 'top',
        formatter: (params: unknown) => {
          const arr = params as Array<{ data: [number, number, number] }>;
          if (!arr?.length) return '';
          const [h, d, v] = arr[0].data;
          return `${days[d] ?? '?'} ${String(h).padStart(2, '0')}:00<br/>avg ${v.toFixed(1)} ms`;
        },
      },
      series: [{ type: 'heatmap', data, progressive: 1000, animation: false }],
    };
  }, [heatmap, selectedId]);
  const heatmapCellCount = useMemo(() => heatmap.filter((c) => c.avgLatencyMs != null).length, [heatmap]);

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
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            title="导出报告 (Markdown / HTML)"
          >
            <FileText className="h-3.5 w-3.5" /> 导出报告
          </button>
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
            {draftKind === 'traceroute' && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">最大跳数</span>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={draftMaxHops}
                  onChange={(e) => setDraftMaxHops(Number(e.target.value))}
                  className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                />
                <span className="text-xs text-muted-foreground">(调系统 tracert/traceroute)</span>
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
              traceroutePath={traceroutePath}
              heatmapOption={heatmapOption}
              heatmapCellCount={heatmapCellCount}
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

      {showExportModal && (
        <ExportReportModal
          api={api}
          targets={targets}
          systemInfo={systemInfo}
          selectedId={selectedId}
          onClose={() => setShowExportModal(false)}
        />
      )}
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

interface TraceroutePath {
  hops: Array<{ hop: number; rttMs: number[]; host: string }>;
  totalMs: number;
  timestampMs: number;
  complete: boolean;
}

interface TargetDetailProps {
  target: NetProbeTarget;
  history: NetProbeResult[];
  stats: ReturnType<typeof computeStats>;
  chartOption: EChartsCoreOption;
  waterfallOption: EChartsCoreOption | null;
  traceroutePath: TraceroutePath | null;
  heatmapOption: EChartsCoreOption | null;
  heatmapCellCount: number;
}

const TargetDetail: React.FC<TargetDetailProps> = ({ target, history, stats, chartOption, waterfallOption, traceroutePath, heatmapOption, heatmapCellCount }) => {
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
      {traceroutePath ? (
        <TraceroutePathView path={traceroutePath} />
      ) : (
        <>
          <div className="h-48 border-b border-border">
            <Chart option={chartOption} className="h-full w-full" />
          </div>
          {heatmapOption && (
            <div className="border-b border-border px-4 py-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Heatmap · 7 天 × 24 小时(平均延迟) · {heatmapCellCount} cells</span>
              </div>
              <div className="h-44">
                <Chart option={heatmapOption} className="h-full w-full" />
              </div>
            </div>
          )}
        </>
      )}
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

const TraceroutePathView: React.FC<{ path: TraceroutePath }> = ({ path }) => {
  return (
    <div className="flex-1 overflow-auto border-b border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
        <span>Path · {path.hops.length} hops · total {path.totalMs.toFixed(0)} ms{path.complete ? ' · complete' : ' · partial'}</span>
        <span className="font-mono text-[10px]">{new Date(path.timestampMs).toLocaleString()}</span>
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-right w-12">Hop</th>
            <th className="px-3 py-2 text-left">Host</th>
            <th className="px-3 py-2 text-right w-32">RTT #1</th>
            <th className="px-3 py-2 text-right w-32">RTT #2</th>
            <th className="px-3 py-2 text-right w-32">RTT #3</th>
          </tr>
        </thead>
        <tbody>
          {path.hops.map((h) => (
            <tr key={h.hop} className="border-b border-border/40 hover:bg-muted/20">
              <td className="px-3 py-1.5 text-right font-mono">{h.hop}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{h.host}</td>
              {[0, 1, 2].map((i) => {
                const v = h.rttMs[i];
                return (
                  <td key={i} className="px-3 py-1.5 text-right font-mono">
                    {v == null || v < 0 ? <span className="text-muted-foreground">*</span> : `${v.toFixed(1)} ms`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

interface RulesPanelProps {
  rules: NetProbeAlertRule[];
  incidents: NetProbeIncident[];
  targets: NetProbeTarget[];
  onRefresh: () => void;
  onCloseIncident: (id: string) => Promise<void>;
}

interface ChannelConfigFormProps {
  channel: AlertNotify;
  config: NotifyChannelConfig;
  onChange: (cfg: NotifyChannelConfig) => void;
}

const ChannelConfigForm: React.FC<ChannelConfigFormProps> = ({ channel, config, onChange }) => {
  if (channel === 'desktop' || channel === 'silent') {
    return <p className="text-[11px] text-muted-foreground">该通道无需额外配置</p>;
  }

  if (channel === 'webhook') {
    return (
      <div className="space-y-2 text-xs">
        <Field label="Webhook URL" required>
          <input
            value={config.url ?? ''}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            placeholder="https://example.com/webhook"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="方法">
            <select
              value={config.method ?? 'POST'}
              onChange={(e) => onChange({ ...config, method: e.target.value as 'POST' | 'PUT' })}
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </Field>
          <Field label="载荷格式">
            <select
              value={config.bodyTemplate ?? 'json'}
              onChange={(e) => onChange({ ...config, bodyTemplate: e.target.value as 'json' | 'text' | 'none' })}
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              <option value="json">完整 JSON (含所有字段)</option>
              <option value="text">仅文本 (Slack/钉钉兼容)</option>
              <option value="none">空 body</option>
            </select>
          </Field>
        </div>
        <Field label="额外请求头 (JSON,可选)">
          <input
            value={config.headers ? JSON.stringify(config.headers) : ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (!v) return onChange({ ...config, headers: undefined });
              try {
                const parsed = JSON.parse(v);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  onChange({ ...config, headers: parsed as Record<string, string> });
                }
              } catch {
                // ignore — keep last valid
              }
            }}
            placeholder='{"X-Auth-Token": "..."}'
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
      </div>
    );
  }

  if (channel === 'dingtalk') {
    return (
      <div className="space-y-2 text-xs">
        <Field label="Webhook URL" required>
          <input
            value={config.url ?? ''}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
        <Field label="加签密钥 (可选,设置后必须用,签名算法 HmacSHA256)">
          <input
            value={config.secret ?? ''}
            onChange={(e) => onChange({ ...config, secret: e.target.value || undefined })}
            placeholder="SEC..."
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="@ 手机号 (逗号分隔,可选)">
            <input
              value={(config.atMobiles ?? []).join(',')}
              onChange={(e) => {
                const v = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                onChange({ ...config, atMobiles: v.length > 0 ? v : undefined });
              }}
              placeholder="13800138000"
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
          </Field>
          <Field label="@所有人">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(config.atAll)}
                onChange={(e) => onChange({ ...config, atAll: e.target.checked })}
              />
              触发时 @所有人
            </label>
          </Field>
        </div>
      </div>
    );
  }

  if (channel === 'slack') {
    return (
      <div className="space-y-2 text-xs">
        <Field label="Incoming Webhook URL" required>
          <input
            value={config.url ?? ''}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            placeholder="https://hooks.slack.com/services/T.../B.../..."
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="频道 (覆盖默认)">
            <input
              value={config.channel ?? ''}
              onChange={(e) => onChange({ ...config, channel: e.target.value || undefined })}
              placeholder="#alerts"
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
          </Field>
          <Field label="显示名 (覆盖默认)">
            <input
              value={config.username ?? ''}
              onChange={(e) => onChange({ ...config, username: e.target.value || undefined })}
              placeholder="Network Observatory"
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
          </Field>
        </div>
        <Field label="图标 emoji (覆盖默认)">
          <input
            value={config.iconEmoji ?? ''}
            onChange={(e) => onChange({ ...config, iconEmoji: e.target.value || undefined })}
            placeholder=":satellite:"
            className="w-full rounded border border-border bg-background px-2 py-1"
          />
        </Field>
      </div>
    );
  }

  if (channel === 'telegram') {
    return (
      <div className="space-y-2 text-xs">
        <Field label="Bot Token" required>
          <input
            value={config.botToken ?? ''}
            onChange={(e) => onChange({ ...config, botToken: e.target.value })}
            placeholder="123456:ABC-DEF..."
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
        <Field label="Chat ID" required>
          <input
            value={config.chatId ?? ''}
            onChange={(e) => onChange({ ...config, chatId: e.target.value })}
            placeholder="-100123456789 或 @username"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>
        <Field label="解析模式">
          <select
            value={config.parseMode ?? 'Markdown'}
            onChange={(e) => onChange({ ...config, parseMode: e.target.value as 'Markdown' | 'HTML' | 'MarkdownV2' })}
            className="w-full rounded border border-border bg-background px-2 py-1"
          >
            <option value="Markdown">Markdown</option>
            <option value="HTML">HTML</option>
            <option value="MarkdownV2">MarkdownV2 (转义最严格)</option>
          </select>
        </Field>
      </div>
    );
  }

  return null;
};

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <label className="block">
    <div className="mb-1 text-[10px] uppercase text-muted-foreground">
      {label} {required && <span className="text-destructive">*</span>}
    </div>
    {children}
  </label>
);

const RulesPanel: React.FC<RulesPanelProps> = ({ rules, incidents, targets, onRefresh, onCloseIncident }) => {
  const api = useMemo(() => getAPI(), []);
  const [name, setName] = useState('高延迟告警');
  const [targetId, setTargetId] = useState<string>(''); // empty = all
  const [metric, setMetric] = useState<AlertMetric>('latency_p95');
  const [op, setOp] = useState<AlertOp>('>');
  const [threshold, setThreshold] = useState<number>(200);
  const [notify, setNotify] = useState<AlertNotify>('desktop');
  const [draftConfig, setDraftConfig] = useState<NotifyChannelConfig>({});
  const [draftError, setDraftError] = useState<string | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  const addRule = useCallback(async () => {
    if (!api) return;
    setDraftError(null);
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
        notify,
        notifyConfig: JSON.stringify(draftConfig),
      });
      await onRefresh();
    } catch (e) {
      setDraftError(String((e as Error).message ?? e));
    }
  }, [api, name, targetId, metric, op, threshold, notify, draftConfig, onRefresh]);

  const testDraftChannel = useCallback(async () => {
    if (!api) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testChannel({ notify, notifyConfig: JSON.stringify(draftConfig) });
      setTestResult({ ok: r.ok, detail: r.detail });
    } catch (e) {
      setTestResult({ ok: false, detail: String((e as Error).message ?? e) });
    } finally {
      setTesting(false);
    }
  }, [api, notify, draftConfig]);

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
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] uppercase text-muted-foreground">通知通道</div>
            <select
              value={notify}
              onChange={(e) => {
                setNotify(e.target.value as AlertNotify);
                setDraftConfig({});
                setTestResult(null);
              }}
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {ALERT_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>{c.label} — {c.help}</option>
              ))}
            </select>
          </div>
          <div className="rounded border border-border bg-muted/30 p-2">
            <ChannelConfigForm channel={notify} config={draftConfig} onChange={setDraftConfig} />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={testDraftChannel}
            disabled={testing || notify === 'silent' || notify === 'desktop'}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            title={notify === 'silent' ? '静默通道无需测试' : notify === 'desktop' ? '桌面通知请直接看系统通知中心' : '发送一次测试通知,验证通道配置正确'}
          >
            <Send className="h-3.5 w-3.5" /> {testing ? '测试中…' : '测试通道'}
          </button>
          {testResult && (
            <span className={`text-[11px] ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
              {testResult.ok ? '✓ 测试通过' : `✗ ${testResult.detail ?? '失败'}`}
            </span>
          )}
          <button
            type="button"
            onClick={addRule}
            className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> 新增规则
          </button>
        </div>
        {draftError && <p className="mt-2 text-xs text-destructive">{draftError}</p>}
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
                <th className="px-2 py-1 text-left">通道</th>
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
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      <ShieldAlert className="h-3 w-3" /> {r.notify}
                    </span>
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

// ── Export Report modal ──

interface ExportReportModalProps {
  api: NetProbeAPI;
  targets: NetProbeTarget[];
  systemInfo: { hostname: string; platform: string } | null;
  selectedId: string | null;
  onClose: () => void;
}

const RANGE_PRESETS: { value: '1h' | '6h' | '24h' | '7d'; label: string; ms: number }[] = [
  { value: '1h', label: '最近 1 小时', ms: 60 * 60 * 1000 },
  { value: '6h', label: '最近 6 小时', ms: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '最近 24 小时', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '最近 7 天', ms: 7 * 24 * 60 * 60 * 1000 },
];

const ExportReportModal: React.FC<ExportReportModalProps> = ({ api, targets, systemInfo, selectedId, onClose }) => {
  const [range, setRange] = useState<'1h' | '6h' | '24h' | '7d'>('24h');
  const [format, setFormat] = useState<'md' | 'html'>('html');
  const [scope, setScope] = useState<'all' | 'enabled' | 'selected'>('all');
  const [title, setTitle] = useState<string>('Network Observatory Report');
  const [busy, setBusy] = useState<boolean>(false);
  const [preview, setPreview] = useState<ReportData | null>(null);
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const generate = useCallback(async (): Promise<ReportData | null> => {
    setError(null);
    setPreviewBusy(true);
    try {
      const preset = RANGE_PRESETS.find((p) => p.value === range);
      const sinceMs = Date.now() - (preset?.ms ?? 24 * 60 * 60 * 1000);
      const untilMs = Date.now();

      const targetIds: string[] | undefined =
        scope === 'all'
          ? undefined
          : scope === 'enabled'
            ? targets.filter((t) => t.enabled).map((t) => t.id)
            : selectedId
              ? [selectedId]
              : targets.map((t) => t.id); // no selection → fall back to all
      const effectiveTargetIds = targetIds;

      // Pull everything in parallel.
      const [allResults, rules, incidents] = await Promise.all([
        api.listResults({ sinceMs, untilMs, limit: 100_000 }),
        api.listAlertRules(),
        api.listIncidents({ limit: 500 }),
      ]);

      // Build per-target heatmaps.
      const selectedTargets = (effectiveTargetIds
        ? targets.filter((t) => effectiveTargetIds.includes(t.id))
        : targets
      ).filter((t) => t.probe !== 'traceroute'); // traceroute doesn't have continuous heatmaps

      const heatmaps: Record<string, Array<{ dayOfWeek: number; hourOfDay: number; avgLatencyMs: number | null; sampleCount: number; lossPct: number }>> = {};
      await Promise.all(
        selectedTargets.map(async (t) => {
          try {
            const hm = await api.heatmap({ targetId: t.id, sinceMs });
            heatmaps[t.id] = hm;
          } catch {
            heatmaps[t.id] = [];
          }
        }),
      );

      const data = buildReportData({
        title,
        targets,
        targetIds: effectiveTargetIds,
        sinceMs,
        untilMs,
        results: allResults,
        heatmaps,
        incidents,
        rules,
        system: systemInfo,
      });
      return data;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      return null;
    } finally {
      setPreviewBusy(false);
    }
  }, [api, range, scope, title, targets, systemInfo, selectedId]);

  const handlePreview = useCallback(async () => {
    const data = await generate();
    if (data) setPreview(data);
  }, [generate]);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSavedPath(null);
    try {
      const data = preview ?? (await generate());
      if (!data) return;
      setPreview(data);
      const content = format === 'html' ? buildHtmlReport(data) : buildMarkdownReport(data);
      const filename = suggestReportFilename(title, format);
      type SaveFileFn = (c: string, n?: string, o?: { encoding?: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk'; lineEnding?: 'LF' | 'CRLF' }) => Promise<{ success: boolean; path?: string; modifiedAt?: number; error?: string }>;
      const saveFile = (window as unknown as { electronAPI?: { saveFile?: SaveFileFn } }).electronAPI?.saveFile;
      if (!saveFile) {
        setError('electronAPI.saveFile 不可用');
        return;
      }
      const result = await saveFile(content, filename, { encoding: 'utf8' });
      if (result.success) {
        setSavedPath(result.path ?? null);
      } else {
        setError(result.error ?? '保存失败');
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }, [format, generate, preview, title]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">导出报告</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="关闭">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4 text-sm">
          <section>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">报告标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如: 2026 W32 网络质量周报"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            />
          </section>

          <div className="grid grid-cols-2 gap-3">
            <section>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">时间范围</label>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as '1h' | '6h' | '24h' | '7d')}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                {RANGE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </section>
            <section>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">输出格式</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'md' | 'html')}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="html">HTML (浏览器可打印为 PDF)</option>
                <option value="md">Markdown (可粘贴到 Slack / 文档)</option>
              </select>
            </section>
          </div>

          <section>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">目标范围</label>
            <div className="flex flex-wrap gap-3 text-xs">
              {(['all', 'enabled', 'selected'] as const).map((s) => (
                <label key={s} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="scope"
                    value={s}
                    checked={scope === s}
                    onChange={() => setScope(s)}
                  />
                  {s === 'all' ? '全部目标' : s === 'enabled' ? '仅启用' : '当前选中目标 (在主面板选)'}
                </label>
              ))}
            </div>
          </section>

          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {savedPath && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
              ✓ 已保存到 <code className="font-mono">{savedPath}</code>
            </div>
          )}

          {preview && (
            <section className="rounded border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">预览</span>
                <span className="text-muted-foreground">
                  {preview.totals.targetCount} 目标 · {preview.totals.resultCount} 样本 · {preview.totals.incidentCount} 事件
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded bg-background px-2 py-1.5">
                  <div className="text-[10px] text-muted-foreground">运行中</div>
                  <div className="font-mono">{preview.totals.enabledTargetCount}/{preview.totals.targetCount}</div>
                </div>
                <div className="rounded bg-background px-2 py-1.5">
                  <div className="text-[10px] text-muted-foreground">整体失联率</div>
                  <div className="font-mono">
                    {preview.totals.resultCount > 0
                      ? `${(((preview.totals.resultCount - preview.totals.successCount) / preview.totals.resultCount) * 100).toFixed(2)}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded bg-background px-2 py-1.5">
                  <div className="text-[10px] text-muted-foreground">进行中告警</div>
                  <div className="font-mono">{preview.totals.openIncidentCount}</div>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewBusy}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            {previewBusy ? '生成中…' : '预览数据'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {busy ? '导出中…' : `导出 ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
