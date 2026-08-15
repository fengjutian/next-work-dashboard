/**
 * 视频生成 — 纯函数客户端
 *
 * 不依赖 Electron / node-fetch / global fetch，方便在单测里直接跑。
 * main 进程会基于这些函数拼接出实际 fetch。
 */

import type {
  VideoContentItem,
  VideoGenerationRequest,
  VideoGenerationSubmitResult,
  VideoRatio,
  VideoResolution,
  VideoTaskInfo,
  VideoTaskStatus,
} from '../types';

export const DEFAULT_BASE_URL = 'https://api.minimaxi.com';
export const DEFAULT_MODEL = 'MiniMax-H3';
export const DEFAULT_DURATION = 6;
export const DEFAULT_RESOLUTION: VideoResolution = '768P';
export const DEFAULT_RATIO: VideoRatio = '16:9';

const ALLOWED_RESOLUTIONS: ReadonlySet<VideoResolution> = new Set(['768P', '1080P', '2K']);
const ALLOWED_RATIOS: ReadonlySet<VideoRatio> = new Set([
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
  'adaptive',
]);

export interface NormalizedVideoRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  duration: number;
  resolution: VideoResolution;
  ratio: VideoRatio;
  content: VideoContentItem[];
}

export function normalizeRequest(input: VideoGenerationRequest): { ok: true; value: NormalizedVideoRequest } | { ok: false; error: string } {
  const baseUrl = (input.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiKey = String(input.apiKey || '').trim();
  const model = String(input.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const prompt = String(input.prompt || '').trim();
  if (!apiKey) return { ok: false, error: '请填写 MiniMax API Key' };
  if (!/^[\x21-\x7E]+$/.test(apiKey)) return { ok: false, error: 'API Key 格式无效：只能包含 ASCII 字符' };
  if (!prompt) return { ok: false, error: '请填写视频描述（prompt）' };
  if (prompt.length > 7000) return { ok: false, error: '提示词不能超过 7000 字符' };

  const duration = Number.isInteger(input.duration) && (input.duration as number) >= 4 && (input.duration as number) <= 15
    ? (input.duration as number)
    : DEFAULT_DURATION;

  const resolution: VideoResolution = ALLOWED_RESOLUTIONS.has(input.resolution as VideoResolution) ? (input.resolution as VideoResolution) : DEFAULT_RESOLUTIONS();
  const ratio: VideoRatio = ALLOWED_RATIOS.has(input.ratio as VideoRatio) ? (input.ratio as VideoRatio) : DEFAULT_RATIO;

  const content: VideoContentItem[] = [{ type: 'text', text: prompt }];

  if (input.firstFrameUrl) {
    content.push({ type: 'image_url', image_url: { url: input.firstFrameUrl }, role: 'first_frame' });
  }
  if (input.lastFrameUrl) {
    content.push({ type: 'image_url', image_url: { url: input.lastFrameUrl }, role: 'last_frame' });
  }
  (input.referenceImageUrls || []).forEach((url) => {
    if (url) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  });
  (input.referenceVideoUrls || []).forEach((url) => {
    if (url) content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
  });
  (input.referenceAudioUrls || []).forEach((url) => {
    if (url) content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
  });

  // t2va 模式（无任何参考素材）必须显式 ratio，不能 adaptive
  const hasReference = content.some((item) => item.type !== 'text');
  const finalRatio: VideoRatio = !hasReference ? (ratio === 'adaptive' ? DEFAULT_RATIO : ratio) : ratio;

  return { ok: true, value: { baseUrl, apiKey, model, prompt, duration, resolution, ratio: finalRatio, content } };
}

function DEFAULT_RESOLUTIONS(): VideoResolution {
  return DEFAULT_RESOLUTION;
}

/** 组装 HTTP POST 提交任务的 options（headers/body/endpoint），main 进程直接 fetch 即可 */
export function buildCreateRequest(normalized: NormalizedVideoRequest): { endpoint: string; init: RequestInit } {
  const endpoint = `${normalized.baseUrl}/v2/video_generation`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${normalized.apiKey}`,
    },
    body: JSON.stringify({
      model: normalized.model,
      content: normalized.content,
      duration: normalized.duration,
      resolution: normalized.resolution,
      ratio: normalized.ratio,
    }),
  };
  return { endpoint, init };
}

export function buildQueryRequest(baseUrl: string, apiKey: string, taskId: string): { endpoint: string; init: RequestInit } {
  return {
    endpoint: `${baseUrl.replace(/\/+$/, '')}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
    init: {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  };
}

/** 取消 / 删除上游任务。MiniMax 文档：取消排队中的任务，或删除成功和失败的任务记录。 */
export function buildCancelRequest(baseUrl: string, apiKey: string, taskId: string): { endpoint: string; init: RequestInit } {
  return {
    endpoint: `${baseUrl.replace(/\/+$/, '')}/v2/video_generation/${encodeURIComponent(taskId)}`,
    init: {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  };
}

/** 解析 MiniMax /v2/query 返回 — 文档结构：{ task: { status, content?: { url }, error? }, base_resp? } */
export function parseTaskResponse(payload: unknown, taskId: string): VideoTaskInfo {
  if (!payload || typeof payload !== 'object') {
    return { taskId, status: 'unknown', error: '任务接口返回非 JSON 对象' };
  }
  const root = payload as { task?: { status?: string; content?: { url?: string }; error?: { message?: string } | string }; base_resp?: { status_code?: number; status_msg?: string } };
  const task = root.task || (payload as { status?: string; content?: { url?: string }; error?: unknown });
  const rawStatus = String((task as { status?: string }).status || '').toLowerCase();
  const status = mapStatus(rawStatus);
  const videoUrl = (task as { content?: { url?: string } }).content?.url;
  const error = (task as { error?: { message?: string } | string }).error;
  const errorText = typeof error === 'string' ? error : error?.message;
  return { taskId, status, videoUrl, raw: payload, error: errorText };
}

function mapStatus(input: string): VideoTaskStatus {
  switch (input) {
    case 'queued':
    case 'queueing':
      return 'queued';
    case 'preparing':
    case 'prepare':
      return 'preparing';
    case 'processing':
    case 'running':
    case 'in_progress':
      return 'processing';
    case 'succeed':
    case 'succeeded':
    case 'success':
    case 'finished':
      return 'succeeded';
    case 'fail':
    case 'failed':
      return 'failed';
    case 'cancel':
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

/** 解析 /v2/video_generation 提交响应（base_resp + task_id） */
export function parseSubmitResponse(payload: unknown): VideoGenerationSubmitResult {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: '提交接口返回非 JSON 对象' };
  }
  const body = payload as { task_id?: string; base_resp?: { status_code?: number; status_msg?: string } };
  const statusCode = body.base_resp?.status_code;
  if (statusCode && statusCode !== 0) {
    return {
      success: false,
      baseResp: { statusCode, statusMsg: body.base_resp?.status_msg },
      error: body.base_resp?.status_msg || `MiniMax 返回 status_code=${statusCode}`,
    };
  }
  if (!body.task_id) {
    return { success: false, error: '提交成功但未返回 task_id' };
  }
  return { success: true, taskId: body.task_id, baseResp: { statusCode: 0, statusMsg: body.base_resp?.status_msg } };
}

/** 轮询间隔（毫秒）。官方建议 10s，向上暴露常量供 main 进程使用 */
export const POLL_INTERVAL_MS = 10_000;

/** 最大轮询次数（防止任务僵死），默认 60 次 × 10s = 10 分钟 */
export const POLL_MAX_ATTEMPTS = 60;
