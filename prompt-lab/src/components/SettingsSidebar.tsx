import React from 'react';
import { Plus, Trash2, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ImportExport } from '@/components/ImportExport';
import { useStore } from '@/store';
import type { SiteConfig } from '@/store';

// ── 站点编辑行 ──

const SiteRow: React.FC<{
  site: SiteConfig;
  onUpdate: (patch: Partial<SiteConfig>) => void;
  onDelete: () => void;
}> = ({ site, onUpdate, onDelete }) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="border rounded-md mb-2 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-50 dark:bg-zinc-900">
        <button
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            site.enabled ? 'bg-green-500' : 'bg-zinc-300'
          }`}
          onClick={() => onUpdate({ enabled: !site.enabled })}
          title={site.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
        />
        <span className="text-xs flex-1 truncate">{site.name}</span>
        <button
          className="text-[9px] text-zinc-400 hover:text-zinc-600"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : '编辑'}
        </button>
        <button
          className="text-red-400 hover:text-red-600"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <div className="px-2 py-2 space-y-1.5 border-t">
          <div>
            <label className="text-[9px] text-zinc-500">名称</label>
            <Input
              value={site.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="h-6 text-xs"
            />
          </div>
          <div>
            <label className="text-[9px] text-zinc-500">URL</label>
            <Input
              value={site.url}
              onChange={(e) => onUpdate({ url: e.target.value })}
              className="h-6 text-xs"
            />
          </div>
          <div>
            <label className="text-[9px] text-zinc-500">输入框 CSS 选择器</label>
            <Input
              value={site.inputSelector}
              onChange={(e) => onUpdate({ inputSelector: e.target.value })}
              className="h-6 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-[9px] text-zinc-500">发送按钮 CSS 选择器</label>
            <Input
              value={site.submitSelector}
              onChange={(e) => onUpdate({ submitSelector: e.target.value })}
              className="h-6 text-xs font-mono"
              placeholder="留空则只能「仅填充」"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ── 侧边栏设置面板 ──

export const SettingsSidebar: React.FC = () => {
  const sites = useStore((s) => s.sites);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const handleSiteUpdate = (id: string, patch: Partial<SiteConfig>) => {
    useStore.getState().updateSite(id, patch);
  };

  const handleDeleteSite = (id: string) => {
    const s = useStore.getState();
    if (id.startsWith('custom-')) {
      useStore.setState({ sites: s.sites.filter((si) => si.id !== id) });
    } else {
      s.updateSite(id, { enabled: false });
    }
  };

  const handleAddSite = () => {
    const s = useStore.getState();
    useStore.getState().addSite({
      id: `custom-${Date.now()}`,
      name: '新站点',
      url: 'https://',
      inputSelector: 'textarea',
      submitSelector: '',
      enabled: true,
      sortOrder: s.sites.length,
    });
  };

  const allSites = [...sites].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="h-full flex-1 flex flex-col bg-white dark:bg-zinc-950">
      <div className="px-3 py-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          设置
        </h3>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-5">
          {/* AI 站点 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-semibold text-zinc-500 uppercase">
                AI 站点
              </h4>
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[10px] gap-1 px-1.5"
                onClick={handleAddSite}
              >
                <Plus className="h-2.5 w-2.5" /> 添加
              </Button>
            </div>
            {allSites.map((site) => (
              <SiteRow
                key={site.id}
                site={site}
                onUpdate={(patch) => handleSiteUpdate(site.id, patch)}
                onDelete={() => handleDeleteSite(site.id)}
              />
            ))}
          </section>

          <Separator />

          {/* 外观 */}
          <section>
            <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
              外观
            </h4>
            <div className="flex flex-col gap-1.5">
              {[
                { value: 'light' as const, icon: Sun, label: '浅色' },
                { value: 'dark' as const, icon: Moon, label: '深色' },
                { value: 'system' as const, icon: Monitor, label: '跟随系统' },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                    theme === value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                  }`}
                  onClick={() => setTheme(value)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          <Separator />

          {/* 快捷键 */}
          <section>
            <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
              快捷键
            </h4>
            <div className="space-y-1.5 text-xs">
              {[
                { keys: 'Ctrl + Shift + Space', desc: '唤起主窗口 + 浮动搜索' },
                { keys: 'Ctrl + K', desc: '唤起浮动搜索面板' },
                { keys: 'Ctrl + Enter', desc: '变量填充面板中快速确认' },
                { keys: '↑↓ Enter Esc', desc: '搜索面板中导航/选择/关闭' },
              ].map(({ keys, desc }) => (
                <div key={keys} className="flex items-center justify-between py-0.5">
                  <span className="text-zinc-600 dark:text-zinc-400">{desc}</span>
                  <kbd className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 font-mono">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          {/* 导入导出 */}
          <section>
            <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
              数据管理
            </h4>
            <ImportExport />
          </section>

          <Separator />

          {/* 关于 */}
          <section>
            <h4 className="text-[10px] font-semibold text-zinc-500 uppercase mb-2">
              关于
            </h4>
            <div className="text-[10px] text-zinc-500 space-y-0.5">
              <p>PromptLab v0.2.0</p>
              <p>Electron + React + shadcn/ui + sql.js</p>
              <p>数据存储于本地，不上传任何服务器</p>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
};
