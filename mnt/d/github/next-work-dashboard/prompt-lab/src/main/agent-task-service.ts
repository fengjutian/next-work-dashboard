// ── Agent Task Service ──
// Main-process service that runs AI model calls outside the renderer process.
// Provides create, query, cancel, retry, and progress subscription for agent tasks.

import { EventEmitter } from 'node:events';
import { createOpenAIProvider, type LLMProvider } from '../core/llm';
import type {
  AgentTaskConfig,
  AgentTaskContext,
  AgentTaskEvent,
  AgentTaskProgress,
  AgentTaskRecord,
  AgentTaskState,
} from './agent-task-types';

export type { AgentTaskConfig, AgentTaskContext, AgentTaskEvent, AgentTaskProgress, AgentTaskRecord, AgentTaskState };

let seqCounter = 0;

function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

function taskId(): string {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentTaskService extends EventEmitter {
  private tasks = new Map<string, AgentTaskRecord>();
  private controllers = new Map<string, AbortController>();
  private queue: string[] = [];
  private maxConcurrent = 2;
  private worktreeLocks = new Map<string, string>(); // executionRoot → taskId

  constructor(maxConcurrent = 2) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  // ── Public API ──

  create(config: AgentTaskConfig): AgentTaskRecord {
    if (!config.sessionId || !config.workspaceRoot || !config.instruction.trim()) {
      throw new Error('INVALID_TASK_CONFIG');
    }
    const record: AgentTaskRecord = {
      taskId: taskId(),
      sessionId: config.sessionId,
      workspaceRoot: config.workspaceRoot,
      executionRoot: config.executionRoot,
      instruction: config.instruction.trim(),
      modelConfig: { ...config.modelConfig },
      multiFile: config.multiFile,
      tokenBudget: config.tokenBudget,
      state: 'queued',
      createdAt: Date.now(),
      recovery: config.recovery,
    };
    this.tasks.set(record.taskId, record);
    this.emitEvent(record.taskId, 'queued');
    this.queue.push(record.taskId);
    this.drainQueue();
    return record;
  }

  get(taskId: string): AgentTaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  list(sessionId?: string): AgentTaskRecord[] {
    const records = [...this.tasks.values()];
    if (sessionId) return records.filter((r) => r.sessionId === sessionId);
    return records;
  }

  cancel(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (record.state === 'completed' || record.state === 'failed' || record.state === 'interrupted') return false;
    record.state = 'cancelling';
    this.emitEvent(taskId, 'cancelling');
    const controller = this.controllers.get(taskId);
    if (controller) controller.abort();
    else {
      // Still queued — remove from queue and mark interrupted
      this.queue = this.queue.filter((id) => id !== taskId);
      this.releaseWorktreeLock(taskId);
      record.state = 'interrupted';
      record.endedAt = Date.now();
      this.emitEvent(taskId, 'interrupted');
      this.drainQueue();
    }
    return true;
  }

  retry(taskId: string): AgentTaskRecord | null {
    const record = this.tasks.get(taskId);
    if (!record) return null;
    if (record.state !== 'failed' && record.state !== 'interrupted') return null;
    record.state = 'queued';
    record.error = undefined;
    record.progress = undefined;
    record.startedAt = undefined;
    record.endedAt = undefined;
    this.emitEvent(taskId, 'queued');
    this.queue.push(taskId);
    this.drainQueue();
    return record;
  }

  // ── Progress subscription ──

  subscribe(taskId: string, handler: (event: AgentTaskEvent) => void): () => void {
    const listener = (event: AgentTaskEvent) => {
      if (event.taskId === taskId) handler(event);
    };
    this.on('event', listener);
    // replay current state
    const record = this.tasks.get(taskId);
    if (record) {
      handler({
        taskId: record.taskId,
        sessionId: record.sessionId,
        state: record.state,
        progress: record.progress,
        error: record.error,
      });
    }
    return () => { this.off('event', listener); };
  }

  // ── Shutdown ──

  shutdown(): AgentTaskRecord[] {
    const interrupted: AgentTaskRecord[] = [];
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    for (const record of this.tasks.values()) {
      if (record.state === 'running' || record.state === 'cancelling') {
        record.state = 'interrupted';
        record.endedAt = Date.now();
        this.emitEvent(record.taskId, 'interrupted');
        interrupted.push(record);
      }
    }
    this.queue = [];
    this.worktreeLocks.clear();
    return interrupted;
  }

  // ── Internal: queue drain ──

  private drainQueue(): void {
    const running = [...this.tasks.values()].filter((r) => r.state === 'running').length;
    const available = this.maxConcurrent - running;
    for (let i = 0; i < available && this.queue.length > 0; i++) {
      const nextId = this.queue.shift()!;
      const record = this.tasks.get(nextId);
      if (!record || record.state !== 'queued') continue;
      void this.execute(record);
    }
  }

  // ── Internal: worktree lock ──

  private acquireWorktreeLock(taskId: string, executionRoot?: string): boolean {
    if (!executionRoot) return true; // no worktree — always allowed
    const existing = this.worktreeLocks.get(executionRoot);
    if (existing && existing !== taskId && this.tasks.get(existing)?.state === 'running') return false;
    this.worktreeLocks.set(executionRoot, taskId);
    return true;
  }

  private releaseWorktreeLock(taskId: string): void {
    for (const [root, owner] of this.worktreeLocks) {
      if (owner === taskId) this.worktreeLocks.delete(root);
    }
  }

  // ── Internal: execution ──

  private async execute(record: AgentTaskRecord): Promise<void> {
    if (!this.acquireWorktreeLock(record.taskId, record.executionRoot)) {
      // Re-queue behind current owner
      record.state = 'queued';
      this.queue.push(record.taskId);
      return;
    }

    const controller = new AbortController();
    this.controllers.set(record.taskId, controller);

    try {
      record.state = 'running';
      record.startedAt = Date.now();
      this.emitEvent(record.taskId, 'running');

      const provider = createOpenAIProvider(record.modelConfig);
      const signal = controller.signal;

      // Build conversation from the instruction
      const instruction = record.instruction;
      let response = '';

      if (record.multiFile) {
        this.emitProgress(record.taskId, 'collecting-context', '正在收集工作区上下文…');
        // For now, the renderer sends context files via the config
        // In a future iteration, the renderer will collect and send context
        const contextFiles = record.recovery?.contextPaths ?? [];
        signal.throwIfAborted();

        this.emitProgress(record.taskId, 'generating', 'AI 正在生成多文件修改…');
        const messages = [
          { role: 'system' as const, content: '你是多文件代码修改助手。返回严格 JSON：{"files":[{"path":"目标相对路径","oldPath":"重命名前相对路径（仅重命名时）","content":"修改后的完整文件内容"}]}。新建文件：提供 path 和 content。删除文件：content 设为空字符串。重命名：同时提供 oldPath、path 和重命名后的完整 content。只返回需要变更的文件，不得返回 Markdown。' },
          { role: 'user' as const, content: `修改要求：${instruction}` },
        ];

        for await (const chunk of provider.chat(messages, {
          model: record.modelConfig.model,
          temperature: 0.15,
          maxTokens: Math.min(24_000, Math.max(2_000, Math.floor(record.tokenBudget / 2))),
          signal,
        })) {
          response += chunk.delta;
        }
      } else {
        this.emitProgress(record.taskId, 'generating', 'AI 正在生成单文件修改…');
        const messages = [
          { role: 'system' as const, content: '你是代码编辑器中的修改助手。根据要求修改文件。只返回修改后的完整文件内容，不要解释，不要输出 diff。' },
          { role: 'user' as const, content: `修改要求：${instruction}` },
        ];

        for await (const chunk of provider.chat(messages, {
          model: record.modelConfig.model,
          temperature: 0.2,
          maxTokens: Math.min(16_000, Math.max(2_000, Math.floor(record.tokenBudget / 2))),
          signal,
        })) {
          response += chunk.delta;
        }
      }

      signal.throwIfAborted();

      // Parse response
      this.emitProgress(record.taskId, 'parsing', '正在解析 AI 响应…');
      const proposals = this.parseResponse(response, record.multiFile);

      record.result = { proposals, rawResponse: response };
      record.state = 'review';
      record.endedAt = Date.now();
      this.emitEvent(record.taskId, 'review');
    } catch (error) {
      if (controller.signal.aborted) {
        record.state = 'interrupted';
        record.endedAt = Date.now();
        record.error = 'Task cancelled';
        this.emitEvent(record.taskId, 'interrupted');
      } else {
        record.state = 'failed';
        record.endedAt = Date.now();
        record.error = error instanceof Error ? error.message : String(error);
        this.emitEvent(record.taskId, 'failed');
      }
    } finally {
      this.controllers.delete(record.taskId);
      this.releaseWorktreeLock(record.taskId);
      this.drainQueue();
    }
  }

  private parseResponse(response: string, multiFile: boolean): AgentTaskRecord['result']['proposals'] {
    if (!multiFile) {
      const fenced = response.match(/```(?:[\w+-]+)?\s*\n([\s\S]*?)```/);
      const modified = (fenced?.[1] ?? response).trimEnd();
      return modified ? [{ path: '', original: '', modified, language: '' }] : [];
    }

    const json = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(json) as { files?: Array<{ path: string; oldPath?: string; content: string }> };
      return (parsed.files ?? []).map((f) => ({
        path: f.path,
        original: '',
        modified: f.content,
        language: '',
        previousPath: f.oldPath,
      }));
    } catch {
      return [];
    }
  }

  // ── Internal: events ──

  private emitEvent(taskId: string, state: AgentTaskState): void {
    const record = this.tasks.get(taskId);
    const event: AgentTaskEvent = {
      taskId,
      sessionId: record?.sessionId ?? '',
      state,
      progress: record?.progress,
      error: record?.error,
    };
    this.emit('event', event);
  }

  private emitProgress(taskId: string, stage: string, message: string): void {
    const record = this.tasks.get(taskId);
    if (!record) return;
    const progress: AgentTaskProgress = {
      taskId,
      seq: nextSeq(),
      stage,
      message,
      timestamp: Date.now(),
    };
    record.progress = progress;
    this.emit('event', {
      taskId,
      sessionId: record.sessionId,
      state: record.state,
      progress,
    });
  }
}

export const agentTaskService = new AgentTaskService();
