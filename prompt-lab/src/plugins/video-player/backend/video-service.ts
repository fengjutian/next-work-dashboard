/**
 * VideoPlayerService — 主进程视频播放器服务（V2 完整版）
 *
 * 责任：
 *  1. 找到 mpv 二进制
 *  2. 启动 mpv 子进程
 *     - V1 默认：mpv 自带窗口
 *     - V2：可切到 BrowserWindow 容纳（mpv --wid=<hwnd>）
 *  3. mpv IPC server 通信（JSON-RPC over pipe/socket）
 *  4. 状态/事件桥接到 Renderer
 *  5. 播放列表：add/remove/clear/next/prev/index/mode + auto-next on eof
 *  6. URL 打开（mpv 原生支持 HLS / RTSP / RTMP / HTTP）
 *  7. 关闭时优雅退出 mpv，清理临时 socket 文件
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MpvClient, type MpvEvent } from './mpv-client';
import type {
  MediaInfo,
  PlaylistItem,
  PlaylistMode,
  PlaylistState,
  PlayerState,
  TrackInfo,
  VideoPlayerEvent,
  VideoPlayerStatus,
  VideoWindowInfo,
  VideoWindowMode,
} from '../types';

// ── IPC channel 常量（renderer 端共用） ──
export const VIDEO_IPC = {
  OPEN: 'video-player:open',
  OPEN_URL: 'video-player:open-url',
  CLOSE: 'video-player:close',
  PICK_FILE: 'video-player:pick-file',
  PICK_SUBTITLE: 'video-player:pick-subtitle',
  PLAY: 'video-player:play',
  PAUSE: 'video-player:pause',
  TOGGLE: 'video-player:toggle',
  STOP: 'video-player:stop',
  SEEK: 'video-player:seek',
  SET_VOLUME: 'video-player:set-volume',
  SET_MUTE: 'video-player:set-mute',
  SET_SPEED: 'video-player:set-speed',
  GET_TRACKS: 'video-player:get-tracks',
  SELECT_AUDIO: 'video-player:select-audio',
  SELECT_SUBTITLE: 'video-player:select-subtitle',
  ADD_SUBTITLE: 'video-player:add-subtitle',
  PLAYLIST_ADD: 'video-player:playlist-add',
  PLAYLIST_REMOVE: 'video-player:playlist-remove',
  PLAYLIST_CLEAR: 'video-player:playlist-clear',
  PLAYLIST_INDEX: 'video-player:playlist-play-index',
  PLAYLIST_NEXT: 'video-player:playlist-next',
  PLAYLIST_PREV: 'video-player:playlist-prev',
  PLAYLIST_MODE: 'video-player:playlist-mode',
  PLAYLIST_REORDER: 'video-player:playlist-reorder',
  WINDOW_MODE: 'video-player:window-mode',
  WINDOW_DETACH: 'video-player:window-detach',
  WINDOW_ATTACH: 'video-player:window-attach',
  WINDOW_FOCUS: 'video-player:window-focus',
  STATUS: 'video-player:status',
  EVENT: 'video-player:event',
  SHUTDOWN: 'video-player:shutdown',
} as const;

const SUPPORTED_EXTENSIONS = [
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v',
  'ts', 'm2ts', 'mpg', 'mpeg', 'ogv', '3gp', 'rm', 'rmvb', 'vob',
];

const OBSERVED_PROPERTIES = [
  'pause',
  'time-pos',
  'duration',
  'volume',
  'mute',
  'speed',
  'eof-reached',
] as const;

interface VideoTrackRaw {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  selected?: boolean;
  codec?: string;
  default?: boolean;
}

function isLikelyUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
}

function fileBaseName(input: string): string {
  const normalized = input.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || input;
}

function makeId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class VideoPlayerService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: MpvClient | null = null;
  private socketPath: string | null = null;
  private observerIds: Record<string, number> = {};
  private videoWindow: BrowserWindow | null = null;
  private windowMode: VideoWindowMode = 'mpv';
  private status: VideoPlayerStatus = this.makeIdleStatus();
  private autoNextTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  // ───────────────────── 启动 / 关闭 ─────────────────────

  private makeIdleStatus(): VideoPlayerStatus {
    return {
      state: 'idle',
      filePath: null,
      currentTime: 0,
      duration: 0,
      volume: 100,
      muted: false,
      speed: 1,
      mediaInfo: null,
      trackList: [],
      playlist: { items: [], currentIndex: -1, mode: 'sequential' },
      window: { mode: this.windowMode, detached: false },
    };
  }

  private makeSocketPath(): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\nwd-mpv-${process.pid}-${Date.now()}`;
    }
    return path.join(os.tmpdir(), `nwd-mpv-${process.pid}-${Date.now()}.sock`);
  }

  private mpvBinaryPath(): string {
    const executable = process.platform === 'win32' ? 'mpv.exe' : 'mpv';
    const platformDir = process.platform === 'win32'
      ? 'win32'
      : process.platform === 'darwin'
        ? 'darwin'
        : 'linux';
    const candidates: string[] = [];
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'video-player', platformDir, executable));
    } else {
      candidates.push(path.join(app.getAppPath(), 'resources', 'video-player', platformDir, executable));
      candidates.push(path.join(process.cwd(), 'resources', 'video-player', platformDir, executable));
    }
    candidates.push(...this.probeMpvOnPath());
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
      throw new Error(
        `未找到 mpv 二进制。请执行 npm run fetch:mpv 自动下载，或自行安装 mpv 后重试。\n` +
        `已探测的路径：\n${candidates.join('\n')}`,
      );
    }
    return found;
  }

  private probeMpvOnPath(): string[] {
    const candidates: string[] = [];
    const pathEnv = process.env.PATH || '';
    const separator = process.platform === 'win32' ? ';' : ':';
    if (process.platform === 'win32') {
      for (const dir of pathEnv.split(separator)) {
        if (!dir) continue;
        candidates.push(path.join(dir, 'mpv.exe'));
      }
      const home = os.homedir();
      candidates.push(path.join(home, 'scoop', 'shims', 'mpv.exe'));
      candidates.push(path.join(home, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'));
      candidates.push('C:\\Program Files\\mpv\\mpv.exe');
      candidates.push('C:\\Program Files (x86)\\mpv\\mpv.exe');
      candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mpv', 'mpv.exe'));
    } else {
      for (const dir of pathEnv.split(separator)) {
        if (!dir) continue;
        candidates.push(path.join(dir, 'mpv'));
      }
      candidates.push('/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv');
    }
    return candidates;
  }

  private async ensureMpv(): Promise<void> {
    if (this.client && this.child && !this.child.killed) return;
    const socketPath = this.makeSocketPath();
    this.socketPath = socketPath;

    const bin = this.mpvBinaryPath();
    const args: string[] = [
      '--no-config',
      '--idle=yes',
      '--keep-open=always',
      '--pause',
      '--no-border',
      '--title=NWD Video Player',
      `--input-ipc-server=${socketPath}`,
      '--hwdec=auto-safe',
      '--vo=gpu',
      '--ao=auto',
      '--osc=no',
      '--osd-bar=no',
      '--msg-level=all=no,ipc=v',
    ];

    if (this.windowMode === 'browser') {
      // V2 嵌入基线：把视频渲染到我们创建的 BrowserWindow 的 HWND
      const videoWindow = this.ensureVideoWindow();
      if (process.platform === 'win32') {
        const hwnd = videoWindow.getNativeWindowHandle();
        args.push(`--wid=${hwnd.toString()}`);
      } else if (process.platform === 'darwin') {
        // macOS 上 --wid=<NSView*> 需要在 cocoa 内部桥接，V2 暂走回退到 mpv 默认窗口
        args.push('--force-window=immediate');
      } else {
        // Linux X11
        const wid = videoWindow.getNativeWindowHandle();
        args.push(`--wid=${wid.toString()}`);
      }
    } else {
      args.push('--force-window=immediate');
    }

    this.child = spawn(bin, args, {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stderr?.on('data', () => {
      // mpv 诊断日志，不转发避免噪音
    });

    this.child.on('exit', (code, signal) => {
      const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
      this.handleMpvExit(reason);
    });

    this.client = new MpvClient({ path: socketPath });
    this.client.on('event', (event: MpvEvent) => this.handleMpvEvent(event));
    this.client.on('close', () => this.handleMpvExit('socket closed'));
    this.client.on('error', (err) => this.handleMpvExit(String(err?.message || err)));

    await this.client.connect();

    let nextId = 1;
    for (const prop of OBSERVED_PROPERTIES) {
      await this.client.observeProperty(nextId, prop);
      this.observerIds[prop] = nextId;
      nextId += 1;
    }

    this.client.on('event', (event: MpvEvent) => {
      if (event.event === 'tracks-changed' || event.event === 'file-loaded') {
        void this.refreshTracks();
      }
    });

    await this.refreshTracks();

    if (this.windowMode === 'browser' && this.videoWindow) {
      this.status.window = { mode: 'browser', hwnd: this.hwndNumber(), detached: false };
      this.broadcastStatus();
    }
  }

  private ensureVideoWindow(): BrowserWindow {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      return this.videoWindow;
    }
    const win = new BrowserWindow({
      width: 1280,
      height: 720,
      title: 'NWD Video Player',
      backgroundColor: '#000000',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    // 加载空白页面：mpv --wid= 会接管整个客户区
    win.loadURL('data:text/html,<html><body style="margin:0;background:#000"></body></html>');
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
    win.on('closed', () => {
      this.videoWindow = null;
      // 视频窗口被用户关闭时，杀掉 mpv 以避免僵尸
      if (!this.shuttingDown) {
        this.handleMpvExit('video window closed');
      }
    });
    win.on('resize', () => {
      // mpv 默认会响应窗口尺寸变化
    });
    this.videoWindow = win;
    return win;
  }

  private hwndNumber(): number | undefined {
    if (!this.videoWindow || process.platform !== 'win32') return undefined;
    const handle = this.videoWindow.getNativeWindowHandle();
    if (process.platform === 'win32') {
      // Node Buffer 形式 — 取第一个 4 字节作为 u32
      try {
        return Number(handle.readBigUInt64LE(0));
      } catch {
        return undefined;
      }
    }
    return Number(handle);
  }

  private handleMpvExit(reason: string): void {
    this.status = {
      ...this.status,
      state: 'stopped',
      errorMessage: this.status.state === 'error' ? this.status.errorMessage : `mpv 已退出（${reason}）`,
    };
    this.client?.close();
    this.client = null;
    this.child = null;
    this.cleanupSocket();
    this.broadcastStatus();
    this.broadcastEvent({ event: 'shutdown' });
  }

  private cleanupSocket(): void {
    if (process.platform === 'win32') return;
    if (this.socketPath) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // ignore
      }
    }
  }

  // ───────────────────── 文件 / URL ─────────────────────

  async pickFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '选择视频文件',
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: SUPPORTED_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  async pickSubtitleFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '选择外挂字幕',
      properties: ['openFile'],
      filters: [
        { name: '字幕文件', extensions: ['srt', 'ass', 'ssa', 'vtt', 'sub'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  async open(filePath: string | undefined): Promise<VideoPlayerStatus | null> {
    if (!filePath) {
      const picked = await this.pickFile();
      if (!picked) return null;
      filePath = picked;
    }
    if (!isLikelyUrl(filePath) && !fs.existsSync(filePath)) {
      throw new Error(`文件不存在：${filePath}`);
    }
    await this.ensureMpv();
    if (!this.client) throw new Error('mpv 客户端未就绪');
    this.status = {
      ...this.status,
      state: 'loading',
      filePath,
      currentTime: 0,
      duration: 0,
      errorMessage: undefined,
    };
    this.broadcastStatus();
    await this.client.command(['loadfile', filePath, 'replace']);
    return this.status;
  }

  async openUrl(url: string): Promise<VideoPlayerStatus> {
    if (!url) throw new Error('URL 不能为空');
    if (!/^https?:\/\//i.test(url) && !/^rtsp:\/\//i.test(url) && !/^rtmp:\/\//i.test(url) && !/^mms:\/\//i.test(url)) {
      throw new Error('仅支持 http(s) / rtsp / rtmp / mms 协议');
    }
    await this.ensureMpv();
    if (!this.client) throw new Error('mpv 客户端未就绪');
    this.status = {
      ...this.status,
      state: 'loading',
      filePath: url,
      currentTime: 0,
      duration: 0,
      errorMessage: undefined,
    };
    this.broadcastStatus();
    await this.client.command(['loadfile', url, 'replace']);
    return this.status;
  }

  // ───────────────────── 播放控制 ─────────────────────

  async play(): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    await this.client.command(['set_property', 'pause', false]);
  }

  async pause(): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    await this.client.command(['set_property', 'pause', true]);
  }

  async toggle(): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    const paused = await this.client.command<boolean>(['get_property', 'pause']);
    await this.client.command(['set_property', 'pause', !paused]);
  }

  async stop(): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    await this.client.command(['stop']);
  }

  async seek(seconds: number, mode: 'absolute' | 'relative' = 'absolute'): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    if (mode === 'relative') {
      await this.client.command(['seek', String(seconds), 'relative']);
    } else {
      await this.client.command(['seek', String(seconds), 'absolute']);
    }
  }

  async setVolume(volume: number): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    const clamped = Math.max(0, Math.min(130, Math.round(volume)));
    await this.client.command(['set_property', 'volume', clamped]);
  }

  async setMute(muted: boolean): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    await this.client.command(['set_property', 'mute', !!muted]);
  }

  async setSpeed(speed: number): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    const safe = speed > 0 ? Math.min(speed, 4) : 0.25;
    await this.client.command(['set_property', 'speed', safe]);
  }

  // ───────────────────── 音轨 / 字幕 ─────────────────────

  async selectAudio(id: number | 'no'): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    await this.client.command(['set_property', 'aid', id === 'no' ? 'no' : id]);
    await this.refreshTracks();
  }

  async selectSubtitle(id: number | 'no'): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    await this.client.command(['set_property', 'sid', id === 'no' ? 'no' : id]);
    await this.refreshTracks();
  }

  async addSubtitle(filePath: string): Promise<void> {
    await this.ensureMpv();
    if (!this.client) return;
    if (!fs.existsSync(filePath)) {
      throw new Error(`字幕文件不存在：${filePath}`);
    }
    await this.client.command(['sub-add', filePath, 'select']);
    await this.refreshTracks();
  }

  async getTracks(): Promise<TrackInfo[]> {
    return this.status.trackList;
  }

  // ───────────────────── 播放列表 ─────────────────────

  async addToPlaylist(sources: string[]): Promise<PlaylistState> {
    const items: PlaylistItem[] = [];
    for (const src of sources) {
      if (!src) continue;
      const isUrl = isLikelyUrl(src);
      if (!isUrl && !fs.existsSync(src)) {
        // skip non-existing local file but still add a placeholder? V1: skip
        continue;
      }
      items.push({
        id: makeId(),
        source: src,
        title: isUrl ? src : fileBaseName(src),
        type: isUrl ? 'url' : 'file',
      });
    }
    this.status.playlist = {
      ...this.status.playlist,
      items: [...this.status.playlist.items, ...items],
    };
    this.broadcastStatus();
    return this.status.playlist;
  }

  async removeFromPlaylist(id: string): Promise<PlaylistState> {
    const playlist = this.status.playlist;
    const idx = playlist.items.findIndex((it) => it.id === id);
    if (idx < 0) return playlist;
    const newItems = playlist.items.filter((it) => it.id !== id);
    let newIndex = playlist.currentIndex;
    if (idx < newIndex) newIndex -= 1;
    else if (idx === newIndex) {
      // 当前播放项被删：保持 currentIndex 指向下一项（或越界）
      newIndex = newIndex < newItems.length ? newIndex : newItems.length - 1;
    }
    this.status.playlist = { ...playlist, items: newItems, currentIndex: newIndex };
    this.broadcastStatus();
    return this.status.playlist;
  }

  async clearPlaylist(): Promise<PlaylistState> {
    this.status.playlist = { items: [], currentIndex: -1, mode: this.status.playlist.mode };
    this.broadcastStatus();
    return this.status.playlist;
  }

  async reorderPlaylist(fromIndex: number, toIndex: number): Promise<PlaylistState> {
    const items = [...this.status.playlist.items];
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
      return this.status.playlist;
    }
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    let currentIndex = this.status.playlist.currentIndex;
    if (fromIndex === currentIndex) {
      currentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      currentIndex -= 1;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      currentIndex += 1;
    }
    this.status.playlist = { ...this.status.playlist, items, currentIndex };
    this.broadcastStatus();
    return this.status.playlist;
  }

  async setPlaylistMode(mode: PlaylistMode): Promise<void> {
    this.status.playlist = { ...this.status.playlist, mode };
    this.broadcastStatus();
  }

  async playIndex(index: number): Promise<void> {
    const { items } = this.status.playlist;
    if (index < 0 || index >= items.length) return;
    const item = items[index];
    this.status.playlist = { ...this.status.playlist, currentIndex: index };
    if (isLikelyUrl(item.source)) {
      await this.openUrl(item.source);
    } else {
      await this.open(item.source);
    }
  }

  async playNext(): Promise<void> {
    const next = this.computeNextIndex(1);
    if (next === null) return;
    await this.playIndex(next);
  }

  async playPrev(): Promise<void> {
    const prev = this.computeNextIndex(-1);
    if (prev === null) return;
    await this.playIndex(prev);
  }

  /**
   * 给定方向 (+1 / -1) 计算下一个索引。
   * - 'loop-one' 模式且不是手动切换：返回当前索引（让 mpv 重新从头放）
   * - 'loop-all' 模式：到末尾回到开头
   * - 'sequential'：到末尾停止（返回 null）
   * - 'shuffle'：随机（避免重复）
   */
  private computeNextIndex(direction: 1 | -1): number | null {
    const { items, currentIndex, mode } = this.status.playlist;
    if (items.length === 0) return null;
    if (currentIndex < 0) {
      // 没在播：方向无关，从 0 或随机开始
      return mode === 'shuffle' ? Math.floor(Math.random() * items.length) : 0;
    }
    if (mode === 'loop-one' && direction === 1) {
      // 顺序播放结束：loop-one 直接重置当前项
      this.seekToCurrent(0);
      return null;
    }
    if (mode === 'shuffle') {
      if (items.length === 1) return currentIndex;
      // 避免重复选同一项
      let next = Math.floor(Math.random() * items.length);
      let safety = 8;
      while (next === currentIndex && safety-- > 0) {
        next = Math.floor(Math.random() * items.length);
      }
      return next;
    }
    const next = currentIndex + direction;
    if (next < 0) {
      if (mode === 'loop-all') return items.length - 1;
      return null;
    }
    if (next >= items.length) {
      if (mode === 'loop-all') return 0;
      return null;
    }
    return next;
  }

  private async seekToCurrent(seconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.command(['seek', String(seconds), 'absolute']);
    } catch {
      // ignore
    }
  }

  // ───────────────────── 视频窗口（V2 嵌入基线） ─────────────────────

  async setWindowMode(mode: VideoWindowMode): Promise<void> {
    if (this.windowMode === mode) return;
    this.windowMode = mode;
    this.status.window = { mode, hwnd: mode === 'browser' ? this.hwndNumber() : undefined, detached: this.status.window.detached };
    // 重启 mpv 让 --wid 生效
    if (this.client) {
      try { await this.client.command(['quit']); } catch { /* ignore */ }
    }
    this.client?.close();
    this.client = null;
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    if (mode === 'browser') this.ensureVideoWindow();
    this.broadcastStatus();
  }

  async detachVideoWindow(): Promise<void> {
    if (this.windowMode !== 'browser' || !this.videoWindow) return;
    // 'detached' 是 UI 状态位；mpv 仍渲染到 BrowserWindow，但用户可以从主 UI 单独看
    this.status.window = { ...this.status.window, detached: true };
    this.broadcastStatus();
  }

  async attachVideoWindow(): Promise<void> {
    this.status.window = { ...this.status.window, detached: false };
    this.broadcastStatus();
  }

  async focusVideoWindow(): Promise<void> {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.focus();
    }
  }

  // ───────────────────── 状态 / 事件 ─────────────────────

  getStatus(): VideoPlayerStatus {
    return this.status;
  }

  private async refreshTracks(): Promise<void> {
    if (!this.client) return;
    try {
      const raw = (await this.client.command(['get_property', 'track-list'])) as VideoTrackRaw[];
      const tracks: TrackInfo[] = Array.isArray(raw)
        ? raw
            .filter((t) => t && (t.type === 'audio' || t.type === 'sub'))
            .map((t) => ({
              id: t.id,
              type: t.type,
              title: t.title || (t.type === 'audio' ? `音轨 ${t.id}` : `字幕 ${t.id}`),
              lang: t.lang,
              selected: !!t.selected,
              codec: t.codec,
              default: !!t.default,
            }))
        : [];
      this.status = { ...this.status, trackList: tracks };
      this.broadcastStatus();
    } catch {
      // ignore
    }
  }

  private async refreshMediaInfo(): Promise<void> {
    if (!this.client) return;
    try {
      const [filePath, duration, videoParams, audioParams, containerFormat] = await Promise.all([
        this.client.command<string>(['get_property', 'path']).catch(() => null),
        this.client.command<number>(['get_property', 'duration']).catch(() => 0),
        this.client.command<Record<string, unknown> | null>(['get_property', 'video-params']).catch(() => null),
        this.client.command<Record<string, unknown> | null>(['get_property', 'audio-params']).catch(() => null),
        this.client.command<string | null>(['get_property', 'file-format']).catch(() => null),
      ]);
      const info: MediaInfo = {
        filePath: typeof filePath === 'string' ? filePath : this.status.filePath || '',
        duration: typeof duration === 'number' ? duration : this.status.duration,
        width: typeof videoParams?.w === 'number' ? (videoParams.w as number) : undefined,
        height: typeof videoParams?.h === 'number' ? (videoParams.h as number) : undefined,
        fps: typeof videoParams?.fps === 'number' ? (videoParams.fps as number) : undefined,
        videoCodec: typeof videoParams?.codec === 'string' ? (videoParams.codec as string) : undefined,
        audioCodec: typeof audioParams?.codec === 'string' ? (audioParams.codec as string) : undefined,
        audioSampleRate: typeof audioParams?.samplerate === 'number' ? (audioParams.samplerate as number) : undefined,
        audioChannels: typeof audioParams?.channels === 'number' ? (audioParams.channels as number) : undefined,
        container: typeof containerFormat === 'string' ? containerFormat : undefined,
      };
      // 回填 playlist 当前项 duration / title
      const { playlist } = this.status;
      let items = playlist.items;
      if (playlist.currentIndex >= 0 && playlist.currentIndex < items.length) {
        items = items.map((it, i) =>
          i === playlist.currentIndex
            ? {
                ...it,
                title: isLikelyUrl(it.source) ? it.source : fileBaseName(info.filePath || it.source),
                duration: info.duration || it.duration,
              }
            : it,
        );
      }
      this.status = {
        ...this.status,
        duration: info.duration || this.status.duration,
        mediaInfo: info,
        playlist: { ...playlist, items },
      };
      this.broadcastStatus();
    } catch {
      // ignore
    }
  }

  private handleMpvEvent(event: MpvEvent): void {
    if (event.event === 'property-change' && typeof event.id === 'number') {
      this.applyPropertyChange(event);
    } else if (event.event === 'file-loaded') {
      this.status = { ...this.status, state: 'ready', currentTime: 0 };
      void this.refreshMediaInfo();
      this.broadcastStatus();
    } else if (event.event === 'end-file') {
      const reason = typeof event.reason === 'string' ? event.reason : 'unknown';
      if (reason === 'eof') {
        this.status = { ...this.status, state: 'ended' };
        this.broadcastStatus();
        // 播放列表 auto-next
        void this.handleEof();
      } else {
        this.status = { ...this.status, state: 'stopped' };
        this.broadcastStatus();
      }
    } else if (event.event === 'idle' || event.event === 'idle-active') {
      this.status = { ...this.status, state: 'stopped' };
      this.broadcastStatus();
    }
    this.broadcastEvent(event as unknown as VideoPlayerEvent);
  }

  private async handleEof(): Promise<void> {
    if (this.status.playlist.items.length === 0) return;
    // eof 自动播放下一首
    const next = this.computeNextIndex(1);
    if (next === null) return;
    // 给 mpv 一点时间 settle
    if (this.autoNextTimer) clearTimeout(this.autoNextTimer);
    this.autoNextTimer = setTimeout(() => {
      void this.playIndex(next).catch(() => {
        // ignore
      });
    }, 200);
  }

  private applyPropertyChange(event: MpvEvent): void {
    const name = typeof event.name === 'string' ? event.name : '';
    const data = event.data;
    switch (name) {
      case 'pause': {
        const paused = !!data;
        const nextState: PlayerState = paused ? 'paused' : 'playing';
        if (this.status.filePath) {
          this.status = { ...this.status, state: nextState };
        }
        break;
      }
      case 'time-pos': {
        if (typeof data === 'number') {
          this.status = { ...this.status, currentTime: data };
        }
        break;
      }
      case 'duration': {
        if (typeof data === 'number') {
          this.status = { ...this.status, duration: data };
        }
        break;
      }
      case 'volume': {
        if (typeof data === 'number') {
          this.status = { ...this.status, volume: data };
        }
        break;
      }
      case 'mute': {
        this.status = { ...this.status, muted: !!data };
        break;
      }
      case 'speed': {
        if (typeof data === 'number') {
          this.status = { ...this.status, speed: data };
        }
        break;
      }
      case 'eof-reached': {
        if (data) {
          this.status = { ...this.status, state: 'ended' };
        }
        break;
      }
    }
    this.broadcastStatus();
  }

  private broadcastStatus(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(VIDEO_IPC.STATUS, this.status);
    }
  }

  private broadcastEvent(event: VideoPlayerEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(VIDEO_IPC.EVENT, event);
    }
  }

  // ───────────────────── 关闭 / 清理 ─────────────────────

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.autoNextTimer) {
      clearTimeout(this.autoNextTimer);
      this.autoNextTimer = null;
    }
    try {
      await this.client?.command(['quit']);
    } catch {
      // ignore
    }
    this.client?.close();
    this.client = null;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.cleanupSocket();
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.close();
    }
    this.videoWindow = null;
    this.status = this.makeIdleStatus();
  }
}

export const videoPlayerService = new VideoPlayerService();

// ───────────────────── IPC 绑定 ─────────────────────

export function setupVideoPlayerIPC(): void {
  ipcMain.handle(VIDEO_IPC.PICK_FILE, () => videoPlayerService.pickFile());
  ipcMain.handle(VIDEO_IPC.PICK_SUBTITLE, () => videoPlayerService.pickSubtitleFile());
  ipcMain.handle(VIDEO_IPC.OPEN, async (_event: IpcMainInvokeEvent, filePath?: string) => {
    return videoPlayerService.open(filePath);
  });
  ipcMain.handle(VIDEO_IPC.OPEN_URL, async (_event, url: string) => videoPlayerService.openUrl(url));
  ipcMain.handle(VIDEO_IPC.PLAY, () => videoPlayerService.play());
  ipcMain.handle(VIDEO_IPC.PAUSE, () => videoPlayerService.pause());
  ipcMain.handle(VIDEO_IPC.TOGGLE, () => videoPlayerService.toggle());
  ipcMain.handle(VIDEO_IPC.STOP, () => videoPlayerService.stop());
  ipcMain.handle(VIDEO_IPC.SEEK, (_e, seconds: number, mode?: 'absolute' | 'relative') =>
    videoPlayerService.seek(seconds, mode || 'absolute'),
  );
  ipcMain.handle(VIDEO_IPC.SET_VOLUME, (_e, volume: number) => videoPlayerService.setVolume(volume));
  ipcMain.handle(VIDEO_IPC.SET_MUTE, (_e, muted: boolean) => videoPlayerService.setMute(muted));
  ipcMain.handle(VIDEO_IPC.SET_SPEED, (_e, speed: number) => videoPlayerService.setSpeed(speed));
  ipcMain.handle(VIDEO_IPC.GET_TRACKS, () => videoPlayerService.getTracks());
  ipcMain.handle(VIDEO_IPC.SELECT_AUDIO, (_e, id: number | 'no') => videoPlayerService.selectAudio(id));
  ipcMain.handle(VIDEO_IPC.SELECT_SUBTITLE, (_e, id: number | 'no') => videoPlayerService.selectSubtitle(id));
  ipcMain.handle(VIDEO_IPC.ADD_SUBTITLE, (_e, filePath: string) => videoPlayerService.addSubtitle(filePath));
  ipcMain.handle(VIDEO_IPC.PLAYLIST_ADD, (_e, sources: string[]) => videoPlayerService.addToPlaylist(sources));
  ipcMain.handle(VIDEO_IPC.PLAYLIST_REMOVE, (_e, id: string) => videoPlayerService.removeFromPlaylist(id));
  ipcMain.handle(VIDEO_IPC.PLAYLIST_CLEAR, () => videoPlayerService.clearPlaylist());
  ipcMain.handle(VIDEO_IPC.PLAYLIST_INDEX, (_e, index: number) => videoPlayerService.playIndex(index));
  ipcMain.handle(VIDEO_IPC.PLAYLIST_NEXT, () => videoPlayerService.playNext());
  ipcMain.handle(VIDEO_IPC.PLAYLIST_PREV, () => videoPlayerService.playPrev());
  ipcMain.handle(VIDEO_IPC.PLAYLIST_MODE, (_e, mode: PlaylistMode) => videoPlayerService.setPlaylistMode(mode));
  ipcMain.handle(VIDEO_IPC.PLAYLIST_REORDER, (_e, from: number, to: number) => videoPlayerService.reorderPlaylist(from, to));
  ipcMain.handle(VIDEO_IPC.WINDOW_MODE, (_e, mode: VideoWindowMode) => videoPlayerService.setWindowMode(mode));
  ipcMain.handle(VIDEO_IPC.WINDOW_DETACH, () => videoPlayerService.detachVideoWindow());
  ipcMain.handle(VIDEO_IPC.WINDOW_ATTACH, () => videoPlayerService.attachVideoWindow());
  ipcMain.handle(VIDEO_IPC.WINDOW_FOCUS, () => videoPlayerService.focusVideoWindow());
  ipcMain.handle(VIDEO_IPC.STATUS, () => videoPlayerService.getStatus());
}
