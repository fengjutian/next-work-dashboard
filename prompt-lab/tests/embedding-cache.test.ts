import { beforeEach, describe, expect, it, vi } from 'vitest';

const records = new Map<string, number[]>();
vi.mock('../src/db', () => ({
  isDbReady: () => true,
  dbGetEmbeddingCache: (keys: string[]) => new Map(keys.filter((key) => records.has(key)).map((key) => [key, records.get(key)!])),
  dbPutEmbeddingCache: (entries: Array<{ key: string; vector: number[] }>) => entries.forEach((entry) => records.set(entry.key, entry.vector)),
  flushDbToDisk: vi.fn(),
}));

import { createCachedEmbeddings, getEmbeddingCacheMetrics, resetEmbeddingCacheMetrics } from '../src/core/embedding-cache';

describe('embedding cache', () => {
  beforeEach(() => { records.clear(); resetEmbeddingCacheMetrics(); });

  it('only loads cache misses and preserves input order', async () => {
    const loader = vi.fn(async (inputs: string[]) => inputs.map((input) => [input.length, 1]));
    expect(await createCachedEmbeddings(['one', 'two'], 'local:model', loader)).toEqual([[3, 1], [3, 1]]);
    expect(await createCachedEmbeddings(['two', 'three'], 'local:model', loader)).toEqual([[3, 1], [5, 1]]);
    expect(loader).toHaveBeenNthCalledWith(1, ['one', 'two']);
    expect(loader).toHaveBeenNthCalledWith(2, ['three']);
    expect(getEmbeddingCacheMetrics()).toMatchObject({ requests: 2, inputHits: 1, inputMisses: 3, writes: 3 });
  });

  it('isolates vectors by embedding identity', async () => {
    const loader = vi.fn(async () => [[1, 2]]);
    await createCachedEmbeddings(['same'], 'local:model-a', loader);
    await createCachedEmbeddings(['same'], 'local:model-b', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
