/**
 * 视频播放器进度条
 *
 * - 显示当前位置 / 总时长
 * - 支持点击和拖拽跳转
 * - 拖拽时显示瞬时预览
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from './format';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  disabled?: boolean;
}

export const ProgressBar = memo(function ProgressBar({ currentTime, duration, onSeek, disabled }: ProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const displayRatio = dragging && dragTime !== null ? dragTime / Math.max(duration, 1) : ratio;
  const displayTime = dragging && dragTime !== null ? dragTime : currentTime;

  const computeTime = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const x = Math.min(rect.right, Math.max(rect.left, clientX));
      const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setDragTime(computeTime(e.clientX));
    const onUp = (e: MouseEvent) => {
      const t = computeTime(e.clientX);
      setDragging(false);
      setDragTime(null);
      if (!disabled) onSeek(t);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, computeTime, onSeek, disabled]);

  const handleTrackMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    setDragging(true);
    setDragTime(computeTime(e.clientX));
  };

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-12 text-right tabular-nums">{formatDuration(displayTime)}</span>
      <div
        ref={trackRef}
        onMouseDown={handleTrackMouseDown}
        className={`group relative flex-1 h-2 rounded-full bg-muted overflow-hidden ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.max(duration, 0)}
        aria-valuenow={Math.floor(displayTime)}
        aria-label="播放进度"
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary/80"
          style={{ width: `${displayRatio * 100}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${displayRatio * 100}% - 6px)` }}
        />
      </div>
      <span className="w-12 tabular-nums">{formatDuration(duration)}</span>
    </div>
  );
});
