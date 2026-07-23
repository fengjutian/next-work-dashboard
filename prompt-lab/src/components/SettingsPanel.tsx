import React, { useState } from 'react';
import { X, Plus, Trash2, Globe, Monitor, Moon, Sun } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-md mb-2 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-900">
        <button
          className={`w-2.5 h-2.5 rounded-full ${
            site.enabled ? 'bg-green-500' : 'bg-zinc-300'
          }`}
          onClick={() => onUpdate({ enabled: !site.enabled })}
          title={site.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
        />
        <span className="text-sm flex-1 truncate">{site.name}</span>
        <span className="text-[10px] text-zinc-400 truncate max-w-[200px]">
          {site.url}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-[10px]">{expanded ? '收起' : '编辑'}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-red-400"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {expanded && (
        <div className="px-3 py-2 space-y-2">
          <div>
            <label className="text-[10px] text-zinc-500">名称</label>
            <Input
              value={site.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500">URL</label>
            <Input
              value={site.url}
              onChange={(e) => onUpdate({ url: e.target.value })}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500">
              输入框 CSS 选择器
            </label>
            <Input
              value={site.inputSelector}
              onChange={(e) => onUpdate({ inputSelector: e.target.value })}
              className="h-7 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500">
              发送按钮 CSS 选择器（可选）
            </label>
            <Input
              value={site.submitSelector}
              onChange={(e) => onUpdate({ submitSelector: e.target.value })}
              className="h-7 text-xs font-mono"
              placeholder='留空则只能「仅填充」'
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ── 主设置面板 ──

interface Props {
  onClose: () => void;
}

export const SettingsPanel: React.FC<Props> = ({ onClose }) => {
  const { sites, updateSite } = useStore();
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const handleSiteUpdate = (id: string, patch: Partial<SiteConfig>) => {
    useStore.getState().updateSite(id, patch);
  };

  const handleDeleteSite = (id: string) => {
    const s = useStore.getState();
    if (id.startsWith('custom-')) {
      // 从 sites 中移除（通过 setState）
      useStore.setState({ sites: s.sites.filter((si) => si.id !== id) });
    } else {
      // 预设站点仅禁用
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

  // 确保新增的 site 可以正确加入
  const allSites = useStore((s) => s.sites);

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[8vh] bg-black/40">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl w-[640px] max-h-[84vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">设置</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {/* ── AI 站点 ── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase">
                  AI 站点
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={handleAddSite}
                >
                  <Plus className="h-3 w-3" /> 添加
                </Button>
              </div>
              {allSites
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    onUpdate={(patch) => handleSiteUpdate(site.id, patch)}
                    onDelete={() => handleDeleteSite(site.id)}
                  />
                ))}
              <p className="text-[10px] text-zinc-400 mt-2">
                点击绿色圆点切换启用/禁用。CSS 选择器请在 WebView 中右键检查元素获取。
              </p>
            </section>

            <Separator />

            {/* ── 外观 ── */}
            <section>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-3">
                外观
              </h4>
              <div className="flex gap-2">
                {[
                  { value: 'light' as const, icon: Sun, label: '浅色' },
                  { value: 'dark' as const, icon: Moon, label: '深色' },
                  { value: 'system' as const, icon: Monitor, label: '跟随系统' },
                ].map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors ${
                      theme === value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                    }`}
                    onClick={() => setTheme(value)}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <Separator />

            {/* ── 快捷键 ── */}
            <section>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-3">
                快捷键
              </h4>
              <div className="space-y-2 text-sm">
                {[
                  { keys: 'Ctrl + Shift + Space', desc: '唤起主窗口 + 浮动搜索' },
                  { keys: 'Ctrl + K', desc: '唤起浮动搜索面板' },
                  { keys: 'Ctrl + Enter', desc: '变量填充面板中快速确认' },
                  { keys: '↑↓ Enter Esc', desc: '搜索面板中导航/选择/关闭' },
                ].map(({ keys, desc }) => (
                  <div
                    key={keys}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {desc}
                    </span>
                    <kbd className="text-xs px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 font-mono">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 mt-2">
                快捷键自定义将在后续版本支持
              </p>
            </section>

            <Separator />

            {/* ── 代理 ── */}
            <section>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-3">
                网络代理
              </h4>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-500">协议</label>
                  <select className="w-full h-7 text-xs border rounded px-1 mt-0.5">
                    <option>HTTP</option>
                    <option>HTTPS</option>
                    <option>SOCKS5</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500">主机</label>
                  <Input className="h-7 text-xs mt-0.5" placeholder="127.0.0.1" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500">端口</label>
                  <Input className="h-7 text-xs mt-0.5" placeholder="7890" />
                </div>
                <div className="flex items-end">
                  <Button size="sm" className="h-7 text-xs w-full">
                    应用
                  </Button>
                </div>
              </div>
            </section>

            <Separator />

            {/* ── 导入导出 ── */}
            <section>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-3">
                数据管理
              </h4>
              <ImportExport />
            </section>

            <Separator />
            <section>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-3">
                关于
              </h4>
              <div className="text-xs text-zinc-500 space-y-1">
                <p>PromptLab v0.2.0</p>
                <p>Electron + React + shadcn/ui + sql.js</p>
                <p>数据存储于本地，不上传任何服务器</p>
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
