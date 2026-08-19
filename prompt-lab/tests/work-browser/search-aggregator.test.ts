/**
 * Search aggregator — 并行调度 + 去重 + 排序
 */
import { describe, it, expect } from 'vitest';
import { aggregateSearch } from '@/core/work-browser/search/aggregator';
import { dedupeResults } from '@/core/work-browser/search/dedup';
import { rankResults } from '@/core/work-browser/search/rank';
import type { SearchProvider, SearchQuery, SearchResult } from '@/core/work-browser/types';
import { BUILTIN_PROVIDERS } from '@/core/work-browser/search/providers';

function mkResult(over: Partial<SearchResult> & { source: string; url: string; title: string }): SearchResult {
  return {
    id: `${over.source}-${over.url}`,
    canonicalUrl: over.url,
    snippet: '',
    domain: '',
    publishedAt: null,
    score: 0.5,
    contentHash: '',
    ...over,
  } as SearchResult;
}

const baseQuery: SearchQuery = { text: 'clickhouse memory', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 20 };

describe('built-in providers', () => {
  it('enables Bing, Baidu and Google by default', () => {
    expect(BUILTIN_PROVIDERS.slice(0, 3).map((provider) => provider.id)).toEqual(['bing', 'baidu', 'google']);
  });
});

describe('dedupeResults', () => {
  it('merges same canonicalUrl from different providers', () => {
    const results = [
      mkResult({ source: 'google', url: 'https://a.com/p', title: 'Title A' }),
      mkResult({ source: 'bing', url: 'https://a.com/p', title: 'Title A' }),
    ];
    const out = dedupeResults(results);
    expect(out).toHaveLength(1);
    expect(out[0].source).toContain('google');
    expect(out[0].source).toContain('bing');
  });

  it('keeps distinct results', () => {
    const results = [
      mkResult({ source: 'google', url: 'https://a.com/p1', title: 'A' }),
      mkResult({ source: 'google', url: 'https://a.com/p2', title: 'B' }),
    ];
    const out = dedupeResults(results);
    expect(out).toHaveLength(2);
  });
});

describe('rankResults', () => {
  it('promotes trusted domains', () => {
    const results = [
      mkResult({ source: 'duckduckgo', url: 'https://example.com/p', title: 'A', score: 0.5, domain: 'example.com' }),
      mkResult({ source: 'duckduckgo', url: 'https://github.com/p', title: 'B', score: 0.5, domain: 'github.com' }),
    ];
    const ranked = rankResults(results);
    expect(ranked[0].domain).toBe('github.com');
  });

  it('boosts multi-source hits', () => {
    const r1 = mkResult({ source: 'google · bing', url: 'https://a.com', title: 'X', score: 0.5 });
    const r2 = mkResult({ source: 'duckduckgo', url: 'https://b.com', title: 'Y', score: 0.5 });
    const ranked = rankResults([r2, r1]);
    expect(ranked[0].canonicalUrl).toBe('https://a.com');
  });
});

describe('aggregateSearch', () => {
  it('runs providers in parallel and aggregates', async () => {
    const delays = [50, 30, 10];
    const providers: SearchProvider[] = delays.map((d, i) => ({
      id: `p${i}`,
      name: `Provider ${i}`,
      capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
      async search(q) {
        await new Promise((r) => setTimeout(r, d));
        return [mkResult({ source: `p${i}`, url: `https://p${i}.com/x`, title: `R${i}` })];
      },
    }));
    const r = await aggregateSearch(providers, baseQuery, { timeoutMs: 200, concurrency: 3 });
    expect(r.results).toHaveLength(3);
    expect(r.providers.every((p) => p.ok)).toBe(true);
  });

  it('survives single provider failure', async () => {
    const providers: SearchProvider[] = [
      {
        id: 'ok', name: 'ok', capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
        async search() { return [mkResult({ source: 'ok', url: 'https://ok.com', title: 'OK' })]; },
      },
      {
        id: 'fail', name: 'fail', capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
        async search() { throw new Error('boom'); },
      },
    ];
    const r = await aggregateSearch(providers, baseQuery, { timeoutMs: 200, concurrency: 2 });
    expect(r.results).toHaveLength(1);
    expect(r.providers.find((p) => p.providerId === 'fail')?.ok).toBe(false);
  });

  it('times out a provider even when it ignores AbortSignal', async () => {
    const providers: SearchProvider[] = [{
      id: 'hung', name: 'hung', capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
      async search() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return [];
      },
    }];
    const started = Date.now();
    const result = await aggregateSearch(providers, baseQuery, { timeoutMs: 20, concurrency: 1 });
    expect(Date.now() - started).toBeLessThan(150);
    expect(result.providers[0]).toMatchObject({ providerId: 'hung', ok: false, error: 'PROVIDER_TIMEOUT:hung' });
  });

  it('dedupes across providers in final result', async () => {
    const providers: SearchProvider[] = [
      {
        id: 'a', name: 'A', capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
        async search() { return [mkResult({ source: 'a', url: 'https://same.com', title: 'Same' })]; },
      },
      {
        id: 'b', name: 'B', capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
        async search() { return [mkResult({ source: 'b', url: 'https://same.com', title: 'Same' })]; },
      },
    ];
    const r = await aggregateSearch(providers, baseQuery, { timeoutMs: 200, concurrency: 2 });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].source).toContain('a');
    expect(r.results[0].source).toContain('b');
  });
});
