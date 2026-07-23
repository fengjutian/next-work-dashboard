import React, { useState } from 'react';
import { Globe, Plus, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/store';

export const AIPanel: React.FC = () => {
  const { sites, tabs, openTab, setActiveTab, activeTabId, addSite } = useStore();
  const enabledSites = sites.filter((s) => s.enabled).sort((a, b) => a.sortOrder - b.sortOrder);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const handleAddSite = () => {
    if (!newName.trim() || !newUrl.trim()) return;

    const exists = sites.find((s) => s.url === newUrl.trim());
    if (exists) {
      // 站点已存在，直接打开
      openTab(exists.id);
    } else {
      const id = `custom-${Date.now()}`;
      addSite({
        id,
        name: newName.trim(),
        url: newUrl.trim(),
        inputSelector: 'textarea',
        submitSelector: '',
        enabled: true,
        sortOrder: sites.length,
      });
      openTab(id);
    }

    setNewName('');
    setNewUrl('');
    setShowAddForm(false);
  };

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
          onClick={() => setShowAddForm(!showAddForm)}
          title="添加站点"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Separator />

      {/* 添加站点表单 */}
      {showAddForm && (
        <>
          <div className="p-3 space-y-2 bg-zinc-50 dark:bg-zinc-900 border-b">
            <Input
              className="h-7 text-xs"
              placeholder="站点名称，如 Claude"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSite()}
            />
            <Input
              className="h-7 text-xs"
              placeholder="URL，如 https://claude.ai"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSite()}
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={handleAddSite}
                disabled={!newName.trim() || !newUrl.trim()}
              >
                添加并打开
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => { setShowAddForm(false); setNewName(''); setNewUrl(''); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <Separator />
        </>
      )}

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
                  点击右上角 + 添加站点
                </p>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
