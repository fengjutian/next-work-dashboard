/**
 * nwd-net-probe daemon backend.
 *
 * Spawns the Rust CLI sidecar, manages its lifecycle, and forwards JSONL events
 * to the renderer. Modeled on `disk-space/backend/disk-service.ts` but adapted
 * for the long-lived daemon pattern: the binary runs until shutdown, accepts
 * AddTarget / RemoveTarget / Shutdown over stdin, and emits ProbeResult events
 * on stdout.
 *
 * V1 scope: ICMP probe only. The IPC surface is small on purpose.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';

const DAEMON_START_TIMEOUT_MS = 10_000;
const PROBE_RESULT_HISTORY_LIMIT = 500;

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

export interface NetProbeTarget {
  id: string;
  target: string;
  probe?: string;
  intervalMs?: number;
  timeoutMs?: number;
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
let shuttingDown = false;
let restartAttempts = 0;
let nextTargetId = 1;
const recentResults: Array<Extract<NetProbeEvent, { type: 'probe_result' }>> = [];
const windowListeners = new Set<BrowserWindow>();

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
  for (const win of windowListeners) {
    if (!win.isDestroyed()) {
      win.webContents.send('net-probe:event', event);
    }
  }
}

function recordResult(event: Extract<NetProbeEvent, { type: 'probe_result' }>): void {
  recentResults.push(event);
  if (recentResults.length > PROBE_RESULT_HISTORY_LIMIT) {
    recentResults.splice(0, recentResults.length - PROBE_RESULT_HISTORY_LIMIT);
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
  // Backoff up to 30s, reset on first success.
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

export async function startDaemon(): Promise<{ ready: boolean; version: string | null }> {
  if (processHandle && state.ready) {
    return { ready: true, version: state.version };
  }
  if (processHandle && !state.ready) {
    // Wait for ready (or reject on timeout).
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

  // Stderr → log + state.lastError (non-fatal: we still treat it as alive).
  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-2048);
  });

  // Stdout → JSONL events.
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
      };
      recordResult(event);
      broadcast(event);
      return;
    }
    if (obj.type === 'error') {
      const message = String((obj as { message?: unknown }).message ?? 'unknown error');
      state.lastError = message;
      broadcast({ type: 'error', message, timestampMs: Date.now() });
      return;
    }
    // Unknown type — ignore for forward compatibility.
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

  // Wait for ready before returning.
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

export async function addTarget(target: NetProbeTarget): Promise<{ id: string }> {
  const id = target.id || `t${nextTargetId++}`;
  await startDaemon();
  sendStdin({
    type: 'add_target',
    id,
    target: target.target,
    probe: target.probe ?? 'icmp',
    interval_ms: target.intervalMs ?? 5000,
    ...(target.timeoutMs ? { timeout_ms: target.timeoutMs } : {}),
  });
  return { id };
}

export async function removeTarget(id: string): Promise<{ removed: boolean }> {
  if (!processHandle || !state.ready) return { removed: false };
  sendStdin({ type: 'remove_target', id });
  return { removed: true };
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

export async function shutdownDaemon(): Promise<void> {
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (processHandle && state.ready) {
    try {
      sendStdin({ type: 'shutdown' });
    } catch {
      // best-effort
    }
    // Give it a moment to exit cleanly, then kill.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (processHandle) {
    processHandle.kill();
    processHandle = null;
  }
  state.ready = false;
  state.pid = null;
  state.startedAt = null;
}

export function setupNetProbeIPC(): void {
  ipcMain.handle('net-probe:start', async () => startDaemon());
  ipcMain.handle('net-probe:state', () => snapshotState());
  ipcMain.handle('net-probe:results', () => snapshotResults());
  ipcMain.handle('net-probe:add-target', (_event, target: NetProbeTarget) => addTarget(target));
  ipcMain.handle('net-probe:remove-target', (_event, id: string) => removeTarget(id));
  ipcMain.handle('net-probe:system-info', () => ({
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
  }));
  // Renderer-side window tracking so the backend can broadcast to all open windows.
  app.on('browser-window-created', (_event, win) => {
    const dispose = trackWindow(win);
    win.on('closed', dispose);
  });
}
