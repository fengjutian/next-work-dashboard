/**
 * Provider 通用工具：HTML 抓取 + 解析。
 * 集中处理 timeout / UA / Accept-Language。
 */
import { DOMParser } from '@xmldom/xmldom';
import { canonicalizeUrl, contentFingerprint, decodeHtmlEntities } from './provider';
import type { SearchResult } from '../types';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export async function fetchHtml(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<string> {
  const res = await fetch(url, {
    ...init,
    signal,
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

export async function fetchJson<T = unknown>(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal,
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function makeResult(params: {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: number | null;
  score?: number;
  source: string;
}): SearchResult {
  const canonical = canonicalizeUrl(params.url);
  let domain = '';
  try { domain = new URL(canonical).host; } catch { /* keep empty */ }
  return {
    id: `${params.source}-${canonical}`,
    url: params.url,
    canonicalUrl: canonical,
    title: decodeHtmlEntities(params.title.trim()),
    snippet: decodeHtmlEntities((params.snippet || '').trim()),
    domain,
    source: params.source,
    publishedAt: params.publishedAt ?? null,
    score: params.score ?? 0.5,
    contentHash: contentFingerprint(params.title, canonical, params.snippet || ''),
  };
}

export { DOMParser };
