import { beforeEach, describe, expect, it } from 'vitest';
import { createCachedProvider, createLlmCacheKey, getLlmCacheMetrics, resetLlmCacheMetrics, type LlmCacheEntry } from '../src/core/llm-cache';
import type { LLMProvider } from '../src/core/llm';

function provider(counter: { calls: number }, response = 'cached answer'): LLMProvider {
  return {
    id: 'test-provider',
    async *chat() { counter.calls += 1; yield { delta: response, finishReason: 'stop' }; },
    async listModels() { return []; },
    async validate() { return true; },
  };
}

async function collect(stream: AsyncIterable<{ delta: string }>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk.delta;
  return text;
}

describe('LLM response cache', () => {
  beforeEach(() => resetLlmCacheMetrics());

  it('creates stable keys and keeps model isolation', async () => {
    const messages = [{ role: 'user' as const, content: 'hello  \r\n' }];
    const first = await createLlmCacheKey('p', 'scope', messages, { model: 'a' });
    const normalized = await createLlmCacheKey('p', 'scope', [{ role: 'user', content: 'hello\n' }], { model: 'a' });
    const otherModel = await createLlmCacheKey('p', 'scope', messages, { model: 'b' });
    expect(first).toBe(normalized);
    expect(first).not.toBe(otherModel);
  });

  it('serves repeated requests from memory', async () => {
    const counter = { calls: 0 };
    const cached = createCachedProvider(provider(counter));
    const messages = [{ role: 'user' as const, content: 'same' }];
    expect(await collect(cached.chat(messages, { model: 'm' }))).toBe('cached answer');
    expect(await collect(cached.chat(messages, { model: 'm' }))).toBe('cached answer');
    expect(counter.calls).toBe(1);
    expect(getLlmCacheMetrics()).toMatchObject({ misses: 1, memoryHits: 1, writes: 1 });
  });

  it('loads a persistent entry without calling the model', async () => {
    const counter = { calls: 0 };
    const entries = new Map<string, LlmCacheEntry>();
    const storage = { get: (key: string) => entries.get(key) ?? null, put: (entry: LlmCacheEntry) => { entries.set(entry.key, entry); } };
    const messages = [{ role: 'user' as const, content: 'persist' }];
    const first = createCachedProvider(provider(counter), { storage });
    await collect(first.chat(messages, { model: 'm' }));
    const second = createCachedProvider(provider(counter), { storage });
    expect(await collect(second.chat(messages, { model: 'm' }))).toBe('cached answer');
    expect(counter.calls).toBe(1);
    expect(getLlmCacheMetrics().persistentHits).toBe(1);
  });

  it('bypasses calls that define tools', async () => {
    const counter = { calls: 0 };
    const cached = createCachedProvider(provider(counter));
    const messages = [{ role: 'user' as const, content: 'tool request' }];
    const options = { model: 'm', tools: [{ type: 'function' as const, function: { name: 'now', description: '', parameters: {} } }] };
    await collect(cached.chat(messages, options));
    await collect(cached.chat(messages, options));
    expect(counter.calls).toBe(2);
    expect(getLlmCacheMetrics().bypasses).toBe(2);
  });

  it('emits persistent metric events for misses, writes, and hits', async () => {
    const counter = { calls: 0 };
    const events: string[] = [];
    const cached = createCachedProvider(provider(counter), { onEvent: (event) => events.push(event) });
    const messages = [{ role: 'user' as const, content: 'metrics' }];
    await collect(cached.chat(messages, { model: 'm' }));
    await collect(cached.chat(messages, { model: 'm' }));
    expect(events).toEqual(['miss', 'write', 'memory_hit']);
  });
});
