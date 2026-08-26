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
export const DEFAULT_MODEL = 'MiniMax-Hailuo-2.3';
export const H3_MODEL_PREFIX = 'minimax-h3';
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

export function usesH3Protocol(model?: string): boolean {
  return String(model || '').trim().toLowerCase().startsWith(H3_MODEL_PREFIX);
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

  const resolution: VideoResolution = ALLOWED_RESOLUTIONS.has(input.resolution as VideoResolution) ? (input.resolution as VideoResolution) : DEFAULT_RESOLUTION;
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

  if (!usesH3Protocol(model)) {
    if (input.referenceVideoUrls?.some(Boolean) || input.referenceAudioUrls?.some(Boolean) || input.referenceImageUrls?.some(Boolean)) {
      return { ok: false, error: 'Hailuo 2.3 暂不支持当前的参考图/视频/音频模式，请切换到 MiniMax-H3' };
    }
    if (resolution === '2K') return { ok: false, error: 'Hailuo 2.3 不支持 2K，请选择 768P 或 1080P' };
    if (duration !== 6 && duration !== 10) return { ok: false, error: 'Hailuo 2.3 仅支持 6 秒或 10 秒' };
    if (resolution === '1080P' && duration !== 6) return { ok: false, error: 'Hailuo 2.3 的 1080P 仅支持 6 秒' };
    if (input.lastFrameUrl && model.toLowerCase() !== 'minimax-hailuo-02') {
      return { ok: false, error: '首尾帧生成需要 MiniMax-Hailuo-02；Hailuo 2.3 仅支持文生视频和首帧图生视频' };
    }
  }

  return { ok: true, value: { baseUrl, apiKey, model, prompt, duration, resolution, ratio: finalRatio, content } };
}

/** 组装 HTTP POST 提交任务的 options（headers/body/endpoint），main 进程直接 fetch 即可 */
export function buildCreateRequest(normalized: NormalizedVideoRequest): { endpoint: string; init: RequestInit } {
  const h3 = usesH3Protocol(normalized.model);
  const endpoint = `${normalized.baseUrl}/${h3 ? 'v2' : 'v1'}/video_generation`;
  const firstFrame = normalized.content.find((item) => item.type === 'image_url' && item.role === 'first_frame');
  const lastFrame = normalized.content.find((item) => item.type === 'image_url' && item.role === 'last_frame');
  const body = h3 ? {
    model: normalized.model,
    content: normalized.content,
    duration: normalized.duration,
    resolution: normalized.resolution,
    ratio: normalized.ratio,
  } : {
    model: normalized.model,
    prompt: normalized.prompt,
    duration: normalized.duration,
    resolution: normalized.resolution,
    ...(firstFrame?.type === 'image_url' ? { first_frame_image: firstFrame.image_url.url } : {}),
    ...(lastFrame?.type === 'image_url' ? { last_frame_image: lastFrame.image_url.url } : {}),
  };
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${normalized.apiKey}`,
    },
    body: JSON.stringify(body),
  };
  return { endpoint, init };
}

export function buildQueryRequest(baseUrl: string, apiKey: string, taskId: string, model = 'MiniMax-H3'): { endpoint: string; init: RequestInit } {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    endpoint: usesH3Protocol(model)
      ? `${root}/v2/query/video_generation/${encodeURIComponent(taskId)}`
      : `${root}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
    init: {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  };
}

export function buildFileRetrieveRequest(baseUrl: string, apiKey: string, fileId: string): { endpoint: string; init: RequestInit } {
  return {
    endpoint: `${baseUrl.replace(/\/+$/, '')}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
    init: { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
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
  const root = payload as { task?: { status?: string; content?: { url?: string }; error?: { message?: string } | string }; status?: string; file_id?: string | number; base_resp?: { status_code?: number; status_msg?: string } };
  const task = root.task || (payload as { status?: string; content?: { url?: string }; error?: unknown });
  const rawStatus = String((task as { status?: string }).status || '').toLowerCase();
  const status = mapStatus(rawStatus);
  const videoUrl = (task as { content?: { url?: string } }).content?.url;
  const error = (task as { error?: { message?: string } | string }).error;
  const errorText = typeof error === 'string' ? error : error?.message;
  const fileId = root.file_id === undefined ? undefined : String(root.file_id);
  const businessError = root.base_resp?.status_code && root.base_resp.status_code !== 0 ? root.base_resp.status_msg : undefined;
  return { taskId, status, videoUrl, fileId, raw: payload, error: errorText || businessError };
}

export function parseFileRetrieveResponse(payload: unknown): { videoUrl?: string; error?: string } {
  if (!payload || typeof payload !== 'object') return { error: '文件接口返回非 JSON 对象' };
  const body = payload as { file?: { download_url?: string }; base_resp?: { status_code?: number; status_msg?: string } };
  if (body.base_resp?.status_code && body.base_resp.status_code !== 0) return { error: body.base_resp.status_msg || `MiniMax 返回 status_code=${body.base_resp.status_code}` };
  return body.file?.download_url ? { videoUrl: body.file.download_url } : { error: '文件接口未返回 download_url' };
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

export function formatMiniMaxHttpError(status: number, payload: unknown, rawText: string): string {
  const body = payload as { error?: { message?: string }; message?: string } | null;
  const message = body?.error?.message || body?.message || rawText.slice(0, 500) || '未知错误';
  if (/TokenPlan|Credit/i.test(message) && /MiniMax-H3/i.test(message)) {
    return '当前 MiniMax 套餐不支持 H3。你的 Max 套餐可使用 Hailuo 2.3（每日 3 条），请在模型处选择 MiniMax-Hailuo-2.3。';
  }
  return `MiniMax 请求失败（HTTP ${status}）：${message}`;
}

/** 轮询间隔（毫秒）。官方建议 10s，向上暴露常量供 main 进程使用 */
export const POLL_INTERVAL_MS = 10_000;

/** 最大轮询次数（防止任务僵死），默认 60 次 × 10s = 10 分钟 */
export const POLL_MAX_ATTEMPTS = 60;
