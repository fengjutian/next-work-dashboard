/**
 * SearchProvider 协议 — 所有引擎实现这个接口。
 * aggregator 接受一组 provider 并行调度。
 */
import type { SearchProvider, SearchResult, SearchQuery } from '../types';

export type { SearchProvider, SearchResult, SearchQuery };

/** 提供商配置：用于运行时启用/禁用、注入 API key。 */
export interface ProviderConfig {
  id: string;
  enabled: boolean;
  apiKey?: string;
  endpoint?: string;
  /** 优先级 0–100，越大越先跑。 */
  priority: number;
}

/** 通用工具：HTML 文本反转义。 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

/** 用 SHA-256 截前 16 字符作为内容指纹（去重用）。同步可用。 */
export function contentFingerprint(title: string, url: string, snippet: string): string {
  // 简单 FNV-1a 64-bit，避免引用 node:crypto 在 main 启动链路
  const input = `${title}|${url}|${snippet}`;
  let h1 = 0xcbf29ce4;
  let h2 = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c; h2 ^= c << 1;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

/** URL 规范化：去 utm_* / 锚点 / trailing slash。 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const params = new URLSearchParams(u.search);
    const dropKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'];
    dropKeys.forEach((k) => params.delete(k));
    u.search = params.toString();
    u.hash = '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return raw;
  }
}
