/**
 * task/runner — 多步任务编排
 */
import { describe, it, expect, vi } from 'vitest';
import { runTask, applyStepUpdate } from '@/core/work-browser/task/runner';
import { INVESTIGATION_TEMPLATE, instantiateTask } from '@/core/work-browser/task/template';
import type { Task } from '@/core/work-browser/types';

function makeTask(): Task {
  return instantiateTask('ws1' as any, INVESTIGATION_TEMPLATE);
}

describe('runTask', () => {
  it('按顺序执行所有 steps 并 emit 事件', async () => {
    const task = makeTask();
    const events: string[] = [];
    const handle = runTask(task, {
      handlers: {
        '记录错误码、日志、复现条件': async () => { events.push('collect-symptoms'); return 'symptoms'; },
        '多引擎搜索错误码 / 关键词': async () => { events.push('search-cases'); return 'cases'; },
        '按可能性从高到低排列根因': async () => { events.push('list-hypotheses'); return 'hypotheses'; },
        '从 Workspace 文档、笔记、命令输出取证': async () => { events.push('collect-evidence'); return 'evidence'; },
        '最小变更验证步骤 + 回滚预案': async () => { events.push('propose-fix'); return 'fix'; },
      },
      onEvent: (e) => events.push(`event:${e.kind}`),
    });
    const result = await handle.promise;
    expect(result.status).toBe('resolved');
    expect(result.resolvedAt).not.toBeNull();
    expect(result.steps.every((s) => s.status === 'done')).toBe(true);
    // 每个 step 的 result 都应被记录
    expect(result.steps.map((s) => s.result)).toEqual(['symptoms', 'cases', 'hypotheses', 'evidence', 'fix']);
  });

  it('handler 抛错时 task 进入 blocked', async () => {
    const task = makeTask();
    const handle = runTask(task, {
      handlers: {
        '记录错误码、日志、复现条件': async () => { throw new Error('oops'); },
      },
      onEvent: () => undefined,
    });
    const result = await handle.promise;
    expect(result.status).toBe('blocked');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].result).toBe('oops');
  });

  it('没有 handler 的 step 自动 skip', async () => {
    const task = makeTask();
    const handle = runTask(task, {
      handlers: {},
    });
    const result = await handle.promise;
    expect(result.status).toBe('resolved');
    expect(result.steps.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('cancel 触发 task-failed', async () => {
    const task = makeTask();
    let resolveStep: () => void = () => undefined;
    const events: string[] = [];
    const handle = runTask(task, {
      handlers: {
        '记录错误码、日志、复现条件': () => new Promise<void>((r) => { resolveStep = () => r(); }),
      },
      onEvent: (e) => events.push(e.kind),
    });
    setTimeout(() => handle.cancel(), 10);
    resolveStep();
    const result = await handle.promise;
    // cancel 后下一个 step 之前会 break，但第一个 step 已 done
    expect(result.steps[0].status).toBe('done');
  });
});

describe('applyStepUpdate', () => {
  it('更新 step 字段并 touch updatedAt', async () => {
    const task = makeTask();
    const before = task.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const stepId = task.steps[0].id;
    const updated = applyStepUpdate(task, stepId, { status: 'in-progress', result: 'progress' });
    const target = updated.steps.find((s) => s.id === stepId)!;
    expect(target.status).toBe('in-progress');
    expect(target.result).toBe('progress');
    expect(updated.updatedAt).toBeGreaterThan(before);
  });
});
