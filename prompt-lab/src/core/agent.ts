// ── ReAct Agent Loop ──
// 使用 OpenAI 原生 function calling 协议

import type { LLMProvider, ChatMessage, ChatOptions, ToolDef } from './llm';
import { getEnabledToolSchemas, executeToolCall } from './tools';
import type { ToolCall, ToolResult } from './tools';

// ── 类型 ──

export interface AgentStep {
  type: 'think' | 'act' | 'observe' | 'answer';
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface AgentOptions {
  maxSteps?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
}

// ── System prompt ──

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools. Follow these rules:

1. **URL handling**: When the user mentions a URL (http:// or https://), you MUST call the \`fetch_url\` tool to retrieve its content before answering. Never claim you cannot access the network — you have the fetch_url tool for this purpose.

2. **Memory first**: When available, use \`search_conversation_history\` to find relevant context before answering.

3. **Tools over guesses**: Prefer calling a tool over guessing or relying on training data. Always respond in the user's language.`;

// ── Agent ──

function openAiSchemaToToolDef(schema: ReturnType<typeof getEnabledToolSchemas>[number]): ToolDef {
  return {
    type: 'function',
    function: {
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters as unknown as Record<string, unknown>,
    },
  };
}

export async function* runAgent(
  provider: LLMProvider,
  userMessage: string,
  history: ChatMessage[],
  model: string,
  options: AgentOptions = {},
): AsyncIterable<AgentStep> {
  const maxSteps = options.maxSteps ?? 5;
  const toolSchemas = getEnabledToolSchemas();
  const tools = toolSchemas.map(openAiSchemaToToolDef);

  const systemPrompt = options.systemPrompt
    ? `${SYSTEM_PROMPT}\n\n${options.systemPrompt}`
    : SYSTEM_PROMPT;
  const systemMsg: ChatMessage = { role: 'system', content: systemPrompt };
  const messages: ChatMessage[] = [systemMsg, ...history, { role: 'user', content: userMessage }];

  for (let step = 0; step < maxSteps; step++) {
    yield { type: 'think', content: '' };

    let fullContent = '';
    let finishReason: string | null = null;
    const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      const chatOpts: ChatOptions = { model, signal: options.signal, tools };
      const stream = provider.chat(messages, chatOpts);
      for await (const chunk of stream) {
        fullContent += chunk.delta;

        // 收集 tool_call delta
        if (chunk.toolCallDelta) {
          const d = chunk.toolCallDelta;
          const existing = accumulatedToolCalls.get(d.index);
          if (existing) {
            if (d.id) existing.id = d.id;
            if (d.name) existing.name = d.name;
            existing.arguments += d.arguments || '';
          } else {
            accumulatedToolCalls.set(d.index, {
              id: d.id || '',
              name: d.name || '',
              arguments: d.arguments || '',
            });
          }
        }

        if (chunk.finishReason) finishReason = chunk.finishReason;
      }
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      yield { type: 'answer', content: `Agent error: ${err.message}` };
      return;
    }

    // ── 判断是否有 tool_calls ──
    if (accumulatedToolCalls.size === 0) {
      yield { type: 'answer', content: fullContent };
      return;
    }

    // ── 构建 ToolCall 列表 ──
    const rawCalls = [...accumulatedToolCalls.values()]
      .sort((a, b) => a.id.localeCompare(b.id) || 0);

    const toolCalls: ToolCall[] = rawCalls
      .map((c, i) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.arguments); } catch { /* empty args */ }
        return {
          id: c.id || `call_${i}`,
          name: c.name,
          arguments: args,
        };
      })
      .filter((c) => c.name);

    if (toolCalls.length === 0) {
      yield { type: 'answer', content: fullContent };
      return;
    }

    // ── Act：执行工具 ──
    const thinkingText = fullContent.trim();
    yield { type: 'act', content: thinkingText, toolCalls };

    const toolResults: ToolResult[] = [];
    for (const call of toolCalls) {
      const result = await executeToolCall(call);
      toolResults.push(result);
    }

    // ── Observe ──
    yield { type: 'observe', toolResults };

    // 按 OpenAI 格式追加消息
    messages.push({
      role: 'assistant',
      content: thinkingText || null as any,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    });
    for (const result of toolResults) {
      messages.push({
        role: 'tool',
        content: result.error ? `Error: ${result.error}` : (result.output || ''),
        tool_call_id: result.callId,
      });
    }
  }

  // 超过最大步骤
  messages.push({
    role: 'user',
    content: 'Please provide a final answer based on all the information gathered so far.',
  });

  let finalResponse = '';
  try {
    const stream = provider.chat(messages, { model, signal: options.signal });
    for await (const chunk of stream) {
      finalResponse += chunk.delta;
    }
  } catch (err: any) {
    finalResponse = `Agent error at final step: ${err.message}`;
  }
  yield { type: 'answer', content: finalResponse };
}
