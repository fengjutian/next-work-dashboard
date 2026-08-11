/**
 * useSearch — 多引擎 + 本地 FTS5 搜索 hook
 */
import { useCallback, useState } from 'react';
import type { AggregatedSearchResponse } from '../../../core/work-browser/types';

export type SearchScope = 'web' | 'workspace' | 'library';

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggregatedSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (text: string, workspaceId?: string, scope: SearchScope = 'workspace') => {
    if (!text.trim()) return null;
    setLoading(true); setError(null);
    try {
      const res = (await window.electronAPI.workBrowser.search.run({ text, workspaceId, scope })) as AggregatedSearchResponse;
      setData(res);
      return res;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, run };
}
