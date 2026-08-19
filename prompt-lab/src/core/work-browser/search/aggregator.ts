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
import { searchLocal } from './local';
import type Database from 'better-sqlite3';

export interface AggregateOptions {
  /** 超时（ms），单个 provider 超时会被丢弃。默认 8000。 */
  timeoutMs?: number;
  /** 总并发上限。默认 4。 */
  concurrency?: number;
  /** 触发 AI 摘要（可选，回调由调用方注入）。 */
  onSummarize?: (results: SearchResult[], query: SearchQuery) => Promise<string | null>;
  /** 启用本地 FTS5 检索（work-browser 专属） */
  localDb?: Database.Database;
  /** 本地检索 scope */
  localScope?: { kind: 'workspace' | 'library' | 'off'; workspaceId?: string };
  signal?: AbortSignal;
  onProgress?: (progress: { results: SearchResult[]; providers: SearchProviderStatus[]; took: number }) => void;
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
  // 全局取消：timeoutMs 全部 provider 共享上限

  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
    workers.push((async () => {
      while (queue.length) {
        const p = queue.shift()!;
        const t0 = Date.now();
        const controller = new AbortController();
        const providerTimer = setTimeout(() => controller.abort(), timeoutMs);
        const abortProvider = () => controller.abort();
        options.signal?.addEventListener('abort', abortProvider, { once: true });
        try {
          const results = await withTimeout(p.search(query, controller.signal), timeoutMs, p.id, options.signal);
          for (const r of results) {
            all.push(normalizeResult(r, p.id));
          }
          statuses.push({ providerId: p.id, ok: true, count: results.length, error: null, took: Date.now() - t0 });
          options.onProgress?.({ results: rankResults(dedupeResults(all)).slice(0, query.perPage), providers: [...statuses], took: Date.now() - started });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          statuses.push({ providerId: p.id, ok: false, count: 0, error: msg, took: Date.now() - t0 });
          options.onProgress?.({ results: rankResults(dedupeResults(all)).slice(0, query.perPage), providers: [...statuses], took: Date.now() - started });
        } finally {
          clearTimeout(providerTimer);
          options.signal?.removeEventListener('abort', abortProvider);
        }
      }
    })());
  }
  await Promise.all(workers);

  const deduped = dedupeResults(all);
  const ranked = rankResults(deduped).slice(0, query.perPage);

  // 本地 FTS5 检索
  let localResults: SearchResult[] = [];
  if (options.localDb && options.localScope && options.localScope.kind !== 'off') {
    try {
      const t0 = Date.now();
      localResults = searchLocal(options.localDb, query, {
        scope: options.localScope.kind,
        workspaceId: options.localScope.workspaceId,
        limit: query.perPage,
      });
      statuses.push({
        providerId: 'local',
        ok: true,
        count: localResults.length,
        error: null,
        took: Date.now() - t0,
      });
    } catch (e) {
      statuses.push({
        providerId: 'local',
        ok: false,
        count: 0,
        error: e instanceof Error ? e.message : String(e),
        took: 0,
      });
    }
  }

  // 合并本地 + 网络结果，重新去重排序
  const combined = dedupeResults([...ranked, ...localResults]);
  const final = rankResults(combined).slice(0, query.perPage);

  let aiSummary: string | null = null;
  if (onSummarize && final.length) {
    try { aiSummary = await onSummarize(final, query); } catch { /* 摘要失败不阻塞主结果 */ }
  }

  return {
    query,
    results: final,
    providers: statuses,
    took: Date.now() - started,
    aiSummary,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, providerId: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`PROVIDER_TIMEOUT:${providerId}`)), timeoutMs);
  });
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      if (signal?.aborted) reject(new Error('SEARCH_CANCELLED'));
      else signal?.addEventListener('abort', () => reject(new Error('SEARCH_CANCELLED')), { once: true });
    });
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
