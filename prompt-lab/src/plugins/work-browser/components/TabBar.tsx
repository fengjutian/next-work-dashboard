import {
  ArrowRight, ChevronDown, Copy, Globe2, Home, ListTree, Pin, PinOff, Plus, RefreshCw,
  RotateCcw, Rows3, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  onNewTab: () => void | Promise<void>;
  onAdd: (url: string) => boolean | Promise<boolean>;
}

export function TabBar(props: TabBarProps) {
  const { tabs, activeId, canReopen, onActivate, onHome, onClose, onCloseRight,
    onCloseOthers, onDuplicate, onPin, onRefresh, onReopen, onAddRight, onNewTab, onAdd } = props;
  const [url, setUrl] = useState('');
  const [vertical, setVertical] = useState(() => localStorage.getItem('work-browser.vertical-tabs') === 'true');
  const [menu, setMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
  const [hoverCard, setHoverCard] = useState<{ tab: Tab; left: number; top: number } | null>(null);
  const hoverTimerRef = useRef<number>();
  const orderedTabs = useMemo(() => [...tabs].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.position - b.position), [tabs]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [menu]);

  useEffect(() => {
    if (hoverCard && !tabs.some((tab) => tab.id === hoverCard.tab.id)) {
      setHoverCard(null);
    }
    if (menu && !tabs.some((tab) => tab.id === menu.tab.id)) {
      setMenu(null);
    }
  }, [hoverCard, menu, tabs]);

  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), []);

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
      onMouseEnter={(event) => {
        window.clearTimeout(hoverTimerRef.current);
        const rect = event.currentTarget.getBoundingClientRect();
        hoverTimerRef.current = window.setTimeout(() => {
          setHoverCard({ tab, left: Math.min(rect.left, window.innerWidth - 300), top: rect.bottom + 7 });
        }, 350);
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimerRef.current);
        setHoverCard(null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ tab, x: event.clientX, y: event.clientY });
      }}
      style={!isVertical && !tab.isPinned ? {
        flexBasis: orderedTabs.length > 6 ? `${100 / orderedTabs.length}%` : '180px',
      } : undefined}
      className={`group/tab flex cursor-default items-center gap-2 text-xs transition ${
        isVertical
          ? 'h-9 w-full rounded-xl px-2.5'
          : tab.isPinned
            ? 'h-9 w-10 shrink-0 justify-center rounded-t-xl rounded-b-md px-0'
            : 'h-9 min-w-28 max-w-64 shrink rounded-t-xl rounded-b-md px-3'
      } ${activeId === tab.id
        ? 'bg-card text-foreground shadow-[0_-1px_0_rgba(255,255,255,.7),0_1px_3px_rgba(0,0,0,.10)]'
        : 'text-foreground/75 hover:bg-card/45 hover:text-foreground'}`}
    >
      {tab.favicon ? <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" /> : <Globe2 size={13} className="shrink-0" />}
      {(!tab.isPinned || isVertical) && <span className="min-w-0 flex-1 truncate">{formatTabTitle(tab)}</span>}
      {tab.isPinned && isVertical && <Pin size={11} className="shrink-0" />}
      {!tab.isPinned && (
        <button type="button" aria-label={`关闭 ${tab.title || tab.url}`} onClick={(event) => {
          event.stopPropagation();
          window.clearTimeout(hoverTimerRef.current);
          setHoverCard(null);
          void onClose(tab);
        }} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-muted focus:opacity-100 ${activeId === tab.id ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'}`}>
          <X size={11} />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative flex h-20 shrink-0 flex-col border-b border-border/50 bg-[#dce8fb] dark:bg-muted/45">
      <div className="flex h-10 min-w-0 items-end gap-1 px-1.5 pt-1">
        <button type="button" aria-label="标签页列表" title="标签页列表" onClick={toggleVertical} className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-card/70 text-foreground transition hover:bg-card"><ChevronDown size={15} /></button>
        <div className="work-browser-tab-strip flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {orderedTabs.map((tab) => tabButton(tab))}
          <button type="button" aria-label="新建标签页" title="新建标签页" onClick={() => void onNewTab()} className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-foreground/75 transition hover:bg-card/55 hover:text-foreground"><Plus size={17} /></button>
        </div>
      </div>
      <div className="flex h-10 items-center gap-2 border-t border-white/40 bg-card/55 px-2 dark:border-border/40">
        <button type="button" aria-label="返回首页" title="返回首页" onClick={onHome} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${activeId ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'bg-muted text-foreground'}`}><Home size={15} /></button>
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-full border border-transparent bg-muted/70 pl-3 transition focus-within:border-primary/25 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/10">
          <Globe2 size={14} className="shrink-0 text-muted-foreground" />
          <input placeholder="输入网址或搜索" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitUrl(); }} className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/70" />
          <button type="button" aria-label="打开网址" onClick={() => void submitUrl()} disabled={!url.trim()} className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-primary hover:text-primary-foreground disabled:opacity-35"><ArrowRight size={13} /></button>
        </div>
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

      {hoverCard && !menu && (
        <TabHoverCard tab={hoverCard.tab} left={hoverCard.left} top={hoverCard.top} active={hoverCard.tab.id === activeId} />
      )}
    </div>
  );
}

function TabHoverCard({ tab, left, top, active }: { tab: Tab; left: number; top: number; active: boolean }) {
  let hostname = tab.url;
  let pathParts: string[] = [];
  try {
    const parsed = new URL(tab.url);
    hostname = parsed.hostname.replace(/^www\./, '');
    pathParts = parsed.pathname.split('/').filter(Boolean).slice(0, 3);
  } catch { /* Show the original URL. */ }
  return (
    <div className="pointer-events-none fixed z-[900] w-72 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl" style={{ left, top }}>
      <div className="flex h-24 items-center justify-center bg-gradient-to-br from-primary/12 via-muted/40 to-background">
        <div className="flex flex-col items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-card shadow-sm">
            {tab.favicon ? <img src={tab.favicon} alt="" className="h-6 w-6 rounded" /> : <Globe2 size={20} className="text-primary" />}
          </div>
          <span className="max-w-56 truncate text-xs font-medium text-foreground">{hostname}</span>
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium text-foreground">{tab.title || hostname}</div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{tab.url}</div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5">网站小地图</span>
          <span className="truncate">{hostname}</span>
          {pathParts.map((part) => <span key={part} className="flex min-w-0 items-center gap-1"><span>/</span><span className="max-w-16 truncate">{decodeURIComponent(part)}</span></span>)}
          <span className="ml-auto shrink-0">{tab.isPinned ? '已固定' : active ? '当前页面' : '标签页'}</span>
        </div>
      </div>
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
