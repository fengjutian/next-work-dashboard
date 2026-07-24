import React from 'react';
import { Globe, MessageSquare, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActivityBar } from '@/components/ActivityBar';
import { AIPanel } from '@/components/AIPanel';
import { PromptSidebar } from '@/components/PromptSidebar';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { ConversationHistory } from '@/components/ConversationHistory';
import { PromptDrawer } from '@/components/PromptDrawer';
import { WebViewContainer } from '@/components/WebViewContainer';
import { CommandPalette } from '@/components/CommandPalette';
import { ToastProvider } from '@/components/Toast';
import { usePersistence } from '@/hooks/usePersistence';
import { useStore } from '@/store';

// ── 空状态（无标签页时，仅 AI 模式显示） ──

const EmptyState: React.FC = () => {
  const { sites, openTab } = useStore();
  const enabledSites = sites.filter((s) => s.enabled);

  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="text-center space-y-6 max-w-md">
        <Globe className="h-12 w-12 text-zinc-300 mx-auto" />
        <div>
          <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-200 mb-2">
            next-work-dashboard
          </h1>
          {enabledSites.length > 0 ? (
            <p className="text-sm text-zinc-500">
              选择一个 AI 站点开始对话
            </p>
          ) : (
            <p className="text-xs text-zinc-400">
              请在设置中启用 AI 站点
            </p>
          )}
        </div>
        {enabledSites.length > 0 && (
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
        )}
      </div>
    </div>
  );
};

// ── 根布局 ──

export default function App() {
  const {
    activeActivity,
    setActiveActivity,
    tabs,
    injectMode,
    setInjectMode,
    injectStrategy,
    setInjectStrategy,
    theme,
    promptDrawerOpen,
    setPromptDrawerOpen,
  } = useStore();
  usePersistence();

  // 应用主题
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const isAI = activeActivity === 'ai' || activeActivity === null;
  const isPrompts = activeActivity === 'prompts';
  const isHistory = activeActivity === 'history';
  const isSettings = activeActivity === 'settings';

  return (
    <ToastProvider>
    <div className="h-screen flex flex-col">
      {/* 顶部工具栏 */}
      <div className="h-10 flex items-center px-3 border-b bg-white dark:bg-zinc-950 gap-2 select-none">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          next-work-dashboard
        </span>

        <div className="flex-1" />

        {/* 注入模式切换 — 仅 AI 模式显示 */}
        {isAI && (
          <>
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
          </>
        )}

        {isAI && (
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ml-1 ${promptDrawerOpen ? 'text-blue-500' : ''}`}
            onClick={() => setPromptDrawerOpen(!promptDrawerOpen)}
            title="提示词"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 主体：Activity Bar + AI 侧边栏 + 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* VSCode 风格 Activity Bar */}
        <ActivityBar />

        {/* AI 侧边栏 — 常驻但仅 AI 模式可见 */}
        <div style={{ display: isAI ? 'flex' : 'none' }} className="h-full">
          <AIPanel />
        </div>

        {/* 主内容区 — 三个面板常驻，CSS 显隐切换 */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* AI 面板：WebView */}
          <div
            className="flex-1 flex flex-col"
            style={{ display: isAI ? 'flex' : 'none' }}
          >
            {tabs.length > 0 ? <WebViewContainer /> : <EmptyState />}
          </div>

          {/* 提示词面板 */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
            style={{ display: isPrompts ? 'flex' : 'none' }}
          >
            <PromptSidebar />
          </div>

          {/* 历史面板 */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
            style={{ display: isHistory ? 'flex' : 'none' }}
          >
            <ConversationHistory />
          </div>

          {/* 设置面板 */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
            style={{ display: isSettings ? 'flex' : 'none' }}
          >
            <SettingsSidebar />
          </div>
        </div>
      </div>

      {/* 浮动搜索面板 */}
      <CommandPalette />

      {/* 提示词抽屉 */}
      <PromptDrawer />

      {/* 底部状态栏 — 设置 */}
      <div className="h-8 flex items-center justify-end px-2 border-t bg-zinc-100 dark:bg-zinc-900 select-none flex-shrink-0">
        <button
          className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${
            isSettings
              ? 'text-zinc-900 dark:text-zinc-100 bg-zinc-200 dark:bg-zinc-700'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800'
          }`}
          onClick={() => setActiveActivity(isSettings ? null : 'settings')}
          title="设置"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
    </ToastProvider>
  );
}
