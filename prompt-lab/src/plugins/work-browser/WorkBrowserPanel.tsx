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
import { message, Space, Typography, Empty, Tabs, ToastHost } from './ui';
import { Bot, BookOpen, GitFork, ListTodo } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
  const { workspaces, create: createWorkspace } = useWorkspaces(false);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
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

  const { loading: searchLoading, data: searchData, run: runSearch } = useSearch();

  // 默认选第一个 workspace
  useEffect(() => {
    if (!activeWorkspace && workspaces.length > 0) setActiveWorkspace(workspaces[0]);
  }, [workspaces, activeWorkspace]);

  // 加载 active workspace 的 tabs / documents
  const refreshTabs = useCallback(async (wsId: string) => {
    const list = (await window.electronAPI.workBrowser.tab.list(wsId)) as Tab[];
    setTabs(list);
    if (list.length && !list.find((t) => t.id === activeTab?.id)) {
      setActiveTab(list[0]);
    } else if (list.length === 0) {
      setActiveTab(null);
    }
  }, [activeTab?.id]);

  const refreshDocuments = useCallback(async (wsId: string) => {
    const docs = (await window.electronAPI.workBrowser.document.list(wsId, 100)) as Document[];
    setDocuments(docs);
  }, []);

  const refreshAnnotations = useCallback(async (wsId: string) => {
    const anns = (await window.electronAPI.workBrowser.annotation.listByWorkspace(wsId)) as Annotation[];
    setAnnotations(anns);
  }, []);

  const refreshHistory = useCallback(async () => {
    const h = (await window.electronAPI.workBrowser.search.history(50)) as SearchHistoryEntry[];
    setHistory(h);
  }, []);

  useEffect(() => {
    if (activeWorkspace) {
      void refreshTabs(activeWorkspace.id);
      void refreshDocuments(activeWorkspace.id);
      void refreshAnnotations(activeWorkspace.id);
    }
  }, [activeWorkspace, refreshTabs, refreshDocuments, refreshAnnotations]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  // Cleaner 配置
  useEffect(() => {
    void window.electronAPI.workBrowser.cleaner.payload().then((p) => setBlockedDomains(p.blockedDomains));
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
    await runSearch(text, activeWorkspace?.id, scope);
    setSearchOpen(true);
    void refreshHistory();
  }, [activeWorkspace?.id, runSearch, refreshHistory]);

  const handleAddTab = useCallback(async (url: string) => {
    if (!activeWorkspace) { message.warning('请先选择 Workspace'); return; }
    const tab = (await window.electronAPI.workBrowser.tab.create({ workspaceId: activeWorkspace.id, url, title: url })) as Tab;
    await refreshTabs(activeWorkspace.id);
    setActiveTab(tab);
  }, [activeWorkspace, refreshTabs]);

  const handleSave = useCallback(async (input: { url: string; title?: string; workspaceId: string }) => {
    try {
      const r = await window.electronAPI.workBrowser.document.save({
        workspaceId: input.workspaceId,
        url: input.url,
        title: input.title,
        tabId: activeTab?.id,
      });
      message.success(`已保存：${r.wordCount} 词${r.isNewVersion ? `（新版本 ${r.diffSummary}）` : ''}`);
      setSaveOpen(false);
      if (activeWorkspace) await refreshDocuments(activeWorkspace.id);
      // 保存后建立 tab → document 关联
      if (activeTab) setActiveDocumentId(r.documentId);
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

  const handleOpenResult = useCallback((url: string) => {
    void handleAddTab(url);
    setSearchOpen(false);
  }, [handleAddTab]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ToastHost />
      <header className="relative z-10 shrink-0 border-b border-border/70 bg-card/90 px-4 py-3 shadow-[0_1px_12px_hsl(var(--foreground)/0.035)] backdrop-blur-xl">
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <SearchBar
            onSearch={handleSearch}
            onSave={activeTab ? () => setSaveOpen(true) : undefined}
            onResearch={(topic) => { setResearchTopic(topic); setResearchOpen(true); }}
            cleanerEnabled={cleanerEnabled}
            onToggleCleaner={toggleCleaner}
            loading={searchLoading}
          />
          {activeWorkspace && (
            <Typography.Text type="secondary" className="flex items-center gap-2 text-[11px]">
              <span className="rounded-md bg-primary-light px-2 py-0.5 text-primary">{activeWorkspace.icon} {activeWorkspace.name}</span>
              <span>{tabs.length} 个标签页</span><span className="text-border">•</span><span>{documents.length} 篇文档</span>
            </Typography.Text>
          )}
        </Space>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,220px)_minmax(360px,1fr)_minmax(240px,300px)] max-[1080px]:grid-cols-[190px_minmax(320px,1fr)_250px]">
        <aside className="min-h-0 border-r border-border/70 bg-card/55">
          <WorkspaceList
            workspaces={workspaces}
            activeId={activeWorkspace?.id}
            onSelect={setActiveWorkspace}
            onCreate={async (input) => { await createWorkspace(input); }}
          />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary-light)/0.45),transparent_32rem)]">
          {activeWorkspace ? (
            <>
              <TabBar
                tabs={tabs}
                activeId={activeTab?.id}
                onActivate={setActiveTab}
                onClose={async (t) => {
                  await window.electronAPI.workBrowser.tab.remove(t.id);
                  await refreshTabs(activeWorkspace.id);
                }}
                onAdd={handleAddTab}
              />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <WebContent
                  tab={activeTab}
                  cleanerEnabled={cleanerEnabled}
                  blockedDomains={blockedDomains}
                  activeDocumentId={activeDocumentId}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Empty description="选择或新建工作区，开始整理你的研究资料" />
            </div>
          )}
        </main>
        <aside className="min-h-0 overflow-hidden border-l border-border/70 bg-card/75">
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
                      onOpenDocument={(d) => { window.open(d.url, '_blank'); }}
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
        </aside>
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
