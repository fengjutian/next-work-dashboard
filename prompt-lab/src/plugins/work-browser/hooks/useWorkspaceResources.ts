import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, Document, Tab } from '../../../core/work-browser/types';
import { message } from '../ui';

export function useWorkspaceResources(workspaceId?: string) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const workspaceIdRef = useRef(workspaceId);
  const lastTabByWorkspace = useRef(new Map<string, string>());
  const tabsCache = useRef(new Map<string, Tab[]>());
  const documentsCache = useRef(new Map<string, Document[]>());
  const annotationsCache = useRef(new Map<string, Annotation[]>());
  workspaceIdRef.current = workspaceId;

  const refreshTabs = useCallback(async (id: string) => {
    try {
      const list = await window.electronAPI.workBrowser.tab.list(id) as Tab[];
      tabsCache.current.set(id, list);
      if (workspaceIdRef.current !== id) return;
      setTabs(list);
      setActiveTab((current) => list.find((tab) => tab.id === lastTabByWorkspace.current.get(id))
        ?? list.find((tab) => tab.id === current?.id) ?? list[0] ?? null);
    } catch (error) {
      if (workspaceIdRef.current === id) message.error(`标签页加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const refreshDocuments = useCallback(async (id: string) => {
    try {
      const list = await window.electronAPI.workBrowser.document.list(id, 100) as Document[];
      documentsCache.current.set(id, list);
      if (workspaceIdRef.current === id) setDocuments(list);
    } catch (error) {
      if (workspaceIdRef.current === id) message.error(`文档加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const refreshAnnotations = useCallback(async (id: string) => {
    try {
      const list = await window.electronAPI.workBrowser.annotation.listByWorkspace(id) as Annotation[];
      annotationsCache.current.set(id, list);
      if (workspaceIdRef.current === id) setAnnotations(list);
    } catch (error) {
      if (!String(error).includes('No handler registered')) console.warn('[work-browser] workspace annotations unavailable:', error);
      if (workspaceIdRef.current === id) setAnnotations([]);
    }
  }, []);

  const restoreCached = useCallback((id: string) => {
    const cachedTabs = tabsCache.current.get(id);
    if (cachedTabs) {
      setTabs(cachedTabs);
      setActiveTab(cachedTabs.find((tab) => tab.id === lastTabByWorkspace.current.get(id)) ?? cachedTabs[0] ?? null);
    }
    const cachedDocuments = documentsCache.current.get(id);
    if (cachedDocuments) setDocuments(cachedDocuments);
    const cachedAnnotations = annotationsCache.current.get(id);
    if (cachedAnnotations) setAnnotations(cachedAnnotations);
  }, []);

  useEffect(() => {
    if (!workspaceId) { setTabs([]); setActiveTab(null); setDocuments([]); setAnnotations([]); return; }
    restoreCached(workspaceId);
    void Promise.all([refreshTabs(workspaceId), refreshDocuments(workspaceId), refreshAnnotations(workspaceId)]);
  }, [workspaceId, refreshAnnotations, refreshDocuments, refreshTabs, restoreCached]);

  useEffect(() => {
    if (activeTab) lastTabByWorkspace.current.set(activeTab.workspaceId, activeTab.id);
  }, [activeTab]);

  return { tabs, setTabs, activeTab, setActiveTab, documents, annotations, refreshTabs, refreshDocuments, refreshAnnotations, restoreCached };
}
