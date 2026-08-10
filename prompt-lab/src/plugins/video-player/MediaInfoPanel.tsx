/**
 * 媒体信息面板 — 展示分辨率、编码、时长等
 */

import type { MediaInfo } from './types';
import { formatDuration } from './format';

export interface MediaInfoPanelProps {
  mediaInfo: MediaInfo | null;
  filePath: string | null;
}

export function MediaInfoPanel({ mediaInfo, filePath }: MediaInfoPanelProps) {
  if (!mediaInfo && !filePath) {
    return (
      <div className="text-xs text-muted-foreground px-4 py-3 border-t bg-muted/30">
        未打开视频
      </div>
    );
  }

  const info = mediaInfo;
  const items: Array<[string, string]> = [];

  if (info) {
    if (info.width && info.height) {
      items.push(['分辨率', `${info.width} × ${info.height}`]);
    }
    if (info.fps) {
      items.push(['帧率', `${info.fps.toFixed(2)} fps`]);
    }
    if (info.videoCodec) {
      items.push(['视频编码', info.videoCodec.toUpperCase()]);
    }
    if (info.audioCodec) {
      items.push(['音频编码', info.audioCodec.toUpperCase()]);
    }
    if (info.audioSampleRate) {
      items.push(['采样率', `${(info.audioSampleRate / 1000).toFixed(1)} kHz`]);
    }
    if (info.audioChannels) {
      items.push(['声道', audioChannelLabel(info.audioChannels)]);
    }
    if (info.container) {
      items.push(['封装', info.container.toUpperCase()]);
    }
    if (info.duration) {
      items.push(['时长', formatDuration(info.duration)]);
    }
  }

  return (
    <div className="text-xs text-muted-foreground px-4 py-2 border-t bg-muted/30 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1">
      {items.length === 0 ? (
        <span>正在解析媒体信息…</span>
      ) : (
        items.map(([k, v]) => (
          <span key={k}>
            <span className="text-foreground/60">{k}：</span>
            <span className="text-foreground/90">{v}</span>
          </span>
        ))
      )}
    </div>
  );
}

function audioChannelLabel(channels: number): string {
  switch (channels) {
    case 1: return '单声道 (1.0)';
    case 2: return '立体声 (2.0)';
    case 6: return '5.1 环绕';
    case 8: return '7.1 环绕';
    default: return `${channels} 声道`;
  }
}
