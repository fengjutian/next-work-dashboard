import type { KnowledgeDocument, KnowledgeDocumentType } from './types';

export interface KnowledgeSearchInput {
  document: KnowledgeDocument;
  content: string;
}

export interface KnowledgeSearchFilters {
  types?: KnowledgeDocumentType[];
  tags?: string[];
  pathPrefix?: string;
}

export interface KnowledgeSearchHit {
  uri: string;
  path: string;
  title: string;
  type: KnowledgeDocumentType;
  tags: string[];
  score: number;
  snippets: Array<{ line: number; endLine: number; text: string; score: number }>;
}

interface KnowledgeChunk {
  uri: string;
  path: string;
  title: string;
  type: KnowledgeDocumentType;
  tags: string[];
  line: number;
  endLine: number;
  text: string;
  terms: Record<string, number>;
  length: number;
  norm: number;
}

const MAX_CHUNK_CHARS = 900;
const CHUNK_OVERLAP_LINES = 2;

function terms(text: string): string[] {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const result: string[] = normalized.match(/[a-z0-9_.-]{2,}/g) ?? [];
  const chinese = normalized.replace(/[^\u3400-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) result.push(chinese.slice(index, index + 2));
  return result;
}

function vectorize(text: string): { vector: Record<string, number>; length: number; norm: number } {
  const vector: Record<string, number> = {};
  const tokens = terms(text);
  tokens.forEach((token) => { vector[token] = (vector[token] ?? 0) + 1; });
  return { vector, length: tokens.length, norm: Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0)) };
}

function cosine(a: Record<string, number>, aNorm: number, b: Record<string, number>, bNorm: number): number {
  if (!aNorm || !bNorm) return 0;
  const [small, large] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  let dot = 0;
  Object.entries(small).forEach(([key, value]) => { dot += value * (large[key] ?? 0); });
  return dot / (aNorm * bNorm);
}

export function splitKnowledgeDocument(input: KnowledgeSearchInput): KnowledgeChunk[] {
  const lines = input.content.split(/\r?\n/);
  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && (size + lines[end].length <= MAX_CHUNK_CHARS || end === start)) {
      size += lines[end].length + 1;
      end += 1;
      if (end < lines.length && /^#{1,6}\s+/.test(lines[end]) && size > 180) break;
    }
    const text = lines.slice(start, end).join('\n').trim();
    if (text) {
      const weighted = `${input.document.title} ${input.document.tags.join(' ')} ${text}`;
      const { vector, length, norm } = vectorize(weighted);
      chunks.push({
        uri: input.document.uri, path: input.document.path, title: input.document.title,
        type: input.document.type, tags: input.document.tags, line: start + 1, endLine: end,
        text, terms: vector, length, norm,
      });
    }
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_LINES);
  }
  return chunks;
}

export class KnowledgeSearchIndex {
  private chunks: KnowledgeChunk[] = [];

  replace(inputs: KnowledgeSearchInput[]): void {
    this.chunks = inputs.flatMap(splitKnowledgeDocument);
  }

  get size(): number { return this.chunks.length; }

  search(query: string, limit = 20, filters: KnowledgeSearchFilters = {}): KnowledgeSearchHit[] {
    const queryText = query.trim();
    if (!queryText) return [];
    const queryVector = vectorize(queryText);
    const candidates = this.chunks.filter((chunk) => {
      if (filters.types?.length && !filters.types.includes(chunk.type)) return false;
      if (filters.tags?.length && !filters.tags.every((tag) => chunk.tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase()))) return false;
      if (filters.pathPrefix && !chunk.path.toLocaleLowerCase().startsWith(filters.pathPrefix.replace(/\\/g, '/').toLocaleLowerCase())) return false;
      return true;
    });
    if (!candidates.length) return [];
    const queryTerms = [...new Set(terms(queryText))];
    const averageLength = candidates.reduce((sum, chunk) => sum + chunk.length, 0) / candidates.length;
    const frequencies = Object.fromEntries(queryTerms.map((term) => [term, candidates.filter((chunk) => chunk.terms[term]).length]));
    const scored = candidates.map((chunk) => {
      let bm25 = 0;
      for (const term of queryTerms) {
        const frequency = chunk.terms[term] ?? 0;
        if (!frequency) continue;
        const idf = Math.log(1 + (candidates.length - frequencies[term] + 0.5) / (frequencies[term] + 0.5));
        bm25 += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * chunk.length / Math.max(1, averageLength)));
      }
      const sparse = cosine(queryVector.vector, queryVector.norm, chunk.terms, chunk.norm);
      const normalizedQuery = queryText.toLocaleLowerCase();
      const titleBoost = chunk.title.toLocaleLowerCase().includes(normalizedQuery) ? 0.35 : 0;
      const score = (bm25 / (bm25 + 3)) * 0.6 + sparse * 0.4 + titleBoost;
      return { chunk, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

    const grouped = new Map<string, KnowledgeSearchHit>();
    for (const { chunk, score } of scored) {
      const existing = grouped.get(chunk.uri);
      const snippet = { line: chunk.line, endLine: chunk.endLine, text: chunk.text.slice(0, 500), score };
      if (existing) {
        if (existing.snippets.length < 3) existing.snippets.push(snippet);
        existing.score = Math.max(existing.score, score) + Math.min(score, 0.2) * 0.15;
      } else grouped.set(chunk.uri, {
        uri: chunk.uri, path: chunk.path, title: chunk.title, type: chunk.type, tags: chunk.tags,
        score, snippets: [snippet],
      });
    }
    return [...grouped.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(100, limit)));
  }
}
