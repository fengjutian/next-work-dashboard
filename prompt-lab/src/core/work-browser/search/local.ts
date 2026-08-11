/**
 * 本地 FTS5 全文搜索
 *
 * 特点：
 *  - 基于 SQLite FTS5（BM25 算法）
 *  - 支持 workspace / library 两种 scope
 *  - 返回 SearchResult 格式（与 search/aggregator 一致）
 */
import type Database from 'better-sqlite3';
import type { SearchResult, SearchQuery } from '../types';
import { contentFingerprint, canonicalizeUrl } from './provider';

export interface LocalSearchOptions {
  /** 'workspace' 限定当前 workspace；'library' 跨 workspace */
  scope: 'workspace' | 'library';
  workspaceId?: string;
  limit?: number;
  /** 高亮前缀/后缀 */
  highlight?: { open: string; close: string };
}

interface FtsRow {
  rowid: number;
  id: string;
  workspace_id: string;
  title: string;
  url: string;
  source_type: string;
  summary: string | null;
  updated_at: number;
  word_count: number;
  rank: number;
  snippet: string | null;
}

/**
 * 在 documents_fts 上跑 BM25 检索
 */
export function searchLocal(db: Database.Database, query: SearchQuery, options: LocalSearchOptions): SearchResult[] {
  const limit = options.limit ?? query.perPage ?? 20;
  if (!query.text.trim()) return [];

  // 转义 FTS5 查询词
  const ftsQuery = buildFtsQuery(query.text);
  if (!ftsQuery) return [];

  const whereScope = options.scope === 'workspace' && options.workspaceId
    ? `AND d.workspace_id = ?`
    : '';

  const scopeParam = options.scope === 'workspace' && options.workspaceId ? [options.workspaceId] : [];

  const sql = `
    SELECT d.rowid, d.id, d.workspace_id, d.title, d.url, d.source_type, d.summary, d.updated_at, d.word_count,
           bm25(documents_fts, 1.0, 1.0, 0.5) AS rank,
           snippet(documents_fts, 2, ?, ?, '…', 24) AS snippet
    FROM documents_fts
    JOIN documents d ON d.rowid = documents_fts.rowid
    WHERE documents_fts MATCH ?
    ${whereScope}
    ORDER BY rank
    LIMIT ?
  `;
  const highlight = options.highlight ?? { open: '<<', close: '>>' };
  const rows = db.prepare(sql).all(highlight.open, highlight.close, ftsQuery, ...scopeParam, limit) as FtsRow[];

  return rows.map((r) => {
    const canonical = canonicalizeUrl(r.url);
    let domain = '';
    try { domain = new URL(canonical).host; } catch { /* keep empty */ }
    const score = Math.max(0, 1 + r.rank); // bm25 rank 是负数，-1 ~ -∞ 表示越好
    return {
      id: `local-${r.id}`,
      url: r.url,
      canonicalUrl: canonical,
      title: r.title,
      snippet: (r.snippet || r.summary || '').slice(0, 240),
      domain,
      source: 'local',
      publishedAt: null,
      score,
      contentHash: contentFingerprint(r.title, canonical, r.summary || ''),
      // 额外字段（供 UI 区分）
      ...({ workspaceId: r.workspace_id, updatedAt: r.updated_at, wordCount: r.word_count, sourceType: r.source_type } as any),
    } as SearchResult;
  });
}

/**
 * 把自然语言转 FTS5 MATCH 表达式
 * - 用空格 / AND 分词
 * - 词尾加 * 作 prefix match
 * - 转义 FTS5 保留字符
 */
export function buildFtsQuery(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (!tokens.length) return '';
  return tokens.map((t) => `${t}*`).join(' AND ');
}
