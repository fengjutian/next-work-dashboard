// Agent Task Service - Main-process AI task execution
import { EventEmitter } from 'node:events';
import { createOpenAIProvider } from '../core/llm';
import type {
  AgentTaskConfig,
  AgentTaskEvent,
  AgentTaskProgress,
  AgentTaskRecord,
  AgentTaskState,
} from './agent-task-types';

export type { AgentTaskConfig, AgentTaskEvent, AgentTaskProgress, AgentTaskRecord, AgentTaskState };

let seqCounter = 0;
function nextSeq(): number { seqCounter += 1; return seqCounter; }
function taskId(): string { return "agent-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

export class AgentTaskService extends EventEmitter {
  private tasks = new Map<string, AgentTaskRecord>();
  private controllers = new Map<string, AbortController>();
  private queue: string[] = [];
  private maxConcurrent = 2;
  private worktreeLocks = new Map<string, string>();

  constructor(maxConcurrent = 2) { super(); this.maxConcurrent = maxConcurrent; }

  create(config: AgentTaskConfig): AgentTaskRecord {
    if (!config.sessionId || !config.workspaceRoot || !config.instruction.trim()) throw new Error('INVALID_TASK_CONFIG');
    const record: AgentTaskRecord = {
      taskId: taskId(), sessionId: config.sessionId, workspaceRoot: config.workspaceRoot,
      executionRoot: config.executionRoot, instruction: config.instruction.trim(),
      modelConfig: { ...config.modelConfig }, multiFile: config.multiFile,
      tokenBudget: config.tokenBudget, state: 'queued', createdAt: Date.now(),
      recovery: config.recovery,
    };
    this.tasks.set(record.taskId, record);
    this.emitEvent(record.taskId, 'queued');
    this.queue.push(record.taskId);
    this.drainQueue();
    return record;
  }

  get(taskId: string): AgentTaskRecord | undefined { return this.tasks.get(taskId); }

  list(sessionId?: string): AgentTaskRecord[] {
    const records = [...this.tasks.values()];
    return sessionId ? records.filter((r) => r.sessionId === sessionId) : records;
  }

  cancel(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (record.state === 'completed' || record.state === 'failed' || record.state === 'interrupted') return false;
    record.state = 'cancelling';
    this.emitEvent(taskId, 'cancelling');
    const controller = this.controllers.get(taskId);
    if (controller) { controller.abort(); }
    else {
      this.queue = this.queue.filter((id) => id !== taskId);
      this.releaseWorktreeLock(taskId);
      record.state = 'interrupted'; record.endedAt = Date.now();
      this.emitEvent(taskId, 'interrupted');
      this.drainQueue();
    }
    return true;
  }

  retry(taskId: string): AgentTaskRecord | null {
    const record = this.tasks.get(taskId);
    if (!record) return null;
    if (record.state !== 'failed' && record.state !== 'interrupted') return null;
    record.state = 'queued'; record.error = undefined; record.progress = undefined;
    record.startedAt = undefined; record.endedAt = undefined;
    this.emitEvent(taskId, 'queued');
    this.queue.push(taskId);
    this.drainQueue();
    return record;
  }

  subscribe(taskId: string, handler: (event: AgentTaskEvent) => void): () => void {
    const listener = (event: AgentTaskEvent) => { if (event.taskId === taskId) handler(event); };
    this.on('event', listener);
    const record = this.tasks.get(taskId);
    if (record) handler({ taskId: record.taskId, sessionId: record.sessionId, state: record.state, progress: record.progress, error: record.error });
    return () => { this.off('event', listener); };
  }

  // Restore tasks from persisted state (call on app startup)
  restore(tasks: AgentTaskRecord[]): number {
    let count = 0;
    for (const t of tasks) {
      if (this.tasks.has(t.taskId)) continue;
      if (t.state === "running" || t.state === "cancelling") {
        t.state = "interrupted";
        t.endedAt = Date.now();
        t.error = "Recovered after restart";
      }
      this.tasks.set(t.taskId, t);
      if (t.state === "queued") {
        this.queue.push(t.taskId);
        this.emitEvent(t.taskId, "queued");
        count++;
      }
    }
    if (count > 0) this.drainQueue();
    return count;
  }

  // Get all tasks for persistence
  snapshot(): AgentTaskRecord[] {
    return [...this.tasks.values()];
  }

    shutdown(): AgentTaskRecord[] {
    const interrupted: AgentTaskRecord[] = [];
    for (const c of this.controllers.values()) c.abort();
    this.controllers.clear();
    for (const record of this.tasks.values()) {
      if (record.state === 'running' || record.state === 'cancelling') {
        record.state = 'interrupted'; record.endedAt = Date.now();
        this.emitEvent(record.taskId, 'interrupted');
        interrupted.push(record);
      }
    }
    this.queue = []; this.worktreeLocks.clear();
    return interrupted;
  }

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

  private acquireWorktreeLock(taskId: string, executionRoot?: string): boolean {
    if (!executionRoot) return true;
    const existing = this.worktreeLocks.get(executionRoot);
    if (existing && existing !== taskId && this.tasks.get(existing)?.state === 'running') return false;
    this.worktreeLocks.set(executionRoot, taskId);
    return true;
  }

  private releaseWorktreeLock(taskId: string): void {
    for (const [root, owner] of this.worktreeLocks) { if (owner === taskId) this.worktreeLocks.delete(root); }
  }

  private async execute(record: AgentTaskRecord): Promise<void> {
    if (!this.acquireWorktreeLock(record.taskId, record.executionRoot)) {
      record.state = 'queued'; this.queue.push(record.taskId); return;
    }
    const controller = new AbortController();
    this.controllers.set(record.taskId, controller);
    try {
      record.state = 'running'; record.startedAt = Date.now();
      this.emitEvent(record.taskId, 'running');
      const provider = createOpenAIProvider(record.modelConfig);
      const signal = controller.signal;
      let response = '';
      if (record.messages && record.messages.length > 0) {
        this.emitProgress(record.taskId, 'generating', 'AI generating response...');
        const msgs = record.messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content }));
        for await (const chunk of provider.chat(msgs, { model: record.modelConfig.model, temperature: 0.15, maxTokens: Math.min(24000, Math.max(2000, Math.floor(record.tokenBudget / 2))), signal })) response += chunk.delta;
      } else if (record.multiFile) {
        this.emitProgress(record.taskId, 'generating', 'AI generating multi-file edits...');
        const msgs = [
          { role: 'system' as const, content: 'You are a multi-file code editor. Return strict JSON. Only changed files. No markdown.' },
          { role: 'user' as const, content: 'Instruction: ' + record.instruction },
        ];
        for await (const chunk of provider.chat(msgs, { model: record.modelConfig.model, temperature: 0.15, maxTokens: Math.min(24000, Math.max(2000, Math.floor(record.tokenBudget / 2))), signal })) response += chunk.delta;
      } else {
        this.emitProgress(record.taskId, 'generating', 'AI generating single-file edit...');
        const msgs = [
          { role: 'system' as const, content: 'You are a code editor. Return only the modified file. No explanations.' },
          { role: 'user' as const, content: 'Instruction: ' + record.instruction },
        ];
        for await (const chunk of provider.chat(msgs, { model: record.modelConfig.model, temperature: 0.2, maxTokens: Math.min(16000, Math.max(2000, Math.floor(record.tokenBudget / 2))), signal })) response += chunk.delta;
      }
      signal.throwIfAborted();
      this.emitProgress(record.taskId, 'parsing', 'Parsing AI response...');
      record.result = { proposals: this.parseResponse(response, record.multiFile), rawResponse: response };
      record.state = 'review'; record.endedAt = Date.now();
      this.emitEvent(record.taskId, 'review');
    } catch (error) {
      if (controller.signal.aborted) {
        record.state = 'interrupted'; record.endedAt = Date.now(); record.error = 'Task cancelled';
        this.emitEvent(record.taskId, 'interrupted');
      } else {
        record.state = 'failed'; record.endedAt = Date.now();
        record.error = error instanceof Error ? error.message : String(error);
        this.emitEvent(record.taskId, 'failed');
      }
    } finally {
      this.controllers.delete(record.taskId);
      this.releaseWorktreeLock(record.taskId);
      this.drainQueue();
    }
  }

  private parseResponse(response: string, multiFile: boolean): AgentTaskRecord["result"]["proposals"] {
    if (!multiFile) {
      const m = response.match(/`{3}(?:[\w+-]+)?\s*\n([\s\S]*?)`{3}/);
      const modified = (m ? m[1] : response).trimEnd();
      return modified ? [{ path: "", original: "", modified, language: "" }] : [];
    }
    const json = response.replace(/^`{3}(?:json)?\s*/i, "").replace(/`{3}\s*$/, "").trim();
    try {
      const parsed = JSON.parse(json) as { files?: Array<{ path: string; oldPath?: string; content: string }> };
      return (parsed.files ?? []).map((f) => ({ path: f.path, original: "", modified: f.content, language: "", previousPath: f.oldPath }));
    } catch { return []; }
  }

  private emitEvent(taskId: string, state: AgentTaskState): void {
    const record = this.tasks.get(taskId);
    const event: AgentTaskEvent = { taskId, sessionId: record?.sessionId ?? '', state, progress: record?.progress, error: record?.error };
    this.emit('event', event);
  }

  private emitProgress(taskId: string, stage: string, message: string): void {
    const record = this.tasks.get(taskId);
    if (!record) return;
    record.progress = { taskId, seq: nextSeq(), stage, message, timestamp: Date.now() };
    this.emit('event', { taskId, sessionId: record.sessionId, state: record.state, progress: record.progress });
  }
}

export const agentTaskService = new AgentTaskService();
