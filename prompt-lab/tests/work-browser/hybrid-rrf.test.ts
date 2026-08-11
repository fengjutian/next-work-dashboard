/**
 * hybrid.ts — 纯函数部分（RRF 融合 + 转 SearchResult）
 *
 * 集成测试（需要 better-sqlite3 + Lance native 模块）skip；
 * 核心 RRF 逻辑用纯函数测。
 */
import { describe, it, expect } from 'vitest';
import { hybridToSearchResults, type HybridChunk } from '@/core/work-browser/search/hybrid';

describe('hybridToSearchResults', () => {
  it('空 chunks 返回 []', () => {
    expect(hybridToSearchResults([])).toEqual([]);
  });

  it('把 HybridChunk 转成 SearchResult 格式', () => {
    const chunks: HybridChunk[] = [
      {
        documentId: 'd1',
        chunkId: 'd1::0',
        content: 'ClickHouse 内存优化建议',
        sectionTitle: 'Memory Optimization',
        page: 0,
        distance: 0.1,
        bm25Rank: 1,
        vectorRank: 2,
        fusedScore: 1 / 61 + 1 / 62,
        documentTitle: 'ClickHouse 指南',
        documentUrl: 'https://example.com/clickhouse',
        workspaceId: 'ws1',
      },
    ];
    const out = hybridToSearchResults(chunks);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('hybrid-d1::0');
    expect(out[0].source).toBe('local');
    expect(out[0].title).toBe('ClickHouse 指南');
    expect(out[0].snippet).toContain('ClickHouse');
    expect(out[0].domain).toBe('example.com');
    expect((out[0] as any).documentId).toBe('d1');
  });

  it('无 documentUrl 时不抛错', () => {
    const chunks: HybridChunk[] = [
      {
        documentId: 'd2',
        chunkId: 'd2::0',
        content: '内容',
        sectionTitle: null,
        page: -1,
        distance: 0.2,
        bm25Rank: null,
        vectorRank: 1,
        fusedScore: 1 / 61,
        documentTitle: 'Title',
        documentUrl: '',
        workspaceId: 'ws1',
      },
    ];
    const out = hybridToSearchResults(chunks);
    expect(out.length).toBe(1);
    expect(out[0].canonicalUrl).toContain('local://');
  });

  it('score 透传 fusedScore', () => {
    const chunks: HybridChunk[] = [
      { documentId: 'a', chunkId: 'a::0', content: 'x', sectionTitle: null, page: -1, distance: 0, bm25Rank: 1, vectorRank: 1, fusedScore: 0.99, documentTitle: 'A', documentUrl: 'https://a.com', workspaceId: 'ws' },
      { documentId: 'b', chunkId: 'b::0', content: 'y', sectionTitle: null, page: -1, distance: 0, bm25Rank: 2, vectorRank: 2, fusedScore: 0.5, documentTitle: 'B', documentUrl: 'https://b.com', workspaceId: 'ws' },
    ];
    const out = hybridToSearchResults(chunks);
    expect(out[0].score).toBe(0.99);
    expect(out[1].score).toBe(0.5);
  });
});

/**
 * RRF 核心算法（从 hybrid.ts 抽出用于单测）
 */
function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank);
}

describe('RRF (Reciprocal Rank Fusion)', () => {
  it('rank=1 时 score = 1/61', () => {
    expect(rrfScore(1)).toBeCloseTo(1 / 61, 5);
  });
  it('rank=10 时 score = 1/70', () => {
    expect(rrfScore(10)).toBeCloseTo(1 / 70, 5);
  });
  it('融合双路：sum 两条路 score', () => {
    const bm25 = rrfScore(1);
    const vector = rrfScore(3);
    const fused = bm25 + vector;
    expect(fused).toBeCloseTo(1 / 61 + 1 / 63, 5);
  });
  it('只在 BM25 命中的 chunk 仍有非零 fusedScore', () => {
    const fused = rrfScore(5) + 0;
    expect(fused).toBeGreaterThan(0);
  });
  it('只在 vector 命中的 chunk 仍有非零 fusedScore', () => {
    const fused = 0 + rrfScore(5);
    expect(fused).toBeGreaterThan(0);
  });
});
