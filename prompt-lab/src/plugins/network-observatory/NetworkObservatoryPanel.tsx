/**
 * Network Observatory panel — V1.
 *
 * Minimal viable UI: input a target (hostname or IPv4), click "Start probe",
 * watch ICMP results stream in. No persistence yet (V1.1 will add storage).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network, Pause, Play, Plus, RefreshCw, Trash2, XCircle } from '@/components/icons';
import type { NetProbeEvent, NetProbeState } from './backend/net-probe-service';

interface NetProbeAPI {
  start: () => Promise<{ ready: boolean; version: string | null }>;
  state: () => Promise<NetProbeState>;
  results: () => Promise<Array<Extract<NetProbeEvent, { type: 'probe_result' }>>>;
  addTarget: (target: {
    id?: string;
    target: string;
    probe?: string;
    intervalMs?: number;
    timeoutMs?: number;
  }) => Promise<{ id: string }>;
  removeTarget: (id: string) => Promise<{ removed: boolean }>;
  systemInfo: () => Promise<{ hostname: string; platform: string; arch: string; cpus: number }>;
  onEvent: (callback: (event: NetProbeEvent) => void) => () => void;
}

function getNetProbeAPI(): NetProbeAPI | null {
  const api = (window as unknown as { electronAPI?: { netProbe?: NetProbeAPI } }).electronAPI
    ?.netProbe;
  return api ?? null;
}

interface TargetRow {
  id: string;
  target: string;
  intervalMs: number;
  addedAt: number;
  lastResult: Extract<NetProbeEvent, { type: 'probe_result' }> | null;
  successCount: number;
  failureCount: number;
}

function describeError(code: number | null, message?: string): string {
  if (code === 0) return 'exited cleanly';
  if (message) return message;
  if (code === null) return 'killed';
  return `exit ${code}`;
}

export const NetworkObservatoryPanel: React.FC = () => {
  const api = useMemo(() => getNetProbeAPI(), []);
  const [targets, setTargets] = useState<Map<string, TargetRow>>(new Map());
  const [draft, setDraft] = useState<string>('127.0.0.1');
  const [intervalSec, setIntervalSec] = useState<number>(2);
  const [systemInfo, setSystemInfo] = useState<{ hostname: string; platform: string } | null>(null);
  const [daemonState, setDaemonState] = useState<NetProbeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState<boolean>(true);
  const targetOrderRef = useRef<string[]>([]);

  // Boot: hydrate state + start daemon.
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
        const state = await api.state();
        if (!cancelled) setDaemonState(state);
        if (autoStart) {
          await api.start();
          if (!cancelled) setDaemonState(await api.state());
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, autoStart]);

  // Subscribe to events.
  useEffect(() => {
    if (!api) return;
    const off = api.onEvent((event) => {
      if (event.type === 'ready') {
        setDaemonState((prev) => ({
          ...(prev ?? {
            ready: false,
            version: null,
            pid: null,
            startedAt: null,
            lastError: null,
            lastExit: null,
          }),
          ready: true,
          version: event.version,
          pid: event.pid,
          startedAt: event.startedAt,
        }));
        setError(null);
        return;
      }
      if (event.type === 'error') {
        setError(event.message);
        return;
      }
      if (event.type === 'exit') {
        setDaemonState((prev) =>
          prev
            ? {
                ...prev,
                ready: false,
                lastExit: { code: event.code, error: event.error, timestampMs: event.timestampMs },
              }
            : prev,
        );
        return;
      }
      if (event.type === 'probe_result') {
        setTargets((prev) => {
          const next = new Map(prev);
          const row = next.get(event.id) ?? {
            id: event.id,
            target: event.id,
            intervalMs: 0,
            addedAt: Date.now(),
            lastResult: null,
            successCount: 0,
            failureCount: 0,
          };
          row.lastResult = event;
          if (event.success) row.successCount += 1;
          else row.failureCount += 1;
          next.set(event.id, row);
          return next;
        });
      }
    });
    return off;
  }, [api]);

  const addTarget = useCallback(async () => {
    if (!api) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const intervalMs = Math.max(500, Math.floor(intervalSec * 1000));
      const { id } = await api.addTarget({ target: trimmed, intervalMs });
      setTargets((prev) => {
        const next = new Map(prev);
        next.set(id, {
          id,
          target: trimmed,
          intervalMs,
          addedAt: Date.now(),
          lastResult: null,
          successCount: 0,
          failureCount: 0,
        });
        if (!targetOrderRef.current.includes(id)) targetOrderRef.current = [...targetOrderRef.current, id];
        return next;
      });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api, draft, intervalSec]);

  const removeTarget = useCallback(
    async (id: string) => {
      if (!api) return;
      try {
        await api.removeTarget(id);
        setTargets((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        targetOrderRef.current = targetOrderRef.current.filter((x) => x !== id);
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
      setDaemonState(await api.state());
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [api]);

  if (!api) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        netProbe IPC 未就绪 — 请检查 preload.ts 是否暴露了 electronAPI.netProbe
      </div>
    );
  }

  const orderedTargets = targetOrderRef.current
    .map((id) => targets.get(id))
    .filter((t): t is TargetRow => Boolean(t));

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">Network Observatory</h1>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">v0.1 · ICMP</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {systemInfo && (
            <span>
              {systemInfo.hostname} · {systemInfo.platform}
            </span>
          )}
          <DaemonStatusBadge state={daemonState} />
          <button
            type="button"
            onClick={restartDaemon}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 重新连接
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-destructive/70 hover:text-destructive">
            ×
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTarget();
          }}
          placeholder="目标 (域名或 IPv4,例如 8.8.8.8)"
          className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          间隔
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={intervalSec}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
            className="w-16 rounded border border-border bg-background px-2 py-1 text-xs"
          />
          秒
        </label>
        <button
          type="button"
          onClick={addTarget}
          className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> 添加
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {orderedTargets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Network className="h-8 w-8 opacity-30" />
            <p>添加一个目标开始 ICMP 探测</p>
            <p className="text-xs opacity-70">V1 仅支持 IPv4,DAEMON 通过 Rust nwd-net-probe 子进程运行</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">目标</th>
                <th className="px-4 py-2 text-left">状态</th>
                <th className="px-4 py-2 text-right">最近延迟</th>
                <th className="px-4 py-2 text-right">成功 / 失败</th>
                <th className="px-4 py-2 text-right">时间</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orderedTargets.map((t) => (
                <TargetTableRow key={t.id} row={t} onRemove={removeTarget} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        ICMP via IcmpSendEcho (Windows) / raw socket (Unix) — V1 不存储历史,V1.1 加 SQLite 持久化
      </footer>
    </div>
  );
};

const DaemonStatusBadge: React.FC<{ state: NetProbeState | null }> = ({ state }) => {
  if (!state) return <span className="rounded bg-muted px-2 py-0.5">未知</span>;
  if (state.ready) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-600">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        运行中 · v{state.version}
      </span>
    );
  }
  if (state.lastExit) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-amber-600">
        <Pause className="h-3 w-3" /> 已退出 — {describeError(state.lastExit.code, state.lastExit.error)}
      </span>
    );
  }
  return <span className="rounded bg-muted px-2 py-0.5">未启动</span>;
};

const TargetTableRow: React.FC<{ row: TargetRow; onRemove: (id: string) => void }> = ({
  row,
  onRemove,
}) => {
  const r = row.lastResult;
  return (
    <tr className="border-b border-border/60 hover:bg-muted/30">
      <td className="px-4 py-2">
        <div className="font-mono text-sm">{row.target}</div>
        <div className="text-xs text-muted-foreground">
          id={row.id} · {row.intervalMs}ms
        </div>
      </td>
      <td className="px-4 py-2">
        {r ? (
          r.success ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Play className="h-3 w-3" /> 正常
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-destructive" title={r.error ?? ''}>
              <XCircle className="h-3 w-3" /> 失败
            </span>
          )
        ) : (
          <span className="text-muted-foreground">等待中</span>
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {r && r.latencyMs != null ? `${r.latencyMs.toFixed(1)} ms` : '—'}
      </td>
      <td className="px-4 py-2 text-right font-mono">
        <span className="text-emerald-600">{row.successCount}</span>
        <span className="mx-1 text-muted-foreground">/</span>
        <span className="text-destructive">{row.failureCount}</span>
      </td>
      <td className="px-4 py-2 text-right text-xs text-muted-foreground">
        {r ? new Date(r.timestampMs).toLocaleTimeString() : '—'}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="text-muted-foreground hover:text-destructive"
          title="移除目标"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
};
