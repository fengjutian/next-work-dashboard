/**
 * useSearch — 多引擎 + 本地 FTS5 搜索 hook
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AggregatedSearchResponse } from '../../../core/work-browser/types';

export type SearchScope = 'web' | 'workspace' | 'library';

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggregatedSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const queryRef = useRef<AggregatedSearchResponse['query'] | null>(null);

  useEffect(() => window.electronAPI.workBrowser.search.onProgress((progress) => {
    if (progress.requestId !== activeRequestRef.current || !queryRef.current) return;
    setData({
      query: queryRef.current,
      results: progress.results as AggregatedSearchResponse['results'],
      providers: progress.providers as AggregatedSearchResponse['providers'],
      took: progress.took,
      aiSummary: null,
    });
  }), []);

  const cancel = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active) return;
    activeRequestRef.current = null;
    void window.electronAPI.workBrowser.search.cancel(active);
    setLoading(false);
  }, []);

  const run = useCallback(async (text: string, workspaceId?: string, scope: SearchScope = 'workspace') => {
    if (!text.trim()) return null;
    const requestId = ++requestIdRef.current;
    if (activeRequestRef.current) void window.electronAPI.workBrowser.search.cancel(activeRequestRef.current);
    const streamId = crypto.randomUUID();
    activeRequestRef.current = streamId;
    queryRef.current = { text: text.trim(), locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 20 };
    setLoading(true); setError(null);
    try {
      const res = (await window.electronAPI.workBrowser.search.start(streamId, { text, workspaceId, scope })) as AggregatedSearchResponse;
      if (requestId === requestIdRef.current) setData(res);
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (requestId === requestIdRef.current && !message.includes('SEARCH_CANCELLED')) setError(message);
      return null;
    } finally {
      if (activeRequestRef.current === streamId) activeRequestRef.current = null;
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  return { loading, data, error, run, cancel };
}
