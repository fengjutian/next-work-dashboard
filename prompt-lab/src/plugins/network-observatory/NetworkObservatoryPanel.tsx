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
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
// `cytoscape-fcose` doesn't ship .d.ts files. Type as `any` to satisfy
// strict TS without bringing in a `@types/cytoscape-fcose` (none exists).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import fcose from 'cytoscape-fcose';
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
  NetProbeLanHost,
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

// Register the fcose force-directed layout. cytoscape.use() is idempotent
// for layouts of the same name, so calling this at module load is safe even
// under React StrictMode's double-invoke.
// `cytoscape-fcose` ships no .d.ts; we silence the type error inline.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
try { cytoscape.use(fcose as any); } catch { /* fcose unavailable */ }

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
  listLanHosts: (opts?: { scanId?: string; sinceMs?: number; limit?: number }) => Promise<NetProbeLanHost[]>;
  deleteLanHost: (id: string) => Promise<boolean>;
  scanLan: (opts?: { subnet?: string; maxHosts?: number; perPortTimeoutMs?: number }) => Promise<{ scanId: string; subnet: string | null; found: number; hosts: NetProbeLanHost[]; totalMs: number | null }>;
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

const PROBE_TEMPLATES: Array<{
  label: string;
  kind: NetProbeKind;
  target: string;
  interval: number;
  port?: number;
  url?: string;
}> = [
  { label: '公共 DNS', kind: 'dns', target: '1.1.1.1', interval: 10 },
  { label: 'HTTPS 网站', kind: 'http', target: 'example.com', url: 'https://example.com', interval: 30 },
  { label: '服务器端口', kind: 'tcp', target: 'example.com', port: 443, interval: 10 },
  { label: '路由追踪', kind: 'traceroute', target: '1.1.1.1', interval: 60 },
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

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, description, confirmLabel, destructive = false, onCancel, onConfirm }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="net-confirm-title" aria-describedby="net-confirm-description" tabIndex={-1} className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl outline-none">
        <div className="flex items-start gap-3">
          <div className={`rounded-full p-2 ${destructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="net-confirm-title" className="text-sm font-semibold">{title}</h2>
            <p id="net-confirm-description" className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted">取消</button>
          <button type="button" onClick={() => void onConfirm()} className={`rounded px-3 py-1.5 text-xs font-medium text-white ${destructive ? 'bg-destructive hover:opacity-90' : 'bg-primary hover:opacity-90'}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

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
  const [activeView, setActiveView] = useState<'overview' | 'target' | 'rules' | 'lan'>('overview');
  const [history, setHistory] = useState<NetProbeResult[]>([]);
  const [overviewResults, setOverviewResults] = useState<NetProbeResult[]>([]);
  const [heatmap, setHeatmap] = useState<Array<{ dayOfWeek: number; hourOfDay: number; avgLatencyMs: number | null; sampleCount: number; lossPct: number }>>([]);
  const [systemInfo, setSystemInfo] = useState<{ hostname: string; platform: string } | null>(null);
  const [daemonState, setDaemonState] = useState<NetProbeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStart] = useState<boolean>(true);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showAddTarget, setShowAddTarget] = useState<boolean>(false);
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<NetProbeTarget | null>(null);

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
  const selectedTarget = selectedId ? targetMap.get(selectedId) ?? null : null;

  const refreshAll = useCallback(async () => {
    if (!api) return;
    try {
      const [t, r, i, s, recent] = await Promise.all([
        api.listTargets(),
        api.listAlertRules(),
        api.listIncidents(),
        api.state(),
        api.listResults({ limit: 500 }),
      ]);
      setTargets(t);
      setRules(r);
      setIncidents(i);
      setDaemonState(s);
      setOverviewResults(recent);
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
      if (event.type === 'probe_result') {
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
        setOverviewResults((prev) => [newRow, ...prev].slice(0, 500));
        if (event.id === selectedId) setHistory((prev) => [newRow, ...prev].slice(0, 500));
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
      setActiveView('target');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api, draftKind, draftTarget, draftInterval, draftPort, draftRecord, draftResolvers, draftUrl, draftPath, draftIpVersion, draftMaxHops]);

  const applyTemplate = useCallback((template: typeof PROBE_TEMPLATES[number]) => {
    setDraftKind(template.kind);
    setDraftTarget(template.target);
    setDraftInterval(template.interval);
    if (template.port) setDraftPort(template.port);
    setDraftUrl(template.url ?? '');
    setShowAddTarget(true);
  }, []);

  const removeTarget = useCallback(
    async (id: string) => {
      if (!api) return;
      try {
        await api.removeTarget(id);
        setTargets((prev) => prev.filter((t) => t.id !== id));
        if (selectedId === id) {
          setSelectedId(null);
          setActiveView('overview');
        }
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
          <div className="border-b border-border bg-muted/30">
            <button
              type="button"
              onClick={() => setShowAddTarget((visible) => !visible)}
              aria-expanded={showAddTarget}
              aria-controls="network-observatory-add-target"
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/60"
            >
              <span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> 新增监控目标</span>
              <span aria-hidden="true">{showAddTarget ? '−' : '+'}</span>
            </button>
            {showAddTarget && <div id="network-observatory-add-target" className="border-t border-border p-3">
            <div className="mb-2 grid grid-cols-2 gap-1" aria-label="探测模板">
              {PROBE_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="rounded border border-border bg-background px-2 py-1 text-left text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  {template.label}
                </button>
              ))}
            </div>
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
            </div>}
          </div>
          <div className="flex-1 overflow-auto">
            {targets.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">还没有目标</div>
            ) : (
              targets.map((t) => (
                <div
                  key={t.id}
                  className={`flex w-full items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-left text-sm ${selectedId === t.id ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(t.id);
                      setActiveView('target');
                    }}
                    aria-current={activeView === 'target' && selectedId === t.id ? 'page' : undefined}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase">{t.probe}</span>
                      <span className="truncate font-mono text-xs">{t.target}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t.intervalMs}ms · {t.enabled ? '运行中' : '已暂停'}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleTarget(t)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t.enabled ? '暂停' : '启用'}
                    aria-label={`${t.enabled ? '暂停' : '启用'} ${t.target}`}
                  >
                    {t.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteTarget(t)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title="删除"
                    aria-label={`删除 ${t.target}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border p-2 space-y-1">
            <button
              type="button"
              onClick={() => setActiveView('overview')}
              className={`w-full rounded border px-2 py-1.5 text-xs ${activeView === 'overview' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
            >
              网络健康总览
            </button>
            <button
              type="button"
              onClick={() => setActiveView('rules')}
              className={`w-full rounded border px-2 py-1.5 text-xs ${activeView === 'rules' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
            >
              告警规则 ({rules.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView('lan')}
              className={`w-full rounded border px-2 py-1.5 text-xs ${activeView === 'lan' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
              title="LAN 扫描 + 拓扑"
            >
              LAN 拓扑
            </button>
          </div>
        </aside>

        {/* Right: detail */}
        <main className="flex flex-col overflow-hidden">
          {activeView === 'target' && selectedTarget ? (
            <TargetDetail
              target={selectedTarget}
              history={history}
              stats={stats}
              chartOption={chartOption}
              waterfallOption={waterfallOption}
              traceroutePath={traceroutePath}
              heatmapOption={heatmapOption}
              heatmapCellCount={heatmapCellCount}
            />
          ) : activeView === 'rules' ? (
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
          ) : activeView === 'lan' ? (
            <LanPanel api={api} systemInfo={systemInfo} />
          ) : (
            <>
            <ObservatoryOverview
              targets={targets}
              results={overviewResults}
              incidents={incidents}
              daemonReady={daemonState?.ready ?? false}
              onSelectTarget={(id) => {
                setSelectedId(id);
                setActiveView('target');
              }}
              onAddTarget={() => setShowAddTarget(true)}
            />
            {/* Retained for translation extraction; replaced visually by the overview. */}
            <div className="hidden">
              <Network className="h-10 w-10 opacity-30" />
              <p>添加一个目标,或选择一个目标查看详情</p>
              <p className="text-xs opacity-70">ICMP / TCP / DNS / HTTP · 7 天历史 · 告警</p>
            </div>
            </>
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
      {pendingDeleteTarget && (
        <ConfirmDialog
          title="删除监控目标"
          description={`确认删除“${pendingDeleteTarget.target}”？相关历史数据也可能被移除。`}
          confirmLabel="删除目标"
          destructive
          onCancel={() => setPendingDeleteTarget(null)}
          onConfirm={async () => {
            const id = pendingDeleteTarget.id;
            setPendingDeleteTarget(null);
            await removeTarget(id);
          }}
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

interface ObservatoryOverviewProps {
  targets: NetProbeTarget[];
  results: NetProbeResult[];
  incidents: NetProbeIncident[];
  daemonReady: boolean;
  onSelectTarget: (id: string) => void;
  onAddTarget: () => void;
}

const ObservatoryOverview: React.FC<ObservatoryOverviewProps> = ({
  targets, results, incidents, daemonReady, onSelectTarget, onAddTarget,
}) => {
  const latestByTarget = useMemo(() => {
    const latest = new Map<string, NetProbeResult>();
    for (const result of results) {
      const current = latest.get(result.targetId);
      if (!current || result.timestampMs > current.timestampMs) latest.set(result.targetId, result);
    }
    return latest;
  }, [results]);
  const enabledTargets = targets.filter((target) => target.enabled);
  const latestResults = enabledTargets.map((target) => latestByTarget.get(target.id)).filter((result): result is NetProbeResult => Boolean(result));
  const healthyCount = latestResults.filter((result) => result.success).length;
  const healthScore = latestResults.length > 0 ? Math.round((healthyCount / latestResults.length) * 100) : null;
  const successfulLatencies = latestResults.flatMap((result) => result.success && result.latencyMs != null ? [result.latencyMs] : []);
  const averageLatency = successfulLatencies.length > 0
    ? Math.round(successfulLatencies.reduce((sum, latency) => sum + latency, 0) / successfulLatencies.length)
    : null;
  const unhealthyTargets = enabledTargets.filter((target) => latestByTarget.get(target.id)?.success === false);
  const openIncidents = incidents.filter((incident) => incident.endedAt == null);

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">网络健康总览</h2>
          <p className="mt-1 text-xs text-muted-foreground">根据每个启用目标的最新探测结果计算</p>
        </div>
        <button type="button" onClick={onAddTarget} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> 新增监控
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewMetric label="健康分" value={healthScore == null ? '等待数据' : `${healthScore}%`} tone={healthScore == null ? 'muted' : healthScore >= 90 ? 'good' : 'bad'} />
        <OverviewMetric label="启用目标" value={String(enabledTargets.length)} hint={`共 ${targets.length} 个目标`} />
        <OverviewMetric label="平均延迟" value={averageLatency == null ? '—' : `${averageLatency} ms`} />
        <OverviewMetric label="打开事件" value={String(openIncidents.length)} tone={openIncidents.length > 0 ? 'bad' : 'good'} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">需要关注</h3>
            <span className={`text-xs ${daemonReady ? 'text-emerald-500' : 'text-destructive'}`}>{daemonReady ? '探测服务在线' : '探测服务离线'}</span>
          </div>
          {unhealthyTargets.length === 0 ? (
            <div className="flex items-center gap-2 rounded bg-emerald-500/10 px-3 py-4 text-xs text-emerald-600">
              <CheckCircle className="h-4 w-4" /> 当前没有探测失败的目标
            </div>
          ) : (
            <div className="space-y-2">
              {unhealthyTargets.slice(0, 8).map((target) => (
                <button key={target.id} type="button" onClick={() => onSelectTarget(target.id)} className="flex w-full items-center justify-between rounded border border-destructive/20 px-3 py-2 text-left hover:bg-destructive/5">
                  <span className="min-w-0 truncate font-mono text-xs">{target.target}</span>
                  <span className="ml-3 shrink-0 text-[11px] text-destructive">{latestByTarget.get(target.id)?.error ?? '探测失败'}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">最近探测</h3>
          {results.length === 0 ? (
            <p className="py-4 text-xs text-muted-foreground">还没有探测数据，添加目标后会自动显示。</p>
          ) : (
            <div className="space-y-1">
              {[...results].sort((a, b) => b.timestampMs - a.timestampMs).slice(0, 8).map((result) => {
                const target = targets.find((item) => item.id === result.targetId);
                return (
                  <button key={result.id} type="button" onClick={() => target && onSelectTarget(target.id)} disabled={!target} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-default">
                    {result.success ? <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                    <span className="min-w-0 flex-1 truncate font-mono">{target?.target ?? result.targetId}</span>
                    <span className="text-muted-foreground">{result.latencyMs == null ? '—' : `${Math.round(result.latencyMs)} ms`}</span>
                    <span className="w-16 text-right text-muted-foreground">{formatTimestamp(result.timestampMs)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const OverviewMetric: React.FC<{ label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'muted' }> = ({ label, value, hint, tone = 'muted' }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={`mt-1 text-xl font-semibold ${tone === 'good' ? 'text-emerald-500' : tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
    {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
  </div>
);

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
      ) : target.probe === 'traceroute' ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 border-b border-border bg-muted/10 px-6 text-center">
          {history.some((result) => !result.success) ? (
            <ShieldAlert className="h-7 w-7 text-destructive/70" />
          ) : (
            <RefreshCw className="h-7 w-7 animate-spin text-primary/70" />
          )}
          <p className="text-sm font-medium">{history.some((result) => !result.success) ? '路径探测暂未成功' : '正在等待首次路径结果'}</p>
          <p className="max-w-lg text-xs leading-5 text-muted-foreground">
            {history.find((result) => !result.success)?.error
              ?? `Traceroute 最长可能需要几十秒，下一次探测间隔为 ${Math.round(target.intervalMs / 1000)} 秒。`}
          </p>
        </div>
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

// ── LAN scan + topology panel ──

interface LanPanelProps {
  api: NetProbeAPI;
  systemInfo: { hostname: string; platform: string } | null;
}

interface LanHostUI extends NetProbeLanHost {
  ports: number[];
  ageMin: number;
}

function parseOpenPorts(s: string): number[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

const LanPanel: React.FC<LanPanelProps> = ({ api, systemInfo }) => {
  const [hosts, setHosts] = useState<LanHostUI[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [subnet, setSubnet] = useState<string>('');
  const [lastScan, setLastScan] = useState<{ scanId: string; found: number; totalMs: number | null; ts: number } | null>(null);

  const cyRef = useRef<HTMLDivElement | null>(null);
  const cyCoreRef = useRef<Core | null>(null);
  // Track the last rendered set of (ip, e-id) so we only re-run the expensive
  // fcose layout when the topology actually changed. Pure re-renders (e.g. user
  // clicks "refresh" and we re-list the same hosts) won't cause node-jitter.
  const lastRenderedIdsRef = useRef<string>('');

  const refresh = useCallback(async () => {
    try {
      const rows = await api.listLanHosts({ limit: 500 });
      const now = Date.now();
      setHosts(
        rows.map((r) => ({
          ...r,
          ports: parseOpenPorts(r.openPorts),
          ageMin: Math.max(0, Math.round((now - r.lastSeen) / 60_000)),
        })),
      );
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleScan = useCallback(async () => {
    const requestedSubnet = subnet.trim() || '自动检测的本地 /24 网段';
    if (!window.confirm(`将主动扫描 ${requestedSubnet}，最多探测 254 台主机。请确认你有权扫描该网络。`)) return;
    setBusy(true);
    setError(null);
    try {
      const opts: { subnet?: string; maxHosts?: number; perPortTimeoutMs?: number } = { maxHosts: 254, perPortTimeoutMs: 250 };
      if (subnet.trim()) opts.subnet = subnet.trim();
      const r = await api.scanLan(opts);
      setLastScan({ scanId: r.scanId, found: r.found, totalMs: r.totalMs, ts: Date.now() });
      await refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }, [api, subnet, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      // `id` is NetProbeLanHost.id (e.g. `lan-192.168.1.1`); `selectedIp` is
      // the raw IP used as the cytoscape node id. Look up the host by id
      // before deleting so we can match against the right value.
      const target = hosts.find((h) => h.id === id);
      if (!window.confirm(`确认删除设备记录“${target?.ip ?? id}”？`)) return;
      await api.deleteLanHost(id);
      await refresh();
      if (target && selectedIp === target.ip) setSelectedIp(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api, refresh, hosts, selectedIp]);

  // Sort by last-seen desc so freshly seen hosts are on top.
  const sortedHosts = useMemo(() => {
    return [...hosts].sort((a, b) => b.lastSeen - a.lastSeen);
  }, [hosts]);

  const selected = useMemo(
    () => (selectedIp ? sortedHosts.find((h) => h.ip === selectedIp) ?? null : null),
    [selectedIp, sortedHosts],
  );

  // Color rule shared by sidebar dots, list view, and the cytoscape stylesheet.
  const colorForHost = useCallback((h: LanHostUI): string => {
    if (h.ports.includes(443) || h.ports.includes(80)) return '#10b981';
    if (h.ports.length > 0) return '#f59e0b';
    return '#94a3b8';
  }, []);

  // ── cytoscape: build / sync the graph ──
  // We initialize the core once and then keep elements in sync via add/remove.
  // The layout runs only when nodes change (not on selection changes).
  useEffect(() => {
    if (!cyRef.current) return;
    if (!cyCoreRef.current) {
      cyCoreRef.current = cytoscape({
        container: cyRef.current,
        wheelSensitivity: 0.3,
        minZoom: 0.3,
        maxZoom: 2.5,
        boxSelectionEnabled: false,
        autoungrabify: false, // allow drag-to-rearrange
        style: [
          {
            selector: 'node',
            style: {
              'background-color': 'data(color)',
              'border-color': '#0f172a',
              'border-width': 1.5,
              'border-opacity': 0.3,
              label: 'data(label)',
              'font-size': 9,
              'font-family': 'ui-monospace, "SF Mono", Consolas, monospace',
              color: '#0f172a',
              'text-margin-y': -4,
              'text-valign': 'top',
              'text-halign': 'center',
              'text-wrap': 'wrap',
              'text-max-width': '90px',
              width: 36,
              height: 36,
            },
          },
          {
            selector: 'node[kind = "self"]',
            style: {
              'background-color': '#6366f1',
              'border-color': '#a5b4fc',
              'border-width': 2.5,
              'border-opacity': 1,
              'font-size': 11,
              'font-weight': 600,
              color: '#fff',
              'text-margin-y': 4,
              'text-valign': 'center',
              width: 64,
              height: 64,
            },
          },
          {
            selector: 'node:selected',
            style: {
              'border-color': '#0f172a',
              'border-width': 3,
              'border-opacity': 1,
              width: 44,
              height: 44,
            },
          },
          {
            selector: 'node[kind = "self"]:selected',
            style: {
              width: 72,
              height: 72,
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1.2,
              'line-color': '#cbd5e1',
              'line-style': 'dashed',
              'curve-style': 'bezier',
              'target-arrow-shape': 'none',
              opacity: 0.7,
            },
          },
          {
            selector: 'edge:selected, edge.source:selected, edge.target:selected',
            style: {
              'line-color': '#6366f1',
              'line-style': 'solid',
              width: 2,
              opacity: 1,
            },
          },
        ],
      });
      cyCoreRef.current.on('tap', 'node', (evt) => {
        const id = evt.target.id();
        if (id === 'self') {
          setSelectedIp(null);
        } else {
          setSelectedIp(id);
        }
      });
      cyCoreRef.current.on('tap', (evt) => {
        // Tap on background deselects.
        if (evt.target === cyCoreRef.current) setSelectedIp(null);
      });
    }

    const cy = cyCoreRef.current;
    // Build elements.
    const selfLabel = systemInfo?.hostname ?? '本机';
    const elements: ElementDefinition[] = [
      { data: { id: 'self', label: selfLabel, kind: 'self' } },
      ...sortedHosts.map((h) => ({
        data: {
          id: h.ip,
          // Two-line label: top is the short octet, bottom is the IP/hostname
          // pair. cytoscape's `text-wrap: wrap` does the wrapping for us, so
          // we just give it a string with the host's last octet and let the
          // CSS line-break on whitespace. Keeping the IP on a separate visual
          // row matters for hover/identification even when wrap is off.
          label: `${h.ip.split('.').slice(-1)[0]} ${h.ip}${h.hostname ? ` · ${h.hostname.length > 16 ? h.hostname.slice(0, 16) + '…' : h.hostname}` : ''}`,
          color: colorForHost(h),
          ports: h.ports,
        },
      })),
      ...sortedHosts.map((h) => ({
        data: { id: `e-${h.ip}`, source: 'self', target: h.ip },
      })),
    ];

    // Compute the desired host+edge identity set. We exclude 'self' from
    // removal candidates (it's the root, never goes away) and use plain
    // `cy.nodes()` / `cy.edges()` iteration — the previous `cy.elements(
    // 'node[ip]')` selector matched nothing because we never set a `data.ip`
    // attribute, so stale hosts lingered in the graph after delete.
    const desiredHostIds = sortedHosts.map((h) => h.ip);
    const desiredEdgeIds = sortedHosts.map((h) => `e-${h.ip}`);

    // Remove nodes that are no longer present.
    cy.nodes().forEach((n) => {
      const id = n.id();
      if (id === 'self') return;
      if (!desiredHostIds.includes(id)) n.remove();
    });
    // Remove edges that are no longer present.
    cy.edges().forEach((e) => {
      const id = e.id();
      if (id && !desiredEdgeIds.includes(id)) e.remove();
    });
    // Add missing nodes / edges.
    const existingNodeIds = new Set(cy.nodes().map((n) => n.id()));
    const existingEdgeIds = new Set(cy.edges().map((e) => e.id()));
    elements.forEach((el) => {
      const id = (el.data as { id: string }).id;
      if (id === 'self') return; // never remove the self node
      if (el.data.source && el.data.target) {
        if (!existingEdgeIds.has(id)) cy.add(el);
      } else {
        if (!existingNodeIds.has(id)) cy.add(el);
      }
    });
    // Apply port count badge as a `data` attr so future stylesheet rules can
    // size nodes by open-port count if desired.
    sortedHosts.forEach((h) => {
      const n = cy.getElementById(h.ip);
      if (n.nonempty()) n.data('ports', String(h.ports.length));
    });

    // Only re-run the expensive fcose layout when the topology actually
    // changed. Same hosts re-listed (e.g. user clicks "refresh" or scan
    // completes with identical results) won't cause node jitter.
    const topologyKey = [...desiredHostIds].sort().join(',');
    if (topologyKey !== lastRenderedIdsRef.current) {
      lastRenderedIdsRef.current = topologyKey;
      const hasNodes = cy.nodes().length > 1;
      if (hasNodes) {
        cy.layout({
          name: 'fcose',
          quality: 'default',
          randomize: true,
          animate: false,
          nodeSeparation: 80,
          idealEdgeLength: () => 90,
          nodeRepulsion: () => 8000,
          gravity: 0.25,
          numIter: 2500,
          fit: true,
          padding: 30,
        } as cytoscape.LayoutOptions).run();
      } else if (cy.nodes().length === 1) {
        cy.fit(undefined, 30);
      }
    } else {
      // Same host set — keep current layout but make sure everything is
      // visible (e.g. after the panel was resized).
      cy.fit(undefined, 30);
    }
  }, [sortedHosts, systemInfo, colorForHost]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cyCoreRef.current?.destroy();
      cyCoreRef.current = null;
    };
  }, []);

  // Sync selectedIp → cytoscape visual selection.
  useEffect(() => {
    const cy = cyCoreRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selectedIp) {
      const n = cy.getElementById(selectedIp);
      if (n.nonempty()) n.select();
    }
  }, [selectedIp]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex flex-1 items-center gap-2">
          <input
            value={subnet}
            onChange={(e) => setSubnet(e.target.value)}
            placeholder="auto-detect /24 (留空)"
            className="w-64 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
          />
          <button
            type="button"
            onClick={handleScan}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? '扫描中…' : '扫描 LAN'}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            title="刷新 (用存储里已扫到的主机)"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={() => {
              const cy = cyCoreRef.current;
              if (cy) cy.fit(undefined, 30);
            }}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            title="重新居中 + 适配视窗"
          >
            居中
          </button>
          {lastScan && (
            <span className="text-[11px] text-muted-foreground">
              上次: {lastScan.found} 主机 / {lastScan.totalMs?.toFixed(0) ?? '?'}ms
              {' · '}
              {new Date(lastScan.ts).toLocaleTimeString()}
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          已知 {hosts.length} 主机
          {systemInfo ? ` · ${systemInfo.hostname}` : ''}
        </span>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid flex-1 grid-cols-[1fr_280px] overflow-hidden">
        {/* Topology */}
        <div className="relative overflow-hidden bg-muted/20">
          {sortedHosts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Network className="h-10 w-10 opacity-30" />
              <p>还没有扫描过 LAN</p>
              <p className="text-xs opacity-70">点上面的「扫描 LAN」开始 TCP 扫描本地 /24</p>
              {hosts.length === 0 && busy === false && (
                <p className="text-[10px] opacity-50">
                  (Windows 上 loopback /24 会扫到 32 个虚拟主机;实际部署可以填真实子网如 192.168.1.0)
                </p>
              )}
            </div>
          ) : (
            <div ref={cyRef} className="h-full w-full" />
          )}
          <div className="pointer-events-none absolute right-2 top-2 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground shadow">
            <span className="mr-2"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" /> Web (80/443)</span>
            <span className="mr-2"><span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" /> Other TCP</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" /> No ports</span>
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground shadow">
            拖动节点 · 滚轮缩放 · 双击空白处自适应
          </div>
        </div>

        {/* Sidebar: details / list */}
        <aside className="border-l border-border overflow-auto bg-background">
          {selected ? (
            <div className="space-y-3 p-3 text-sm">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">IP</div>
                <div className="font-mono text-base">{selected.ip}</div>
              </div>
              {selected.hostname && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Hostname</div>
                  <div className="font-mono text-xs break-all">{selected.hostname}</div>
                </div>
              )}
              {selected.mac && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">MAC</div>
                  <div className="font-mono text-xs">{selected.mac}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">开放端口 ({selected.ports.length})</div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {selected.ports.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    selected.ports.map((p) => (
                      <span key={p} className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]">
                        {p}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">首次发现</div>
                  <div className="font-mono">{new Date(selected.firstSeen).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">最近</div>
                  <div className="font-mono">{selected.ageMin < 1 ? '刚刚' : `${selected.ageMin} 分钟前`}</div>
                </div>
              </div>
              <div className="text-[10px] uppercase text-muted-foreground">来源</div>
              <div className="font-mono text-xs">{selected.source}</div>
              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedIp(null)}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  返回列表
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(selected.id)}
                  className="rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1 inline h-3 w-3" />
                  删除
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs">
              <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[10px] uppercase text-muted-foreground">
                主机列表 ({sortedHosts.length})
              </div>
              {sortedHosts.length === 0 ? (
                <div className="px-3 py-4 text-center text-muted-foreground">无</div>
              ) : (
                sortedHosts.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelectedIp(h.ip)}
                    className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left hover:bg-muted/40"
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: colorForHost(h) }}
                    />
                    <span className="flex-1 min-w-0">
                      <div className="truncate font-mono text-[11px]">{h.ip}</div>
                      {h.hostname && (
                        <div className="truncate text-[10px] text-muted-foreground">{h.hostname}</div>
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {h.ports.length > 0 ? `${h.ports.length}p` : '—'}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
