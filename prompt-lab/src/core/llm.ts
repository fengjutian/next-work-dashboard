// ── LLM Provider 抽象层 — 核心对话引擎 ──

// ── 类型定义 ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ToolDef[];
  /** 默认启用流式响应；部分 OpenAI 兼容服务只支持非流式。 */
  stream?: boolean;
  /** 请求 OpenAI 兼容服务强制返回 JSON 对象。 */
  responseFormat?: 'json_object';
}

export interface ChatChunk {
  delta: string;
  /** 部分推理模型将可见推理输出放在独立字段。 */
  reasoningDelta?: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | null;
  /** 流式 tool_call 增量 */
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
}

// ── Provider 接口 ──

export interface LLMProvider {
  readonly id: string;
  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
  validate(): Promise<boolean>;
}

// ── OpenAI 兼容 Provider ──

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  chatProxy?: (payload: { baseUrl: string; apiKey: string; body: Record<string, unknown> }) => Promise<{ ok: boolean; status: number; data?: any; error?: string }>;
}

export function createOpenAIProvider(config: OpenAIConfig): LLMProvider {
  const apiKey = config.apiKey.trim();
  const { baseUrl } = config;
  const normalizedBase = baseUrl.replace(/\/$/, '');

  return {
    id: 'openai-compatible',

    async *chat(messages, options) {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: messages.map((m) => {
          const msg: Record<string, unknown> = { role: m.role, content: m.content };
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
          return msg;
        }),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        stream: options.stream ?? true,
      };
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = 'auto';
      }
      if (options.responseFormat) body.response_format = { type: options.responseFormat };

      if (config.chatProxy) {
        body.stream = false;
        const proxied = await config.chatProxy({ baseUrl: normalizedBase, apiKey, body });
        if (!proxied.ok) throw new Error(`LLM API error ${proxied.status}: ${proxied.error ?? 'Request failed'}`);
        const choice = proxied.data?.choices?.[0];
        const content = choice?.message?.content ?? choice?.text ?? proxied.data?.output_text ?? proxied.data?.content ?? '';
        const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? choice?.message?.analysis ?? '';
        yield { delta: Array.isArray(content) ? content.map((part: { text?: string; content?: string }) => part.text ?? part.content ?? '').join('') : String(content), reasoningDelta: String(reasoning ?? ''), finishReason: choice?.finish_reason ?? 'stop' };
        return;
      }

      const response = await fetch(`${normalizedBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text}`);
      }

      if (options.stream === false) {
        const parsed = await response.json();
        const choice = parsed.choices?.[0];
        const content = choice?.message?.content ?? choice?.text ?? parsed.output_text ?? parsed.content ?? '';
        const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? choice?.message?.analysis ?? '';
        const text = Array.isArray(content)
          ? content.map((part: { text?: string; content?: string }) => part.text ?? part.content ?? '').join('')
          : String(content ?? '');
        yield { delta: text, reasoningDelta: String(reasoning ?? ''), finishReason: choice?.finish_reason ?? 'stop' };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trimStart();
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            const rawContent = delta?.content ?? choice.message?.content ?? choice.text ?? '';
            const rawReasoning = delta?.reasoning_content ?? delta?.reasoning ?? delta?.analysis ?? '';
            const content = Array.isArray(rawContent)
              ? rawContent.map((part: { text?: string; content?: string }) => part.text ?? part.content ?? '').join('')
              : String(rawContent ?? '');

            const chunk: ChatChunk = {
              delta: content,
              reasoningDelta: String(rawReasoning ?? ''),
              finishReason: choice.finish_reason || null,
            };

            // 解析 tool_calls delta
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                chunk.toolCallDelta = {
                  index: tc.index ?? 0,
                  id: tc.id,
                  name: tc.function?.name,
                  arguments: tc.function?.arguments,
                };
                yield chunk;
              }
            } else {
              yield chunk;
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }
    },

    async listModels() {
      const response = await fetch(`${normalizedBase}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
        provider: 'openai-compatible',
        contextWindow: 32768,
      }));
    },

    async validate() {
      try {
        const res = await fetch(`${normalizedBase}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

// ── Provider Registry ──

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): LLMProvider | undefined {
  return providers.get(id);
}

export function listProviders(): LLMProvider[] {
  return [...providers.values()];
}
