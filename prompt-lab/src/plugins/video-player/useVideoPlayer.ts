/**
 * 视频播放器 React 状态 hook（V2 完整版）
 *
 * 订阅主进程推送的 status 事件，并把命令代理到 window.electronAPI.videoPlayer。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PlaylistItem,
  PlaylistMode,
  PlaylistState,
  VideoPlayerAPI,
  VideoPlayerEvent,
  VideoPlayerStatus,
  VideoWindowMode,
} from './types';

const API: VideoPlayerAPI | undefined = (() => {
  if (typeof window === 'undefined') return undefined;
  return (window as any).electronAPI?.videoPlayer as VideoPlayerAPI | undefined;
})();

const INITIAL_STATUS: VideoPlayerStatus = {
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
  window: { mode: 'mpv', detached: false },
};

export interface UseVideoPlayerResult {
  status: VideoPlayerStatus;
  latestEvent: VideoPlayerEvent | null;
  open: (filePath?: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  pickAndOpen: () => Promise<void>;
  pickAndAddSubtitle: () => Promise<void>;
  close: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  toggle: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (seconds: number, mode?: 'absolute' | 'relative') => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setMute: (muted: boolean) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  selectAudio: (id: number | 'no') => Promise<void>;
  selectSubtitle: (id: number | 'no') => Promise<void>;
  addToPlaylist: (sources: string[]) => Promise<void>;
  pickAndAddToPlaylist: () => Promise<void>;
  removeFromPlaylist: (id: string) => Promise<void>;
  clearPlaylist: () => Promise<void>;
  playIndex: (index: number) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  setPlaylistMode: (mode: PlaylistMode) => Promise<void>;
  reorderPlaylist: (from: number, to: number) => Promise<void>;
  setWindowMode: (mode: VideoWindowMode) => Promise<void>;
  focusVideoWindow: () => Promise<void>;
  attachVideoWindow: () => Promise<void>;
}

export function useVideoPlayer(): UseVideoPlayerResult {
  const [status, setStatus] = useState<VideoPlayerStatus>(INITIAL_STATUS);
  const [latestEvent, setLatestEvent] = useState<VideoPlayerEvent | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!API) return;
    let cancelled = false;
    API.getStatus()
      .then((s) => {
        if (!cancelled && s) setStatus(s);
      })
      .catch(() => {});
    const offStatus = API.onStatus((s) => setStatus(s));
    const offEvent = API.onEvent((e) => setLatestEvent(e));
    return () => {
      cancelled = true;
      offStatus();
      offEvent();
    };
  }, []);

  const safeCall = useCallback(async <R, T extends unknown[]>(fn: (...args: T) => Promise<R>, ...args: T): Promise<R> => {
    if (!API) throw new Error('electronAPI 不可用，请在 Electron 内运行');
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 用户取消文件选择器 / URL 输入对话框等场景：不要当作错误
      if (/canceled|cancelled|cancel/i.test(message)) {
        throw err; // 重新抛出，但不改 state
      }
      setStatus((prev) => ({ ...prev, state: 'error', errorMessage: message }));
      throw err;
    }
  }, []);

  return {
    status,
    latestEvent,
    open: useCallback(async (filePath?: string) => {
      const result = await safeCall(API!.open, filePath);
      if (result) setStatus(result);
    }, [safeCall]),
    openUrl: useCallback(async (url: string) => {
      const result = await safeCall(API!.openUrl, url);
      setStatus(result);
    }, [safeCall]),
    pickAndOpen: useCallback(async () => {
      const result = await safeCall(API!.open, undefined as any);
      if (result) setStatus(result);
    }, [safeCall]),
    pickAndAddSubtitle: useCallback(async () => {
      const filePath = await API!.pickSubtitle();
      if (!filePath) return;
      await safeCall(API!.addSubtitle, filePath);
    }, [safeCall]),
    close: useCallback(() => safeCall(API!.close), [safeCall]),
    play: useCallback(() => safeCall(API!.play), [safeCall]),
    pause: useCallback(() => safeCall(API!.pause), [safeCall]),
    toggle: useCallback(() => safeCall(API!.toggle), [safeCall]),
    stop: useCallback(() => safeCall(API!.stop), [safeCall]),
    seek: useCallback((seconds: number, mode?: 'absolute' | 'relative') => safeCall(API!.seek, seconds, mode), [safeCall]),
    setVolume: useCallback((volume: number) => safeCall(API!.setVolume, volume), [safeCall]),
    setMute: useCallback((muted: boolean) => safeCall(API!.setMute, muted), [safeCall]),
    setSpeed: useCallback((speed: number) => safeCall(API!.setSpeed, speed), [safeCall]),
    selectAudio: useCallback((id: number | 'no') => safeCall(API!.selectAudio, id), [safeCall]),
    selectSubtitle: useCallback((id: number | 'no') => safeCall(API!.selectSubtitle, id), [safeCall]),
    addToPlaylist: useCallback(async (sources: string[]) => {
      const result: PlaylistState = await safeCall(API!.addToPlaylist, sources);
      setStatus((prev) => ({ ...prev, playlist: result }));
    }, [safeCall]),
    pickAndAddToPlaylist: useCallback(async () => {
      const result = await safeCall(API!.open, undefined as any);
      if (!result || !result.filePath) return;
      // 也加入 playlist
      const pl: PlaylistState = await safeCall(API!.addToPlaylist, [result.filePath]);
      setStatus((prev) => ({ ...prev, playlist: pl, ...result }));
    }, [safeCall]),
    removeFromPlaylist: useCallback(async (id: string) => {
      const result: PlaylistState = await safeCall(API!.removeFromPlaylist, id);
      setStatus((prev) => ({ ...prev, playlist: result }));
    }, [safeCall]),
    clearPlaylist: useCallback(async () => {
      const result: PlaylistState = await safeCall(API!.clearPlaylist);
      setStatus((prev) => ({ ...prev, playlist: result }));
    }, [safeCall]),
    playIndex: useCallback((index: number) => safeCall(API!.playIndex, index), [safeCall]),
    playNext: useCallback(() => safeCall(API!.playNext), [safeCall]),
    playPrev: useCallback(() => safeCall(API!.playPrev), [safeCall]),
    setPlaylistMode: useCallback((mode: PlaylistMode) => safeCall(API!.setPlaylistMode, mode), [safeCall]),
    reorderPlaylist: useCallback(async (from: number, to: number) => {
      const result: PlaylistState = await safeCall(API!.reorderPlaylist, from, to);
      setStatus((prev) => ({ ...prev, playlist: result }));
    }, [safeCall]),
    setWindowMode: useCallback((mode: VideoWindowMode) => safeCall(API!.setWindowMode, mode), [safeCall]),
    focusVideoWindow: useCallback(() => safeCall(API!.focusVideoWindow), [safeCall]),
    attachVideoWindow: useCallback(() => safeCall(API!.attachVideoWindow), [safeCall]),
  };
}
