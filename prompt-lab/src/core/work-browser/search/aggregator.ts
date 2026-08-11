/**
 * 聚合器：并行调用一组 provider → 归一化 → 去重 → 排序 → 返回
 */
import type {
  SearchProvider,
  SearchQuery,
  SearchResult,
  AggregatedSearchResponse,
  SearchProviderStatus,
} from '../types';
import { canonicalizeUrl, contentFingerprint } from './provider';
import { dedupeResults } from './dedup';
import { rankResults } from './rank';

export interface AggregateOptions {
  /** 超时（ms），单个 provider 超时会被丢弃。默认 8000。 */
  timeoutMs?: number;
  /** 总并发上限。默认 4。 */
  concurrency?: number;
  /** 触发 AI 摘要（可选，回调由调用方注入）。 */
  onSummarize?: (results: SearchResult[], query: SearchQuery) => Promise<string | null>;
}

export async function aggregateSearch(
  providers: SearchProvider[],
  query: SearchQuery,
  options: AggregateOptions = {},
): Promise<AggregatedSearchResponse> {
  const { timeoutMs = 8000, concurrency = 4, onSummarize } = options;
  const started = Date.now();

  const queue = [...providers];
  const all: SearchResult[] = [];
  const statuses: SearchProviderStatus[] = [];
  const controller = new AbortController();
  // 全局取消：timeoutMs 全部 provider 共享上限
  const timer = setTimeout(() => controller.abort(), timeoutMs + 500);

  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
    workers.push((async () => {
      while (queue.length) {
        const p = queue.shift()!;
        const t0 = Date.now();
        try {
          const results = await p.search(query, controller.signal);
          for (const r of results) {
            all.push(normalizeResult(r, p.id));
          }
          statuses.push({ providerId: p.id, ok: true, count: results.length, error: null, took: Date.now() - t0 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          statuses.push({ providerId: p.id, ok: false, count: 0, error: msg, took: Date.now() - t0 });
        }
      }
    })());
  }
  await Promise.all(workers);
  clearTimeout(timer);

  const deduped = dedupeResults(all);
  const ranked = rankResults(deduped).slice(0, query.perPage);

  let aiSummary: string | null = null;
  if (onSummarize && ranked.length) {
    try { aiSummary = await onSummarize(ranked, query); } catch { /* 摘要失败不阻塞主结果 */ }
  }

  return {
    query,
    results: ranked,
    providers: statuses,
    took: Date.now() - started,
    aiSummary,
  };
}

function normalizeResult(r: SearchResult, defaultSource: string): SearchResult {
  const canonical = r.canonicalUrl || canonicalizeUrl(r.url);
  return {
    ...r,
    source: r.source || defaultSource,
    canonicalUrl: canonical,
    contentHash: r.contentHash || contentFingerprint(r.title, canonical, r.snippet),
    domain: r.domain || (() => { try { return new URL(canonical).host; } catch { return ''; } })(),
  };
}
