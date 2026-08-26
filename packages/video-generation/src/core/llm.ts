/**
 * 视频生成面板用的极简 OpenAI 兼容 Chat provider。
 *
 * 与 @next-work/outline-scaffolder 内的同名实现保持一致：支持流式 + 非流式，
 * 主进程环境下走 host 提供的 chatProxy 走 IPC 转发（避免 renderer 直接暴露 API Key）。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  stream?: boolean;
  responseFormat?: "json_object";
}

export interface ChatChunk {
  delta: string;
  reasoningDelta?: string;
  finishReason?: "stop" | "length" | "tool_calls" | null;
}

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  chatProxy?: (payload: { baseUrl: string; apiKey: string; body: Record<string, unknown> }) => Promise<{ ok: boolean; status: number; data?: any; error?: string }>;
}

export function createOpenAIProvider(config: OpenAIConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  return {
    async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        stream: config.chatProxy ? false : options.stream ?? true,
      };
      if (options.responseFormat) body.response_format = { type: options.responseFormat };
      if (config.chatProxy) {
        const result = await config.chatProxy({ baseUrl, apiKey: config.apiKey.trim(), body });
        if (!result.ok) throw new Error(`LLM API error ${result.status}: ${result.error ?? "Request failed"}`);
        const choice = result.data?.choices?.[0];
        const content = choice?.message?.content ?? choice?.text ?? result.data?.output_text ?? result.data?.content ?? "";
        const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? "";
        yield { delta: String(content), reasoningDelta: String(reasoning), finishReason: choice?.finish_reason ?? "stop" };
        return;
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey.trim()}` },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!response.ok) throw new Error(`LLM API error ${response.status}: ${await response.text()}`);
      if (options.stream === false) {
        const data = await response.json();
        const choice = data.choices?.[0];
        yield { delta: String(choice?.message?.content ?? choice?.text ?? ""), finishReason: choice?.finish_reason ?? "stop" };
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const payload = line.trim().replace(/^data:\s*/, "");
          if (!payload || payload === line.trim() || payload === "[DONE]") continue;
          try {
            const choice = JSON.parse(payload).choices?.[0];
            if (choice) yield {
              delta: String(choice.delta?.content ?? ""),
              reasoningDelta: String(choice.delta?.reasoning_content ?? ""),
              finishReason: choice.finish_reason ?? null,
            };
          } catch { /* ignore incomplete SSE records */ }
        }
      }
    },
  };
}
