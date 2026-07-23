import React from 'react';
import { Globe, Plus, ExternalLink } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/store';

export const AIPanel: React.FC = () => {
  const { sites, tabs, openTab, setActiveTab, activeTabId } = useStore();
  const enabledSites = sites.filter((s) => s.enabled).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="h-full w-[260px] flex-shrink-0 border-r flex flex-col bg-white dark:bg-zinc-950">
      {/* 头部 */}
      <div className="px-3 py-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          AI 站点
        </h3>
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
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                      activeTabId === tab.id
                        ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <ExternalLink
                      className={`h-3 w-3 shrink-0 ${
                        activeTabId === tab.id ? 'text-blue-500' : 'text-zinc-400'
                      }`}
                    />
                    <span className="truncate">{tab.title}</span>
                  </button>
                ))}
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
                  className="w-full text-left px-2 py-2 rounded-md text-sm transition-colors flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 group"
                  onClick={() => openTab(site.id)}
                >
                  <Globe className="h-3.5 w-3.5 text-zinc-400 group-hover:text-blue-500 transition-colors" />
                  <span className="flex-1 truncate">{site.name}</span>
                  <Plus className="h-3 w-3 text-zinc-300 group-hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100" />
                </button>
              ))}
              {enabledSites.length === 0 && (
                <p className="text-xs text-zinc-400 py-4 text-center">
                  没有启用的站点，请在设置中启用
                </p>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
