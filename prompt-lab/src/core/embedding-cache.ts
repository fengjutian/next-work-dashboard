import { dbGetEmbeddingCache, dbPutEmbeddingCache, flushDbToDisk, isDbReady } from '@/db';

export interface EmbeddingCacheMetrics { requests: number; inputHits: number; inputMisses: number; writes: number; errors: number }
const metrics: EmbeddingCacheMetrics = { requests: 0, inputHits: 0, inputMisses: 0, writes: 0, errors: 0 };

async function hashEmbeddingInput(identity: string, input: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${identity}\0${input.replace(/\r\n?/g, '\n')}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getEmbeddingCacheMetrics(): EmbeddingCacheMetrics { return { ...metrics }; }
export function resetEmbeddingCacheMetrics(): void { Object.keys(metrics).forEach((key) => { metrics[key as keyof EmbeddingCacheMetrics] = 0; }); }

export async function createCachedEmbeddings(
  inputs: string[],
  identity: string,
  loader: (missingInputs: string[]) => Promise<number[][]>,
  maxEntries = 20000,
): Promise<number[][]> {
  if (!inputs.length) return [];
  metrics.requests += 1;
  const keys = await Promise.all(inputs.map((input) => hashEmbeddingInput(identity, input)));
  let cached = new Map<string, number[]>();
  try { if (isDbReady()) cached = dbGetEmbeddingCache(keys); } catch { metrics.errors += 1; }
  const missingIndexes = keys.map((key, index) => cached.has(key) ? -1 : index).filter((index) => index >= 0);
  metrics.inputHits += inputs.length - missingIndexes.length;
  metrics.inputMisses += missingIndexes.length;
  if (missingIndexes.length) {
    const missingInputs = missingIndexes.map((index) => inputs[index]);
    const vectors = await loader(missingInputs);
    if (vectors.length !== missingInputs.length) throw new Error('INVALID_EMBEDDING_RESPONSE');
    const entries = missingIndexes.map((inputIndex, index) => ({ key: keys[inputIndex], identity, vector: vectors[index] }));
    entries.forEach((entry) => cached.set(entry.key, entry.vector));
    try {
      if (isDbReady()) { dbPutEmbeddingCache(entries, maxEntries); void flushDbToDisk(); }
      metrics.writes += entries.length;
    } catch { metrics.errors += 1; }
  }
  return keys.map((key) => cached.get(key)!).filter(Boolean);
}
