import { ipcMain } from 'electron';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseRssFeed } from './rss-parser';
import { loadRssState, saveRssState } from './rss-database';
import type { RssArticle, RssSubscription } from '../types';

const MAX_FEED_BYTES = 5 * 1024 * 1024;

function privateAddress(address: string): boolean {
  if (address === '::1' || address === '::' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb')) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function safeHttpUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP/HTTPS 订阅地址');
  if (url.username || url.password) throw new Error('订阅地址不能包含用户名或密码');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('已阻止本机订阅地址');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error('已阻止内网或特殊用途地址');
  return url;
}

async function fetchSafely(rawUrl: string): Promise<{ response: Response; url: URL }> {
  let url = await safeHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 'User-Agent': 'next-work-dashboard/0.2 RSS Reader' } });
    if (response.status < 300 || response.status >= 400) return { response, url };
    const location = response.headers.get('location');
    if (!location) throw new Error('订阅源返回了无效重定向');
    url = await safeHttpUrl(new URL(location, url).toString());
  }
  throw new Error('订阅源重定向次数过多');
}

export function registerRssIpc(): void {
  ipcMain.handle('rss:fetch', async (_event, rawUrl: string) => {
    const { response, url } = await fetchSafely(rawUrl.trim());
    if (!response.ok) throw new Error(`订阅源请求失败（HTTP ${response.status}）`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_FEED_BYTES) throw new Error('订阅源超过 5 MB 限制');
    const xml = await response.text();
    if (xml.length > MAX_FEED_BYTES) throw new Error('订阅源超过 5 MB 限制');
    return parseRssFeed(xml, url.toString());
  });
  ipcMain.handle('rss:state:load', () => loadRssState());
  ipcMain.handle('rss:state:save', (_event, state: { subscriptions: RssSubscription[]; articles: RssArticle[] }) => saveRssState(state));
}
