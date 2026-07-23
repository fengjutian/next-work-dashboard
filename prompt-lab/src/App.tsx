import React, { useState } from 'react';
import { PanelLeft, PanelRight, Globe, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PromptSidebar } from '@/components/PromptSidebar';
import { WebViewContainer } from '@/components/WebViewContainer';
import { CommandPalette } from '@/components/CommandPalette';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ToastProvider } from '@/components/Toast';
import { usePersistence } from '@/hooks/usePersistence';
import { useStore } from '@/store';

// ── 空状态（无标签页时） ──

const EmptyState: React.FC = () => {
  const { sites, openTab } = useStore();
  const enabledSites = sites.filter((s) => s.enabled);

  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="text-center space-y-6 max-w-md">
        <Globe className="h-12 w-12 text-zinc-300 mx-auto" />
        <div>
          <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-200 mb-2">
            PromptLab
          </h1>
          <p className="text-sm text-zinc-500">
            在左侧选择提示词，然后打开一个 AI 网站开始使用
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {enabledSites.map((site) => (
            <button
              key={site.id}
              className="px-4 py-3 rounded-lg border bg-white dark:bg-zinc-800 hover:border-blue-400 hover:shadow-sm transition-all text-sm text-zinc-700 dark:text-zinc-300"
              onClick={() => openTab(site.id)}
            >
              + {site.name}
            </button>
          ))}
        </div>
        {enabledSites.length === 0 && (
          <p className="text-xs text-zinc-400">
            请在设置中启用 AI 站点
          </p>
        )}
      </div>
    </div>
  );
};

// ── 根布局 ──

export default function App() {
  const { sidebarOpen, toggleSidebar, tabs, injectMode, setInjectMode, injectStrategy, setInjectStrategy, theme } =
    useStore();
  usePersistence();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 应用主题
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return (
    <ToastProvider>
    <div className="h-screen flex flex-col">
      {/* 顶部工具栏 */}
      <div className="h-10 flex items-center px-3 border-b bg-white dark:bg-zinc-950 gap-2 select-none">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleSidebar}
        >
          {sidebarOpen ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelRight className="h-4 w-4" />
          )}
        </Button>

        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          PromptLab
        </span>

        <div className="flex-1" />

        {/* 注入模式切换 */}
        <div className="flex items-center gap-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
          <button
            className={`px-2 py-0.5 rounded-sm transition-colors ${
              injectMode === 'fill-only'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setInjectMode('fill-only')}
          >
            仅填充
          </button>
          <button
            className={`px-2 py-0.5 rounded-sm transition-colors ${
              injectMode === 'fill-and-submit'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setInjectMode('fill-and-submit')}
          >
            填充并发送
          </button>
        </div>

        {/* 追加/替换 */}
        <div className="flex items-center gap-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5 ml-1">
          <button
            className={`px-2 py-0.5 rounded-sm transition-colors ${
              injectStrategy === 'replace'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setInjectStrategy('replace')}
          >
            替换
          </button>
          <button
            className={`px-2 py-0.5 rounded-sm transition-colors ${
              injectStrategy === 'append'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setInjectStrategy('append')}
          >
            追加
          </button>
        </div>

        <Button variant="ghost" size="icon" className="h-7 w-7 ml-1" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4 text-zinc-500" />
        </Button>
      </div>

      {/* 主体：侧边栏 + WebView */}
      <div className="flex flex-1 overflow-hidden">
        <PromptSidebar collapsed={!sidebarOpen} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {tabs.length > 0 ? <WebViewContainer /> : <EmptyState />}
        </div>
      </div>

      {/* 浮动搜索面板 */}
      <CommandPalette />

      {/* 设置面板 */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
    </ToastProvider>
  );
}
