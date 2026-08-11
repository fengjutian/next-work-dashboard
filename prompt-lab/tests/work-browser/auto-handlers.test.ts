/**
 * auto-handlers — Task Runner 自动编排
 */
import { describe, it, expect } from 'vitest';
import { buildAutoHandlers, type TaskAutoContext } from '@/core/work-browser/task/auto-handlers';
import type { TaskStep, Task } from '@/core/work-browser/types';

function mkStep(description: string, evidence = ''): TaskStep {
  return {
    id: `step-${description}` as any,
    title: description,
    description,
    status: 'pending',
    evidence,
    result: null,
  };
}

function mkTask(title: string, descriptions: string[]): Task {
  return {
    id: 't1' as any,
    workspaceId: 'ws1' as any,
    title,
    description: '测试',
    status: 'todo',
    relatedDocumentIds: [],
    relatedTabIds: [],
    relatedNoteIds: [],
    steps: descriptions.map((d) => mkStep(d)),
    aiGenerated: true,
    createdAt: 0,
    updatedAt: 0,
    resolvedAt: null,
  };
}

function mkCtx(): TaskAutoContext & { calls: { search: number; rag: number } } {
  const ctx = {
    workspaceId: 'ws1' as any,
    search: { run: async (input) => { (ctx as any).calls.search++; return { results: [{ title: 'T', url: 'u', snippet: 'S', source: 'google' }], summary: 'AI 摘要' }; } },
    rag: { run: async (input) => { (ctx as any).calls.rag++; return { systemPrompt: 'sys', citations: [{ documentId: 'd1', url: 'u', title: 'T', excerpt: 'E' }], chunks: [] }; } },
    calls: { search: 0, rag: 0 },
  } as any;
  return ctx;
}

describe('auto-handlers', () => {
  it('包含 INVESTIGATION 全部 5 个 step 的 handler', () => {
    const handlers = buildAutoHandlers();
    expect(handlers['记录错误码、日志、复现条件']).toBeDefined();
    expect(handlers['多引擎搜索错误码 / 关键词']).toBeDefined();
    expect(handlers['按可能性从高到低排列根因']).toBeDefined();
    expect(handlers['从 Workspace 文档、笔记、命令输出取证']).toBeDefined();
    expect(handlers['最小变更验证步骤 + 回滚预案']).toBeDefined();
  });

  it('包含 RESEARCH 全部 5 个 step 的 handler', () => {
    const handlers = buildAutoHandlers();
    expect(handlers['构造查询']).toBeDefined();
    expect(handlers['多引擎搜索']).toBeDefined();
    expect(handlers['正文提取']).toBeDefined();
    expect(handlers['AI 聚合分析']).toBeDefined();
    expect(handlers['输出报告']).toBeDefined();
  });

  it('"多引擎搜索错误码" handler 调 search.run', async () => {
    const handlers = buildAutoHandlers();
    const ctx = mkCtx();
    const step = mkStep('多引擎搜索错误码 / 关键词', '404 not found');
    const task = mkTask('PostHog 排障', ['多引擎搜索错误码 / 关键词']);
    const out = await handlers['多引擎搜索错误码 / 关键词'](step, task, ctx);
    expect(ctx.calls.search).toBe(1);
    expect(out).toContain('多引擎搜索结果');
    expect(out).toContain('T');
    expect(out).toContain('AI 摘要');
  });

  it('"按可能性从高到低排列根因" handler 调 rag.run', async () => {
    const handlers = buildAutoHandlers();
    const ctx = mkCtx();
    const step = mkStep('按可能性从高到低排列根因', 'oom');
    const task = mkTask('ClickHouse 排障', ['按可能性从高到低排列根因']);
    const out = await handlers['按可能性从高到低排列根因'](step, task, ctx);
    expect(ctx.calls.rag).toBe(1);
    expect(out).toContain('假设列表');
    expect(out).toContain('T'); // citation title
  });

  it('"输出报告" 无 LLM 时回退到草稿', async () => {
    const handlers = buildAutoHandlers();
    const ctx = { ...mkCtx(), summarize: undefined };
    const step = mkStep('输出报告', '前序 step 的 evidence');
    const task = mkTask('研究', ['输出报告']);
    const out = await handlers['输出报告'](step, task, ctx);
    expect(out).toContain('研究报告草稿');
    expect(out).toContain('前序 step 的 evidence');
  });

  it('"记录症状" handler 返回人工提示', async () => {
    const handlers = buildAutoHandlers();
    const ctx = mkCtx();
    const step = mkStep('记录错误码、日志、复现条件');
    const task = mkTask('PostHog 排障', ['记录错误码、日志、复现条件']);
    const out = await handlers['记录错误码、日志、复现条件'](step, task, ctx);
    expect(out).toContain('需人工');
    expect(ctx.calls.search).toBe(0);
    expect(ctx.calls.rag).toBe(0);
  });
});
