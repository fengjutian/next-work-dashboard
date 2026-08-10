/**
 * 视频播放器插件 — 跨进程共享类型
 *
 * 同时被主进程 service（backend/video-service.ts）和渲染进程 UI（*.tsx）引用。
 * preload.ts 暴露的 IPC API 也基于这里的接口。
 */

export type PlayerState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'ended'
  | 'error';

export interface TrackInfo {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title: string;
  lang?: string;
  selected: boolean;
  codec?: string;
  default?: boolean;
}

export interface MediaInfo {
  filePath: string;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  container?: string;
}

export interface VideoPlayerStatus {
  state: PlayerState;
  filePath: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  speed: number;
  mediaInfo: MediaInfo | null;
  trackList: TrackInfo[];
  errorMessage?: string;
}

export type VideoPlayerEvent =
  | { event: 'property-change'; name: string; data: unknown }
  | { event: 'file-loaded' }
  | { event: 'end-file'; reason?: string }
  | { event: 'idle' }
  | { event: 'tracks-changed' }
  | { event: 'shutdown' }
  | { event: string; [key: string]: unknown };

export interface VideoPlayerAPI {
  // 文件
  open: (filePath?: string) => Promise<VideoPlayerStatus | null>;
  pickFile: () => Promise<string | null>;
  close: () => Promise<void>;

  // 播放控制
  play: () => Promise<void>;
  pause: () => Promise<void>;
  toggle: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (seconds: number, mode?: 'absolute' | 'relative') => Promise<void>;

  // 音量 / 倍速
  setVolume: (volume: number) => Promise<void>;
  setMute: (muted: boolean) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;

  // 音轨 / 字幕
  selectAudio: (id: number | 'no') => Promise<void>;
  selectSubtitle: (id: number | 'no') => Promise<void>;
  addSubtitle: (filePath: string) => Promise<void>;
  getTracks: () => Promise<TrackInfo[]>;

  // 状态
  getStatus: () => Promise<VideoPlayerStatus>;

  // 事件订阅
  onStatus: (callback: (status: VideoPlayerStatus) => void) => () => void;
  onEvent: (callback: (event: VideoPlayerEvent) => void) => () => void;
}

export interface RecentVideoEntry {
  path: string;
  name: string;
  duration?: number;
  lastPlayedAt: number;
}
