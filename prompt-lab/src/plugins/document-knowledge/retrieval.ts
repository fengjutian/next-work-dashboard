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

export interface RetrievalOptions {
  limit?: number;
  minScore?: number;
  maxPerDocument?: number;
  contextBudget?: number;
}

function normalizedContent(content: string): string { return content.replace(/\s+/g, ' ').trim().toLocaleLowerCase(); }

function inferredChunkIndex(hit: RetrievalHit): number | undefined {
  if (typeof hit.chunkIndex === 'number') return hit.chunkIndex;
  const value = Number(hit.id.split(':').at(-1));
  return Number.isInteger(value) ? value : undefined;
}

function joinOverlappingContent(left: string, right: string): string {
  const maxOverlap = Math.min(left.length, right.length, 500);
  for (let size = maxOverlap; size >= 20; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return `${left}${right.slice(size)}`;
  }
  return `${left}\n${right}`;
}

export function mergeAdjacentHits(hits: RetrievalHit[]): RetrievalHit[] {
  const groups = new Map<string, RetrievalHit[]>();
  for (const hit of hits) {
    const key = `${hit.documentId}\u0000${hit.sectionId}`;
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  const merged: RetrievalHit[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => (inferredChunkIndex(left) ?? Number.MAX_SAFE_INTEGER) - (inferredChunkIndex(right) ?? Number.MAX_SAFE_INTEGER));
    for (const hit of group) {
      const previous = merged.at(-1);
      const previousIndex = previous && inferredChunkIndex(previous);
      const currentIndex = inferredChunkIndex(hit);
      if (previous && previous.documentId === hit.documentId && previous.sectionId === hit.sectionId
        && previousIndex !== undefined && currentIndex === previousIndex + 1) {
        previous.content = joinOverlappingContent(previous.content, hit.content);
        previous.chunkIndex = currentIndex;
        previous.score = Math.max(previous.score, hit.score);
        previous.mergedChunkIds = [...(previous.mergedChunkIds ?? [previous.id]), ...(hit.mergedChunkIds ?? [hit.id])];
        previous.retrievalScores = {
          vector: Math.max(previous.retrievalScores?.vector ?? 0, hit.retrievalScores?.vector ?? 0) || undefined,
          lexical: Math.max(previous.retrievalScores?.lexical ?? 0, hit.retrievalScores?.lexical ?? 0) || undefined,
          fused: Math.max(previous.retrievalScores?.fused ?? 0, hit.retrievalScores?.fused ?? 0) || undefined,
        };
      } else merged.push({ ...hit });
    }
  }
  return merged.sort((left, right) => right.score - left.score);
}

export function prepareRetrievalHits(hits: RetrievalHit[], options: RetrievalOptions = {}): RetrievalHit[] {
  const limit = Math.max(1, options.limit ?? 5);
  const minScore = Math.max(0, options.minScore ?? 0);
  const maxPerDocument = Math.max(1, options.maxPerDocument ?? limit);
  const unique = new Map<string, RetrievalHit>();
  for (const hit of hits.filter((item) => item.score >= minScore).sort((left, right) => right.score - left.score)) {
    const key = normalizedContent(hit.content);
    if (!key || unique.has(key)) continue;
    unique.set(key, { ...hit });
  }
  const perDocument = new Map<string, number>();
  const diversified = mergeAdjacentHits([...unique.values()]).filter((hit) => {
    const count = perDocument.get(hit.documentId) ?? 0;
    if (count >= maxPerDocument) return false;
    perDocument.set(hit.documentId, count + 1);
    return true;
  }).slice(0, limit);
  const budget = Math.max(200, options.contextBudget ?? Number.MAX_SAFE_INTEGER);
  let remaining = budget;
  return diversified.flatMap((hit) => {
    if (remaining <= 0) return [];
    const headerReserve = 120;
    const allowed = Math.max(0, remaining - headerReserve);
    if (!allowed) return [];
    const content = hit.content.length <= allowed ? hit.content : `${hit.content.slice(0, Math.max(0, allowed - 12))}\n[片段已截断]`;
    remaining -= content.length + headerReserve;
    return [{ ...hit, content }];
  });
}

export function buildRagContext(hits: RetrievalHit[]): string {
  return hits.map((hit, index) =>
    `[资料 ${index + 1}] ${hit.documentName} / ${hit.sectionTitle}${hit.page ? ` / 第 ${hit.page} 页` : ''}\n${hit.content}`
  ).join('\n\n');
}
