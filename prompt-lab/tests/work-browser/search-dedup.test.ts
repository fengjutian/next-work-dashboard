/**
 * dedup / rank 边界用例
 */
import { describe, it, expect } from 'vitest';
import { dedupeResults } from '@/core/work-browser/search/dedup';
import type { SearchResult } from '@/core/work-browser/types';

function mk(p: Partial<SearchResult> & Pick<SearchResult, 'url' | 'title' | 'source' | 'domain'>): SearchResult {
  return {
    id: '', canonicalUrl: p.url, snippet: '', publishedAt: null, score: 0.5, contentHash: '',
    ...p,
  } as SearchResult;
}

describe('dedupeResults - 标题相似度兜底', () => {
  it('标题 80% 相似 → 合并', () => {
    const a = mk({ url: 'https://a.com/1', domain: 'a.com', title: 'ClickHouse Memory Optimization Guide', source: 'google' });
    const b = mk({ url: 'https://a.com/2', domain: 'a.com', title: 'ClickHouse Memory Optimization 指南', source: 'bing' });
    const out = dedupeResults([a, b]);
    expect(out).toHaveLength(1);
  });

  it('strictUrl=true 时只按 URL 去重', () => {
    const a = mk({ url: 'https://a.com/1', domain: 'a.com', title: 'AAA', source: 'google' });
    const b = mk({ url: 'https://a.com/2', domain: 'a.com', title: 'AAA', source: 'bing' });
    const out = dedupeResults([a, b], { strictUrl: true });
    expect(out).toHaveLength(2);
  });

  it('不同 domain 不会被合并', () => {
    const a = mk({ url: 'https://a.com/1', domain: 'a.com', title: 'Same Title', source: 'google' });
    const b = mk({ url: 'https://b.com/1', domain: 'b.com', title: 'Same Title', source: 'bing' });
    const out = dedupeResults([a, b]);
    expect(out).toHaveLength(2);
  });
});
