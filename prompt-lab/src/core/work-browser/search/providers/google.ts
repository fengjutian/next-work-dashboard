/** Google Web Search — 无 API key 的公开结果页解析。 */
import type { SearchProvider, SearchQuery, SearchResult } from '../../types';
import { DOMParser, fetchHtml, makeResult } from './_shared';

export const googleProvider: SearchProvider = {
  id: 'google',
  name: 'Google',
  capabilities: { web: true, images: false, news: false, code: false, suggestions: false },
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query.text)}&num=${query.perPage}&hl=${encodeURIComponent(query.locale || 'zh-CN')}&safe=${query.safeSearch ? 'active' : 'off'}&filter=0`;
    const doc = new DOMParser().parseFromString(await fetchHtml(url, signal), 'text/html');
    const headings = (doc as any).getElementsByTagName('h3') || [];
    const results: SearchResult[] = [];
    for (let i = 0; i < headings.length && results.length < query.perPage; i++) {
      const heading = headings[i];
      const anchor = closestAnchor(heading);
      const href = unwrapGoogleUrl(anchor?.getAttribute?.('href') || '');
      const title = textOf(heading);
      if (!title || !/^https?:\/\//i.test(href) || /(^|\.)google\./i.test(safeHost(href))) continue;
      const container = findResultContainer(anchor);
      const snippet = findTextByClass(container, /VwiC3b|aCOpRe|IsZvec/) || '';
      results.push(makeResult({ title, url: href, snippet, source: 'google' }));
    }
    return results;
  },
};

function closestAnchor(node: any): any {
  let current = node?.parentNode;
  for (let i = 0; current && i < 4; i++, current = current.parentNode) {
    if (String(current.nodeName || '').toLowerCase() === 'a') return current;
  }
  return null;
}

function findResultContainer(node: any): any {
  let current = node;
  for (let i = 0; current && i < 7; i++, current = current.parentNode) {
    const cls = String(current.getAttribute?.('class') || '');
    if (/(^|\s)(g|MjjYud|tF2Cxc)(\s|$)/.test(cls)) return current;
  }
  return node?.parentNode;
}

function findTextByClass(root: any, pattern: RegExp): string {
  const divs = root?.getElementsByTagName?.('div') || [];
  for (let i = 0; i < divs.length; i++) {
    if (pattern.test(String(divs[i].getAttribute?.('class') || ''))) {
      const text = textOf(divs[i]);
      if (text) return text.slice(0, 260);
    }
  }
  return '';
}

function unwrapGoogleUrl(raw: string): string {
  if (!raw.startsWith('/url?')) return raw;
  try { return new URL(raw, 'https://www.google.com').searchParams.get('q') || raw; } catch { return raw; }
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function textOf(node: any): string {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
}
