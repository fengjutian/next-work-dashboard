/**
 * 排序
 *
 * 评分构成（默认权重）：
 *  - 各 provider 自带 score（0–1）
 *  - 域名权威性：常见权威域加分（github.com / stackoverflow.com / mozilla.org ...）
 *  - 多源命中：同一条结果被多个引擎返回时加分
 *  - 时效：publishedAt 越近越加分（< 30 天满分）
 */
import type { SearchResult } from '../types';

const TRUSTED_DOMAINS = new Set([
  'github.com', 'stackoverflow.com', 'stackexchange.com',
  'developer.mozilla.org', 'w3.org', 'wikipedia.org',
  'arxiv.org', 'semanticscholar.org',
  'docs.microsoft.com', 'learn.microsoft.com', 'cloud.google.com',
  'aws.amazon.com', 'reactjs.org', 'vuejs.org', 'typescriptlang.org',
  'nodejs.org', 'python.org', 'rust-lang.org',
  'react.dev', 'nextjs.org',
]);

const SOURCE_PRIORITY: Record<string, number> = {
  google: 1.0,
  bing: 0.95,
  brave: 0.95,
  duckduckgo: 0.9,
  github: 0.92,
  stackoverflow: 0.9,
  mdn: 0.9,
  wikipedia: 0.85,
};

export function rankResults(results: SearchResult[]): SearchResult[] {
  const now = Date.now();
  return [...results]
    .map((r) => {
      const sourceCount = r.source.split('·').map((s) => s.trim()).filter(Boolean).length;
      const base = (r.score || 0.5) * (SOURCE_PRIORITY[r.source.split('·')[0]?.trim() || ''] ?? 0.85);
      const trust = TRUSTED_DOMAINS.has(r.domain) ? 0.1 : 0;
      const multi = Math.min(0.1, (sourceCount - 1) * 0.05);
      const fresh = r.publishedAt
        ? Math.max(0, 0.1 * (1 - (now - r.publishedAt) / (30 * 24 * 3600 * 1000)))
        : 0;
      return { ...r, score: Math.min(1, base + trust + multi + fresh) };
    })
    .sort((a, b) => b.score - a.score);
}
