import React from 'react';
import { Database, Puzzle, Settings, X } from '@/components/icons';
import { ActivityBar } from '@/components/ActivityBar';
import { TitleBar } from '@/components/TitleBar';
import { AIPanel, AISiteWelcome, WebViewContainer } from '@/plugins/ai';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { PromptDrawer } from '@/plugins/prompts';
import { CommandPalette } from '@/components/CommandPalette';
import { PluginStatusBar } from '@/components/PluginStatusBar';
import { ToastProvider } from '@/components/Toast';
import { usePersistence } from '@/hooks/usePersistence';
import { useDbPersistence } from '@/hooks/useDbPersistence';
import { useStore } from '@/store';
import { pluginRegistry, registerBuiltInPlugins, rehydrateUserPlugins, usePluginRegistryVersion } from '@/plugins';

// 模块加载时注册所有内置插件（一次性、幂等）
registerBuiltInPlugins();
rehydrateUserPlugins();

// ── 空状态（无标签页时，仅 AI 模式显示） ──

// ── 根布局 ──

export default function App() {
  usePluginRegistryVersion();
  const {
    activeActivity,
    tabs,
    theme,
  } = useStore();
  usePersistence();
  useDbPersistence();
  const [bottomOverlay, setBottomOverlay] = React.useState<'database' | 'plugin-manager' | 'settings' | null>(null);
  const visitedPluginIds = React.useRef(new Set<string>());
  if (activeActivity) visitedPluginIds.current.add(activeActivity);

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

  React.useEffect(() => {
    if (!bottomOverlay) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setBottomOverlay(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [bottomOverlay]);

  const bottomOverlayPlugin = bottomOverlay === 'database' || bottomOverlay === 'plugin-manager'
    ? pluginRegistry.get(bottomOverlay)
    : undefined;
  const BottomOverlayPanel = bottomOverlayPlugin?.component;

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
            {tabs.length > 0 ? <WebViewContainer /> : <AISiteWelcome />}
          </div>

          {/* 动态插件面板 — 由 pluginRegistry 驱动的常驻面板 */}
          {pluginRegistry.getEnabled()
            .filter((p) => p.id !== 'ai')
            .filter((p) => activeActivity === p.id || (p.keepAlive && visitedPluginIds.current.has(p.id)))
            .map((p) => {
              const Panel = p.component;
              return (
                <div
                  key={p.id}
                  className="flex-1 flex flex-col overflow-hidden"
                  style={{ display: activeActivity === p.id ? 'flex' : 'none' }}
                >
                  <React.Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载插件中…</div>}>
                    <Panel />
                  </React.Suspense>
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

      {bottomOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5" onMouseDown={() => setBottomOverlay(null)}>
          <section className="flex h-[88vh] w-[92vw] max-w-[1600px] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={bottomOverlay === 'database' ? '数据库浏览器' : bottomOverlay === 'plugin-manager' ? '插件管理' : '设置'}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-4">
              {bottomOverlay === 'database' ? <Database className="h-4 w-4 text-primary" /> : bottomOverlay === 'plugin-manager' ? <Puzzle className="h-4 w-4 text-primary" /> : <Settings className="h-4 w-4 text-primary" />}
              <h2 className="text-sm font-semibold">{bottomOverlay === 'database' ? '数据库浏览器' : bottomOverlay === 'plugin-manager' ? '插件管理' : '设置'}</h2>
              <div className="flex-1" />
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setBottomOverlay(null)} title="关闭" aria-label="关闭弹层"><X className="h-4 w-4" /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
              <React.Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>}>
                {bottomOverlay === 'settings' ? <SettingsSidebar /> : BottomOverlayPanel ? <BottomOverlayPanel /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">模块不可用</div>}
              </React.Suspense>
            </div>
          </section>
        </div>
      )}

      {/* 底部状态栏 — 插件状态栏项 + 设置 */}
      <div className="h-7 flex items-center px-2 border-t border-[#61245b] bg-[#61245b] text-white/85 select-none flex-shrink-0 gap-2 shadow-[0_-1px_3px_rgb(97_36_91_/_0.16)]">
        <PluginStatusBar />
        <button
          className={`h-6 w-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            bottomOverlay === 'database'
              ? 'bg-white/20 text-white'
              : 'text-white/80 hover:bg-white/15 hover:text-white'
          }`}
          onClick={() => setBottomOverlay((current) => current === 'database' ? null : 'database')}
          title="数据库浏览器"
          aria-label="数据库浏览器"
        >
          <Database className="h-4 w-4" />
        </button>
        <button
          className={`h-6 w-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            bottomOverlay === 'plugin-manager'
              ? 'bg-white/20 text-white'
              : 'text-white/80 hover:bg-white/15 hover:text-white'
          }`}
          onClick={() => setBottomOverlay((current) => current === 'plugin-manager' ? null : 'plugin-manager')}
          title="插件管理"
          aria-label="插件管理"
        >
          <Puzzle className="h-4 w-4" />
        </button>
        <button
          className={`h-6 w-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            bottomOverlay === 'settings'
              ? 'bg-white/20 text-white'
              : 'text-white/80 hover:bg-white/15 hover:text-white'
          }`}
          onClick={() => setBottomOverlay((current) => current === 'settings' ? null : 'settings')}
          title="设置"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
    </ToastProvider>
  );
}
