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
import { Layout, message, Space, Typography, Empty } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import type {
  Workspace, Tab, Document, SearchHistoryEntry,
} from '../../core/work-browser/types';
import { SearchBar } from './components/SearchBar';
import { WorkspaceList } from './components/WorkspaceList';
import { TabBar } from './components/TabBar';
import { WebContent } from './components/WebContent';
import { LibraryList } from './components/LibraryList';
import { SearchResults } from './components/SearchResults';
import { SavePageDialog } from './components/SavePageDialog';
import { useWorkspaces } from './hooks/useWorkspace';
import { useSearch } from './hooks/useSearch';
import { STORAGE_KEYS } from './constants';

const { Sider, Content } = Layout;

export function WorkBrowserPanel() {
  const { workspaces, create: createWorkspace } = useWorkspaces(false);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [cleanerEnabled, setCleanerEnabled] = useState(true);
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);

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

  const refreshHistory = useCallback(async () => {
    const h = (await window.electronAPI.workBrowser.search.history(50)) as SearchHistoryEntry[];
    setHistory(h);
  }, []);

  useEffect(() => {
    if (activeWorkspace) {
      void refreshTabs(activeWorkspace.id);
      void refreshDocuments(activeWorkspace.id);
    }
  }, [activeWorkspace, refreshTabs, refreshDocuments]);

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

  const handleSearch = useCallback(async (text: string) => {
    await runSearch(text, activeWorkspace?.id);
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
      if (activeWorkspace) void refreshDocuments(activeWorkspace.id);
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspace, activeTab?.id, refreshDocuments]);

  const handleOpenResult = useCallback((url: string) => {
    void handleAddTab(url);
    setSearchOpen(false);
  }, [handleAddTab]);

  return (
    <Layout style={{ height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <SearchBar
            onSearch={handleSearch}
            onSave={activeTab ? () => setSaveOpen(true) : undefined}
            cleanerEnabled={cleanerEnabled}
            onToggleCleaner={toggleCleaner}
            loading={searchLoading}
          />
          {activeWorkspace && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {activeWorkspace.icon} {activeWorkspace.name} · {tabs.length} 个 Tab · {documents.length} 篇文档
            </Typography.Text>
          )}
        </Space>
      </div>
      <Layout style={{ height: 'calc(100% - 70px)' }}>
        <Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
          <WorkspaceList
            workspaces={workspaces}
            activeId={activeWorkspace?.id}
            onSelect={setActiveWorkspace}
            onCreate={async (input) => { await createWorkspace(input); }}
          />
        </Sider>
        <Content style={{ display: 'flex', flexDirection: 'column' }}>
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
                <WebContent tab={activeTab} cleanerEnabled={cleanerEnabled} blockedDomains={blockedDomains} />
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="选择或新建 Workspace 开始" />
            </div>
          )}
        </Content>
        <Sider width={280} theme="light" style={{ borderLeft: '1px solid #f0f0f0' }}>
          {activeWorkspace ? (
            <LibraryList
              documents={documents}
              history={history}
              onOpenDocument={(d) => { window.open(d.url, '_blank'); }}
              onReplayQuery={handleSearch}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Library 暂不可用" style={{ marginTop: 24 }} />
          )}
        </Sider>
      </Layout>
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
    </Layout>
  );
}
