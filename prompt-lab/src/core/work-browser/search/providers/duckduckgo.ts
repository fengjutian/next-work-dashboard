/**
 * DuckDuckGo HTML 搜索 provider
 * - 端点：https://html.duckduckgo.com/html/?q=...
 * - 不需要 API key；适合 Phase 1 默认启用
 * - 解析 HTML 抽取标题/链接/摘要
 */
import type { SearchProvider, SearchQuery, SearchResult } from '../../types';
import { fetchHtml, DOMParser, makeResult } from './_shared';

export const duckduckgoProvider: SearchProvider = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  capabilities: { web: true, images: false, news: false, code: false, suggestions: true },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.text)}&kl=${encodeURIComponent(query.locale || 'us-en')}`;
    const html = await fetchHtml(url, signal);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results: SearchResult[] = [];
    // DDG HTML 端结果节点 .result
    const nodes = (doc as any).getElementsByTagName('a') || [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const cls = a.getAttribute('class') || '';
      const href = a.getAttribute('href') || '';
      if (!cls.includes('result__a')) continue;
      if (!href.startsWith('http')) continue;
      const title = (a.textContent || '').trim();
      const parent = a.parentNode;
      let snippet = '';
      if (parent) {
        const snipNode = (parent as any).getElementsByTagName?.('a')?.length
          ? (parent as any).getElementsByTagName('a')[0]
          : null;
        const result = (parent as any).parentNode;
        if (result) {
          const tds = result.getElementsByTagName('a');
          for (let j = 0; j < tds.length; j++) {
            const sib = tds[j].nextSibling;
            if (sib && sib.textContent && sib.textContent.length > 20) {
              snippet = sib.textContent.trim();
              break;
            }
          }
        }
        if (!snippet) snippet = (parent.textContent || '').replace(title, '').trim().slice(0, 240);
      }
      results.push(makeResult({ title, url: href, snippet, source: 'duckduckgo' }));
      if (results.length >= query.perPage) break;
    }
    return results;
  },
  async getSuggestions(q: string, signal: AbortSignal): Promise<string[]> {
    const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`;
    try {
      const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = (await res.json()) as Array<[string]>;
      return data.map((row) => row[0]).filter(Boolean).slice(0, 8);
    } catch {
      return [];
    }
  },
};
