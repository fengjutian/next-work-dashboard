import { dbListSemanticShadow, dbPutSemanticShadow, dbRecordLlmCacheEvent, flushDbToDisk, isDbReady } from '@/db';

export interface SemanticShadowMetrics { checks: number; candidates: number; highConfidence: number; mediumConfidence: number; stores: number; errors: number; bestSimilarity: number }
const metrics: SemanticShadowMetrics = { checks: 0, candidates: 0, highConfidence: 0, mediumConfidence: 0, stores: 0, errors: 0, bestSimilarity: 0 };
export function getSemanticShadowMetrics(): SemanticShadowMetrics { return { ...metrics }; }
export function resetSemanticShadowMetrics(): void { Object.keys(metrics).forEach((key) => { metrics[key as keyof SemanticShadowMetrics] = 0; }); }

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return -1;
  let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2; }
  return a && b ? dot / Math.sqrt(a * b) : -1;
}

export interface SemanticShadowContext { key: string; namespace: string; model: string; prompt: string; vector: number[]; bestSimilarity: number }
export async function evaluateSemanticShadow(input: {
  key: string; namespace: string; model: string; prompt: string; embed: (text: string) => Promise<number[]>;
}): Promise<SemanticShadowContext | null> {
  metrics.checks += 1;
  try {
    const vector = await input.embed(input.prompt);
    if (!vector.length) return null;
    const candidates = isDbReady() ? dbListSemanticShadow(input.namespace, input.model) : [];
    const bestSimilarity = candidates.reduce((best, entry) => Math.max(best, cosine(vector, entry.vector)), -1);
    if (bestSimilarity >= 0.94) metrics.candidates += 1;
    if (bestSimilarity >= 0.97) metrics.highConfidence += 1;
    else if (bestSimilarity >= 0.94) metrics.mediumConfidence += 1;
    dbRecordLlmCacheEvent(bestSimilarity >= 0.97 ? 'shadow_high' : bestSimilarity >= 0.94 ? 'shadow_medium' : 'shadow_none', input.namespace, input.model, Math.max(0, bestSimilarity));
    metrics.bestSimilarity = Math.max(metrics.bestSimilarity, bestSimilarity);
    return { ...input, vector, bestSimilarity };
  } catch { metrics.errors += 1; return null; }
}

export function storeSemanticShadow(context: SemanticShadowContext | null, response: string, maxEntries = 5000): void {
  if (!context || !response.trim() || !isDbReady()) return;
  try {
    dbPutSemanticShadow({ key: context.key, namespace: context.namespace, model: context.model, prompt: context.prompt, response, vector: context.vector, createdAt: Date.now() }, maxEntries);
    metrics.stores += 1; void flushDbToDisk();
  } catch { metrics.errors += 1; }
}
