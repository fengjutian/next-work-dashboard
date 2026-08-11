/** Bing Web Search — 无 API key 的公开结果页解析。 */
import type { SearchProvider, SearchQuery, SearchResult } from '../../types';
import { DOMParser, fetchHtml, makeResult } from './_shared';

export const bingProvider: SearchProvider = {
  id: 'bing',
  name: 'Bing',
  capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query.text)}&count=${query.perPage}&setlang=${encodeURIComponent(query.locale || 'zh-CN')}&safeSearch=${query.safeSearch ? 'Strict' : 'Off'}`;
    const doc = new DOMParser().parseFromString(await fetchHtml(url, signal), 'text/html');
    const items = (doc as any).getElementsByTagName('li') || [];
    const results: SearchResult[] = [];
    for (let i = 0; i < items.length && results.length < query.perPage; i++) {
      const item = items[i];
      if (!hasClass(item, 'b_algo')) continue;
      const headings = item.getElementsByTagName?.('h2') || [];
      const anchor = headings[0]?.getElementsByTagName?.('a')?.[0];
      const href = anchor?.getAttribute?.('href') || '';
      const title = textOf(anchor);
      if (!title || !/^https?:\/\//i.test(href)) continue;
      const paragraphs = item.getElementsByTagName?.('p') || [];
      results.push(makeResult({ title, url: href, snippet: textOf(paragraphs[0]), source: 'bing' }));
    }
    return results;
  },
};

function hasClass(node: any, name: string): boolean {
  return String(node?.getAttribute?.('class') || '').split(/\s+/).includes(name);
}

function textOf(node: any): string {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
}
