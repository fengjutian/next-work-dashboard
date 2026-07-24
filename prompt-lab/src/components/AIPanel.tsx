import React, { useState, useEffect } from 'react';
import { Globe, PanelLeft, PanelRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/store';

// 根据站点 ID 取色，保证同一站点颜色一致
const SITE_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
];

function hashColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return SITE_COLORS[Math.abs(hash) % SITE_COLORS.length];
}

// favicon 组件 — 通过主进程 IPC 获取，绕开浏览器限制
// name 用于首字母头像兜底；加载中 / 失败时展示该头像
const SiteIcon: React.FC<{ url: string; name: string; className?: string }> = ({ url, name, className = 'h-4 w-4' }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!window.electronAPI?.fetchFavicon) {
      setFailed(true);
      return;
    }
    window.electronAPI.fetchFavicon(url).then((result) => {
      if (!cancelled) {
        if (result) setDataUrl(result);
        else setFailed(true);
      }
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [url]);

  const colorClass = hashColor(url);
  const letter = name?.trim()?.[0] ?? '?';

  // 加载中 / 失败 — 首字母头像
  if (failed || !dataUrl) {
    return (
      <span
        className={`${className} rounded-sm flex items-center justify-center text-[10px] font-bold ${colorClass} ${!failed && !dataUrl ? 'animate-pulse' : ''}`}
        title={name}
      >
        {letter}
      </span>
    );
  }

  return (
    <img
      src={dataUrl}
      className={`${className} rounded-sm`}
      onError={() => setFailed(true)}
      alt=""
    />
  );
};

export const AIPanel: React.FC = () => {
  const { sites, tabs, openTab, setActiveTab, activeTabId } = useStore();
  const enabledSites = sites.filter((s) => s.enabled).sort((a, b) => a.sortOrder - b.sortOrder);

  const [collapsed, setCollapsed] = useState(true);

  // ── 折叠态：窄条 ──
  if (collapsed) {
    return (
      <div className="h-full w-9 flex-shrink-0 border-r flex flex-col items-center py-2 gap-1 bg-white dark:bg-zinc-950">
        {/* 展开按钮 */}
        <button
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 mb-1"
          onClick={() => setCollapsed(false)}
          title="展开面板"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>

        <Separator className="w-6" />

        {/* 标签页图标 */}
        {tabs.map((tab) => {
          const site = sites.find((s) => s.id === tab.siteId);
          return (
            <button
              key={tab.id}
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                activeTabId === tab.id
                  ? 'bg-blue-100 dark:bg-blue-900 ring-1 ring-blue-300 dark:ring-blue-700'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              onClick={() => setActiveTab(tab.id)}
              title={tab.title}
            >
              {site ? <SiteIcon url={site.url} name={site.name} className="h-4 w-4" /> : tab.title.slice(0, 2)}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* 快速打开站点 */}
        {enabledSites.map((site) => (
          <button
            key={site.id}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => openTab(site.id)}
            title={site.name}
          >
            <SiteIcon url={site.url} name={site.name} className="h-4 w-4" />
          </button>
        ))}
      </div>
    );
  }

  // ── 展开态：完整面板 ──

  return (
    <div className="h-full w-[260px] flex-shrink-0 border-r flex flex-col bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          AI 站点
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setCollapsed(true)}
          title="折叠面板"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* 已打开的标签页 */}
          {tabs.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-zinc-400 uppercase mb-2">
                已打开 ({tabs.length})
              </h4>
              <div className="space-y-0.5">
                {tabs.map((tab) => {
                  const site = sites.find((s) => s.id === tab.siteId);
                  return (
                    <button
                      key={tab.id}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                        activeTabId === tab.id
                          ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {site ? (
                        <SiteIcon url={site.url} name={site.name} className="h-4 w-4 shrink-0" />
                      ) : (
                        <Globe className="h-3 w-3 shrink-0 text-zinc-400" />
                      )}
                      <span className="truncate">{tab.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 可用站点 */}
          <div>
            <h4 className="text-[10px] font-semibold text-zinc-400 uppercase mb-2">
              可用站点
            </h4>
            <div className="space-y-1">
              {enabledSites.map((site) => (
                <button
                  key={site.id}
                  className="w-full text-left px-2 py-2 rounded-md text-sm transition-colors flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  onClick={() => openTab(site.id)}
                >
                  <SiteIcon url={site.url} name={site.name} className="h-5 w-5 shrink-0" />
                  <span className="flex-1 truncate">{site.name}</span>
                </button>
              ))}
              {enabledSites.length === 0 && (
                <p className="text-xs text-zinc-400 py-4 text-center">
                  请在设置中启用 AI 站点
                </p>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
