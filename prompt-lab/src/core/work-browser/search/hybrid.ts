/**
 * 混合检索 — BM25 (FTS5) + Vector (Lance) 双路召回 + Reranker
 *
 * 算法：
 *  1. 两条路并行：FTS5 走 SQLite，Vector 走 Lance cosine 距离
 *  2. 用 RRF (Reciprocal Rank Fusion) 合并：
 *      score = Σ 1 / (k + rank_i)
 *      k 默认为 60（论文推荐值）
 *  3. 取 top-K，按 score 降序
 *
 * 数据流：
 *   query → embedder.embed(query) → lance vector search
 *         → searchLocal(query)    → FTS5 BM25
 *         → fuse(results1, results2) → final top-k
 */
import type Database from 'better-sqlite3';
import type { SearchResult, SearchQuery } from '../types';
import { searchLocal, type LocalSearchOptions } from './local';
import { contentFingerprint, canonicalizeUrl } from './provider';

export interface HybridSearchInput {
  query: SearchQuery;
  db: Database.Database;
  /** Lance 检索接口（main 端注入，core 不依赖 lance） */
  vectorSearch: (vector: number[], modelId: string, limit: number) => Promise<Array<{ id: string; distance: number; documentId?: string; content?: string; sectionTitle?: string; page?: number }>>;
  /** Embedding 模型（懒加载） */
  embedder: (text: string) => Promise<{ vector: number[]; model: string }>;
  localOptions: LocalSearchOptions;
  modelId: string;
  topK?: number;
  rrfK?: number;
}

export interface HybridChunk {
  documentId: string;
  chunkId: string;
  content: string;
  sectionTitle: string | null;
  page: number;
  distance: number;
  bm25Rank: number | null;
  vectorRank: number | null;
  fusedScore: number;
  /** 关联 document metadata（来自 SQLite） */
  documentTitle?: string;
  documentUrl?: string;
  workspaceId?: string;
}

/**
 * 双路召回 + RRF 融合
 */
export async function hybridSearch(input: HybridSearchInput): Promise<HybridChunk[]> {
  const { query, db, vectorSearch, embedder, localOptions, modelId, topK = 10, rrfK = 60 } = input;
  if (!query.text.trim()) return [];

  // 并行：FTS5 + Embedding
  const [, emb] = await Promise.all([
    Promise.resolve().then(() => searchLocal(db, query, localOptions)),
    embedder(query.text).catch((e) => {
      console.warn('[work-browser] embedder failed, vector search skipped:', e);
      return { vector: [], model: modelId };
    }),
  ]);

  // BM25 召回
  const bm25Results = searchLocal(db, query, localOptions);

  // Vector 召回
  let vectorRaw: Awaited<ReturnType<typeof vectorSearch>> = [];
  if (emb.vector.length) {
    try {
      vectorRaw = await vectorSearch(emb.vector, emb.model, topK * 2);
    } catch (e) {
      console.warn('[work-browser] vector search failed:', e);
    }
  }

  // 关联 document metadata（从 SQLite 拿）
  const docMetaCache = new Map<string, { title: string; url: string; workspaceId: string }>();
  const getDocMeta = (docId: string) => {
    if (docMetaCache.has(docId)) return docMetaCache.get(docId)!;
    const row = db.prepare('SELECT id, title, url, workspace_id FROM documents WHERE id = ?').get(docId) as any;
    if (!row) return null;
    const meta = { title: row.title, url: row.url, workspaceId: row.workspace_id };
    docMetaCache.set(docId, meta);
    return meta;
  };

  // 把 BM25 results 转成 hybrid entries
  const byChunkId = new Map<string, HybridChunk>();

  bm25Results.forEach((r, rank) => {
    // r.id 是 'local-{documentId}'，去掉前缀拿 documentId
    const documentId = r.id.replace(/^local-/, '');
    const chunkId = `${documentId}::bm25`; // bm25 不分 chunk，标一个虚拟 chunk
    const meta = getDocMeta(documentId);
    byChunkId.set(chunkId, {
      documentId,
      chunkId,
      content: r.snippet,
      sectionTitle: r.title,
      page: -1,
      distance: 0,
      bm25Rank: rank + 1,
      vectorRank: null,
      fusedScore: 0,
      documentTitle: meta?.title,
      documentUrl: meta?.url,
      workspaceId: meta?.workspaceId,
    });
  });

  // 把 vector results 转成 hybrid entries
  vectorRaw.forEach((m, rank) => {
    // m.id 形如 `{documentId}::{chunkIndex}`，documentId 可能在 RRF 之前已有
    const documentId = m.documentId || m.id.split('::')[0];
    const chunkKey = m.id;
    const meta = getDocMeta(documentId);
    const existing = byChunkId.get(chunkKey);
    if (existing) {
      existing.vectorRank = rank + 1;
      if (m.content) existing.content = m.content;
    } else {
      byChunkId.set(chunkKey, {
        documentId,
        chunkId: chunkKey,
        content: m.content || '',
        sectionTitle: m.sectionTitle || null,
        page: typeof m.page === 'number' ? m.page : -1,
        distance: m.distance,
        bm25Rank: null,
        vectorRank: rank + 1,
        fusedScore: 0,
        documentTitle: meta?.title,
        documentUrl: meta?.url,
        workspaceId: meta?.workspaceId,
      });
    }
  });

  // RRF 融合
  const fused: HybridChunk[] = [];
  byChunkId.forEach((c) => {
    const bm25Score = c.bm25Rank ? 1 / (rrfK + c.bm25Rank) : 0;
    const vectorScore = c.vectorRank ? 1 / (rrfK + c.vectorRank) : 0;
    c.fusedScore = bm25Score + vectorScore;
    fused.push(c);
  });
  fused.sort((a, b) => b.fusedScore - a.fusedScore);
  return fused.slice(0, topK);
}

/**
 * 把 HybridChunk 转成 SearchResult 格式（供 SearchResults UI 用）
 */
export function hybridToSearchResults(chunks: HybridChunk[]): SearchResult[] {
  return chunks.map((c) => {
    const url = c.documentUrl || `local://doc/${c.documentId}`;
    const canonical = canonicalizeUrl(url);
    let domain = '';
    try { domain = new URL(canonical).host; } catch { /* keep empty */ }
    return {
      id: `hybrid-${c.chunkId}`,
      url,
      canonicalUrl: canonical,
      title: c.documentTitle || c.sectionTitle || 'Local result',
      snippet: c.content.slice(0, 240),
      domain,
      source: 'local',
      publishedAt: null,
      score: c.fusedScore,
      contentHash: contentFingerprint(c.documentTitle || '', canonical, c.content),
      // 附加字段（HybridChunk 元数据）
      ...({
        documentId: c.documentId,
        workspaceId: c.workspaceId,
        sectionTitle: c.sectionTitle,
        page: c.page,
        bm25Rank: c.bm25Rank,
        vectorRank: c.vectorRank,
        distance: c.distance,
      } as any),
    } as SearchResult;
  });
}
