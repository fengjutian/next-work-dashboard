/**
 * 跨引擎去重
 *
 * 优先级：
 *  1. canonicalUrl 完全相同 → 合并来源
 *  2. contentHash 相同 → 合并来源（标题/摘要微小变化）
 *  3. domain + 标题首部 80% 相似 → 合并来源
 */
import type { SearchResult } from '../types';

export interface DedupOptions {
  /** 是否要求 canonicalUrl 完全相同才算重复。默认 false。 */
  strictUrl?: boolean;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[\s\u3000]+/g, ' ').replace(/[^\w一-鿿]+/g, '').slice(0, 80);
}

function jaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  setA.forEach((c) => { if (setB.has(c)) inter++; });
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

export function dedupeResults(results: SearchResult[], options: DedupOptions = {}): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Map<string, number>(); // key → out index

  for (const r of results) {
    const urlKey = r.canonicalUrl;
    const hashKey = r.contentHash;
    const titleKey = `${r.domain}::${normalizeTitle(r.title)}`;

    let merged: number | null = null;
    for (const k of [urlKey, hashKey, titleKey]) {
      const idx = seen.get(k);
      if (idx !== undefined) { merged = idx; break; }
    }

    if (merged === null && !options.strictUrl) {
      // 标题相似度兜底
      const tn = normalizeTitle(r.title);
      for (let i = 0; i < out.length; i++) {
        const ex = out[i];
        if (ex.domain !== r.domain) continue;
        if (jaccard(tn, normalizeTitle(ex.title)) > 0.8) { merged = i; break; }
      }
    }

    if (merged === null) {
      out.push(r);
      seen.set(urlKey, out.length - 1);
      seen.set(hashKey, out.length - 1);
      seen.set(titleKey, out.length - 1);
    } else {
      const ex = out[merged];
      if (!ex.source.includes(r.source)) ex.source = `${ex.source} · ${r.source}`;
      // 取较高分
      ex.score = Math.max(ex.score, r.score);
      // 优先取较长 snippet
      if ((r.snippet?.length || 0) > (ex.snippet?.length || 0)) ex.snippet = r.snippet;
    }
  }
  return out;
}
