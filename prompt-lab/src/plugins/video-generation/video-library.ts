/**
 * 视频生成 — 本地元数据 + 文件管理
 *
 * 元数据走 SQLite（dbUpsertVideoTask / dbGetVideoTask / dbListVideoTasks / dbDeleteVideoTask）。
 * 视频文件本身在主进程落盘，渲染端不直接读路径，按需调用 window.electronAPI.videoGeneration.readBlob
 * 拿到 ArrayBuffer，再 URL.createObjectURL() 喂给 <video>。
 */

import {
  dbDeleteVideoTask,
  dbGetVideoTask,
  dbListVideoTasks,
  dbUpdateVideoTaskFile,
  dbUpdateVideoTaskStatus,
  dbUpsertVideoTask,
  type DbVideoTaskRecord,
} from '@/db';
import type { StoredVideoRecord, VideoGenerationMode, VideoRatio, VideoResolution, VideoTaskStatus } from './types';

function recordToStored(row: DbVideoTaskRecord): StoredVideoRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    prompt: row.prompt,
    model: row.model,
    mode: (row.mode || 'text-to-video') as VideoGenerationMode,
    duration: row.duration,
    resolution: (row.resolution || '768P') as VideoResolution,
    ratio: (row.ratio || '16:9') as VideoRatio,
    fileName: row.fileName,
    filePath: row.filePath,
    bytes: row.bytes,
    status: (row.status || 'processing') as VideoTaskStatus,
    createdAt: row.createdAt,
  };
}

export function makeId(): string {
  return `vgen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTask(input: {
  id: string;
  taskId: string;
  prompt: string;
  model: string;
  mode: VideoGenerationMode;
  duration: number;
  resolution: VideoResolution;
  ratio: VideoRatio;
}): Promise<void> {
  await dbUpsertVideoTask({
    id: input.id,
    taskId: input.taskId,
    prompt: input.prompt,
    model: input.model,
    mode: input.mode,
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio,
    fileName: '',
    filePath: '',
    bytes: 0,
    status: 'processing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function attachFile(id: string, fileName: string, filePath: string, bytes: number): Promise<void> {
  await dbUpdateVideoTaskFile(id, fileName, filePath, bytes);
}

export async function updateStatus(id: string, status: VideoTaskStatus): Promise<void> {
  await dbUpdateVideoTaskStatus(id, status);
}

export function getTask(id: string): StoredVideoRecord | null {
  const row = dbGetVideoTask(id);
  return row ? recordToStored(row) : null;
}

export function listTasks(limit = 50, status?: VideoTaskStatus): StoredVideoRecord[] {
  return dbListVideoTasks(limit, status).map(recordToStored);
}

/** 删除本地记录 + 视频文件（文件删除走主进程 IPC，因为 renderer 拿不到 fs） */
export async function deleteTask(id: string): Promise<void> {
  const row = getTask(id);
  if (row?.filePath) {
    try { await window.electronAPI.videoGeneration.cleanup(row.filePath); } catch { /* best-effort */ }
  }
  await dbDeleteVideoTask(id);
}

/** 拉取本地视频文件的 ArrayBuffer，渲染端用 createObjectURL 喂给 <video> */
export async function readVideoAsBlob(filePath: string): Promise<{ success: boolean; data?: ArrayBuffer; mimeType?: string; bytes?: number; error?: string }> {
  return window.electronAPI.videoGeneration.readBlob(filePath);
}
