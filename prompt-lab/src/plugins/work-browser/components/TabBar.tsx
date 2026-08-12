import {
  ArrowRight, Copy, Globe2, Home, ListTree, Pin, PinOff, Plus, RefreshCw,
  RotateCcw, Rows3, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Tab } from '../../../core/work-browser/types';

export interface TabBarProps {
  tabs: Tab[];
  activeId?: string;
  canReopen?: boolean;
  onActivate: (tab: Tab) => void;
  onHome: () => void;
  onClose: (tab: Tab) => void | Promise<void>;
  onCloseRight: (tab: Tab) => void | Promise<void>;
  onCloseOthers: (tab: Tab) => void | Promise<void>;
  onDuplicate: (tab: Tab) => void | Promise<void>;
  onPin: (tab: Tab) => void | Promise<void>;
  onRefresh: (tab: Tab) => void;
  onReopen: () => void | Promise<void>;
  onAddRight: (tab: Tab) => void | Promise<void>;
  onAdd: (url: string) => boolean | Promise<boolean>;
}

export function TabBar(props: TabBarProps) {
  const { tabs, activeId, canReopen, onActivate, onHome, onClose, onCloseRight,
    onCloseOthers, onDuplicate, onPin, onRefresh, onReopen, onAddRight, onAdd } = props;
  const [url, setUrl] = useState('');
  const [vertical, setVertical] = useState(() => localStorage.getItem('work-browser.vertical-tabs') === 'true');
  const [menu, setMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
  const orderedTabs = useMemo(() => [...tabs].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.position - b.position), [tabs]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [menu]);

  const submitUrl = async () => {
    const value = url.trim();
    if (value && await onAdd(value)) setUrl('');
  };
  const run = (action: () => void | Promise<void>) => {
    setMenu(null);
    void action();
  };
  const toggleVertical = () => {
    setVertical((current) => {
      localStorage.setItem('work-browser.vertical-tabs', String(!current));
      return !current;
    });
    setMenu(null);
  };

  const tabButton = (tab: Tab, isVertical = false) => (
    <div
      key={tab.id}
      role="tab"
      aria-selected={activeId === tab.id}
      onClick={() => onActivate(tab)}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ tab, x: event.clientX, y: event.clientY });
      }}
      className={`group/tab flex shrink-0 cursor-default items-center gap-2 rounded-xl text-xs transition ${
        isVertical ? 'h-9 w-full px-2.5' : tab.isPinned ? 'h-9 w-10 justify-center px-0' : 'h-9 min-w-28 max-w-56 px-3'
      } ${activeId === tab.id ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'}`}
      title={tab.title || tab.url}
    >
      {tab.favicon ? <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" /> : <Globe2 size={13} className="shrink-0" />}
      {(!tab.isPinned || isVertical) && <span className="min-w-0 flex-1 truncate">{formatTabTitle(tab)}</span>}
      {tab.isPinned && isVertical && <Pin size={11} className="shrink-0" />}
      {!tab.isPinned && (
        <button type="button" aria-label={`关闭 ${tab.title || tab.url}`} onClick={(event) => { event.stopPropagation(); void onClose(tab); }} className="grid h-5 w-5 shrink-0 place-items-center rounded-md opacity-0 hover:bg-primary/10 group-hover/tab:opacity-100 focus:opacity-100">
          <X size={11} />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border/30 bg-muted/10 px-2">
      <button type="button" aria-label="返回首页" title="返回首页" onClick={onHome} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${activeId ? 'text-muted-foreground hover:bg-primary/10 hover:text-primary' : 'bg-primary/10 text-primary shadow-sm'}`}><Home size={15} /></button>
      <div className="work-browser-tab-strip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
        {orderedTabs.map((tab) => tabButton(tab))}
      </div>
      <div className="flex h-8 w-[min(30vw,360px)] shrink-0 items-center rounded-lg bg-muted/45 pl-2.5 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/10">
        <Globe2 size={14} className="shrink-0 text-muted-foreground" />
        <input placeholder="输入 URL →" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitUrl(); }} className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/70" />
        <button type="button" aria-label="打开网址" onClick={() => void submitUrl()} disabled={!url.trim()} className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"><ArrowRight size={13} /></button>
      </div>

      {vertical && (
        <div className="absolute left-2 top-[calc(100%+6px)] z-40 w-64 rounded-2xl border border-border/60 bg-card p-2 shadow-2xl">
          <div className="mb-1 flex items-center justify-between px-2 py-1 text-xs font-medium"><span>垂直标签页</span><button type="button" onClick={toggleVertical} className="grid h-6 w-6 place-items-center rounded-md hover:bg-muted"><X size={12} /></button></div>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">{orderedTabs.map((tab) => tabButton(tab, true))}</div>
        </div>
      )}

      {menu && (
        <div className="fixed z-[1000] w-56 rounded-xl border border-border/60 bg-card p-1.5 text-xs shadow-2xl" style={{ left: Math.min(menu.x, window.innerWidth - 232), top: Math.min(menu.y, window.innerHeight - 354) }} onPointerDown={(event) => event.stopPropagation()}>
          <MenuItem icon={<Plus size={14} />} label="在右侧新建标签页" onClick={() => run(() => onAddRight(menu.tab))} />
          <MenuItem icon={<RefreshCw size={14} />} label="刷新" onClick={() => run(() => onRefresh(menu.tab))} />
          <MenuItem icon={<Copy size={14} />} label="复制标签页" onClick={() => run(() => onDuplicate(menu.tab))} />
          <MenuItem icon={menu.tab.isPinned ? <PinOff size={14} /> : <Pin size={14} />} label={menu.tab.isPinned ? '取消固定标签页' : '固定标签页'} onClick={() => run(() => onPin(menu.tab))} />
          <Separator />
          <MenuItem icon={<X size={14} />} label="关闭标签页" onClick={() => run(() => onClose(menu.tab))} />
          <MenuItem icon={<Rows3 size={14} />} label="关闭右侧标签页" disabled={tabs.findIndex((tab) => tab.id === menu.tab.id) === tabs.length - 1} onClick={() => run(() => onCloseRight(menu.tab))} />
          <MenuItem icon={<X size={14} />} label="关闭其他标签页" disabled={tabs.length < 2} onClick={() => run(() => onCloseOthers(menu.tab))} />
          <Separator />
          <MenuItem icon={<ListTree size={14} />} label={vertical ? '关闭垂直标签' : '打开垂直标签'} onClick={toggleVertical} />
          <MenuItem icon={<RotateCcw size={14} />} label="重新打开已关闭的标签页" disabled={!canReopen} onClick={() => run(onReopen)} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, disabled, onClick }: { icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-foreground transition hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35">{icon}<span>{label}</span></button>;
}

function Separator() { return <div className="my-1 h-px bg-border/50" />; }

function formatTabTitle(tab: Tab): string {
  const title = (tab.title || '').trim();
  if (title && title !== tab.url && !/^https?:\/\//i.test(title)) return title;
  try { return new URL(tab.url).hostname.replace(/^www\./, '') || '新标签页'; }
  catch { return title || '新标签页'; }
}
