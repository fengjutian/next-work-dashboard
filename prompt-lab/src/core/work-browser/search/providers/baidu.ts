/** 百度网页搜索 — 默认中文搜索源。 */
import type { SearchProvider, SearchQuery, SearchResult } from '../../types';
import { DOMParser, fetchHtml, makeResult } from './_shared';

export const baiduProvider: SearchProvider = {
  id: 'baidu',
  name: '百度',
  capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query.text)}&rn=${query.perPage}&ie=utf-8`;
    const doc = new DOMParser().parseFromString(await fetchHtml(url, signal, {
      headers: { Referer: 'https://www.baidu.com/' },
    }), 'text/html');
    const nodes = (doc as any).getElementsByTagName('div') || [];
    const results: SearchResult[] = [];
    for (let i = 0; i < nodes.length && results.length < query.perPage; i++) {
      const node = nodes[i];
      const cls = String(node.getAttribute?.('class') || '');
      if (!/(^|\s)(result|c-container)(\s|$)/.test(cls)) continue;
      const headings = node.getElementsByTagName?.('h3') || [];
      const anchor = headings[0]?.getElementsByTagName?.('a')?.[0];
      const redirectUrl = anchor?.getAttribute?.('href') || '';
      const sourceUrl = node.getAttribute?.('mu') || redirectUrl;
      const title = textOf(anchor);
      if (!title || !/^https?:\/\//i.test(sourceUrl)) continue;
      const snippet = findTextByClass(node, /c-abstract|content-right|c-span-last/) || textOf(node).replace(title, '').slice(0, 260);
      results.push(makeResult({ title, url: sourceUrl, snippet, source: 'baidu' }));
    }
    return results;
  },
};

function findTextByClass(root: any, pattern: RegExp): string {
  const divs = root.getElementsByTagName?.('div') || [];
  for (let i = 0; i < divs.length; i++) {
    if (pattern.test(String(divs[i].getAttribute?.('class') || ''))) {
      const text = textOf(divs[i]);
      if (text.length > 12) return text.slice(0, 260);
    }
  }
  return '';
}

function textOf(node: any): string {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
}
