/**
 * useSearch — 多引擎搜索 hook
 */
import { useCallback, useState } from 'react';
import type { AggregatedSearchResponse } from '../../../core/work-browser/types';

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AggregatedSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (text: string, workspaceId?: string) => {
    if (!text.trim()) return null;
    setLoading(true); setError(null);
    try {
      const res = (await window.electronAPI.workBrowser.search.run({ text, workspaceId })) as AggregatedSearchResponse;
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
