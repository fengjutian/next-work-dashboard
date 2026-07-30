import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// favicon 缓存：host → base64 data URL
const faviconCache = new Map<string, string>();

// 内置 favicon URL — 对已知站点直接使用官方图标，跳过 HTML 解析
const BUILTIN_FAVICON_URLS: Record<string, string> = {
  'gemini.google.com': 'https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg',
};

function httpGet(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      urlStr,
      { timeout: 5000, headers: { 'User-Agent': 'next-work-dashboard/1.0' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          httpGet(redirectUrl).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function httpGetBuffer(urlStr: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      urlStr,
      { timeout: 5000, headers: { 'User-Agent': 'next-work-dashboard/1.0' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          httpGetBuffer(redirectUrl).then(resolve).catch(reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function parseFaviconLink(html: string, baseUrl: string): string | null {
  const re = /<link\b[^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i
    || /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*>/i;
  const match = html.match(re);
  if (match) {
    return new URL(match[1], baseUrl).toString();
  }
  return null;
}

export async function fetchSiteFavicon(siteUrl: string): Promise<string | null> {
  try {
    const u = new URL(siteUrl);
    const host = u.hostname;
    const cacheKey = host;

    if (faviconCache.has(cacheKey)) return faviconCache.get(cacheKey)!;

    let iconUrl = BUILTIN_FAVICON_URLS[host] ?? null;

    if (!iconUrl) {
      const html = await httpGet(siteUrl);
      iconUrl = parseFaviconLink(html, siteUrl);
    }

    if (!iconUrl) {
      iconUrl = `${u.origin}/favicon.ico`;
    }

    const buf = await httpGetBuffer(iconUrl);

    const ext = iconUrl.split('.').pop()?.split('?')[0] || 'ico';
    const mime = { png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'image/x-icon';
    const b64 = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    faviconCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}
