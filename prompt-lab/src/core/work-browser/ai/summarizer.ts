/**
 * AI Summarizer — 搜索结果聚合摘要
 *
 * 设计：
 *  - 默认走 OpenAI-compatible chat/completions 协议（覆盖 OpenAI / DeepSeek / Qwen / Ollama / vLLM ...）
 *  - 通过 settings 表读取 baseUrl + apiKey + model
 *  - 失败时返回 null（不阻塞主结果）
 *  - 严格保留来源引用（PRD 第 15 节"原始来源引用"红线）
 */
import type { SearchResult, SearchQuery } from '../types';

export interface AIProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 超时（ms）。 */
  timeoutMs?: number;
  /** 是否用本地（Ollama）模式，鉴权头不同。 */
  local?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export async function loadAIConfig(getter: (key: string) => Promise<string | null>): Promise<AIProviderConfig> {
  const [baseUrl, apiKey, model] = await Promise.all([
    getter('workBrowser.ai.baseUrl'),
    getter('workBrowser.ai.apiKey'),
    getter('workBrowser.ai.model'),
  ]);
  return {
    baseUrl: baseUrl || DEFAULT_BASE_URL,
    apiKey: apiKey || '',
    model: model || DEFAULT_MODEL,
    local: (baseUrl || '').includes('localhost') || (baseUrl || '').includes('127.0.0.1'),
  };
}

const SYSTEM_PROMPT = `你是 Work Browser 的搜索摘要助手。基于给定来源列表生成中文摘要，要求：
1. 必须保留来源引用 — 关键事实后追加 [n] 标识（n 为来源序号）。
2. 不引入来源以外的事实，不得臆测。
3. 输出分三段：核心结论、关键证据、争议或不确定性。
4. 长度 ≤ 300 字。`;

export async function summarizeResults(
  results: SearchResult[],
  query: SearchQuery,
  config: AIProviderConfig,
): Promise<string | null> {
  if (results.length === 0) return null;
  const sources = results.slice(0, 20).map((r, i) => {
    const snippet = (r.snippet || '').slice(0, 240).replace(/\s+/g, ' ');
    return `[${i + 1}] ${r.title}\n${r.canonicalUrl}\n${snippet}`;
  }).join('\n\n');

  const userPrompt = `查询：${query.text}\n\n来源：\n${sources}\n\n请按要求生成摘要。`;

  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 12000);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn('[work-browser] summarize failed:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
