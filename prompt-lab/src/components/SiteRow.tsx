import React from 'react';
import { Trash2 } from '@/components/icons';
import { Input } from '@/components/ui/input';
import type { SiteConfig } from '@/store';

// ── 站点编辑行（侧边栏紧凑版） ──

export const SiteRow: React.FC<{
  site: SiteConfig;
  onUpdate: (patch: Partial<SiteConfig>) => void;
  onDelete: () => void;
}> = ({ site, onUpdate, onDelete }) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="border rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${
            site.enabled ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
          onClick={() => onUpdate({ enabled: !site.enabled })}
          title={site.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
        />
        <span className="text-xs flex-1 truncate font-medium text-zinc-700 dark:text-zinc-300">
          {site.name}
        </span>
        <button
          className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : '编辑'}
        </button>
        <button
          className="text-red-400 hover:text-red-600 transition-colors"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="px-3 py-2.5 space-y-2 border-t bg-zinc-50/50 dark:bg-zinc-950/50">
          <div>
            <label className="text-[10px] text-zinc-500 font-medium">名称</label>
            <Input
              value={site.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="h-7 text-xs mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-medium">URL</label>
            <Input
              value={site.url}
              onChange={(e) => onUpdate({ url: e.target.value })}
              className="h-7 text-xs mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-medium">输入框 CSS 选择器</label>
            <Input
              value={site.inputSelector}
              onChange={(e) => onUpdate({ inputSelector: e.target.value })}
              className="h-7 text-xs font-mono mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-medium">发送按钮 CSS 选择器</label>
            <Input
              value={site.submitSelector}
              onChange={(e) => onUpdate({ submitSelector: e.target.value })}
              className="h-7 text-xs font-mono mt-0.5"
              placeholder="留空则只能「仅填充」"
            />
          </div>
        </div>
      )}
    </div>
  );
};
