/**
 * GitHub 搜索 provider（公共 API，无需 key）
 * - 端点：https://api.github.com/search/issues?q=...&type=Issues
 *        https://api.github.com/search/repositories?q=...
 * - 适合"代码 / Issue"垂直搜索
 */
import type { SearchProvider, SearchQuery, SearchResult } from '../types';
import { fetchJson, makeResult } from './_shared';

interface GhSearchResponse {
  total_count: number;
  items: Array<{
    html_url: string;
    title: string;
    body?: string | null;
    created_at: string;
    repository_url?: string;
    full_name?: string;
    description?: string | null;
  }>;
}

export const githubProvider: SearchProvider = {
  id: 'github',
  name: 'GitHub',
  capabilities: { web: true, images: false, news: false, code: true, suggestions: false },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    try {
      const issues = await fetchJson<GhSearchResponse>(
        `https://api.github.com/search/issues?q=${encodeURIComponent(query.text)}&per_page=${Math.min(query.perPage, 30)}`,
        signal,
        { headers: { Accept: 'application/vnd.github+json' } },
      );
      for (const it of issues.items || []) {
        all.push(makeResult({
          title: it.title,
          url: it.html_url,
          snippet: (it.body || '').slice(0, 240),
          publishedAt: Date.parse(it.created_at) || null,
          score: 0.7,
          source: 'github',
        }));
      }
    } catch { /* ignore issues failures */ }

    try {
      const repos = await fetchJson<GhSearchResponse>(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query.text)}&per_page=${Math.min(query.perPage, 15)}`,
        signal,
        { headers: { Accept: 'application/vnd.github+json' } },
      );
      for (const r of repos.items || []) {
        all.push(makeResult({
          title: r.full_name || r.title,
          url: r.html_url,
          snippet: (r.description || '').slice(0, 240),
          publishedAt: Date.parse(r.created_at) || null,
          score: 0.65,
          source: 'github',
        }));
      }
    } catch { /* ignore repo failures */ }

    return all.slice(0, query.perPage);
  },
};
