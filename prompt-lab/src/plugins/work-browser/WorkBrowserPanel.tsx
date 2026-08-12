/**
 * WorkBrowserPanel — Work Browser 插件主面板
 *
 * 布局（PRD 第 6 节）：
 *
 * ┌────────────────────────────────────────────────────────┐
 * │  SearchBar  [🛡 Cleaner] [💾 Save]                    │
 * ├──────────┬──────────────────────────────────┬──────────┤
 * │ Workspace│  TabBar                          │  Library │
 * │ List     │  ┌────────────────────────────┐  │  /       │
 * │          │  │  WebContent (iframe)       │  │  History │
 * │          │  │                            │  │          │
 * │          │  └────────────────────────────┘  │          │
 * │          │                                  │          │
 * └──────────┴──────────────────────────────────┴──────────┘
 */
import { Empty, message, Tabs, ToastHost } from './ui';
import { Bot, BookOpen, FolderKanban, GitFork, ListTodo, PanelLeft, PanelRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type {
  Workspace, Tab, Document, Annotation, SearchHistoryEntry,
} from '../../core/work-browser/types';
import { SearchBar } from './components/SearchBar';
import { WorkspaceList } from './components/WorkspaceList';
import { TabBar } from './components/TabBar';
import { WebContent } from './components/WebContent';
import { LibraryList } from './components/LibraryList';
import { TaskList } from './components/TaskList';
import { GraphView } from './components/GraphView';
import { AgentPanel } from './components/AgentPanel';
import { SearchResults } from './components/SearchResults';
import { SavePageDialog } from './components/SavePageDialog';
import { ResearchDrawer } from './components/ResearchDrawer';
import { useWorkspaces } from './hooks/useWorkspace';
import { useSearch } from './hooks/useSearch';
import { STORAGE_KEYS } from './constants';

export function WorkBrowserPanel() {
  const aiApi = useStore((state) => state.aiApi);
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const { workspaces, create: createWorkspace } = useWorkspaces(false);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const [webviewRefreshKey, setWebviewRefreshKey] = useState(0);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchTopic, setResearchTopic] = useState('');
  const [cleanerEnabled, setCleanerEnabled] = useState(true);
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>(undefined);
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.LEFT_SIDEBAR_COLLAPSED) === 'true');
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.RIGHT_SIDEBAR_COLLAPSED) === 'true');

  const activeWorkspaceId = activeWorkspace?.id;
  const activeWorkspaceIdRef = useRef<string | undefined>(undefined);
  const aiConfigBridgeAvailableRef = useRef(true);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  const { loading: searchLoading, data: searchData, run: runSearch } = useSearch();

  const editDocument = useCallback((document: Document) => {
    if (!document.contentPath) {
      message.warning('该文档没有可编辑的 Markdown 文件');
      return;
    }
    setActiveActivity('markdown-editor');
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('plugin:file-open', {
      detail: {
        pluginId: 'markdown-editor',
        editorId: 'markdown-editor.default',
        file: { path: document.contentPath, name: document.title || 'Work Browser Document.md' },
      },
    })));
  }, [setActiveActivity]);

  const compareDocument = useCallback(async (document: Document) => {
    try {
      const comparison = await window.electronAPI.workBrowser.document.compare(document.id);
      sessionStorage.setItem('compare.pending.v1', JSON.stringify(comparison));
      setActiveActivity('compare');
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('compare:open-content', { detail: comparison })));
    } catch (error) {
      message.warning(error instanceof Error ? error.message : String(error));
    }
  }, [setActiveActivity]);

  useEffect(() => {
    if (!aiConfigBridgeAvailableRef.current) return;
    void window.electronAPI.workBrowser.config.setAI({
      baseUrl: aiApi.baseUrl,
      apiKey: aiApi.apiKey,
      model: aiApi.model,
      local: /(?:localhost|127\.0\.0\.1)/i.test(aiApi.baseUrl),
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No handler registered for 'work-browser:config:set-ai'")) {
        aiConfigBridgeAvailableRef.current = false;
        return;
      }
      console.warn('[work-browser] unable to sync application AI config', error);
    });
  }, [aiApi.apiKey, aiApi.baseUrl, aiApi.model]);

  // 默认选第一个 workspace
  useEffect(() => {
    setActiveWorkspace((current) => {
      if (workspaces.length === 0) return null;
      return workspaces.find((workspace) => workspace.id === current?.id) ?? workspaces[0];
    });
  }, [workspaces]);

  // 加载 active workspace 的 tabs / documents
  const refreshTabs = useCallback(async (wsId: string) => {
    try {
      const list = (await window.electronAPI.workBrowser.tab.list(wsId)) as Tab[];
      if (activeWorkspaceIdRef.current !== wsId) return;
      setTabs(list);
      setActiveTab((current) => list.find((tab) => tab.id === current?.id) ?? list[0] ?? null);
    } catch (error) {
      if (activeWorkspaceIdRef.current === wsId) message.error(`标签页加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const refreshDocuments = useCallback(async (wsId: string) => {
    try {
      const docs = (await window.electronAPI.workBrowser.document.list(wsId, 100)) as Document[];
      if (activeWorkspaceIdRef.current === wsId) setDocuments(docs);
    } catch (error) {
      if (activeWorkspaceIdRef.current === wsId) message.error(`文档加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const refreshAnnotations = useCallback(async (wsId: string) => {
    try {
      const anns = (await window.electronAPI.workBrowser.annotation.listByWorkspace(wsId)) as Annotation[];
      if (activeWorkspaceIdRef.current === wsId) setAnnotations(anns);
    } catch (error) {
      // Annotation Graph 是增强能力；旧版主进程未注册该 channel 时不阻塞浏览器主体。
      if (!String(error).includes('No handler registered')) {
        console.warn('[work-browser] workspace annotations unavailable:', error);
      }
      if (activeWorkspaceIdRef.current === wsId) setAnnotations([]);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const h = (await window.electronAPI.workBrowser.search.history(50)) as SearchHistoryEntry[];
      setHistory(h);
    } catch (error) {
      console.warn('[work-browser] search history unavailable:', error);
    }
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) {
      setTabs([]);
      setActiveTab(null);
      setDocuments([]);
      setAnnotations([]);
      void refreshTabs(activeWorkspaceId);
      void refreshDocuments(activeWorkspaceId);
      void refreshAnnotations(activeWorkspaceId);
    }
  }, [activeWorkspaceId, refreshTabs, refreshDocuments, refreshAnnotations]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  // Cleaner 配置
  useEffect(() => {
    void window.electronAPI.workBrowser.cleaner.payload()
      .then((p) => setBlockedDomains(p.blockedDomains))
      .catch((error) => console.warn('[work-browser] cleaner payload unavailable:', error));
    const stored = localStorage.getItem(STORAGE_KEYS.CLEANER_OPTIONS);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (typeof parsed.enabled === 'boolean') setCleanerEnabled(parsed.enabled);
      } catch { /* ignore */ }
    }
  }, []);

  const toggleCleaner = () => {
    const next = !cleanerEnabled;
    setCleanerEnabled(next);
    localStorage.setItem(STORAGE_KEYS.CLEANER_OPTIONS, JSON.stringify({ enabled: next }));
    message.success(next ? '已开启净化' : '已关闭净化');
  };

  const handleSearch = useCallback(async (text: string, scope: 'web' | 'workspace' | 'library' = 'workspace') => {
    const result = await runSearch(text, activeWorkspace?.id, scope);
    if (result) setSearchOpen(true);
    else message.error('搜索失败，请检查搜索服务配置后重试');
    void refreshHistory();
  }, [activeWorkspace?.id, runSearch, refreshHistory]);

  const handleAddTab = useCallback(async (url: string) => {
    if (!activeWorkspace) { message.warning('请先选择 Workspace'); return false; }
    try {
      const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`;
      const position = tabs.reduce((max, tab) => Math.max(max, Number.isFinite(tab.position) ? tab.position : 0), 0) + 1;
      const tab = (await window.electronAPI.workBrowser.tab.create({ workspaceId: activeWorkspace.id, url: normalizedUrl, title: url, position })) as Tab;
      await refreshTabs(activeWorkspace.id);
      setActiveTab(tab);
      return true;
    } catch (error) {
      message.error(`新建标签页失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }, [activeWorkspace, refreshTabs, tabs]);

  const createTabAt = useCallback(async (url: string, position: number, title?: string) => {
    if (!activeWorkspace) return null;
    const created = (await window.electronAPI.workBrowser.tab.create({
      workspaceId: activeWorkspace.id,
      url,
      title: title || url,
      position,
    })) as Tab;
    await refreshTabs(activeWorkspace.id);
    setActiveTab(created);
    return created;
  }, [activeWorkspace, refreshTabs]);

  const closeTabSet = useCallback(async (closing: Tab[]) => {
    if (!activeWorkspace || closing.length === 0) return;
    const closingIds = new Set(closing.map((tab) => tab.id));
    const remaining = tabs.filter((tab) => !closingIds.has(tab.id));
    setClosedTabs((current) => [...closing.slice().reverse(), ...current].slice(0, 20));
    try {
      await Promise.all(closing.map((tab) => window.electronAPI.workBrowser.tab.remove(tab.id)));
      if (activeTab && closingIds.has(activeTab.id)) {
        setActiveTab(remaining.find((tab) => tab.position >= activeTab.position) ?? remaining.at(-1) ?? null);
      }
      await refreshTabs(activeWorkspace.id);
    } catch (error) {
      message.error(`关闭标签页失败：${error instanceof Error ? error.message : String(error)}`);
      await refreshTabs(activeWorkspace.id);
    }
  }, [activeWorkspace, activeTab, refreshTabs, tabs]);

  const addTabRight = useCallback(async (tab: Tab) => {
    const stored = await window.electronAPI.workBrowser.settings.get('workBrowser.homeUrl').catch(() => undefined);
    const url = typeof stored === 'string' && /^https?:\/\//i.test(stored) ? stored : 'https://www.google.com';
    await createTabAt(url, tab.position + 0.5, url);
  }, [createTabAt]);

  const duplicateTab = useCallback(async (tab: Tab) => {
    await createTabAt(tab.url, tab.position + 0.5, tab.title);
  }, [createTabAt]);

  const togglePinnedTab = useCallback(async (tab: Tab) => {
    try {
      await window.electronAPI.workBrowser.tab.update(tab.id, { isPinned: !tab.isPinned });
      if (activeWorkspace) await refreshTabs(activeWorkspace.id);
    } catch (error) {
      message.error(`固定标签页失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeWorkspace, refreshTabs]);

  const reopenClosedTab = useCallback(async () => {
    const [closed, ...rest] = closedTabs;
    if (!closed || !activeWorkspace) return;
    try {
      await createTabAt(closed.url, closed.position, closed.title);
      setClosedTabs(rest);
    } catch (error) {
      message.error(`恢复标签页失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeWorkspace, closedTabs, createTabAt]);

  const handleSave = useCallback(async (input: { url: string; title?: string; workspaceId: string }) => {
    try {
      const r = await window.electronAPI.workBrowser.document.save({
        workspaceId: input.workspaceId,
        url: input.url,
        title: input.title,
        tabId: input.workspaceId === activeWorkspace?.id ? activeTab?.id : undefined,
      });
      message.success(`已保存：${r.wordCount} 词${r.isNewVersion ? `（新版本 ${r.diffSummary}）` : ''}`);
      setSaveOpen(false);
      if (activeWorkspace?.id === input.workspaceId) await refreshDocuments(activeWorkspace.id);
      // 保存后建立 tab → document 关联
      if (activeTab && activeWorkspace?.id === input.workspaceId) setActiveDocumentId(r.documentId);
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspace, activeTab, refreshDocuments]);

  // activeTab 变化时，自动查找匹配的 document
  useEffect(() => {
    if (!activeTab) { setActiveDocumentId(undefined); return; }
    const matched = documents.find((d) => d.url === activeTab.url);
    setActiveDocumentId(matched?.id);
  }, [activeTab, documents]);

  const handleOpenResult = useCallback(async (url: string) => {
    if (await handleAddTab(url)) setSearchOpen(false);
  }, [handleAddTab]);

  const handleTabUpdate = useCallback((tabId: string, patch: Partial<Pick<Tab, 'title' | 'url' | 'favicon'>>) => {
    setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, ...patch } : tab));
    setActiveTab((current) => current?.id === tabId ? { ...current, ...patch } : current);
    void window.electronAPI.workBrowser.tab.update(tabId, patch).catch((error) => {
      console.warn('[work-browser] tab metadata update failed:', error);
    });
  }, []);

  const toggleLeftSidebar = () => setLeftCollapsed((collapsed) => {
    localStorage.setItem(STORAGE_KEYS.LEFT_SIDEBAR_COLLAPSED, String(!collapsed));
    return !collapsed;
  });
  const toggleRightSidebar = () => setRightCollapsed((collapsed) => {
    localStorage.setItem(STORAGE_KEYS.RIGHT_SIDEBAR_COLLAPSED, String(!collapsed));
    return !collapsed;
  });

  const gridTemplateColumns = leftCollapsed
    ? (rightCollapsed ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(250px, 310px)')
    : (rightCollapsed ? 'minmax(180px, 220px) minmax(0, 1fr)' : 'minmax(180px, 220px) minmax(0, 1fr) minmax(250px, 310px)');

  return (
    <div className="work-browser-panel flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ToastHost />
      <header className="relative z-10 shrink-0 bg-background/95 px-2 py-1.5 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleLeftSidebar} title={leftCollapsed ? '展开工作区侧栏' : '折叠工作区侧栏'} aria-label={leftCollapsed ? '展开工作区侧栏' : '折叠工作区侧栏'} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-transparent transition hover:bg-accent ${leftCollapsed ? 'bg-primary-light text-primary' : 'text-muted-foreground'}`}><PanelLeft size={17} /></button>
          {activeWorkspace && (
            <div className="hidden shrink-0 items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 xl:flex">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-card text-primary shadow-sm"><FolderKanban size={13} /></span>
              <div className="leading-tight">
                <div className="max-w-28 truncate text-xs font-semibold">{activeWorkspace.name}</div>
                <div className="text-[10px] text-muted-foreground">{tabs.length} 标签 · {documents.length} 文档</div>
              </div>
            </div>
          )}
          <div className="min-w-0 flex-1">
          <SearchBar
            onSearch={handleSearch}
            onSave={activeTab ? () => setSaveOpen(true) : undefined}
            onResearch={(topic) => { setResearchTopic(topic); setResearchOpen(true); }}
            cleanerEnabled={cleanerEnabled}
            onToggleCleaner={toggleCleaner}
            loading={searchLoading}
          />
          </div>
          <button type="button" onClick={toggleRightSidebar} title={rightCollapsed ? '展开辅助侧栏' : '折叠辅助侧栏'} aria-label={rightCollapsed ? '展开辅助侧栏' : '折叠辅助侧栏'} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-transparent transition hover:bg-accent ${rightCollapsed ? 'bg-primary-light text-primary' : 'text-muted-foreground'}`}><PanelRight size={17} /></button>
        </div>
      </header>
      <div className="mx-2 mb-2 grid min-h-0 flex-1 gap-px overflow-hidden rounded-2xl bg-border/30 transition-[grid-template-columns] duration-200" style={{ gridTemplateColumns }}>
        {!leftCollapsed && <aside className="min-h-0 overflow-hidden bg-card/90">
          <WorkspaceList
            workspaces={workspaces}
            activeId={activeWorkspace?.id}
            onSelect={setActiveWorkspace}
            onCreate={async (input) => {
              const created = await createWorkspace(input);
              setActiveWorkspace(created);
              return created;
            }}
          />
        </aside>}
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card">
          {activeWorkspace ? (
            <>
              <TabBar
                tabs={tabs}
                activeId={activeTab?.id}
                canReopen={closedTabs.length > 0}
                onActivate={setActiveTab}
                onHome={() => setActiveTab(null)}
                onClose={(tab) => closeTabSet([tab])}
                onCloseRight={(tab) => closeTabSet(tabs.filter((candidate) => !candidate.isPinned && candidate.position > tab.position))}
                onCloseOthers={(tab) => closeTabSet(tabs.filter((candidate) => candidate.id !== tab.id && !candidate.isPinned))}
                onDuplicate={duplicateTab}
                onPin={togglePinnedTab}
                onRefresh={(tab) => { setActiveTab(tab); setWebviewRefreshKey((key) => key + 1); }}
                onReopen={reopenClosedTab}
                onAddRight={addTabRight}
                onAdd={handleAddTab}
              />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <WebContent
                  key={`${activeTab?.id || 'home'}:${webviewRefreshKey}`}
                  tab={activeTab}
                  cleanerEnabled={cleanerEnabled}
                  blockedDomains={blockedDomains}
                  activeDocumentId={activeDocumentId}
                  onOpenUrl={handleAddTab}
                  onResearch={(topic) => { setResearchTopic(topic); setResearchOpen(true); }}
                  onTabUpdate={handleTabUpdate}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Empty description="选择或新建工作区，开始整理你的研究资料" />
            </div>
          )}
        </main>
        {!rightCollapsed && <aside className="min-h-0 overflow-hidden bg-card/90">
          {activeWorkspace ? (
            <Tabs
              size="small"
              style={{ height: '100%' }}
              items={[
                {
                  key: 'library',
                  label: <span className="flex items-center gap-1"><BookOpen size={13} />资料库</span>,
                  children: (
                    <LibraryList
                      documents={documents}
                      history={history}
                      onOpenDocument={(d) => { void handleAddTab(d.url); }}
                      onEditDocument={editDocument}
                      onCompareDocument={(document) => { void compareDocument(document); }}
                      onReplayQuery={handleSearch}
                    />
                  ),
                },
                {
                  key: 'tasks',
                  label: <span className="flex items-center gap-1"><ListTodo size={13} />任务</span>,
                  children: <TaskList workspaceId={activeWorkspace.id} />,
                },
                {
                  key: 'graph',
                  label: <span className="flex items-center gap-1"><GitFork size={13} />图谱</span>,
                  children: (
                    <GraphView
                      workspaceId={activeWorkspace.id}
                      documents={documents}
                      tabs={tabs}
                      annotations={annotations}
                      onOpenDocument={(url) => void handleAddTab(url)}
                    />
                  ),
                },
                {
                  key: 'agent',
                  label: <span className="flex items-center gap-1"><Bot size={13} />助手</span>,
                  children: (
                    <AgentPanel
                      workspaceId={activeWorkspace.id}
                      activeTab={activeTab}
                      documents={documents}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Library 暂不可用" style={{ marginTop: 24 }} />
          )}
        </aside>}
      </div>
      <SearchResults
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        data={searchData}
        loading={searchLoading}
        onOpen={handleOpenResult}
      />
      <SavePageDialog
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onConfirm={handleSave}
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, icon: w.icon }))}
        defaultWorkspaceId={activeWorkspace?.id}
        initialUrl={activeTab?.url}
        initialTitle={activeTab?.title}
      />
      <ResearchDrawer
        open={researchOpen}
        onClose={() => setResearchOpen(false)}
        workspaces={workspaces}
        defaultWorkspaceId={activeWorkspace?.id}
        defaultTopic={researchTopic}
        onCompleted={() => { if (activeWorkspace) void refreshDocuments(activeWorkspace.id); }}
      />
    </div>
  );
}
