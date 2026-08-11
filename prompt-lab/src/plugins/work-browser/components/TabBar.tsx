/**
 * TabBar — Tab 切换栏
 */
import { Tabs, Space } from '../ui';
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
      <Space size={6} className="group/tab min-w-0">
        {t.favicon ? <img src={t.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" /> : <Globe2 size={13} className="shrink-0 text-muted-foreground" />}
        <span className="max-w-36 truncate" title={t.title || t.url}>{formatTabTitle(t)}</span>
        <button
          type="button"
          aria-label={`关闭 ${t.title || t.url}`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 opacity-0 transition hover:bg-primary/10 hover:text-primary focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 group-hover/tab:opacity-100"
          onClick={(e) => { e.stopPropagation(); onClose(t); }}
        ><X size={11} /></button>
      </Space>
    ),
  }));

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/30 bg-muted/10 px-2">
      <div className="work-browser-tab-strip min-w-0 flex-1 overflow-hidden">
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
      <div className="flex h-8 w-[min(30vw,360px)] shrink-0 items-center rounded-lg border border-transparent bg-muted/45 pl-2.5 transition focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/10">
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
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-muted disabled:text-muted-foreground"
          disabled={!url.trim()}
        ><ArrowRight size={13} /></button>
      </div>
    </div>
  );
}

function formatTabTitle(tab: Tab): string {
  const title = (tab.title || '').trim();
  if (title && title !== tab.url && !/^https?:\/\//i.test(title)) return title;
  try {
    const url = new URL(tab.url);
    return url.hostname.replace(/^www\./, '') || '新标签页';
  } catch {
    return title || '新标签页';
  }
}
