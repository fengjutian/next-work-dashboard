/**
 * 视频播放器插件 — 入口
 *
 * 暴露：
 *  - VideoPlayerPanel  → 面板 React 组件
 *  - 类型 + 后端 service
 */

export { VideoPlayerPanel } from './VideoPlayerPanel';
export type {
  MediaInfo,
  PlayerState,
  TrackInfo,
  VideoPlayerAPI,
  VideoPlayerEvent,
  VideoPlayerStatus,
  RecentVideoEntry,
} from './types';
