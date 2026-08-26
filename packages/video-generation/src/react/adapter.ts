/**
 * Host capabilities consumed by the video generation panel.
 *
 * Concrete hosts (prompt-lab, future web / mobile shells) wire this adapter to their
 * own Electron preload bridge, SQLite layer, and AI provider.
 */

import type { ChatChunk, ChatMessage, ChatOptions } from '../core/llm';
import type { StitchMetrics } from '../core/continuity';
import type {
  StoredVideoRecord,
  VideoGenerationMode,
  VideoGenerationRequest,
  VideoGenerationSubmitResult,
  VideoRatio,
  VideoResolution,
  VideoTaskInfo,
  VideoTaskStatus,
} from '../types';

export interface VideoAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: string;
}

/** Renderer-side video task record CRUD. Backed by SQLite in the prompt-lab host. */
export interface VideoTaskRepository {
  createTask(input: {
    id: string;
    taskId: string;
    prompt: string;
    model: string;
    mode: VideoGenerationMode;
    duration: number;
    resolution: VideoResolution;
    ratio: VideoRatio;
    batchId?: string;
    batchIndex?: number;
  }): Promise<void>;
  attachFile(id: string, fileName: string, filePath: string, bytes: number): Promise<void>;
  updateStatus(id: string, status: VideoTaskStatus): Promise<void>;
  getTask(id: string): StoredVideoRecord | null;
  listTasks(limit?: number, status?: VideoTaskStatus): StoredVideoRecord[];
  deleteTask(id: string): Promise<void>;
}

/** Electron preload bridge surface. Concrete hosts can narrow these methods. */
export interface VideoGenerationHostApi {
  videoGeneration: {
    create(payload: VideoGenerationRequest): Promise<VideoGenerationSubmitResult>;
    query(payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }): Promise<{ success: boolean; info?: VideoTaskInfo; error?: string }>;
    download(payload: { taskId: string; videoUrl: string; recordId: string }): Promise<{ success: boolean; filePath?: string; fileName?: string; bytes?: number; mimeType?: string; error?: string }>;
    cancel(payload: { baseUrl?: string; apiKey: string; taskId: string; model?: string }): Promise<{ success: boolean; baseResp?: { statusCode?: number; statusMsg?: string }; error?: string }>;
    uploadReference(payload: { name: string; mimeType: string; data: ArrayBuffer; ttlHours?: number }): Promise<{ success: boolean; url?: string; ttlHours?: number; bytes?: number; error?: string }>;
    readBlob(filePath: string): Promise<{ success: boolean; data?: ArrayBuffer; mimeType?: string; bytes?: number; error?: string }>;
    reveal(filePath: string): Promise<{ success: boolean; error?: string }>;
    openFolder(): Promise<{ success: boolean; path?: string; error?: string }>;
    cleanup(filePath: string): Promise<{ success: boolean; error?: string }>;
    extractLastFrame(payload: { filePath: string; recordId: string }): Promise<{ success: boolean; filePath?: string; name?: string; mimeType?: string; data?: ArrayBuffer; error?: string }>;
    inspectStitch(payload: { previousPath: string; nextPath: string; threshold?: number }): Promise<{ success: boolean; score?: number; passed?: boolean; threshold?: number; metrics?: StitchMetrics; error?: string }>;
    concat(payload: { filePaths: string[]; outputId: string }): Promise<{ success: boolean; filePath?: string; fileName?: string; bytes?: number; error?: string }>;
  };
  llmChat?: (payload: { baseUrl: string; apiKey: string; body: Record<string, unknown> }) => Promise<{ ok: boolean; status: number; data?: any; error?: string }>;
}

export interface VideoGenerationAdapter {
  /** Host's Electron preload bridge (typed loosely so it can be wired in any host). */
  api: VideoGenerationHostApi;
  /** AI configuration used for the in-panel prompt expansion feature. */
  ai: VideoAiConfig;
  /** Renderer-side task storage. */
  tasks: VideoTaskRepository;
  /** Optional AI chat fallback. When omitted the panel fetches LLM directly. */
  aiChat?: (messages: ChatMessage[], options: ChatOptions) => AsyncIterable<ChatChunk>;
}
