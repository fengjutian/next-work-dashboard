// ── Agent Task Types ──
// Shared between main process AgentTaskService and renderer.

export type AgentTaskState =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'interrupted'
  | 'failed'
  | 'review'
  | 'completed';

export interface AgentTaskConfig {
  sessionId: string;
  workspaceRoot: string;
  executionRoot?: string;
  instruction: string;
  modelConfig: { apiKey: string; baseUrl: string; model: string };
  multiFile: boolean;
  tokenBudget: number;
  contextFiles?: string[];
  recovery?: { checkpoint: string; contextPaths: string[] };
}

export interface AgentTaskContext {
  sessionId: string;
  executionRoot: string;
  documents: Array<{ path: string; content: string; language: string }>;
  activePath: string;
}

export interface AgentTaskProgress {
  taskId: string;
  seq: number;
  stage: string;
  message: string;
  timestamp: number;
}

export interface AgentTaskRecord {
  taskId: string;
  sessionId: string;
  workspaceRoot: string;
  executionRoot?: string;
  instruction: string;
  modelConfig: { apiKey: string; baseUrl: string; model: string };
  multiFile: boolean;
  tokenBudget: number;
  state: AgentTaskState;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  progress?: AgentTaskProgress;
  error?: string;
  recovery?: { checkpoint: string; contextPaths: string[] };
  result?: {
    proposals: Array<{
      path: string;
      original: string;
      modified: string;
      language: string;
      previousPath?: string;
    }>;
    rawResponse: string;
  };
}

export interface AgentTaskEvent {
  taskId: string;
  sessionId: string;
  state: AgentTaskState;
  progress?: AgentTaskProgress;
  error?: string;
}
