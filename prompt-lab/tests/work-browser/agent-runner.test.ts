/**
 * AI Agent runner — 单轮 tool calling（mock LLM + mock tool context）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAgent, BUILTIN_TOOLS, type ToolContext, type ToolDefinition } from '@/core/work-browser/agent/runner';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(responses: any[]) {
  let i = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: true,
      status: 200,
      json: async () => r,
      text: async () => JSON.stringify(r),
    } as any;
  });
}

const baseConfig = {
  baseUrl: 'https://api.test/v1',
  apiKey: 'test',
  model: 'gpt-4o-mini',
  maxSteps: 3,
  timeoutMs: 5000,
};

function mkCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceId: 'ws1' as any,
    search: { run: async (input) => ({ results: [], summary: null }) },
    rag: { run: async (input) => ({ systemPrompt: '', citations: [], chunks: [] }) },
    document: { save: async () => ({ documentId: 'd1', wordCount: 100 }) },
    tab: { create: async () => ({ id: 'tab1' }) },
    annotation: { create: async () => ({ id: 'a1' }) },
    confirmDanger: async () => true,
    ...overrides,
  };
}

describe('runAgent', () => {
  it('LLM 不调 tool → 直接返回 final answer', async () => {
    mockFetch([{
      choices: [{ message: { role: 'assistant', content: '最终答案：42' } }],
    }]);
    const result = await runAgent({
      userMessage: '1+1=?',
      config: baseConfig,
      toolContext: mkCtx(),
    });
    expect(result.answer).toBe('最终答案：42');
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toEqual([]);
  });

  it('LLM 调 tool → 执行 tool → 再次调 LLM → 返回 final', async () => {
    mockFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call1',
              type: 'function',
              function: { name: 'searchWeb', arguments: JSON.stringify({ query: 'clickhouse' }) },
            }],
          },
        }],
      },
      {
        choices: [{ message: { role: 'assistant', content: '搜索结果已得到，结论：…' } }],
      },
    ]);
    const ctx = mkCtx({
      search: { run: async (input) => ({ results: [{ title: 'T', url: 'u', snippet: 'S', source: 'google' }], summary: 'AI 摘要' }) },
    });
    const result = await runAgent({
      userMessage: '查 clickhouse',
      config: baseConfig,
      toolContext: ctx,
    });
    expect(result.answer).toBe('搜索结果已得到，结论：…');
    expect(result.iterations).toBe(2);
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].tool).toBe('searchWeb');
  });

  it('危险 tool → confirm 拒绝 → tool 返回 user denied', async () => {
    mockFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call1',
              type: 'function',
              function: { name: 'createAnnotation', arguments: JSON.stringify({ documentId: 'd1', rangeText: 'x' }) },
            }],
          },
        }],
      },
      {
        choices: [{ message: { role: 'assistant', content: '用户拒绝后换方案：…' } }],
      },
    ]);
    let confirmCalled = false;
    const ctx = mkCtx({
      confirmDanger: async () => { confirmCalled = true; return false; },
    });
    const result = await runAgent({
      userMessage: '高亮',
      config: baseConfig,
      toolContext: ctx,
    });
    expect(confirmCalled).toBe(true);
    expect(result.answer).toBe('用户拒绝后换方案：…');
    // tool 仍然被记录（即使 user denied）
    expect(result.toolCalls.length).toBe(1);
  });

  it('超过 maxSteps 仍未 final → 返回提示', async () => {
    mockFetch([
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'searchWeb', arguments: '{"query":"a"}' } }] } }] },
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'searchWeb', arguments: '{"query":"b"}' } }] } }] },
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c3', type: 'function', function: { name: 'searchWeb', arguments: '{"query":"c"}' } }] } }] },
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c4', type: 'function', function: { name: 'searchWeb', arguments: '{"query":"d"}' } }] }] }] },
    ]);
    const result = await runAgent({
      userMessage: 'x',
      config: { ...baseConfig, maxSteps: 3 },
      toolContext: mkCtx(),
    });
    expect(result.iterations).toBe(3);
    expect(result.answer).toContain('maxSteps');
  });

  it('LLM 报 500 → 抛错', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'server error' } as any)) as any;
    await expect(runAgent({
      userMessage: 'x',
      config: baseConfig,
      toolContext: mkCtx(),
    })).rejects.toThrow();
  });
});

describe('BUILTIN_TOOLS', () => {
  it('包含 5 个核心工具', () => {
    const names = BUILTIN_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['searchWeb', 'ragQuery', 'savePage', 'openTab', 'createAnnotation']));
  });

  it('createAnnotation 标记为危险', () => {
    const a = BUILTIN_TOOLS.find((t) => t.name === 'createAnnotation');
    expect(a?.requiresConfirm).toBe(true);
  });

  it('每个 tool 都有 JSON schema', () => {
    for (const t of BUILTIN_TOOLS) {
      expect(t.parameters.type).toBe('object');
      expect(Object.keys(t.parameters.properties).length).toBeGreaterThan(0);
      expect(t.parameters.required?.length).toBeGreaterThan(0);
    }
  });
});
