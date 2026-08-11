/**
 * useSearch — 多引擎 + 本地 FTS5 搜索 hook
 */
import { useCallback, useRef, useState } from 'react';
import type { AggregatedSearchResponse } from '../../../core/work-browser/types';

export type SearchScope = 'web' | 'workspace' | 'library';

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggregatedSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const run = useCallback(async (text: string, workspaceId?: string, scope: SearchScope = 'workspace') => {
    if (!text.trim()) return null;
    const requestId = ++requestIdRef.current;
    setLoading(true); setError(null);
    try {
      const res = (await window.electronAPI.workBrowser.search.run({ text, workspaceId, scope })) as AggregatedSearchResponse;
      if (requestId === requestIdRef.current) setData(res);
      return res;
    } catch (e) {
      if (requestId === requestIdRef.current) setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  return { loading, data, error, run };
}
