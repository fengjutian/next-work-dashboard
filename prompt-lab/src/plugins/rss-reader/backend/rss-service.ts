import { ipcMain } from 'electron';
import { parseRssFeed } from './rss-parser';

const MAX_FEED_BYTES = 5 * 1024 * 1024;

function safeHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP/HTTPS 订阅地址');
  return url;
}

export function registerRssIpc(): void {
  ipcMain.handle('rss:fetch', async (_event, rawUrl: string) => {
    const url = safeHttpUrl(rawUrl.trim());
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 'User-Agent': 'next-work-dashboard/0.2 RSS Reader' },
    });
    if (!response.ok) throw new Error(`订阅源请求失败（HTTP ${response.status}）`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_FEED_BYTES) throw new Error('订阅源超过 5 MB 限制');
    const xml = await response.text();
    if (xml.length > MAX_FEED_BYTES) throw new Error('订阅源超过 5 MB 限制');
    return parseRssFeed(xml, url.toString());
  });
}

