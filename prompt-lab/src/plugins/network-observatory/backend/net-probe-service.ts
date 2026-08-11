/**
 * nwd-net-probe daemon backend.
 *
 * Spawns the Rust CLI sidecar, manages its lifecycle, persists probe results
 * to SQLite, evaluates alert rules, and forwards events to the renderer.
 *
 * V1.1: history persistence (7-day retention), alert engine with desktop
 * notifications, target CRUD via storage.
 */
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';

import {
  dbListTargets,
  dbGetTarget,
  dbUpsertTarget,
  dbDeleteTarget,
  dbListResults,
  dbInsertResult,
  dbListAlertRules,
  dbGetAlertRule,
  dbUpsertAlertRule,
  dbDeleteAlertRule,
  dbListIncidents,
  dbCloseIncident,
  dbAggregateHeatmap,
  dbListLanHosts,
  dbUpsertLanHost,
  dbDeleteLanHost,
  type NetProbeTarget,
  type NetProbeResult,
  type NetProbeAlertRule,
  type NetProbeIncident,
  type HeatmapCell,
  type NetProbeLanHost,
} from './net-probe-storage';
import { evaluateAlerts, maintenanceTick, getOpenIncidentsSnapshot, resetAlertState } from './net-probe-alerts';
import { testChannel } from './net-probe-notify';
import { validateLanScanOptions, validateTargetInput } from './net-probe-validation';

const DAEMON_START_TIMEOUT_MS = 10_000;
const INMEM_RESULT_LIMIT = 500;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export type NetProbeEvent =
  | { type: 'ready'; version: string; pid: number; startedAt: number }
  | {
      type: 'probe_result';
      id: string;
      probe: string;
      timestampMs: number;
      success: boolean;
      latencyMs: number | null;
      error: string | null;
      payload: Record<string, unknown> | null;
    }
  | { type: 'error'; message: string; timestampMs: number }
  | { type: 'exit'; code: number | null; error?: string; timestampMs: number };

export interface NetProbeState {
  ready: boolean;
  version: string | null;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  lastExit: { code: number | null; error?: string; timestampMs: number } | null;
}

export interface NetProbeTargetInput {
  id?: string;
  target: string;
  probe?: 'icmp' | 'tcp' | 'dns' | 'http' | 'traceroute' | 'lan_scan';
  intervalMs?: number;
  timeoutMs?: number;
  options?: Record<string, unknown>;
  enabled?: boolean;
}

const state: NetProbeState = {
  ready: false,
  version: null,
  pid: null,
  startedAt: null,
  lastError: null,
  lastExit: null,
};

let processHandle: ChildProcess | null = null;
let pendingReady: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
let restartAttempts = 0;
let nextTargetId = 1;
const recentResults: Array<Extract<NetProbeEvent, { type: 'probe_result' }>> = [];
const targetHistoryCache = new Map<string, NetProbeResult[]>();
const windowListeners = new Set<BrowserWindow>();
const broadcastSubscribers = new Set<(ev: NetProbeEvent) => void>();

function probePath(): string {
  const executable = process.platform === 'win32' ? 'nwd-net-probe.exe' : 'nwd-net-probe';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'net-probe', executable)]
    : [
        path.join(app.getAppPath(), 'native', 'net-probe', 'target', 'release', executable),
        path.join(app.getAppPath(), 'resources', 'net-probe', executable),
        path.join(process.cwd(), 'resources', 'net-probe', executable),
      ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error(
      `nwd-net-probe 未构建。运行: cd prompt-lab && npm run build:net-probe。搜索路径: ${candidates.join(', ')}`,
    );
  }
  return found;
}

function broadcast(event: NetProbeEvent): void {
  for (const sub of broadcastSubscribers) {
    try { sub(event); } catch { /* ignore */ }
  }
  for (const win of windowListeners) {
    if (!win.isDestroyed()) {
      win.webContents.send('net-probe:event', event);
    }
  }
}

function recordResult(event: Extract<NetProbeEvent, { type: 'probe_result' }>): void {
  recentResults.push(event);
  if (recentResults.length > INMEM_RESULT_LIMIT) {
    recentResults.splice(0, recentResults.length - INMEM_RESULT_LIMIT);
  }
}

function sendStdin(line: object): void {
  if (!processHandle || !processHandle.stdin || processHandle.stdin.writableEnded) {
    throw new Error('net-probe daemon 不可用');
  }
  processHandle.stdin.write(JSON.stringify(line) + '\n');
}

function scheduleRestart(): void {
  if (shuttingDown) return;
  if (restartTimer) return;
  const delay = Math.min(30_000, 1_000 * Math.pow(2, restartAttempts));
  restartAttempts += 1;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startDaemon().catch((e) => {
      state.lastError = String((e as Error).message ?? e);
      broadcast({ type: 'error', message: state.lastError, timestampMs: Date.now() });
    });
  }, delay);
}

function startMaintenance(): void {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    try {
      maintenanceTick();
    } catch (e) {
      // best-effort
      // eslint-disable-next-line no-console
      console.warn('[net-probe] maintenance failed:', e);
    }
  }, MAINTENANCE_INTERVAL_MS);
}

export async function startDaemon(): Promise<{ ready: boolean; version: string | null }> {
  if (processHandle && state.ready) {
    return { ready: true, version: state.version };
  }
  if (processHandle && !state.ready) {
    await new Promise<void>((resolve, reject) => {
      pendingReady = {
        resolve,
        reject,
        timer: setTimeout(() => {
          pendingReady = null;
          reject(new Error('nwd-net-probe 启动超时'));
        }, DAEMON_START_TIMEOUT_MS),
      };
    });
    return { ready: true, version: state.version };
  }

  const binary = probePath();
  const child = spawn(binary, ['daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  processHandle = child;
  state.pid = child.pid ?? null;
  state.startedAt = Date.now();
  state.ready = false;
  state.lastError = null;

  if (!child.stdout || !child.stderr) {
    throw new Error('nwd-net-probe 子进程无 stdout/stderr');
  }

  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-2048);
  });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      state.lastError = `parse: ${String((e as Error).message)}`;
      broadcast({ type: 'error', message: state.lastError, timestampMs: Date.now() });
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as { type?: string; [k: string]: unknown };
    if (obj.type === 'ready') {
      state.ready = true;
      state.version = typeof obj.version === 'string' ? obj.version : null;
      restartAttempts = 0;
      const event: NetProbeEvent = {
        type: 'ready',
        version: state.version ?? 'unknown',
        pid: state.pid ?? 0,
        startedAt: state.startedAt ?? Date.now(),
      };
      broadcast(event);
      // On ready, sync persisted targets to the daemon.
      try {
        for (const t of dbListTargets().filter((t) => t.enabled)) {
          sendStdin({
            type: 'add_target',
            id: t.id,
            target: t.target,
            probe: t.probe,
            interval_ms: t.intervalMs,
            timeout_ms: t.timeoutMs,
            options: safeParseJson(t.optionsJson),
          });
        }
      } catch (e) {
        // best-effort
      }
      if (pendingReady) {
        const p = pendingReady;
        pendingReady = null;
        clearTimeout(p.timer);
        p.resolve();
      }
      return;
    }
    if (obj.type === 'probe_result') {
      const event: Extract<NetProbeEvent, { type: 'probe_result' }> = {
        type: 'probe_result',
        id: String(obj.id ?? ''),
        probe: String(obj.probe ?? 'icmp'),
        timestampMs: Number(obj.timestamp_ms ?? Date.now()),
        success: Boolean(obj.success),
        latencyMs: typeof obj.latency_ms === 'number' ? (obj.latency_ms as number) : null,
        error: typeof obj.error === 'string' ? (obj.error as string) : null,
        payload: (obj.payload as Record<string, unknown> | null) ?? null,
      };
      recordResult(event);
      broadcast(event);

      // Persist to SQLite.
      const row = dbInsertResult({
        targetId: event.id,
        probe: event.probe,
        timestampMs: event.timestampMs,
        success: event.success,
        latencyMs: event.latencyMs,
        error: event.error,
        payloadJson: JSON.stringify(event.payload ?? {}),
      });
      // Update in-memory per-target history for alert evaluation.
      const cache = targetHistoryCache.get(event.id) ?? [];
      cache.unshift(row);
      if (cache.length > 32) cache.length = 32;
      targetHistoryCache.set(event.id, cache);
      // Evaluate alerts (best-effort).
      try {
        evaluateAlerts({ result: row, targetHistory: cache });
      } catch (e) {
        // best-effort
      }
      return;
    }
    if (obj.type === 'error') {
      const message = String((obj as { message?: unknown }).message ?? 'unknown error');
      state.lastError = message;
      broadcast({ type: 'error', message, timestampMs: Date.now() });
      return;
    }
  });

  child.on('close', (code) => {
    processHandle = null;
    state.ready = false;
    const exitEvent: Extract<NetProbeEvent, { type: 'exit' }> = {
      type: 'exit',
      code,
      error: code === 0 ? undefined : stderrTail.trim() || 'subprocess exited',
      timestampMs: Date.now(),
    };
    state.lastExit = { code, error: exitEvent.error, timestampMs: exitEvent.timestampMs };
    broadcast(exitEvent);
    if (pendingReady) {
      const p = pendingReady;
      pendingReady = null;
      clearTimeout(p.timer);
      p.reject(new Error(exitEvent.error ?? 'subprocess exited before ready'));
    }
    if (!shuttingDown) scheduleRestart();
  });

  await new Promise<void>((resolve, reject) => {
    pendingReady = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pendingReady = null;
        reject(new Error('nwd-net-probe 启动超时'));
      }, DAEMON_START_TIMEOUT_MS),
    };
  });

  startMaintenance();
  return { ready: true, version: state.version };
}

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v != null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function addTarget(input: NetProbeTargetInput): Promise<NetProbeTarget> {
  const validated = validateTargetInput(input);
  const id = validated.id ?? `t${nextTargetId++}`;
  const row = dbUpsertTarget({
    id,
    target: validated.target,
    probe: validated.probe ?? 'icmp',
    intervalMs: validated.intervalMs ?? 5000,
    timeoutMs: validated.timeoutMs ?? 3000,
    optionsJson: JSON.stringify(validated.options ?? {}),
    enabled: validated.enabled ?? true,
  });
  await startDaemon();
  if (row.enabled) {
    sendStdin({
      type: 'add_target',
      id: row.id,
      target: row.target,
      probe: row.probe,
      interval_ms: row.intervalMs,
      timeout_ms: row.timeoutMs,
      options: safeParseJson(row.optionsJson),
    });
  }
  return row;
}

export async function removeTarget(id: string): Promise<{ removed: boolean }> {
  const ok = dbDeleteTarget(id);
  targetHistoryCache.delete(id);
  if (processHandle && state.ready) {
    try {
      sendStdin({ type: 'remove_target', id });
    } catch {
      // daemon may be down — restart will not re-add because db is gone
    }
  }
  return { removed: ok };
}

export async function updateTargetEnabled(id: string, enabled: boolean): Promise<NetProbeTarget | null> {
  const existing = dbGetTarget(id);
  if (!existing) return null;
  const row = dbUpsertTarget({ ...existing, enabled });
  if (!enabled && processHandle && state.ready) {
    try {
      sendStdin({ type: 'remove_target', id });
    } catch {
      // best-effort
    }
  } else if (enabled) {
    await startDaemon();
    try {
      sendStdin({
        type: 'add_target',
        id: row.id,
        target: row.target,
        probe: row.probe,
        interval_ms: row.intervalMs,
        timeout_ms: row.timeoutMs,
        options: safeParseJson(row.optionsJson),
      });
    } catch {
      // best-effort
    }
  }
  return row;
}

export function snapshotState(): NetProbeState {
  return { ...state };
}

export function snapshotResults(): Array<Extract<NetProbeEvent, { type: 'probe_result' }>> {
  return [...recentResults];
}

export function trackWindow(win: BrowserWindow): () => void {
  windowListeners.add(win);
  return () => {
    windowListeners.delete(win);
  };
}

/**
 * Helper for `scan-lan` etc.: collects the next `probe_result` event whose
 * `id` matches `targetId`. Resolves with the event payload (or null on
 * timeout). Cancelling via `cancel()` releases any pending waiters and
 * clears the timeout so we don't keep a live timer in memory.
 */
class OneShotCollector {
  private resolve: ((value: Extract<NetProbeEvent, { type: 'probe_result' }> | null) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private cancelled = false;
  constructor(
    private readonly targetId: string,
    private readonly timeoutMs: number,
  ) {}
  handle(ev: NetProbeEvent): void {
    if (ev.type !== 'probe_result' || ev.id !== this.targetId) return;
    if (this.resolve && !this.cancelled) {
      const r = this.resolve;
      this.resolve = null;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      r(ev as Extract<NetProbeEvent, { type: 'probe_result' }>);
    }
  }
  wait(): Promise<Extract<NetProbeEvent, { type: 'probe_result' }> | null> {
    if (this.cancelled) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.timer = setTimeout(() => {
        if (this.resolve) {
          const r = this.resolve;
          this.resolve = null;
          this.timer = null;
          r(null);
        }
      }, this.timeoutMs);
    });
  }
  cancel(): void {
    this.cancelled = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(null);
    }
  }
}

/**
 * Subscribe to broadcasted net-probe events from the main process side.
 * Returns an unsubscribe function. Used by handlers that need to wait for
 * the next event matching a predicate.
 */
function broadcastListeners(handler: (ev: NetProbeEvent) => void): () => void {
  const wrapped = (ev: NetProbeEvent) => handler(ev);
  broadcastSubscribers.add(wrapped);
  return () => broadcastSubscribers.delete(wrapped);
}

export async function shutdownDaemon(): Promise<void> {
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
  if (processHandle && state.ready) {
    try {
      sendStdin({ type: 'shutdown' });
    } catch {
      // best-effort
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (processHandle) {
    processHandle.kill();
    processHandle = null;
  }
  state.ready = false;
  state.pid = null;
  state.startedAt = null;
  resetAlertState();
}

export function setupNetProbeIPC(): void {
  ipcMain.handle('net-probe:start', async () => startDaemon());
  ipcMain.handle('net-probe:state', () => snapshotState());
  ipcMain.handle('net-probe:system-info', () => ({
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
  }));
  ipcMain.handle('net-probe:list-targets', () => dbListTargets());
  ipcMain.handle('net-probe:add-target', (_event, input: NetProbeTargetInput) => addTarget(input));
  ipcMain.handle('net-probe:remove-target', (_event, id: string) => removeTarget(id));
  ipcMain.handle('net-probe:update-target', (_event, id: string, patch: Partial<NetProbeTargetInput>) => {
    const existing = dbGetTarget(id);
    if (!existing) return null;
    const validated = validateTargetInput({
      id,
      target: patch.target ?? existing.target,
      probe: patch.probe ?? existing.probe as NetProbeTargetInput['probe'],
      intervalMs: patch.intervalMs ?? existing.intervalMs,
      timeoutMs: patch.timeoutMs ?? existing.timeoutMs,
      options: patch.options ?? safeParseJson(existing.optionsJson) ?? {},
      enabled: patch.enabled ?? existing.enabled,
    });
    return dbUpsertTarget({
      ...existing,
      target: validated.target,
      probe: validated.probe ?? existing.probe,
      intervalMs: validated.intervalMs ?? existing.intervalMs,
      timeoutMs: validated.timeoutMs ?? existing.timeoutMs,
      optionsJson: JSON.stringify(validated.options ?? {}),
      enabled: validated.enabled ?? existing.enabled,
    });
  });
  ipcMain.handle('net-probe:set-target-enabled', (_event, id: string, enabled: boolean) => updateTargetEnabled(id, enabled));
  ipcMain.handle('net-probe:list-results', (_event, opts: { targetId?: string; sinceMs?: number; untilMs?: number; limit?: number }) => dbListResults(opts ?? {}));
  ipcMain.handle('net-probe:heatmap', (_event, opts: { targetId: string; sinceMs?: number }) => dbAggregateHeatmap(opts));
  ipcMain.handle('net-probe:list-alert-rules', () => dbListAlertRules());
  ipcMain.handle('net-probe:add-alert-rule', (_event, input: Omit<NetProbeAlertRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => dbUpsertAlertRule(input));
  ipcMain.handle('net-probe:remove-alert-rule', (_event, id: string) => dbDeleteAlertRule(id));
  ipcMain.handle('net-probe:list-incidents', (_event, opts?: { openOnly?: boolean; limit?: number }) => dbListIncidents(opts ?? {}));
  ipcMain.handle('net-probe:close-incident', (_event, id: string) => dbCloseIncident(id, Date.now()));
  ipcMain.handle('net-probe:open-incidents-snapshot', () => getOpenIncidentsSnapshot());
  ipcMain.handle('net-probe:test-channel', async (_event, args: { notify: string; notifyConfig?: string }) => {
    try {
      return await testChannel(args.notify, args.notifyConfig);
    } catch (e) {
      return { ok: false, channel: args.notify, detail: String((e as Error).message ?? e), durationMs: 0 };
    }
  });
  ipcMain.handle('net-probe:on-event', () => true); // no-op marker
  ipcMain.handle('net-probe:list-lan-hosts', (_event, opts?: { scanId?: string; sinceMs?: number; limit?: number }) => dbListLanHosts(opts ?? {}));
  ipcMain.handle('net-probe:delete-lan-host', (_event, id: string) => dbDeleteLanHost(id));
  // scan-lan: spawn a one-shot lan_scan via the daemon, collect the result,
  // merge the discovered hosts into storage, return the raw payload. We use
  // a fresh target id so it doesn't collide with user-added targets.
  ipcMain.handle('net-probe:scan-lan', async (_event, opts: { subnet?: string; maxHosts?: number; perPortTimeoutMs?: number } = {}) => {
    const validatedOpts = validateLanScanOptions(opts);
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetId = `lanscan-${scanId}`;
    const scanOptions: Record<string, unknown> = {
      max_hosts: validatedOpts.maxHosts,
      per_port_timeout_ms: validatedOpts.perPortTimeoutMs,
    };
    if (validatedOpts.subnet) scanOptions.subnet = validatedOpts.subnet;

    const collector = new OneShotCollector(targetId, 30_000);
    const off = broadcastListeners((ev) => collector.handle(ev));
    try {
      await startDaemon();
      await addTarget({
        id: targetId,
        target: validatedOpts.subnet ? `lan:${validatedOpts.subnet}` : 'lan:auto',
        probe: 'lan_scan',
        intervalMs: 600_000, // effectively one-shot
        timeoutMs: 30_000,
        options: scanOptions,
        enabled: true,
      });
      const result = await collector.wait();
      if (!result) throw new Error('lan scan timed out (30s)');
      const payload = (result.payload ?? {}) as {
        hosts?: Array<{ ip: string; hostname?: string; open_ports?: number[] }>;
        subnet?: string;
      };
      const hosts = payload.hosts ?? [];
      const merged: NetProbeLanHost[] = [];
      for (const h of hosts) {
        const upserted = dbUpsertLanHost({
          ip: h.ip,
          hostname: h.hostname ?? null,
          openPorts: h.open_ports ?? [],
          source: 'tcp',
          scanId,
        });
        merged.push(upserted);
      }
      return {
        scanId,
        subnet: payload.subnet ?? null,
        found: hosts.length,
        hosts: merged,
        totalMs: result.latencyMs,
      };
    } finally {
      // Best-effort cleanup of the one-shot target so it doesn't sit in the
      // targets table forever.
      try { await removeTarget(targetId); } catch { /* ignore */ }
      off();
      collector.cancel();
    }
  });
  ipcMain.on('net-probe:event', (event, payload: NetProbeEvent) => {
    // not used: actual broadcast goes through trackWindow + window.webContents.send
    void event;
    void payload;
  });
  app.on('browser-window-created', (_event, win) => {
    const dispose = trackWindow(win);
    win.on('closed', dispose);
  });
}
