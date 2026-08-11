/**
 * Task 自动 handler — 把模板 step 映射到 work-browser 内部 API
 *
 * 设计：
 *  - 每个 handler 接受 step + task + 上下文 → 调 search / rag / document → 返回 result 字符串
 *  - 不依赖 LLM 决策（决策在代码里固定）
 *  - 通过 `TaskAutoContext` 注入外部 API（main 端装配）
 *
 * 用法（main 端）：
 *   const ctx = { search, rag, listDocuments, summarize };
 *   const handle = runTask(task, { handlers: buildAutoHandlers(ctx) });
 */

import type { Task, TaskStep, WorkspaceId } from '../types';

export interface TaskAutoSearch {
  run(input: { query: string; workspaceId?: string; scope?: 'web' | 'workspace' | 'library'; topK?: number }): Promise<{
    results: Array<{ title: string; url: string; snippet: string; source: string }>;
    summary: string | null;
  }>;
}

export interface TaskAutoRag {
  run(input: { query: string; workspaceId?: string; topK?: number; scope?: 'workspace' | 'library' }): Promise<{
    systemPrompt: string;
    citations: Array<{ documentId: string; url: string; title: string; excerpt: string }>;
    chunks: Array<{ documentId: string; content: string; sectionTitle: string | null; page: number; fusedScore: number }>;
  }>;
}

export interface TaskAutoContext {
  workspaceId: WorkspaceId | null;
  search: TaskAutoSearch;
  rag: TaskAutoRag;
  /** 可选：LLM 总结（OpenAI-compatible） */
  summarize?: (input: { systemPrompt: string; userPrompt: string }) => Promise<string | null>;
}

export type TaskStepHandler = (step: TaskStep, task: Task, ctx: TaskAutoContext) => Promise<string>;

/**
 * 截断文本到前 N 字符并加省略号
 */
function truncate(s: string, n = 800): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * 格式化搜索结果为 markdown 列表
 */
function formatSearchResults(results: Array<{ title: string; url: string; snippet: string; source: string }>): string {
  if (!results.length) return '_（未命中相关结果）_';
  return results.slice(0, 5).map((r, i) =>
    `${i + 1}. **${truncate(r.title, 120)}**\n   - ${r.source} · ${r.url}\n   - ${truncate(r.snippet, 200)}`
  ).join('\n\n');
}

/**
 * 格式化 RAG 引用为 markdown 列表
 */
function formatRagCitations(citations: Array<{ title: string; url: string; excerpt: string }>): string {
  if (!citations.length) return '_（本地知识库无相关引用）_';
  return citations.slice(0, 5).map((c, i) =>
    `${i + 1}. **${truncate(c.title, 120)}**\n   - ${c.url}\n   - ${truncate(c.excerpt, 200)}`
  ).join('\n\n');
}

/**
 * INVESTIGATION 模板的自动 handlers
 *  step.description（按声明顺序）:
 *  - 记录错误码、日志、复现条件
 *  - 多引擎搜索错误码 / 关键词
 *  - 按可能性从高到低排列根因
 *  - 从 Workspace 文档、笔记、命令输出取证
 *  - 最小变更验证步骤 + 回滚预案
 */
const INVESTIGATION_HANDLERS: Record<string, TaskStepHandler> = {
  '记录错误码、日志、复现条件': async (_step, task) => {
    // 这一步必须人工填，不自动
    return '⚠️ 需人工：\n- 错误码 / 异常堆栈\n- 触发条件与复现步骤\n- 最近一次正常运行的 commit / 部署时间\n\n填入后再运行后续 step。';
  },

  '多引擎搜索错误码 / 关键词': async (step, task, ctx) => {
    const query = step.evidence || task.title;
    if (!query.trim()) return '_无搜索关键词_';
    const out = await ctx.search.run({ query, workspaceId: ctx.workspaceId || undefined, scope: 'web', topK: 10 });
    const md = `# 多引擎搜索结果\n\n${formatSearchResults(out.results)}`;
    return md + (out.summary ? `\n\n## AI 摘要\n\n${out.summary}` : '');
  },

  '按可能性从高到低排列根因': async (step, task, ctx) => {
    const query = step.evidence || `列出"${task.title}"的可能根因，按可能性从高到低排序`;
    const out = await ctx.rag.run({ query, workspaceId: ctx.workspaceId || undefined, topK: 6 });
    return `# 假设列表\n\n${formatRagCitations(out.citations)}\n\n（基于本地知识库 + 工作区 RAG 召回）`;
  },

  '从 Workspace 文档、笔记、命令输出取证': async (step, task, ctx) => {
    const query = step.evidence || `收集"${task.title}"的证据：相关文档、配置、命令输出`;
    const out = await ctx.rag.run({ query, workspaceId: ctx.workspaceId || undefined, topK: 8 });
    return `# 证据集合\n\n${formatRagCitations(out.citations)}`;
  },

  '最小变更验证步骤 + 回滚预案': async (step, _task, ctx) => {
    // 基于前面所有 step 的 result，输出结构化模板
    const collected = step.evidence || '（基于前序 step 收集的证据综合）';
    if (ctx.summarize) {
      const sys = `你是一个排障顾问。基于用户提供的证据 + 假设列表，输出"最小变更验证步骤 + 回滚预案"。\n格式：\n## 最小变更\n- 步骤 1：...\n## 验证\n- 验证项 1：...\n## 回滚预案\n- 步骤 1：...\n- 影响面：...`;
      const text = await ctx.summarize({ systemPrompt: sys, userPrompt: collected });
      if (text) return text;
    }
    return `# 方案草稿\n\n${truncate(collected, 1200)}\n\n（无 AI 总结时由人工填写。配置 workBrowser.ai.baseUrl / apiKey 启用 AI 总结。）`;
  },
};

/**
 * RESEARCH 模板的自动 handlers
 */
const RESEARCH_HANDLERS: Record<string, TaskStepHandler> = {
  '构造查询': async (step, task) => {
    return `# 研究主题\n\n**${task.title}**\n\n${task.description}\n\n## 子查询维度\n1. 核心定义与背景\n2. 主流实现 / 方案对比\n3. 已知问题与最佳实践\n4. 性能 / 成本 / 风险\n5. 实战案例 / 工具`;
  },

  '多引擎搜索': async (step, task, ctx) => {
    const query = step.evidence || task.title;
    const out = await ctx.search.run({ query, workspaceId: ctx.workspaceId || undefined, scope: 'web', topK: 12 });
    return `# 来源汇总\n\n${formatSearchResults(out.results)}`;
  },

  '正文提取': async (_step, _task, _ctx) => {
    return '_（由后续 step "AI 聚合分析" 统一处理；本步无需手动操作）_';
  },

  'AI 聚合分析': async (step, task, ctx) => {
    const query = step.evidence || task.title;
    const out = await ctx.rag.run({ query, workspaceId: ctx.workspaceId || undefined, topK: 10 });
    return `# 核心结论 / 争议 / 推荐\n\n${formatRagCitations(out.citations)}\n\n${out.systemPrompt.slice(0, 600)}…`;
  },

  '输出报告': async (step, _task, ctx) => {
    if (ctx.summarize) {
      const sys = `你是研究报告撰写助手。基于所有前序 step 收集的来源 + 本地知识库引用，生成结构化研究报告。\n格式：\n# Executive Summary\n# Background\n# Key Findings\n# Evidence\n# Different Opinions\n# Technical Details\n# Recommendations\n# References`;
      const text = await ctx.summarize({ systemPrompt: sys, userPrompt: step.evidence || _task.description });
      if (text) return text;
    }
    return `# 研究报告草稿\n\n（启用 AI 总结 workBrowser.ai.* 后自动生成）\n\n## 已知引用\n${step.evidence || '_（无）_'}`;
  },
};

const ALL_AUTO_HANDLERS: Record<string, TaskStepHandler> = {
  ...INVESTIGATION_HANDLERS,
  ...RESEARCH_HANDLERS,
};

/**
 * 构造一个 handler map：包含全部 auto-handler，渲染端可传额外覆盖
 */
export function buildAutoHandlers(): Record<string, TaskStepHandler> {
  return { ...ALL_AUTO_HANDLERS };
}
