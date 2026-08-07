import { beforeEach, describe, expect, it, vi } from 'vitest';

const entries: Array<{ key: string; namespace: string; model: string; prompt: string; response: string; vector: number[]; createdAt: number }> = [];
vi.mock('../src/db', () => ({
  isDbReady: () => true,
  dbListSemanticShadow: (namespace: string, model: string) => entries.filter((entry) => entry.namespace === namespace && entry.model === model),
  dbPutSemanticShadow: (entry: typeof entries[number]) => entries.push(entry),
  dbRecordLlmCacheEvent: vi.fn(),
  flushDbToDisk: vi.fn(),
}));

import { evaluateSemanticShadow, getSemanticShadowMetrics, resetSemanticShadowMetrics, storeSemanticShadow } from '../src/core/semantic-shadow-cache';

describe('semantic shadow cache', () => {
  beforeEach(() => { entries.length = 0; resetSemanticShadowMetrics(); });

  it('records high-confidence candidates without returning a response', async () => {
    entries.push({ key: 'old', namespace: 'scope', model: 'm', prompt: 'old', response: 'answer', vector: [1, 0], createdAt: 1 });
    const context = await evaluateSemanticShadow({ key: 'new', namespace: 'scope', model: 'm', prompt: 'similar', embed: async () => [0.999, 0.01] });
    expect(context?.bestSimilarity).toBeGreaterThan(0.97);
    expect(getSemanticShadowMetrics()).toMatchObject({ checks: 1, candidates: 1, highConfidence: 1 });
  });

  it('isolates candidates by namespace and model and stores observations', async () => {
    entries.push({ key: 'other', namespace: 'other', model: 'm', prompt: 'old', response: 'answer', vector: [1, 0], createdAt: 1 });
    const context = await evaluateSemanticShadow({ key: 'new', namespace: 'scope', model: 'm', prompt: 'query', embed: async () => [1, 0] });
    expect(context?.bestSimilarity).toBe(-1);
    storeSemanticShadow(context, 'fresh answer');
    expect(entries.some((entry) => entry.key === 'new' && entry.response === 'fresh answer')).toBe(true);
  });
});
