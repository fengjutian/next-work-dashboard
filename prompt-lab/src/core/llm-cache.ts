import type { ChatChunk, ChatMessage, ChatOptions, LLMProvider, ModelInfo } from './llm';

export interface LlmCacheEntry {
  key: string;
  response: string;
  reasoning: string;
  model: string;
  provider: string;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  hitCount: number;
}

export interface LlmCacheStorage {
  get(key: string): Promise<LlmCacheEntry | null> | LlmCacheEntry | null;
  put(entry: LlmCacheEntry): Promise<void> | void;
  clear?(): Promise<void> | void;
}

export interface LlmCacheMetrics {
  eligibleRequests: number;
  memoryHits: number;
  persistentHits: number;
  coalescedHits: number;
  misses: number;
  bypasses: number;
  writes: number;
  errors: number;
}

export interface CachedProviderOptions {
  storage?: LlmCacheStorage;
  namespace?: string;
  enabled?: () => boolean;
  ttlMs?: number;
  memoryTtlMs?: number;
  maxMemoryEntries?: number;
  replayChunkSize?: number;
  bypass?: (messages: ChatMessage[], options: ChatOptions) => boolean;
  semanticShadow?: {
    evaluate: (key: string, messages: ChatMessage[], options: ChatOptions) => Promise<unknown>;
    store: (context: unknown, response: string) => void;
  };
}

const metrics: LlmCacheMetrics = {
  eligibleRequests: 0, memoryHits: 0, persistentHits: 0, coalescedHits: 0,
  misses: 0, bypasses: 0, writes: 0, errors: 0,
};
let cacheGeneration = 0;

export function getLlmCacheMetrics(): LlmCacheMetrics { return { ...metrics }; }
export function resetLlmCacheMetrics(): void { Object.keys(metrics).forEach((key) => { metrics[key as keyof LlmCacheMetrics] = 0; }); }
export function clearLlmMemoryCaches(): void { cacheGeneration += 1; }

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+$/g, '')).join('\n');
}

function stableValue(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createLlmCacheKey(providerId: string, namespace: string, messages: ChatMessage[], options: ChatOptions): Promise<string> {
  return sha256(JSON.stringify(stableValue({
    schemaVersion: 1, providerId, namespace, model: options.model,
    temperature: options.temperature ?? 0.7, maxTokens: options.maxTokens ?? null,
    responseFormat: options.responseFormat ?? null, messages,
    tools: options.tools ?? [],
  })));
}

async function* replay(entry: LlmCacheEntry, chunkSize: number): AsyncIterable<ChatChunk> {
  if (entry.reasoning) yield { delta: '', reasoningDelta: entry.reasoning, finishReason: null };
  for (let offset = 0; offset < entry.response.length; offset += chunkSize) {
    yield { delta: entry.response.slice(offset, offset + chunkSize), finishReason: null };
    await Promise.resolve();
  }
  yield { delta: '', finishReason: 'stop' };
}

export function createCachedProvider(provider: LLMProvider, options: CachedProviderOptions = {}): LLMProvider {
  const memory = new Map<string, LlmCacheEntry>();
  const inflight = new Map<string, Promise<LlmCacheEntry>>();
  const ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const memoryTtlMs = options.memoryTtlMs ?? 30 * 60 * 1000;
  const maxMemoryEntries = options.maxMemoryEntries ?? 200;
  const chunkSize = options.replayChunkSize ?? 64;
  let observedGeneration = cacheGeneration;

  const remember = (entry: LlmCacheEntry) => {
    memory.delete(entry.key);
    memory.set(entry.key, { ...entry, expiresAt: Math.min(entry.expiresAt, Date.now() + memoryTtlMs) });
    while (memory.size > maxMemoryEntries) memory.delete(memory.keys().next().value as string);
  };

  return {
    id: `${provider.id}:cached`,
    listModels(): Promise<ModelInfo[]> { return provider.listModels(); },
    validate(): Promise<boolean> { return provider.validate(); },
    async *chat(messages, chatOptions) {
      if (observedGeneration !== cacheGeneration) { memory.clear(); observedGeneration = cacheGeneration; }
      const bypass = options.enabled?.() === false || chatOptions.tools?.length || options.bypass?.(messages, chatOptions);
      if (bypass) { metrics.bypasses += 1; yield* provider.chat(messages, chatOptions); return; }
      metrics.eligibleRequests += 1;
      let key: string;
      try { key = await createLlmCacheKey(provider.id, options.namespace ?? '', messages, chatOptions); }
      catch { metrics.errors += 1; yield* provider.chat(messages, chatOptions); return; }

      const cached = memory.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        metrics.memoryHits += 1; cached.hitCount += 1; cached.lastAccessedAt = Date.now();
        yield* replay(cached, chunkSize); return;
      }
      memory.delete(key);
      try {
        const persisted = await options.storage?.get(key);
        if (persisted && persisted.expiresAt > Date.now()) {
          metrics.persistentHits += 1; remember(persisted); yield* replay(persisted, chunkSize); return;
        }
      } catch { metrics.errors += 1; }

      const pending = inflight.get(key);
      if (pending) {
        metrics.coalescedHits += 1;
        try { const entry = await pending; yield* replay(entry, chunkSize); return; }
        catch { yield* provider.chat(messages, chatOptions); return; }
      }

      metrics.misses += 1;
      const shadowContext = options.semanticShadow?.evaluate(key, messages, chatOptions).catch(() => null);
      let resolveEntry!: (entry: LlmCacheEntry) => void;
      let rejectEntry!: (reason: unknown) => void;
      const promise = new Promise<LlmCacheEntry>((resolve, reject) => { resolveEntry = resolve; rejectEntry = reject; });
      void promise.catch(() => undefined);
      inflight.set(key, promise);
      let response = ''; let reasoning = ''; let completed = false;
      try {
        for await (const chunk of provider.chat(messages, chatOptions)) {
          response += chunk.delta; reasoning += chunk.reasoningDelta ?? '';
          if (chunk.finishReason === 'stop' || chunk.finishReason === 'length') completed = true;
          yield chunk;
        }
        completed = completed || Boolean(response.trim() || reasoning.trim());
        if (!completed) throw new Error('LLM response was empty');
        const now = Date.now();
        const entry: LlmCacheEntry = { key, response, reasoning, model: chatOptions.model, provider: provider.id, createdAt: now, expiresAt: now + ttlMs, lastAccessedAt: now, hitCount: 0 };
        remember(entry);
        try { await options.storage?.put(entry); metrics.writes += 1; } catch { metrics.errors += 1; }
        if (shadowContext) options.semanticShadow?.store(await shadowContext, response);
        resolveEntry(entry);
      } catch (error) { rejectEntry(error); throw error; }
      finally { inflight.delete(key); }
    },
  };
}
