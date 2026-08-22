/**
 * AI Agent — 单轮 tool-calling 框架
 *
 * 设计：
 *  - 工具通过 `defineTool()` 注册，每个工具有 JSON schema 参数 + 危险标记 + 限流配置
 *  - Agent 接收 user message + 已注册 tools 列表，发给 LLM（OpenAI-compatible chat/completions 的 tool_choice=auto）
 *  - LLM 选 0..N 个 tool_call → 校验 → 危险动作 require confirm → 限流 → 执行 → 把 tool 响应拼回 messages → 再次调 LLM
 *  - 最多 maxSteps 步循环
 *
 * 简化：单步多 tool call 支持（OpenAI 协议并行 tool_calls），但**不实现完整 ReAct 反思**（留 Phase 3.5）。
 */

import type { WorkspaceId } from '../types';

export interface ToolContext {
  workspaceId: WorkspaceId | null;
  search: { run: (input: any) => Promise<{ results: any[]; summary: string | null }> };
  rag: { run: (input: any) => Promise<{ systemPrompt: string; userPrompt: string; citations: any[]; chunks: any[] }> };
  document: {
    save: (input: { workspaceId: WorkspaceId; url: string; title?: string; html?: string }) => Promise<{ documentId: string; wordCount: number }>;
  };
  tab: { create: (input: { workspaceId: WorkspaceId; url: string; title?: string }) => Promise<any> };
  annotation: { create: (input: any) => Promise<any> };
  confirmDanger: (params: { toolName: string; args: any; reason: string }) => Promise<boolean>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  /** 标记为危险动作：执行前必须用户确认 */
  requiresConfirm?: boolean;
  /** 限流：每秒最多 N 次 */
  rateLimit?: number;
  /** 实际执行 */
  execute: (args: any, ctx: ToolContext) => Promise<any>;
}

const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: 'searchWeb',
    description: '多引擎搜索网页。返回 top-K 结果（title/url/snippet/source）和可选 AI 摘要。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        scope: { type: 'string', description: 'web/workspace/library', enum: ['web', 'workspace', 'library'] },
        topK: { type: 'number', description: '返回条数（1-30）' },
      },
      required: ['query'],
    },
    execute: async (args, ctx) => ctx.search.run({ query: args.query, workspaceId: ctx.workspaceId, scope: args.scope, topK: args.topK }),
  },
  {
    name: 'ragQuery',
    description: '在本地知识库做 RAG 召回（双路 BM25 + Vector 融合 + 原文片段 + 引用）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '问题或查询' },
        topK: { type: 'number', description: 'top-K 引用（1-20）' },
      },
      required: ['query'],
    },
    execute: async (args, ctx) => ctx.rag.run({ query: args.query, workspaceId: ctx.workspaceId, topK: args.topK }),
  },
  {
    name: 'savePage',
    description: '保存当前页面或 URL 到当前 Workspace。返回 documentId。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL' },
        title: { type: 'string', description: '可选标题' },
      },
      required: ['url'],
    },
    rateLimit: 5,
    execute: async (args, ctx) => {
      if (!ctx.workspaceId) throw new Error('No active workspace');
      return await ctx.document.save({ workspaceId: ctx.workspaceId, url: args.url, title: args.title });
    },
  },
  {
    name: 'openTab',
    description: '在当前 Workspace 新建一个 Tab。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL' },
        title: { type: 'string', description: '可选标题' },
      },
      required: ['url'],
    },
    rateLimit: 10,
    execute: async (args, ctx) => {
      if (!ctx.workspaceId) throw new Error('No active workspace');
      return await ctx.tab.create({ workspaceId: ctx.workspaceId, url: args.url, title: args.title });
    },
  },
  {
    name: 'createAnnotation',
    description: '在当前 document 上创建高亮笔记。**危险动作**：需要用户确认。',
    parameters: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'document id' },
        selector: { type: 'string', description: 'DOM selector' },
        rangeText: { type: 'string', description: '选区文字' },
        note: { type: 'string', description: '笔记内容' },
        color: { type: 'string', description: '颜色', enum: ['yellow', 'green', 'red', 'blue'] },
      },
      required: ['documentId', 'rangeText'],
    },
    requiresConfirm: true,
    rateLimit: 20,
    execute: async (args, ctx) => ctx.annotation.create(args),
  },
];

const rateLimiters = new Map<string, { tokens: number; lastRefill: number }>();

function checkRateLimit(name: string, perSec: number): boolean {
  const now = Date.now();
  let state = rateLimiters.get(name);
  if (!state) { state = { tokens: perSec, lastRefill: now }; rateLimiters.set(name, state); }
  const elapsed = (now - state.lastRefill) / 1000;
  state.tokens = Math.min(perSec, state.tokens + elapsed * perSec);
  state.lastRefill = now;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}

export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxSteps?: number;
  timeoutMs?: number;
}

export interface AgentRunRequest {
  userMessage: string;
  systemPrompt?: string;
  /** Pre-built user-role payload (e.g. RAG retrieved chunks wrapped in
   *  <retrieved> tags). When provided, it is prepended to `userMessage`
   *  in the first user-role turn so chunk content is sent in the user
   *  channel rather than embedded in the system prompt. */
  userContext?: string;
  config: AgentConfig;
  toolContext: ToolContext;
  /** 自定义 tool 注册（叠加在 BUILTIN_TOOLS 上） */
  extraTools?: ToolDefinition[];
  /** 用户消息回调：用于 UI 进度 */
  onStep?: (step: AgentStep) => void;
}

export type AgentStep =
  | { kind: 'llm-call'; iteration: number; toolChoice: 'auto' | 'none' }
  | { kind: 'tool-call'; iteration: number; toolName: string; args: any; requiresConfirm: boolean; confirmed: boolean }
  | { kind: 'tool-result'; iteration: number; toolName: string; result: any }
  | { kind: 'final'; answer: string; iterations: number }
  | { kind: 'error'; message: string; iteration?: number };

export interface AgentRunResult {
  answer: string;
  iterations: number;
  toolCalls: Array<{ tool: string; args: any; result: any; iteration: number }>;
}

export async function runAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const tools = [...BUILTIN_TOOLS, ...(req.extraTools || [])];
  const toolsSpec = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const initialUserContent = req.userContext
    ? `${req.userContext}\n\n---\n\n${req.userMessage}`
    : req.userMessage;
  const messages: any[] = [
    ...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []),
    { role: 'user', content: initialUserContent },
  ];

  const toolCalls: AgentRunResult['toolCalls'] = [];
  const maxSteps = req.config.maxSteps ?? 5;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), req.config.timeoutMs ?? 60000);

  try {
    for (let i = 0; i < maxSteps; i++) {
      req.onStep?.({ kind: 'llm-call', iteration: i, toolChoice: 'auto' });
      const data = await chatCompletion(req.config, messages, toolsSpec, ac.signal);
      const choice = data.choices?.[0];
      if (!choice) {
        return { answer: '（LLM 无响应）', iterations: i, toolCalls };
      }
      const msg = choice.message || {};
      if (msg.content) messages.push({ role: 'assistant', content: msg.content });
      if (msg.tool_calls?.length) {
        // 执行 tool calls
        for (const call of msg.tool_calls) {
          const fn = call.function;
          const tool = tools.find((t) => t.name === fn.name);
          if (!tool) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: `error: unknown tool ${fn.name}` });
            continue;
          }
          const args = safeParseJson(fn.arguments);
          if (args === undefined || args === null || (typeof args === 'object' && args !== null && 'invalid' in (args as Record<string, unknown>))) {
            // LLM produced malformed JSON; do NOT execute with empty
            // args — that could persist a corrupt annotation, write a
            // file at an undefined path, etc.
            messages.push({ role: 'tool', tool_call_id: call.id, content: `error: tool "${fn.name}" arguments are not valid JSON` });
            toolCalls.push({ tool: tool.name, args, result: { error: 'invalid_json_args' }, iteration: i });
            continue;
          }
          // 限流
          if (tool.rateLimit && !checkRateLimit(tool.name, tool.rateLimit)) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'error: rate limit exceeded' });
            continue;
          }
          // 危险动作 confirm
          let confirmed = true;
          if (tool.requiresConfirm) {
            confirmed = await req.toolContext.confirmDanger({
              toolName: tool.name,
              args,
              reason: tool.description,
            });
          }
          req.onStep?.({ kind: 'tool-call', iteration: i, toolName: tool.name, args, requiresConfirm: !!tool.requiresConfirm, confirmed });
          if (!confirmed) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'error: user denied this action' });
            toolCalls.push({ tool: tool.name, args, result: { denied: true }, iteration: i });
            continue;
          }
          try {
            const result = await tool.execute(args, req.toolContext);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result).slice(0, 8000);
            toolCalls.push({ tool: tool.name, args, result, iteration: i });
            messages.push({ role: 'tool', tool_call_id: call.id, content: resultStr });
            req.onStep?.({ kind: 'tool-result', iteration: i, toolName: tool.name, result });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            messages.push({ role: 'tool', tool_call_id: call.id, content: `error: ${msg}` });
            toolCalls.push({ tool: tool.name, args, result: { error: msg }, iteration: i });
          }
        }
        continue;
      }
      // 无 tool call → final answer
      const answer = msg.content || '（无内容）';
      req.onStep?.({ kind: 'final', answer, iterations: i + 1 });
      return { answer, iterations: i + 1, toolCalls };
    }
    // 到达 maxSteps 仍没 final answer
    return { answer: '（Agent 达到 maxSteps 上限未返回最终答案）', iterations: maxSteps, toolCalls };
  } finally {
    clearTimeout(timer);
  }
}

async function chatCompletion(config: AgentConfig, messages: any[], tools: any[], signal: AbortSignal): Promise<any> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({ model: config.model, temperature: 0.2, max_tokens: 2000, messages, tools, tool_choice: 'auto' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

function safeParseJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return { invalid: true };
  }
}

export { BUILTIN_TOOLS };
