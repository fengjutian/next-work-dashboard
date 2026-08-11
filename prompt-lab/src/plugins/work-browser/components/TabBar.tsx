/**
 * TabBar — Tab 切换栏
 */
import { Tabs, Button, Space } from '../ui';
import { ArrowRight, Globe2, X } from 'lucide-react';
import { useState } from 'react';
import type { Tab } from '../../../core/work-browser/types';

export interface TabBarProps {
  tabs: Tab[];
  activeId?: string;
  onActivate: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
  onAdd: (url: string) => boolean | Promise<boolean>;
}

export function TabBar({ tabs, activeId, onActivate, onClose, onAdd }: TabBarProps) {
  const [url, setUrl] = useState('');
  const submitUrl = async () => {
    const value = url.trim();
    if (!value) return;
    if (await onAdd(value)) setUrl('');
  };
  const items = tabs.map((t) => ({
    key: t.id,
    label: (
      <Space size={4}>
        {t.favicon && <img src={t.favicon} alt="" style={{ width: 14, height: 14 }} />}
        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.url}</span>
        <Button
          type="text"
          size="small"
          icon={<X size={12} />}
          onClick={(e) => { e.stopPropagation(); onClose(t); }}
        />
      </Space>
    ),
  }));

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/70 px-2 pt-1">
      <div className="min-w-0 flex-1 overflow-auto">
        <Tabs
          size="small"
          type="card"
          items={items}
          activeKey={activeId}
          onChange={(key) => {
            const t = tabs.find((x) => x.id === key);
            if (t) onActivate(t);
          }}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </div>
      <div className="mb-1 flex h-9 w-[min(32vw,400px)] shrink-0 items-center rounded-xl border border-border/70 bg-background/80 pl-3 shadow-sm transition focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10">
        <Globe2 size={14} className="shrink-0 text-muted-foreground" />
        <input
          placeholder="输入 URL →"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submitUrl(); }}
          className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          aria-label="打开网址"
          onClick={() => void submitUrl()}
          className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:opacity-40"
          disabled={!url.trim()}
        ><ArrowRight size={13} /></button>
      </div>
    </div>
  );
}
