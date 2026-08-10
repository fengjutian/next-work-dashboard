/**
 * 视频播放器插件专用图标
 *
 * 项目级 @/components/icons 不覆盖音量 / 字幕等媒体图标，本文件
 * 直接从 lucide-react 引入需要的 icon，避免污染全局图标库。
 */

import type { SVGProps } from 'react';
import {
  VolumeX as VolumeMuteIcon,
  Volume1 as VolumeLowIcon,
  Volume2 as VolumeHighIcon,
  Subtitles as SubtitleIcon,
  SkipBack as SkipBackIcon,
  SkipForward as SkipForwardIcon,
  Gauge as GaugeIcon,
  ListMusic as ListIcon,
  Film as FilmIcon,
  Speaker as SpeakerIcon,
  Captions as CaptionsIcon,
} from 'lucide-react';

export const VolumeMute = VolumeMuteIcon;
export const VolumeLow = VolumeLowIcon;
export const VolumeHigh = VolumeHighIcon;
export const Subtitle = SubtitleIcon;
export const Captions = CaptionsIcon;
export const SkipBack = SkipBackIcon;
export const SkipForward = SkipForwardIcon;
export const Gauge = GaugeIcon;
export const Playlist = ListIcon;
export const Film = FilmIcon;
export const Speaker = SpeakerIcon;

export type IconProps = SVGProps<SVGSVGElement>;
