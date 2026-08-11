/**
 * Brave Search provider
 * - 端点：https://search.brave.com/search?q=...
 * - 公共页面可访问，但可能触发反爬；尽量带 UA
 * - 解析搜索结果列表
 */
import type { SearchProvider, SearchQuery, SearchResult } from '../../types';
import { fetchHtml, DOMParser, makeResult } from './_shared';

export const braveProvider: SearchProvider = {
  id: 'brave',
  name: 'Brave',
  capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query.text)}&source=web`;
    const html = await fetchHtml(url, signal);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results: SearchResult[] = [];

    const anchors = (doc as any).getElementsByTagName('a') || [];
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const cls = (a.getAttribute('class') || '') + ' ' + (a.getAttribute('id') || '');
      if (!/snippet/i.test(cls) && !/result/i.test(cls)) continue;
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//.test(href)) continue;
      const titleEl = a.getElementsByTagName?.('div')?.[0];
      const title = (titleEl?.textContent || a.textContent || '').trim();
      if (title.length < 4) continue;
      // 摘要：取父节点 text
      const parent = a.parentNode;
      const snippet = parent ? (parent.textContent || '').replace(title, '').trim().slice(0, 240) : '';
      results.push(makeResult({ title, url: href, snippet, source: 'brave' }));
      if (results.length >= query.perPage) break;
    }
    return results;
  },
};
