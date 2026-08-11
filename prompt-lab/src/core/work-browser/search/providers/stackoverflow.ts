/**
 * StackOverflow provider（公共 API，无需 key）
 * - 端点：https://api.stackexchange.com/2.3/search/advanced?q=...&site=stackoverflow
 */
import type { SearchProvider, SearchQuery, SearchResult } from '../types';
import { fetchJson, makeResult } from './_shared';

interface SoResponse {
  items: Array<{
    title: string;
    link: string;
    excerpt?: string;
    creation_date?: number;
    score?: number;
  }>;
}

export const stackoverflowProvider: SearchProvider = {
  id: 'stackoverflow',
  name: 'StackOverflow',
  capabilities: { web: true, images: false, news: false, code: true, suggestions: false },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query.text)}&site=stackoverflow&pagesize=${Math.min(query.perPage, 30)}`;
    const res = await fetchJson<SoResponse>(url, signal);
    return (res.items || []).map((it) =>
      makeResult({
        title: it.title.replace(/<[^>]+>/g, ''),
        url: it.link,
        snippet: (it.excerpt || '').replace(/<[^>]+>/g, ''),
        publishedAt: it.creation_date ? it.creation_date * 1000 : null,
        score: it.score ? Math.min(1, it.score / 100 + 0.5) : 0.6,
        source: 'stackoverflow',
      }),
    );
  },
};
