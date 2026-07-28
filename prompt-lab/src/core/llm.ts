// ── LLM Provider 抽象层 — 核心对话引擎 ──

// ── 类型定义 ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatChunk {
  delta: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
}

// ── Provider 接口 ──

export interface LLMProvider {
  /** 服务商标识 */
  readonly id: string;
  /** 流式对话 */
  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk>;
  /** 列出可用模型 */
  listModels(): Promise<ModelInfo[]>;
  /** 检查 API Key 是否有效 */
  validate(): Promise<boolean>;
}

// ── OpenAI 兼容 Provider ──

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
}

export function createOpenAIProvider(config: OpenAIConfig): LLMProvider {
  const { apiKey, baseUrl } = config;
  const normalizedBase = baseUrl.replace(/\/$/, '');

  return {
    id: 'openai-compatible',

    async *chat(messages, options) {
      const response = await fetch(`${normalizedBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens,
          stream: true,
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text}`);
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            yield {
              delta: choice.delta?.content || '',
              finishReason: choice.finish_reason || null,
            };
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
        contextWindow: 32768, // default
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
