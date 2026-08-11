/**
 * nwd-voice-engine sidecar backend.
 *
 * Spawns the Rust voice engine, manages its lifecycle, forwards events to
 * the renderer, and exposes IPC handlers for renderer-side operations.
 *
 * Architecture:
 *   Electron Main
 *      │  spawn nwd-voice-engine (stdin/stdout JSONL)
 *      ▼
 *   Rust sidecar
 *      │  cpal microphone + Silero VAD + WAV recorder
 *      ▼
 *   resources/voice-engine/*.wav (per-segment, captured by VAD)
 *
 * W2 surface: `models`, `speech.start`, `speech.end`, plus the
 * `audio.level` shape now includes `speech_prob` and `in_speech`.
 * The W1 `recording.raw` request stays for debug.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type {
  AudioLevelEvent,
  DaemonInfo,
  ModelsEvent,
  RecordingFinishedEvent,
  RecordingProgressEvent,
  RecordingStartedEvent,
  SpeechEndEvent,
  SpeechStartEvent,
  VoiceErrorEvent,
  VoiceEvent,
  VoiceState,
} from './voice-types';

const DAEMON_START_TIMEOUT_MS = 8_000;
const MAX_SEGMENTS_KEPT = 20;

const state: VoiceState = {
  ready: false,
  pid: null,
  startedAt: null,
  lastError: null,
  recording: false,
  inSpeech: false,
  level: 0,
  speechProb: 0,
  levelProgress: 0,
  lastRecordingPath: null,
  segments: [],
  info: null,
  models: null,
};

let processHandle: ChildProcess | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const windowListeners = new Set<BrowserWindow>();
let shuttingDown = false;
let restartTimer: NodeJS.Timeout | null = null;
let restartAttempts = 0;

function binaryPath(): string {
  const executable = process.platform === 'win32' ? 'nwd-voice-engine.exe' : 'nwd-voice-engine';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'voice-engine', executable)]
    : [
        path.join(app.getAppPath(), 'native', 'voice-engine', 'target', 'release', executable),
        path.join(process.resourcesPath, 'voice-engine', executable),
        path.join(process.cwd(), 'resources', 'voice-engine', executable),
      ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error(
      `nwd-voice-engine 未构建。运行: cd prompt-lab && npm run build:voice-engine。搜索路径: ${candidates.join(', ')}`,
    );
  }
  return found;
}

function broadcast(event: VoiceEvent): void {
  for (const win of windowListeners) {
    if (!win.isDestroyed()) {
      win.webContents.send('voice:event', event);
    }
  }
}

function sendRequest(payload: Record<string, unknown>): Promise<unknown> {
  if (!processHandle || !processHandle.stdin || processHandle.stdin.writableEnded) {
    return Promise.reject(new Error('voice daemon 不可用'));
  }
  const id = nextRequestId++;
  const line = JSON.stringify({ id, ...payload }) + '\n';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`voice RPC 超时: ${payload.type}`));
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
      broadcast({ type: 'error', payload: { message: state.lastError } });
    });
  }, delay);
}

function snapshotState(): VoiceState {
  return { ...state };
}

export async function startDaemon(): Promise<VoiceState> {
  if (processHandle && state.ready) return snapshotState();
  if (processHandle && !state.ready) {
    return new Promise<VoiceState>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingReady = null;
        reject(new Error('nwd-voice-engine 启动超时'));
      }, DAEMON_START_TIMEOUT_MS);
      pendingReady = { resolve: () => resolve(snapshotState()), reject, timer };
    });
  }

  const binary = binaryPath();
  const child = spawn(binary, ['daemon'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NWD_VOICE_STORAGE_DIR: process.env.NWD_VOICE_STORAGE_DIR ?? defaultStorageDir(),
    },
  });
  processHandle = child;
  state.pid = child.pid ?? null;
  state.startedAt = Date.now();
  state.ready = false;
  state.lastError = null;
  state.recording = false;

  if (!child.stdout || !child.stderr) {
    throw new Error('nwd-voice-engine 子进程无 stdout/stderr');
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
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as Record<string, unknown>;
    const kind = String(obj.type ?? '');

    if (typeof obj.id === 'number' && 'ok' in obj) {
      const entry = pendingRequests.get(obj.id);
      if (entry) {
        pendingRequests.delete(obj.id);
        clearTimeout(entry.timer);
        if ((obj as { ok?: unknown }).ok === false) {
          entry.reject(new Error(String((obj as { error?: unknown }).error ?? 'unknown error')));
        } else {
          const { type: _t, id: _i, ok: _o, ...rest } = obj as Record<string, unknown>;
          entry.resolve(rest);
        }
      }
      return;
    }

    switch (kind) {
      case 'ready': {
        state.ready = true;
        const vadModelPath = (obj as Record<string, unknown>).vad_model_path;
        state.info = {
          version: String(obj.version ?? ''),
          platform: String(obj.platform ?? ''),
          sample_rate: Number(obj.sample_rate ?? 0),
          channels: Number(obj.channels ?? 0),
          storage_dir: state.info?.storage_dir ?? defaultStorageDir(),
          input_device: null,
          recording: false,
          vad_model_path: typeof vadModelPath === 'string' ? vadModelPath : null,
        };
        restartAttempts = 0;
        broadcast({
          type: 'ready',
          version: state.info.version,
          platform: state.info.platform,
          sample_rate: state.info.sample_rate,
          channels: state.info.channels,
          vad_model_path: state.info.vad_model_path,
        });
        if (pendingReady) {
          const p = pendingReady;
          pendingReady = null;
          clearTimeout(p.timer);
          p.resolve();
        }
        return;
      }
      case 'state': {
        const info = obj as unknown as DaemonInfo;
        state.info = info;
        state.recording = info.recording;
        broadcast({ type: 'state', info });
        return;
      }
      case 'models': {
        const payload = obj as unknown as ModelsEvent;
        state.models = payload;
        if (payload?.vad) {
          // Mirror onto info so the renderer can read it in one place.
          if (state.info) state.info = { ...state.info, vad_model_path: payload.vad.path };
        }
        broadcast({ type: 'models', payload });
        return;
      }
      case 'recording.started': {
        state.recording = true;
        state.inSpeech = false;
        const payload = obj as unknown as RecordingStartedEvent;
        broadcast({ type: 'recording.started', payload });
        return;
      }
      case 'recording.progress': {
        const payload = obj as unknown as RecordingProgressEvent;
        const ratio = payload.total_frames > 0 ? payload.written_frames / payload.total_frames : 0;
        state.levelProgress = ratio;
        broadcast({ type: 'recording.progress', payload });
        return;
      }
      case 'recording.finished': {
        state.recording = false;
        state.level = 0;
        state.speechProb = 0;
        state.levelProgress = 0;
        state.inSpeech = false;
        const payload = obj as unknown as RecordingFinishedEvent;
        state.lastRecordingPath = payload.path;
        broadcast({ type: 'recording.finished', payload });
        return;
      }
      case 'audio.level': {
        const payload = obj as unknown as AudioLevelEvent;
        state.level = clampUnit(payload.rms);
        state.speechProb = clampUnit(payload.speech_prob);
        state.inSpeech = Boolean(payload.in_speech);
        // `written_frames` is monotonic for the lifetime of the recording;
        // we don't have a hard cap here, so we surface 0..1 as a soft
        // progress based on a generous 30 s budget.
        state.levelProgress = clampUnit(payload.written_frames / (16_000 * 30));
        broadcast({ type: 'audio.level', payload });
        return;
      }
      case 'speech.start': {
        const payload = obj as unknown as SpeechStartEvent;
        state.inSpeech = true;
        broadcast({ type: 'speech.start', payload });
        return;
      }
      case 'speech.end': {
        const payload = obj as unknown as SpeechEndEvent;
        state.inSpeech = false;
        state.lastRecordingPath = payload.path;
        state.segments = [payload, ...state.segments].slice(0, MAX_SEGMENTS_KEPT);
        broadcast({ type: 'speech.end', payload });
        return;
      }
      case 'error': {
        const payload = obj as unknown as VoiceErrorEvent;
        const message = String(payload?.message ?? 'unknown error');
        state.lastError = message;
        broadcast({ type: 'error', payload: { ...payload, message } });
        return;
      }
      default:
        return;
    }
  });

  child.on('close', (code) => {
    processHandle = null;
    state.ready = false;
    state.pid = null;
    state.recording = false;
    const errMsg =
      code === 0
        ? 'voice daemon 已退出'
        : `voice daemon 异常退出 (code=${code}): ${stderrTail.trim().slice(-512)}`;
    state.lastError = errMsg;
    broadcast({ type: 'error', payload: { kind: 'lifecycle', message: errMsg } });
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

  return snapshotState();
}

let pendingReady: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;

export async function shutdownDaemon(): Promise<void> {
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (processHandle) {
    try {
      processHandle.stdin?.end();
    } catch {
      // Ignore: closing the pipe shouldn't fail the shutdown.
    }
    // Give the child up to 2s to exit gracefully, then SIGKILL.
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2_000);
      processHandle!.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited) {
      try {
        processHandle.kill();
      } catch {
        // Already gone.
      }
    }
  }
  shuttingDown = false;
}

export function getState(): VoiceState {
  return snapshotState();
}

export function listStorageRecordings(): { path: string; mtimeMs: number; size: number }[] {
  const dir = state.info?.storage_dir ?? defaultStorageDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        (name.startsWith('speech-') || name.startsWith('voice-smoke-')) &&
        name.endsWith('.wav'),
    )
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { path: full, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function defaultStorageDir(): string {
  const override = process.env.NWD_VOICE_STORAGE_DIR;
  if (override && override.length > 0) return override;
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'voice-engine');
  }
  return path.join(os.tmpdir(), 'nwd-voice-engine');
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // RMS of typical speech is in [0.01, 0.3]; map roughly to [0, 1] for UI.
  return Math.min(1, Math.max(0, v * 4));
}

export function trackWindow(win: BrowserWindow): () => void {
  windowListeners.add(win);
  return () => {
    windowListeners.delete(win);
  };
}

export function setupVoiceIPC(): void {
  ipcMain.handle('voice:start', async () => {
    const result = await startDaemon();
    return result;
  });
  ipcMain.handle('voice:state', () => snapshotState());
  ipcMain.handle('voice:ping', async () => {
    await sendRequest({ type: 'ping' });
    return true;
  });
  ipcMain.handle('voice:request-state', async () => {
    return sendRequest({ type: 'state' });
  });
  ipcMain.handle('voice:request-models', async () => {
    return sendRequest({ type: 'models' });
  });
  ipcMain.handle('voice:start-recording', async (_event, durationSecs: number) => {
    const safe = Math.max(1, Math.min(60, Math.floor(Number(durationSecs) || 5)));
    await sendRequest({ type: 'recording.start', duration_secs: safe });
    return { duration_secs: safe };
  });
  ipcMain.handle('voice:list-recordings', () => listStorageRecordings());
  ipcMain.handle('voice:on-event', () => true);

  app.on('browser-window-created', (_event, win) => {
    const dispose = trackWindow(win);
    win.on('closed', dispose);
  });
}
