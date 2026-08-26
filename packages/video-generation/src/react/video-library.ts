/**
 * 视频生成 — 渲染端任务记录 + 文件访问胶水
 *
 * 不再 import 任何 host 内部模块。具体的 SQLite / IPC 实现由
 * VideoGenerationAdapter.tasks + api 提供。
 */

import type { VideoTaskRepository, VideoGenerationHostApi } from "./adapter";
import type {
  StoredVideoRecord,
  VideoGenerationMode,
  VideoRatio,
  VideoResolution,
  VideoTaskStatus,
} from "../types";

export function makeId(): string {
  return `vgen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createVideoLibrary(tasks: VideoTaskRepository, api: VideoGenerationHostApi) {
  return {
    makeId,
    createTask: (input: Parameters<VideoTaskRepository["createTask"]>[0]) => tasks.createTask(input),
    attachFile: (id: string, fileName: string, filePath: string, bytes: number) =>
      tasks.attachFile(id, fileName, filePath, bytes),
    updateStatus: (id: string, status: VideoTaskStatus) => tasks.updateStatus(id, status),
    getTask: (id: string): StoredVideoRecord | null => tasks.getTask(id),
    listTasks: (limit = 50, status?: VideoTaskStatus): StoredVideoRecord[] => tasks.listTasks(limit, status),
    deleteTask: async (id: string): Promise<void> => {
      const row = tasks.getTask(id);
      if (row?.filePath) {
        try { await api.videoGeneration.cleanup(row.filePath); } catch { /* best-effort */ }
      }
      await tasks.deleteTask(id);
    },
    readVideoAsBlob: (filePath: string) => api.videoGeneration.readBlob(filePath),
  };
}

export type VideoLibrary = ReturnType<typeof createVideoLibrary>;
