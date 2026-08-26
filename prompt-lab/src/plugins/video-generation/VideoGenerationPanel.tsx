/**
 * prompt-lab wrapper for @next-work-dashboard/video-generation.
 *
 * Hosts in @next-work-dashboard/video-generation are host-agnostic; this file wires the
 * published panel to prompt-lab's concrete:
 *  - SQLite-backed task store (`db*VideoTask*` from `@/db`)
 *  - Electron preload bridge (`window.electronAPI`)
 *  - Zustand AI config (`@/store/store`)
 *
 * Keep this file thin. New host capabilities should be added to the package's
 * `VideoGenerationAdapter` rather than to this wrapper.
 */

import React, { useMemo } from "react";
import { VideoGenerationPanel as PublishedVideoGenerationPanel, type VideoGenerationAdapter } from "@next-work-dashboard/video-generation/react";
import "@next-work-dashboard/video-generation/styles.css";
import {
  dbDeleteVideoTask,
  dbGetVideoTask,
  dbListVideoTasks,
  dbUpdateVideoTaskFile,
  dbUpdateVideoTaskStatus,
  dbUpsertVideoTask,
  type DbVideoTaskRecord,
} from "@/db";
import type {
  StoredVideoRecord,
  VideoGenerationMode,
  VideoRatio,
  VideoResolution,
  VideoTaskStatus,
} from "@next-work-dashboard/video-generation";
import { useStore } from "@/store/store";

function recordToStored(row: DbVideoTaskRecord): StoredVideoRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    prompt: row.prompt,
    model: row.model,
    mode: (row.mode || "text-to-video") as VideoGenerationMode,
    duration: row.duration,
    resolution: (row.resolution || "768P") as VideoResolution,
    ratio: (row.ratio || "16:9") as VideoRatio,
    fileName: row.fileName,
    filePath: row.filePath,
    bytes: row.bytes,
    status: (row.status || "processing") as VideoTaskStatus,
    createdAt: row.createdAt,
    batchId: row.batchId || undefined,
    batchIndex: row.batchIndex ?? undefined,
  };
}

function createPromptLabAdapter(aiConfig: VideoGenerationAdapter["ai"]): VideoGenerationAdapter {
  return {
    api: {
      videoGeneration: window.electronAPI.videoGeneration,
      llmChat: window.electronAPI.llmChat,
    },
    ai: aiConfig,
    tasks: {
      createTask: async (input) => {
        await dbUpsertVideoTask({
          id: input.id,
          taskId: input.taskId,
          prompt: input.prompt,
          model: input.model,
          mode: input.mode,
          duration: input.duration,
          resolution: input.resolution,
          ratio: input.ratio,
          fileName: "",
          filePath: "",
          bytes: 0,
          status: "processing",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          batchId: input.batchId || "",
          batchIndex: input.batchIndex ?? -1,
        });
      },
      attachFile: (id, fileName, filePath, bytes) => dbUpdateVideoTaskFile(id, fileName, filePath, bytes),
      updateStatus: (id, status) => dbUpdateVideoTaskStatus(id, status),
      getTask: (id) => {
        const row = dbGetVideoTask(id);
        return row ? recordToStored(row) : null;
      },
      listTasks: (limit = 50, status) =>
        dbListVideoTasks(limit, status).map(recordToStored),
      deleteTask: async (id) => {
        await dbDeleteVideoTask(id);
      },
    },
  };
}

export const VideoGenerationPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const adapter = useMemo(() => createPromptLabAdapter(aiApi), [aiApi]);
  return <PublishedVideoGenerationPanel adapter={adapter} />;
};
