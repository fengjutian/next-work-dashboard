/**
 * VideoPlayerService — 主进程视频播放器服务
 *
 * 责任：
 *  1. 找到 mpv 二进制（开发态 → resources/video-player/<platform>/mpv；
 *     打包态 → process.resourcesPath；或从 PATH 探测已装的 mpv）
 *  2. 启动 mpv 子进程，--input-ipc-server 暴露 JSON 协议
 *  3. 把 mpv 的属性变化和事件桥接到 Renderer（IPC 事件）
 *  4. 把 Renderer 调用的命令转发给 mpv
 *  5. 关闭时优雅退出 mpv，清理临时 socket 文件
 *
 * 渲染进程通过 IPC 调用本服务，不直接接触 mpv。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MpvClient, type MpvEvent } from './mpv-client';
import type { MediaInfo, PlayerState, TrackInfo, VideoPlayerEvent, VideoPlayerStatus } from '../types';

// ── IPC channel 常量（renderer 端共用） ──
export const VIDEO_IPC = {
  OPEN: 'video-player:open',
  CLOSE: 'video-player:close',
  PICK_FILE: 'video-player:pick-file',
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

export class VideoPlayerService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: MpvClient | null = null;
  private socketPath: string | null = null;
  private observerIds: Record<string, number> = {};
  private status: VideoPlayerStatus = this.makeIdleStatus();
  private bootedAt: number | null = null;

  // ───────────────────── 启动 / 关闭 ─────────────────────

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
    const args = [
      '--no-config',
      '--idle=yes',
      '--force-window=immediate',
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

    this.child = spawn(bin, args, {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.bootedAt = Date.now();

    this.child.stderr?.on('data', () => {
      // mpv 把诊断日志写到 stderr；不转发到 renderer，避免日志噪音
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

    // 订阅常用属性
    let nextId = 1;
    for (const prop of OBSERVED_PROPERTIES) {
      await this.client.observeProperty(nextId, prop);
      this.observerIds[prop] = nextId;
      nextId += 1;
    }

    // 订阅 track-list 变更
    this.client.on('event', (event: MpvEvent) => {
      if (event.event === 'tracks-changed' || event.event === 'file-loaded') {
        void this.refreshTracks();
      }
    });

    // 拉取一次初始 track-list
    await this.refreshTracks();
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

  // ───────────────────── 文件操作 ─────────────────────

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

  async open(filePath: string): Promise<VideoPlayerStatus> {
    if (!filePath) {
      throw new Error('文件路径不能为空');
    }
    if (!fs.existsSync(filePath)) {
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

  // ───────────────────── 状态 / 事件 ─────────────────────

  getStatus(): VideoPlayerStatus {
    return this.status;
  }

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
    };
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
      this.status = {
        ...this.status,
        duration: info.duration || this.status.duration,
        mediaInfo: info,
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
      } else {
        this.status = { ...this.status, state: 'stopped' };
      }
      this.broadcastStatus();
    } else if (event.event === 'idle' || event.event === 'idle-active') {
      // mpv 进入空闲态（keep-open 下不会真的退出，但状态应回到 stopped）
      this.status = { ...this.status, state: 'stopped' };
      this.broadcastStatus();
    }
    this.broadcastEvent(event as unknown as VideoPlayerEvent);
  }

  private applyPropertyChange(event: MpvEvent): void {
    const name = typeof event.name === 'string' ? event.name : '';
    const data = event.data;
    switch (name) {
      case 'pause': {
        const paused = !!data;
        const nextState: PlayerState = paused ? 'paused' : 'playing';
        // 仅在已有文件时切换；避免 idle 状态下误报 playing
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
    this.status = this.makeIdleStatus();
  }
}

export const videoPlayerService = new VideoPlayerService();

// ───────────────────── IPC 绑定 ─────────────────────

export function setupVideoPlayerIPC(): void {
  ipcMain.handle(VIDEO_IPC.PICK_FILE, () => videoPlayerService.pickFile());
  ipcMain.handle(VIDEO_IPC.OPEN, async (_event: IpcMainInvokeEvent, filePath?: string) => {
    if (!filePath) {
      const picked = await videoPlayerService.pickFile();
      if (!picked) return null;
      filePath = picked;
    }
    return videoPlayerService.open(filePath);
  });
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
  ipcMain.handle(VIDEO_IPC.STATUS, () => videoPlayerService.getStatus());
}
