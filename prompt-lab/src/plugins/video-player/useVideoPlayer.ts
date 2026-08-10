/**
 * 视频播放器 React 状态 hook
 *
 * 订阅主进程推送的 status 事件，并把命令代理到 window.electronAPI.videoPlayer。
 * 组件卸载时自动取消订阅。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoPlayerAPI, VideoPlayerEvent, VideoPlayerStatus } from './types';

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
};

export interface UseVideoPlayerResult {
  status: VideoPlayerStatus;
  latestEvent: VideoPlayerEvent | null;
  open: (filePath?: string) => Promise<void>;
  pickAndOpen: () => Promise<void>;
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
  addSubtitle: () => Promise<void>;
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
    pickAndOpen: useCallback(async () => {
      const result = await safeCall(API!.open, undefined as any);
      if (result) setStatus(result);
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
    addSubtitle: useCallback(async () => {
      const filePath = await API!.pickFile();
      if (!filePath) return;
      await safeCall(API!.addSubtitle, filePath);
    }, [safeCall]),
  };
}
