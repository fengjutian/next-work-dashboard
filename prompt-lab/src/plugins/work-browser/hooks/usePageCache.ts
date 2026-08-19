import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tab } from '../../../core/work-browser/types';

export function usePageCache(activeTab: Tab | null, limit = 8) {
  const [cachedPages, setCachedPages] = useState<Tab[]>([]);
  const [readyPages, setReadyPages] = useState<Record<string, boolean>>({});
  const [displayedPageId, setDisplayedPageId] = useState<string | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  const lastUsed = useRef(new Map<string, number>());

  useEffect(() => {
    if (!activeTab) return;
    lastUsed.current.set(activeTab.id, Date.now());
    setCachedPages((current) => {
      const exists = current.some((page) => page.id === activeTab.id);
      const next = exists ? current.map((page) => page.id === activeTab.id ? activeTab : page) : [...current, activeTab];
      if (next.length <= limit) return next;
      const removable = next.filter((page) => !page.isPinned && page.id !== activeTab.id)
        .sort((left, right) => (lastUsed.current.get(left.id) || 0) - (lastUsed.current.get(right.id) || 0))[0];
      if (!removable) return next.slice(-limit);
      lastUsed.current.delete(removable.id);
      return next.filter((page) => page.id !== removable.id);
    });
  }, [activeTab, limit]);

  useEffect(() => {
    if (!activeTab) setDisplayedPageId(null);
    else if (readyPages[activeTab.id]) setDisplayedPageId(activeTab.id);
  }, [activeTab, readyPages]);

  const markReady = useCallback((tabId: string, ready: boolean) => {
    setReadyPages((current) => current[tabId] === ready ? current : { ...current, [tabId]: ready });
    if (ready && activeTab?.id === tabId) setDisplayedPageId(tabId);
  }, [activeTab?.id]);

  const evict = useCallback((ids: Iterable<string>) => {
    const removed = new Set(ids);
    removed.forEach((id) => lastUsed.current.delete(id));
    setCachedPages((current) => current.filter((page) => !removed.has(page.id)));
    setReadyPages((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(id))));
  }, []);

  const refresh = useCallback((tabId: string) => setRefreshKeys((current) => ({ ...current, [tabId]: (current[tabId] || 0) + 1 })), []);
  return { cachedPages, displayedPageId, refreshKeys, markReady, evict, refresh };
}
