/**
 * 视频生成插件 — 类型契约
 *
 * 业务流程是 MiniMax-H3 异步协议：create → poll → download。
 * Renderer 端用 VideoGenerationRequest / VideoGenerationResult；
 * main 进程负责真正与 api.minimaxi.com 交互（持 API Key、下载成片、落库）。
 */

export type VideoGenerationMode = 'text-to-video' | 'image-to-video' | 'start-end-to-video' | 'reference-to-video';

export type VideoResolution = '768P' | '1080P' | '2K';

export type VideoRatio =
  | '1:1'
  | '16:9'
  | '4:3'
  | '3:2'
  | '2:3'
  | '3:4'
  | '9:16'
  | '21:9'
  | 'adaptive';

export interface VideoContentItemText {
  type: 'text';
  text: string;
}

export interface VideoContentItemImage {
  type: 'image_url';
  image_url: { url: string };
  role: 'first_frame' | 'last_frame' | 'reference_image';
}

export interface VideoContentItemVideo {
  type: 'video_url';
  video_url: { url: string };
  role: 'reference_video' | 'base_video';
}

export interface VideoContentItemAudio {
  type: 'audio_url';
  audio_url: { url: string };
  role: 'reference_audio';
}

export type VideoContentItem = VideoContentItemText | VideoContentItemImage | VideoContentItemVideo | VideoContentItemAudio;

export interface VideoGenerationRequest {
  apiKey: string;
  /** MiniMax 接入域名，默认 https://api.minimaxi.com */
  baseUrl?: string;
  model?: string;
  prompt: string;
  duration?: number;
  resolution?: VideoResolution;
  ratio?: VideoRatio;
  /** 同步首尾帧 / 参考图时使用，本地图片需先转 https URL（上传到对象存储后回填） */
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** 渲染端可感知模式；main 进程用它来组织 content[] 并校验 */
  mode?: VideoGenerationMode;
}

export interface VideoGenerationSubmitResult {
  success: boolean;
  taskId?: string;
  /** MiniMax 透传 base_resp */
  baseResp?: { statusCode?: number; statusMsg?: string };
  error?: string;
}

export type VideoTaskStatus = 'queued' | 'preparing' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

export interface VideoTaskInfo {
  taskId: string;
  status: VideoTaskStatus;
  /** 成片下载地址（仅 succeeded 时存在） */
  videoUrl?: string;
  /** Hailuo v1 completes with a file_id, which is exchanged for a download URL. */
  fileId?: string;
  /** 上游原始 task payload，便于排查 */
  raw?: unknown;
  error?: string;
}

export interface VideoGenerationDownloadResult {
  success: boolean;
  /** 本地保存路径（绝对路径） */
  filePath?: string;
  /** 落库后的 record id */
  recordId?: string;
  bytes?: number;
  error?: string;
}

export interface StoredVideoRecord {
  id: string;
  taskId: string;
  prompt: string;
  model: string;
  mode: VideoGenerationMode;
  duration: number;
  resolution: VideoResolution;
  ratio: VideoRatio;
  fileName: string;
  filePath: string;
  bytes: number;
  status: VideoTaskStatus;
  createdAt: number;
}

export interface VideoLibraryQuery {
  limit?: number;
  status?: VideoTaskStatus;
}

export type { VideoStoryboardOptions, VideoStoryboardSegment } from './core/storyboard';
