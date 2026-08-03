import React from 'react';
import { Database, Edit3, MessageSquare, Plus, Puzzle, Send, Settings } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ActivityBar } from '@/components/ActivityBar';
import { TitleBar } from '@/components/TitleBar';
import { AIPanel } from '@/components/AIPanel';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { PromptDrawer } from '@/components/PromptDrawer';
import { WebViewContainer } from '@/components/WebViewContainer';
import { CommandPalette } from '@/components/CommandPalette';
import { PluginStatusBar } from '@/components/PluginStatusBar';
import { AISiteWelcome } from '@/components/AISiteWelcome';
import { ToastProvider } from '@/components/Toast';
import { usePersistence } from '@/hooks/usePersistence';
import { useDbPersistence } from '@/hooks/useDbPersistence';
import { useStore } from '@/store';
import { pluginRegistry, registerBuiltInPlugins, rehydrateUserPlugins } from '@/plugins';

// 模块加载时注册所有内置插件（一次性、幂等）
registerBuiltInPlugins();
rehydrateUserPlugins();

type ToolbarOption<T extends string> = {
  value: T;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
};

function ToolbarSegment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ToolbarOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="flex h-8 items-center rounded-lg border border-border/70 bg-muted/60 p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            }`}
            aria-pressed={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 空状态（无标签页时，仅 AI 模式显示） ──

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
  useDbPersistence();

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
  const isSettings = activeActivity === 'settings';
  const isPluginManager = activeActivity === 'plugin-manager';
  const isDatabase = activeActivity === 'database';

  // 根据 activeActivity 找到对应的插件（非 AI/非 settings 时）
  const activePlugin =
    !isAI && !isSettings && activeActivity
      ? pluginRegistry.get(activeActivity)
      : undefined;

  return (
    <ToastProvider>
    <div className="h-screen flex flex-col">
      <TitleBar />
      {/* 主体：Activity Bar + AI 侧边栏 + 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* VSCode 风格 Activity Bar — 从插件注册中心动态渲染图标 */}
        <ActivityBar />

        {/* AI 侧边栏 — 常驻但仅 AI 模式可见（特殊布局：AIPanel 在 ActivityBar 右侧） */}
        <div style={{ display: isAI ? 'flex' : 'none' }} className="h-full">
          <AIPanel />
        </div>

        {/* 主内容区 — 插件面板动态渲染（保持挂载以保留状态） */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* AI 面板：WebView */}
          <div
            className="flex-1 flex flex-col"
            style={{ display: isAI ? 'flex' : 'none' }}
          >
            <div className="flex h-11 flex-shrink-0 items-center justify-end gap-1.5 border-b bg-card/95 px-3 select-none">
              <ToolbarSegment
                label="发送方式"
                value={injectMode}
                onChange={setInjectMode}
                options={[
                  { value: 'fill-only', label: '仅填充', title: '仅填充输入框', icon: Edit3 },
                  { value: 'fill-and-submit', label: '填充并发送', title: '填充输入框并立即发送', icon: Send },
                ]}
              />
              <ToolbarSegment
                label="内容处理方式"
                value={injectStrategy}
                onChange={setInjectStrategy}
                options={[
                  { value: 'replace', label: '替换', title: '替换输入框中的现有内容', icon: Edit3 },
                  { value: 'append', label: '追加', title: '追加到输入框的现有内容后', icon: Plus },
                ]}
              />
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 flex-shrink-0 ${promptDrawerOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                onClick={() => setPromptDrawerOpen(!promptDrawerOpen)}
                title="提示词"
                aria-label="打开提示词"
                aria-pressed={promptDrawerOpen}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
            {tabs.length > 0 ? <WebViewContainer /> : <AISiteWelcome />}
          </div>

          {/* 动态插件面板 — 由 pluginRegistry 驱动的常驻面板 */}
          {pluginRegistry.getEnabled()
            .filter((p) => p.id !== 'ai')
            .map((p) => {
              const Panel = p.component;
              return (
                <div
                  key={p.id}
                  className="flex-1 flex flex-col overflow-hidden"
                  style={{ display: activeActivity === p.id ? 'flex' : 'none' }}
                >
                  <Panel />
                </div>
              );
            })}

          {/* 设置面板 — 底部状态栏触发，非插件 */}
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

      {/* 底部状态栏 — 插件状态栏项 + 设置 */}
      <div className="h-7 flex items-center px-2 border-t border-[#61245b] bg-[#61245b] text-white/85 select-none flex-shrink-0 gap-2 shadow-[0_-1px_3px_rgb(97_36_91_/_0.16)]">
        <PluginStatusBar />
        <button
          className={`h-6 w-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            isDatabase
              ? 'bg-white/20 text-white'
              : 'text-white/80 hover:bg-white/15 hover:text-white'
          }`}
          onClick={() => setActiveActivity(isDatabase ? null : 'database')}
          title="数据库浏览器"
          aria-label="数据库浏览器"
        >
          <Database className="h-4 w-4" />
        </button>
        <button
          className={`h-6 w-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            isPluginManager
              ? 'bg-white/20 text-white'
              : 'text-white/80 hover:bg-white/15 hover:text-white'
          }`}
          onClick={() => setActiveActivity(isPluginManager ? null : 'plugin-manager')}
          title="插件管理"
          aria-label="插件管理"
        >
          <Puzzle className="h-4 w-4" />
        </button>
        <button
          className={`h-6 w-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            isSettings
              ? 'bg-white/20 text-white'
              : 'text-white/80 hover:bg-white/15 hover:text-white'
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
