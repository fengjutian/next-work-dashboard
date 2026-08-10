/**
 * 视频播放器快捷键 hook
 *
 * 绑定全局快捷键到 videoPlayerService 的命令。注意：在输入框聚焦时
 * 应当禁用快捷键以避免和文本输入冲突。
 */

import { useEffect } from 'react';
import type { VideoPlayerAPI } from './types';

export interface ShortcutBindings {
  toggle: () => void;
  seekForward: () => void;
  seekBackward: () => void;
  volumeUp: () => void;
  volumeDown: () => void;
  mute: () => void;
  speedUp: () => void;
  speedDown: () => void;
  resetSpeed: () => void;
  stop: () => void;
}

const SEEK_STEP = 5;
const VOLUME_STEP = 5;
const SPEED_STEP = 0.1;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useShortcuts(actions: ShortcutBindings, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          actions.toggle();
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          event.preventDefault();
          actions.seekForward();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          event.preventDefault();
          actions.seekBackward();
          break;
        case 'ArrowUp':
          event.preventDefault();
          actions.volumeUp();
          break;
        case 'ArrowDown':
          event.preventDefault();
          actions.volumeDown();
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          actions.mute();
          break;
        case '>':
        case ']':
          event.preventDefault();
          actions.speedUp();
          break;
        case '<':
        case '[':
          event.preventDefault();
          actions.speedDown();
          break;
        case '0':
          event.preventDefault();
          actions.resetSpeed();
          break;
        case 's':
        case 'S':
          if (event.shiftKey) {
            event.preventDefault();
            actions.stop();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions, enabled]);
}

export function applySeek(api: VideoPlayerAPI, seconds: number): Promise<void> {
  return api.seek(seconds, 'relative');
}

export function applyVolumeChange(api: VideoPlayerAPI, current: number, delta: number): Promise<void> {
  return api.setVolume(Math.max(0, Math.min(130, current + delta)));
}

export function applySpeedChange(api: VideoPlayerAPI, current: number, delta: number): Promise<void> {
  const next = Math.max(0.25, Math.min(4, Math.round((current + delta) * 100) / 100));
  return api.setSpeed(next);
}

export const SHORTCUT_HELP = [
  { keys: ['Space', 'K'], desc: '播放 / 暂停' },
  { keys: ['←', 'J'], desc: '后退 5 秒' },
  { keys: ['→', 'L'], desc: '前进 5 秒' },
  { keys: ['↑'], desc: '音量 +5' },
  { keys: ['↓'], desc: '音量 -5' },
  { keys: ['M'], desc: '静音 / 取消静音' },
  { keys: ['[', '<'], desc: '减速 0.1' },
  { keys: [']', '>'], desc: '加速 0.1' },
  { keys: ['0'], desc: '重置倍速' },
  { keys: ['Shift + S'], desc: '停止' },
];

export { SEEK_STEP, VOLUME_STEP, SPEED_STEP };
