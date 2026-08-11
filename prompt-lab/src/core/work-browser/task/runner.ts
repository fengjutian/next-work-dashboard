/**
 * Task Runner — 多步任务编排
 *
 * 类似 lyric-studio.generate 模式：steps 数组按 sequential/parallel 推进，
 * 监听 in-progress / done / failed 事件。
 * Phase 1 简化为 in-memory 执行；持久化由调用方负责（保存回 Task）。
 */
import type { Task, TaskStep, TaskId, TaskStepId } from '../types';
import { nextStepIndex } from './template';

export type TaskRunEvent =
  | { kind: 'step-start'; taskId: TaskId; step: TaskStep }
  | { kind: 'step-progress'; taskId: TaskId; step: TaskStep; progress: number }
  | { kind: 'step-done'; taskId: TaskId; step: TaskStep; result: string }
  | { kind: 'step-failed'; taskId: TaskId; step: TaskStep; error: string }
  | { kind: 'task-done'; taskId: TaskId; task: Task }
  | { kind: 'task-failed'; taskId: TaskId; task: Task; error: string };

export interface TaskRunHandle {
  cancel(): void;
  promise: Promise<Task>;
  /** 当前最新 task 状态（每次 step 事件后更新） */
  getCurrent(): Task;
}

export type TaskStepHandler = (step: TaskStep, task: Task, emit: (e: TaskRunEvent) => void) => Promise<string>;

export interface RunTaskOptions {
  /** 步骤执行器；key 为 step.description 模板里声明的 id（如果用模板）。Phase 1 用 description 匹配。 */
  handlers: Record<string, TaskStepHandler>;
  /** 整体信号。 */
  signal?: AbortSignal;
  /** 事件回调。 */
  onEvent?: (e: TaskRunEvent) => void;
}

export function runTask(task: Task, options: RunTaskOptions): TaskRunHandle {
  let cancelled = false;
  const ac = new AbortController();
  if (options.signal) options.signal.addEventListener('abort', () => { cancelled = true; ac.abort(); });

  const emit = (e: TaskRunEvent) => { options.onEvent?.(e); };

  const promise = (async (): Promise<Task> => {
    const updated: Task = { ...task, status: 'investigating', updatedAt: Date.now() };
    syncCurrent(updated);
    emit({ kind: 'step-start', taskId: updated.id, step: updated.steps[0] });

    for (let i = 0; i < updated.steps.length; i++) {
      if (cancelled || ac.signal.aborted) {
        updated.status = 'blocked';
        syncCurrent(updated);
        emit({ kind: 'task-failed', taskId: updated.id, task: updated, error: 'cancelled' });
        return updated;
      }
      const step = updated.steps[i];
      const handler = options.handlers[step.description] || options.handlers[step.title];
      if (!handler) {
        step.status = 'skipped';
        step.result = '(no handler)';
        continue;
      }
      step.status = 'in-progress';
      emit({ kind: 'step-start', taskId: updated.id, step });
      try {
        const result = await handler(step, updated, emit);
        step.status = 'done';
        step.result = result;
        syncCurrent(updated);
        emit({ kind: 'step-done', taskId: updated.id, step, result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        step.status = 'failed';
        step.result = msg;
        updated.status = 'blocked';
        syncCurrent(updated);
        emit({ kind: 'step-failed', taskId: updated.id, step, error: msg });
        emit({ kind: 'task-failed', taskId: updated.id, task: updated, error: msg });
        return updated;
      }
    }

    updated.status = 'resolved';
    updated.resolvedAt = Date.now();
    updated.updatedAt = updated.resolvedAt;
    syncCurrent(updated);
    emit({ kind: 'task-done', taskId: updated.id, task: updated });
    return updated;
  })();

  // 内部引用：让外部能实时拿 task 状态
  let currentRef: Task = task;
  function syncCurrent(t: Task) { currentRef = t; }

  return {
    cancel() { cancelled = true; ac.abort(); },
    promise,
    getCurrent: () => currentRef,
  };
}

export function applyStepUpdate(task: Task, stepId: TaskStepId, patch: Partial<TaskStep>): Task {
  return {
    ...task,
    steps: task.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    updatedAt: Date.now(),
  };
}

export { nextStepIndex };
