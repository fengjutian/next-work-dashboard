// ── ReAct Agent Loop ──
// 实现 think → act → observe 循环，直到 LLM 给出最终答案

import type { LLMProvider, ChatMessage } from './llm';
import { getToolSchemas, executeToolCall } from './tools';
import type { ToolCall, ToolResult } from './tools';

// ── 类型 ──

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  /** 工具调用信息（仅 assistant 消息可能有） */
  toolCalls?: ToolCall[];
  /** 工具执行结果（仅 tool 消息有） */
  toolResult?: ToolResult;
}

export interface AgentStep {
  type: 'think' | 'act' | 'observe' | 'answer';
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface AgentOptions {
  maxSteps?: number; // 最大循环次数，默认 5
}

// ── System prompt that enables tool use ──

const TOOL_SYSTEM_PROMPT = `You are an AI assistant with access to tools.
When you need to use a tool, output a JSON block exactly like this:

\`\`\`tool
{"calls":[{"id":"call_1","name":"tool_name","arguments":{"arg":"value"}}]}
\`\`\`

After receiving tool results, continue thinking and either use more tools or give a final answer.
Always output your final answer in natural language without tool blocks.

Available tools will be provided in the system message.`;

// ── Agent ──

export async function* runAgent(
  provider: LLMProvider,
  userMessage: string,
  history: ChatMessage[],
  model: string,
  options: AgentOptions = {},
): AsyncIterable<AgentStep> {
  const maxSteps = options.maxSteps ?? 5;

  // 构建包含工具定义的 system message
  const toolSchemas = getToolSchemas();
  const toolListText = toolSchemas
    .map((t) => {
      const props = Object.entries(t.function.parameters.properties)
        .map(([k, v]) => `  - ${k}: ${v.type} — ${v.description}`)
        .join('\n');
      const required = t.function.parameters.required?.length
        ? `\n  Required: ${t.function.parameters.required.join(', ')}`
        : '';
      return `- **${t.function.name}**: ${t.function.description}\n${props}${required}`;
    })
    .join('\n\n');

  const systemMsg: ChatMessage = {
    role: 'system',
    content: `${TOOL_SYSTEM_PROMPT}\n\n## Available Tools\n\n${toolListText}`,
  };

  const messages: ChatMessage[] = [systemMsg, ...history, { role: 'user', content: userMessage }];

  for (let step = 0; step < maxSteps; step++) {
    // ── Think 阶段：调用 LLM ──
    yield { type: 'think', content: '' };

    let fullResponse = '';
    const abort = new AbortController();

    try {
      const stream = provider.chat(messages, { model, signal: abort.signal });
      for await (const chunk of stream) {
        fullResponse += chunk.delta;
      }
    } catch (err: any) {
      yield { type: 'answer', content: `Agent error: ${err.message}` };
      return;
    }

    // ── 解析响应：是否有 tool block ──
    const toolBlockMatch = fullResponse.match(/```tool\n([\s\S]*?)\n```/);
    if (!toolBlockMatch) {
      // 无工具调用 → 最终答案
      yield { type: 'answer', content: fullResponse };
      return;
    }

    // 提取 tool calls JSON
    let toolCalls: ToolCall[];
    try {
      const parsed = JSON.parse(toolBlockMatch[1]);
      toolCalls = parsed.calls || [];
    } catch {
      yield { type: 'answer', content: fullResponse };
      return;
    }

    if (toolCalls.length === 0) {
      yield { type: 'answer', content: fullResponse };
      return;
    }

    // 思考文本（去掉 tool block 后的内容）
    const thinkingText = fullResponse.replace(/```tool\n[\s\S]*?\n```/, '').trim();

    // ── Act 阶段：执行工具 ──
    yield { type: 'act', content: thinkingText, toolCalls };

    const toolResults: ToolResult[] = [];
    for (const call of toolCalls) {
      const result = await executeToolCall(call);
      toolResults.push(result);
    }

    // ── Observe 阶段：将结果反馈给 LLM ──
    yield { type: 'observe', toolResults };

    // 将 assistant 响应 + tool 结果添加到消息历史
    messages.push({ role: 'assistant', content: fullResponse });
    for (const result of toolResults) {
      const resultText = result.error
        ? `Tool ${result.name} error: ${result.error}`
        : `Tool ${result.name} result:\n${result.output}`;
      messages.push({ role: 'user', content: `[Tool Result]\n${resultText}` });
    }
  }

  // 超过最大步骤 → 强制要求 LLM 总结
  messages.push({
    role: 'user',
    content: 'Please provide a final answer based on all the information gathered so far. Do NOT use any more tools.',
  });

  let finalResponse = '';
  try {
    const stream = provider.chat(messages, { model });
    for await (const chunk of stream) {
      finalResponse += chunk.delta;
    }
  } catch (err: any) {
    finalResponse = `Agent error at final step: ${err.message}`;
  }

  yield { type: 'answer', content: finalResponse };
}
