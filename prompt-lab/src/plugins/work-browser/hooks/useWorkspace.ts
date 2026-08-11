/**
 * useWorkspace — Workspace 状态管理 hook
 */
import { useCallback, useEffect, useState } from 'react';
import type { Workspace } from '../../../core/work-browser/types';

export function useWorkspaces(includeArchived = false) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = (await window.electronAPI.workBrowser.workspace.list(includeArchived)) as Workspace[];
      setWorkspaces(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async (input: { name: string; description?: string; icon?: string }) => {
    const ws = (await window.electronAPI.workBrowser.workspace.create(input)) as Workspace;
    await refresh();
    return ws;
  }, [refresh]);

  return { workspaces, loading, error, refresh, create };
}
