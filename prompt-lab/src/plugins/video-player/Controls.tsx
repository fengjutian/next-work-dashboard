/**
 * 视频播放器控件条
 *
 * 包含：播放 / 暂停 / 停止 / 音量 / 倍速 / 字幕 / 音轨 / 静音
 *
 * 注：项目没有 shadcn Select 组件，本文件用轻量 wrapper 直接渲染原生 <select>。
 */

import { useMemo } from 'react';
import { Pause, Play, Square } from '@/components/icons';
import { Keyboard } from 'lucide-react';
import type { VideoPlayerStatus } from './types';
import { VolumeHigh, VolumeLow, VolumeMute, Captions, Gauge, Film, Speaker } from './icons';
import { Button } from '@/components/ui/button';

interface ControlsProps {
  status: VideoPlayerStatus;
  onToggle: () => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  onMute: (m: boolean) => void;
  onSpeed: (s: number) => void;
  onSelectAudio: (id: number | 'no') => void;
  onSelectSubtitle: (id: number | 'no') => void;
  onAddSubtitle: () => void;
  onOpenHelp?: () => void;
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function Controls({
  status,
  onToggle,
  onStop,
  onVolume,
  onMute,
  onSpeed,
  onSelectAudio,
  onSelectSubtitle,
  onAddSubtitle,
  onOpenHelp,
}: ControlsProps) {
  const isPlaying = status.state === 'playing';
  const isStopped = status.state === 'idle' || status.state === 'stopped' || status.state === 'ended' || !status.filePath;
  const VolumeIcon = status.muted || status.volume <= 0
    ? VolumeMute
    : status.volume < 50
      ? VolumeLow
      : VolumeHigh;

  const audioTracks = useMemo(() => status.trackList.filter((t) => t.type === 'audio'), [status.trackList]);
  const subtitleTracks = useMemo(() => status.trackList.filter((t) => t.type === 'sub'), [status.trackList]);
  const selectedAudioId = audioTracks.find((t) => t.selected)?.id;
  const selectedSubtitleId = subtitleTracks.find((t) => t.selected)?.id;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t bg-background/95">
      <Button
        type="button"
        variant="default"
        size="icon"
        onClick={onToggle}
        disabled={!status.filePath}
        title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onStop}
        disabled={!status.filePath}
        title="停止 (Shift+S)"
      >
        <Square className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-2 px-2 min-w-[180px]">
        <button
          type="button"
          onClick={() => onMute(!status.muted)}
          className="text-muted-foreground hover:text-foreground"
          title={status.muted ? '取消静音' : '静音'}
        >
          <VolumeIcon className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={130}
          value={status.muted ? 0 : Math.round(status.volume)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onMute(v === 0 ? true : false);
            onVolume(v);
          }}
          className="flex-1 accent-primary"
          aria-label="音量"
        />
        <span className="w-9 text-xs text-muted-foreground tabular-nums text-right">
          {Math.round(status.muted ? 0 : status.volume)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          aria-label="倍速"
          value={String(status.speed)}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {SPEED_PRESETS.map((s) => (
            <option key={s} value={String(s)}>
              {formatSpeed(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <Speaker className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          aria-label="音轨"
          value={selectedAudioId === undefined ? '__none__' : String(selectedAudioId)}
          onChange={(e) => onSelectAudio(e.target.value === '__none__' ? 'no' : Number(e.target.value))}
          disabled={audioTracks.length === 0}
          className="h-8 max-w-[160px] rounded-md border border-input bg-background px-2 text-xs"
        >
          {audioTracks.length === 0 ? (
            <option value="__none__" disabled>无音轨</option>
          ) : (
            audioTracks.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.title}{t.lang ? ` (${t.lang})` : ''}{t.selected ? ' ✓' : ''}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <Captions className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          aria-label="字幕"
          value={selectedSubtitleId === undefined ? '__none__' : String(selectedSubtitleId)}
          onChange={(e) => onSelectSubtitle(e.target.value === '__none__' ? 'no' : Number(e.target.value))}
          className="h-8 max-w-[160px] rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="__none__">关闭字幕</option>
          {subtitleTracks.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.title}{t.lang ? ` (${t.lang})` : ''}{t.selected ? ' ✓' : ''}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddSubtitle}
          disabled={!status.filePath}
          title="加载外挂字幕"
        >
          外挂
        </Button>
      </div>

      {onOpenHelp && (
        <Button type="button" variant="ghost" size="sm" onClick={onOpenHelp} className="ml-auto">
          <Keyboard className="h-3.5 w-3.5" /> 快捷键
        </Button>
      )}
    </div>
  );
}

function formatSpeed(s: number): string {
  if (s === 1) return '1x';
  return `${s.toFixed(2).replace(/\.?0+$/, '')}x`;
}
