import type { DocumentChunk, RetrievalHit } from './types';

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0; let a = 0; let b = 0;
  for (let i = 0; i < left.length; i += 1) { dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

export function retrieve(chunks: DocumentChunk[], vector: number[], limit = 5): RetrievalHit[] {
  return chunks.map((chunk) => ({ ...chunk, score: cosineSimilarity(chunk.vector, vector) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

export function buildRagContext(hits: RetrievalHit[]): string {
  return hits.map((hit, index) =>
    `[资料 ${index + 1}] ${hit.documentName} / ${hit.sectionTitle}${hit.page ? ` / 第 ${hit.page} 页` : ''}\n${hit.content}`
  ).join('\n\n');
}
