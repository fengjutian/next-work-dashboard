import React from 'react';
import { Trash2 } from 'lucide-react';
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
