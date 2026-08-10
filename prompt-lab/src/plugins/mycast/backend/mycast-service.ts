/**
 * nwd-mycast sidecar backend.
 *
 * Spawns the Rust MyCast daemon, manages its lifecycle, forwards events to
 * the renderer, and exposes IPC handlers for renderer-side operations.
 *
 * Architecture:
 *   Electron Main
 *      │  spawn nwd-mycast (stdin/stdout JSONL)
 *      ▼
 *   Rust sidecar
 *      │  HTTP/WS to phones (LAN)
 *      ▼
 *   Phones / browsers
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';

const DAEMON_START_TIMEOUT_MS = 8_000;

export type MyCastEvent =
  | { type: 'ready'; deviceId: string; deviceName: string; platform: string; httpPort: number; wsPort: number; mdnsEnabled: boolean; version: string; bindAddr: string }
  | { type: 'phone.hello'; deviceId: string; deviceName: string; platform: string }
  | { type: 'phone.pair'; deviceId: string; deviceName: string; platform: string; tokenPrefix: string }
  | { type: 'session.created'; sessionId: string; phoneDeviceId: string; kind: 'screen' | 'file' | 'discovery' }
  | { type: 'webrtc.offer'; sessionId: string; phoneDeviceId: string; sdp: string }
  | { type: 'webrtc.answer'; sessionId: string; phoneDeviceId: string; sdp: string }
  | { type: 'webrtc.ice'; sessionId: string; phoneDeviceId: string; candidate: unknown }
  | { type: 'stream.start'; sessionId: string; phoneDeviceId: string }
  | { type: 'stream.stop'; sessionId: string; phoneDeviceId: string }
  | { type: 'error'; message: string };

export interface MyCastState {
  ready: boolean;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  httpPort: number | null;
  wsPort: number | null;
  bindAddr: string | null;
  mdnsEnabled: boolean | null;
  version: string | null;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
}

const state: MyCastState = {
  ready: false,
  deviceId: null,
  deviceName: null,
  platform: null,
  httpPort: null,
  wsPort: null,
  bindAddr: null,
  mdnsEnabled: null,
  version: null,
  pid: null,
  startedAt: null,
  lastError: null,
};

let processHandle: ChildProcess | null = null;
let pendingReady: { resolve: (info: MyCastState) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const windowListeners = new Set<BrowserWindow>();
let shuttingDown = false;
let restartTimer: NodeJS.Timeout | null = null;
let restartAttempts = 0;

function binaryPath(): string {
  const executable = process.platform === 'win32' ? 'nwd-mycast.exe' : 'nwd-mycast';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'mycast', executable)]
    : [
        path.join(app.getAppPath(), 'native', 'mycast', 'target', 'release', executable),
        path.join(process.resourcesPath, 'mycast', executable),
        path.join(process.cwd(), 'resources', 'mycast', executable),
      ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error(
      `nwd-mycast 未构建。运行: cd prompt-lab && npm run build:mycast。搜索路径: ${candidates.join(', ')}`,
    );
  }
  return found;
}

function broadcast(event: MyCastEvent): void {
  for (const win of windowListeners) {
    if (!win.isDestroyed()) {
      win.webContents.send('mycast:event', event);
    }
  }
}

function sendRequest(payload: Record<string, unknown>): Promise<unknown> {
  if (!processHandle || !processHandle.stdin || processHandle.stdin.writableEnded) {
    return Promise.reject(new Error('mycast daemon 不可用'));
  }
  const id = nextRequestId++;
  const line = JSON.stringify({ id, ...payload }) + '\n';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`mycast RPC 超时: ${payload.type}`));
    }, 8_000);
    pendingRequests.set(id, { resolve, reject, timer });
    processHandle!.stdin!.write(line);
  });
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
      broadcast({ type: 'error', message: state.lastError });
    });
  }, delay);
}

export async function startDaemon(): Promise<MyCastState> {
  if (processHandle && state.ready) return { ...state };
  if (processHandle && !state.ready) {
    return new Promise<MyCastState>((resolve, reject) => {
      pendingReady = {
        resolve: () => resolve({ ...state }),
        reject,
        timer: setTimeout(() => {
          pendingReady = null;
          reject(new Error('nwd-mycast 启动超时'));
        }, DAEMON_START_TIMEOUT_MS),
      };
    });
  }

  const binary = binaryPath();
  const child = spawn(binary, ['daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  processHandle = child;
  state.pid = child.pid ?? null;
  state.startedAt = Date.now();
  state.ready = false;
  state.lastError = null;

  if (!child.stdout || !child.stderr) {
    throw new Error('nwd-mycast 子进程无 stdout/stderr');
  }

  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-2048);
  });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as Record<string, unknown>;
    const kind = String(obj.type ?? '');

    // Response to a request (has id + ok).
    if (typeof obj.id === 'number' && 'ok' in obj) {
      const entry = pendingRequests.get(obj.id);
      if (entry) {
        pendingRequests.delete(obj.id);
        clearTimeout(entry.timer);
        if ((obj as { ok?: unknown }).ok === false) {
          entry.reject(new Error(String((obj as { error?: unknown }).error ?? 'unknown error')));
        } else {
          const { type: _, id: __, ok: ___, ...rest } = obj as Record<string, unknown>;
          entry.resolve(rest);
        }
      }
      return;
    }

    // Event.
    switch (kind) {
      case 'ready': {
        state.ready = true;
        state.deviceId = String(obj.device_id ?? '');
        state.deviceName = String(obj.device_name ?? '');
        state.platform = String(obj.platform ?? '');
        state.httpPort = Number(obj.http_port ?? 0);
        state.wsPort = Number(obj.ws_port ?? 0);
        state.bindAddr = String(obj.bind_addr ?? '');
        state.mdnsEnabled = Boolean(obj.mdns_enabled);
        state.version = String(obj.version ?? '');
        restartAttempts = 0;
        const event: MyCastEvent = {
          type: 'ready',
          deviceId: state.deviceId!,
          deviceName: state.deviceName!,
          platform: state.platform!,
          httpPort: state.httpPort!,
          wsPort: state.wsPort!,
          mdnsEnabled: state.mdnsEnabled!,
          version: state.version!,
          bindAddr: state.bindAddr!,
        };
        broadcast(event);
        if (pendingReady) {
          const p = pendingReady;
          pendingReady = null;
          clearTimeout(p.timer);
          p.resolve({ ...state });
        }
        return;
      }
      case 'phone.hello': {
        broadcast({
          type: 'phone.hello',
          deviceId: String(obj.device_id ?? ''),
          deviceName: String(obj.device_name ?? ''),
          platform: String(obj.platform ?? ''),
        });
        return;
      }
      case 'phone.pair': {
        broadcast({
          type: 'phone.pair',
          deviceId: String(obj.device_id ?? ''),
          deviceName: String(obj.device_name ?? ''),
          platform: String(obj.platform ?? ''),
          tokenPrefix: String(obj.token_prefix ?? ''),
        });
        return;
      }
      case 'session.created': {
        broadcast({
          type: 'session.created',
          sessionId: String(obj.session_id ?? ''),
          phoneDeviceId: String(obj.phone_device_id ?? ''),
          kind: (obj.kind as 'screen' | 'file' | 'discovery') ?? 'screen',
        });
        return;
      }
      case 'webrtc.offer': {
        broadcast({
          type: 'webrtc.offer',
          sessionId: String(obj.session_id ?? ''),
          phoneDeviceId: String(obj.phone_device_id ?? ''),
          sdp: String(obj.sdp ?? ''),
        });
        return;
      }
      case 'webrtc.answer': {
        broadcast({
          type: 'webrtc.answer',
          sessionId: String(obj.session_id ?? ''),
          phoneDeviceId: String(obj.phone_device_id ?? ''),
          sdp: String(obj.sdp ?? ''),
        });
        return;
      }
      case 'webrtc.ice': {
        broadcast({
          type: 'webrtc.ice',
          sessionId: String(obj.session_id ?? ''),
          phoneDeviceId: String(obj.phone_device_id ?? ''),
          candidate: obj.candidate ?? null,
        });
        return;
      }
      case 'stream.start': {
        broadcast({
          type: 'stream.start',
          sessionId: String(obj.session_id ?? ''),
          phoneDeviceId: String(obj.phone_device_id ?? ''),
        });
        return;
      }
      case 'stream.stop': {
        broadcast({
          type: 'stream.stop',
          sessionId: String(obj.session_id ?? ''),
          phoneDeviceId: String(obj.phone_device_id ?? ''),
        });
        return;
      }
      case 'error': {
        state.lastError = String(obj.message ?? 'unknown error');
        broadcast({ type: 'error', message: state.lastError });
        return;
      }
    }
  });

  child.on('close', (code) => {
    processHandle = null;
    state.ready = false;
    state.pid = null;
    const errMsg = code === 0 ? 'mycast daemon 已退出' : `mycast daemon 异常退出 (code=${code}): ${stderrTail.trim().slice(-512)}`;
    state.lastError = errMsg;
    broadcast({ type: 'error', message: errMsg });
    if (pendingReady) {
      const p = pendingReady;
      pendingReady = null;
      clearTimeout(p.timer);
      p.reject(new Error(errMsg));
    }
    for (const [, entry] of pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error('daemon exited'));
    }
    pendingRequests.clear();
    if (!shuttingDown) scheduleRestart();
  });

  return new Promise<MyCastState>((resolve, reject) => {
    pendingReady = {
      resolve: () => resolve({ ...state }),
      reject,
      timer: setTimeout(() => {
        pendingReady = null;
        reject(new Error('nwd-mycast 启动超时'));
      }, DAEMON_START_TIMEOUT_MS),
    };
  });
}

export function snapshotState(): MyCastState {
  return { ...state };
}

export function systemInfo() {
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
  };
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
    try { await sendRequest({ type: 'shutdown' }); } catch { /* best-effort */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  if (processHandle) {
    processHandle.kill();
    processHandle = null;
  }
  state.ready = false;
  state.pid = null;
  state.startedAt = null;
}

export async function issuePairing(): Promise<{ pairCode: string; expiresInMs: number }> {
  const r = await sendRequest({ type: 'issue_pairing' }) as { pair_code?: string; expires_in_ms?: number };
  return {
    pairCode: String(r.pair_code ?? ''),
    expiresInMs: Number(r.expires_in_ms ?? 0),
  };
}

export async function listSessions(): Promise<unknown[]> {
  const r = await sendRequest({ type: 'list_sessions' }) as { sessions?: unknown[] };
  return r.sessions ?? [];
}

export async function listTransfers(): Promise<unknown[]> {
  const r = await sendRequest({ type: 'list_transfers' }) as { transfers?: unknown[] };
  return r.transfers ?? [];
}

export async function sendToPhone(deviceId: string, frame: Record<string, unknown>): Promise<boolean> {
  const r = await sendRequest({ type: 'send_to_phone', device_id: deviceId, frame }) as { delivered?: boolean };
  return Boolean(r.delivered);
}

export async function endSession(sessionId: string): Promise<boolean> {
  const r = await sendRequest({ type: 'end_session', session_id: sessionId }) as { removed?: boolean };
  return Boolean(r.removed);
}

export async function cancelTransfer(uploadId: string): Promise<boolean> {
  const r = await sendRequest({ type: 'cancel_transfer', upload_id: uploadId }) as { cancelled?: boolean };
  return Boolean(r.cancelled);
}

export function setupMyCastIPC(): void {
  ipcMain.handle('mycast:start', async () => {
    await startDaemon();
    return snapshotState();
  });
  ipcMain.handle('mycast:state', () => snapshotState());
  ipcMain.handle('mycast:system-info', () => systemInfo());
  ipcMain.handle('mycast:issue-pairing', () => issuePairing());
  ipcMain.handle('mycast:list-sessions', () => listSessions());
  ipcMain.handle('mycast:list-transfers', () => listTransfers());
  ipcMain.handle('mycast:send-to-phone', (_event, deviceId: string, frame: Record<string, unknown>) => sendToPhone(deviceId, frame));
  ipcMain.handle('mycast:end-session', (_event, sessionId: string) => endSession(sessionId));
  ipcMain.handle('mycast:cancel-transfer', (_event, uploadId: string) => cancelTransfer(uploadId));
  ipcMain.handle('mycast:on-event', () => true);
  app.on('browser-window-created', (_event, win) => {
    const dispose = trackWindow(win);
    win.on('closed', dispose);
  });
}
