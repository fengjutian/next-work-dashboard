/**
 * Research Mode — 一站式研究流程
 *
 * 流程：
 *  1. seed-query 拆解：从用户题目生成 3-5 个子查询
 *  2. multi-engine search 并行执行子查询
 *  3. extract：取 top 结果做 Readability 净化
 *  4. AI 聚合分析：拼成结构化报告
 *  5. save 报告到当前 Workspace 的 documents（自动用 savePageAsMarkdown 同款）
 *
 * 复用 Task Runner auto-handler 作为编排器
 */
import type { WorkspaceId } from '../types';
import type { Task, TaskStep } from '../types';
import { runTask, type TaskStepHandler } from '../task/runner';
import { buildAutoHandlers, type TaskAutoContext } from '../task/auto-handlers';

export interface ResearchRequest {
  topic: string;
  workspaceId: WorkspaceId;
  autoSave: boolean; // 完成后自动存为 document
}

export interface ResearchProgress {
  stage: 'seed-query' | 'multi-search' | 'extract' | 'analyze' | 'save' | 'done' | 'error';
  message: string;
  task?: Task;
  reportPath?: string;
}

export interface ResearchResult {
  task: Task;
  report: string;       // 最终 Markdown 报告
  citations: Array<{ title: string; url: string; excerpt: string }>;
  reportPath?: string;  // 若 autoSave 则有
  took: number;
}

/**
 * 顶层 orchestrator：先做 seed query 拆解 → 注入 evidence 给 task 的第一步 → runTask auto → 报告聚合
 *
 * 简化：本轮用 "用户题目 = 子查询关键词" 替代 AI seed-query 拆解（Phase 3.5 加 AI 拆解）
 */
export async function runResearch(input: ResearchRequest, ctx: TaskAutoContext, options: ResearchOptions = {}): Promise<ResearchResult> {
  const t0 = Date.now();
  options.onProgress?.({ stage: 'seed-query', message: '正在构造子查询…' });

  // Phase 3.5 用 LLM 拆解子查询；本轮用启发式
  const subQueries = heuristicSubQueries(input.topic);

  options.onProgress?.({ stage: 'multi-search', message: `多引擎搜索 ${subQueries.length} 个子查询…` });

  // 给 task 第一步（构造查询）注入 evidence
  // 然后通过 buildAutoHandlers 的 RESEARCH_TEMPLATE handler 跑整个 task
  const initialTask: Task = createResearchTaskFromTopic(input.workspaceId, input.topic, subQueries);

  // 在 runTask 前先把 subQueries 放进 step 0 的 evidence
  initialTask.steps[0].evidence = subQueries.map((q, i) => `${i + 1}. ${q}`).join('\n');

  options.onProgress?.({ stage: 'analyze', message: 'AI 聚合分析中…' });

  const handle = runTask(initialTask, {
    handlers: buildAutoHandlers() as unknown as Record<string, TaskStepHandler>,
    onEvent: (e) => {
      if (e.kind === 'step-done' || e.kind === 'task-done' || e.kind === 'task-failed') {
        options.onProgress?.({ stage: 'analyze', message: `Step ${handle.getCurrent().steps.filter((s) => s.status === 'done').length}/${handle.getCurrent().steps.length} 完成`, task: handle.getCurrent() });
      }
    },
  });

  const final = await handle.promise;

  options.onProgress?.({ stage: 'done', message: '研究完成', task: final });

  // 提取最后一步（输出报告）的 result 作为报告
  const report = final.steps[final.steps.length - 1]?.result || '_（报告生成失败）_';
  const citations = ctx.rag ? extractCitationsFromSteps(final.steps) : [];

  let reportPath: string | undefined;
  if (input.autoSave) {
    options.onProgress?.({ stage: 'save', message: '保存报告到 Workspace…' });
    // 用 save 的模式简化：直接在 documents 写入
    // （完整 SavePageAsMarkdown 走主流程，调用方注入更干净）
    reportPath = await options.saveDocument?.({
      workspaceId: input.workspaceId,
      title: `Research · ${input.topic}`,
      url: `research://local/${encodeURIComponent(input.topic)}`,
      markdown: report,
    });
  }

  return {
    task: final,
    report,
    citations,
    reportPath,
    took: Date.now() - t0,
  };
}

function heuristicSubQueries(topic: string): string[] {
  // 简单：1 主查询 + 4 个角度
  return [
    `${topic}`,
    `${topic} 原理`,
    `${topic} 最佳实践`,
    `${topic} 性能 / 限制`,
    `${topic} 实战案例`,
  ];
}

function createResearchTaskFromTopic(workspaceId: WorkspaceId, topic: string, subQueries: string[]): Task {
  // 直接 import RESEARCH_TEMPLATE + instantiateTask
  // 动态 import 避免循环依赖
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { instantiateTask, RESEARCH_TEMPLATE } = require('../task/template') as typeof import('../task/template');
  void subQueries; // 已经在 evidence 里
  return instantiateTask(workspaceId, RESEARCH_TEMPLATE, `Research · ${topic}`);
}

function extractCitationsFromSteps(steps: TaskStep[]): Array<{ title: string; url: string; excerpt: string }> {
  // 从 step result 中找 markdown 链接
  const cites: Array<{ title: string; url: string; excerpt: string }> = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  for (const s of steps) {
    if (!s.result) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.result)) !== null) {
      cites.push({ title: m[1], url: m[2], excerpt: '' });
    }
  }
  return cites;
}

export interface ResearchOptions {
  onProgress?: (p: ResearchProgress) => void;
  saveDocument?: (params: { workspaceId: WorkspaceId; title: string; url: string; markdown: string }) => Promise<string | undefined>;
}

export type { TaskAutoContext, TaskStepHandler };
