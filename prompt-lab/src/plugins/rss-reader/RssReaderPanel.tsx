import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Globe, Plus, RefreshCw, Search, Star, Trash2, Upload } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RssArticle, RssFeed, RssSubscription } from './types';

interface RssState { subscriptions: RssSubscription[]; articles: RssArticle[] }
type Filter = 'all' | 'unread' | 'starred';
const STORAGE_KEY = 'plugin-rss-reader-v1';
const REFRESH_KEY = 'plugin-rss-reader-refresh-minutes';

function loadState(): RssState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as RssState;
    return Array.isArray(parsed.subscriptions) && Array.isArray(parsed.articles) ? parsed : { subscriptions: [], articles: [] };
  } catch { return { subscriptions: [], articles: [] }; }
}

function subscriptionId(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) hash = Math.imul(hash ^ url.charCodeAt(index), 16777619);
  return `feed-${(hash >>> 0).toString(36)}`;
}

function mergeFeed(state: RssState, feed: RssFeed): RssState {
  const now = Date.now();
  const id = subscriptionId(feed.feedUrl);
  const previous = new Map(state.articles.map((article) => [`${article.feedId}:${article.id}`, article]));
  const incoming = feed.items.map((item): RssArticle => {
    const existing = previous.get(`${id}:${item.id}`);
    return { ...item, feedId: id, feedTitle: feed.title, read: existing?.read ?? false, starred: existing?.starred ?? false };
  });
  const existingSubscription = state.subscriptions.find((item) => item.id === id);
  const subscription: RssSubscription = { id, title: feed.title, description: feed.description, siteUrl: feed.siteUrl, feedUrl: feed.feedUrl, category: existingSubscription?.category ?? '未分类', addedAt: existingSubscription?.addedAt ?? now, lastFetchedAt: now };
  return {
    subscriptions: [...state.subscriptions.filter((item) => item.id !== id), subscription],
    articles: [...incoming, ...state.articles.filter((article) => article.feedId !== id)],
  };
}

function save(next: RssState, setState: React.Dispatch<React.SetStateAction<RssState>>): void {
  setState(next);
  void window.electronAPI.rss.saveState(next);
}

function escapeXml(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function toOpml(subscriptions: RssSubscription[]): string {
  const groups = new Map<string, RssSubscription[]>();
  for (const feed of subscriptions) groups.set(feed.category || '未分类', [...(groups.get(feed.category || '未分类') ?? []), feed]);
  const body = [...groups].map(([category, feeds]) => `    <outline text="${escapeXml(category)}">\n${feeds.map((feed) => `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.feedUrl)}" htmlUrl="${escapeXml(feed.siteUrl)}"/>`).join('\n')}\n    </outline>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>next-work-dashboard RSS subscriptions</title></head><body>\n${body}\n</body></opml>`;
}

function parseOpml(xml: string): Array<{ url: string; category: string }> {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('OPML 文件格式无效');
  return Array.from(document.querySelectorAll('outline[xmlUrl]')).map((node) => ({ url: node.getAttribute('xmlUrl') ?? '', category: node.parentElement?.getAttribute('text') || '未分类' })).filter((item) => !!item.url);
}

function dateLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

export const RssReaderPanel: React.FC = () => {
  const [state, setState] = useState<RssState>(loadState);
  const [selectedFeed, setSelectedFeed] = useState<string>('all');
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshMinutes, setRefreshMinutes] = useState(() => Number(localStorage.getItem(REFRESH_KEY) ?? 60));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    void window.electronAPI.rss.loadState().then((stored) => {
      const legacy = loadState();
      if (!stored.subscriptions.length && legacy.subscriptions.length) {
        const migrated = { ...legacy, subscriptions: legacy.subscriptions.map((feed) => ({ ...feed, category: feed.category || '未分类' })) };
        save(migrated, setState); localStorage.removeItem(STORAGE_KEY);
      } else setState(stored);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : '无法加载 RSS 数据库'));
  }, []);

  const visible = useMemo(() => state.articles
    .filter((item) => selectedFeed === 'all' || item.feedId === selectedFeed)
    .filter((item) => filter === 'all' || (filter === 'unread' ? !item.read : item.starred))
    .filter((item) => `${item.title} ${item.description} ${item.author}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0)), [state.articles, selectedFeed, filter, query]);
  const current = state.articles.find((item) => `${item.feedId}:${item.id}` === selectedArticle) ?? null;
  const unread = (feedId?: string) => state.articles.filter((item) => !item.read && (!feedId || item.feedId === feedId)).length;

  const fetchOne = async (url: string, source = state, category = '未分类') => {
    const merged = mergeFeed(source, await window.electronAPI.rss.fetch(url));
    return { ...merged, subscriptions: merged.subscriptions.map((feed) => feed.feedUrl === new URL(url).toString() ? { ...feed, category } : feed) };
  };
  const addFeed = async () => {
    if (!feedUrl.trim()) return;
    setBusy(true); setError('');
    try { const next = await fetchOne(feedUrl.trim()); save(next, setState); setSelectedFeed(subscriptionId(new URL(feedUrl.trim()).toString())); setFeedUrl(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '添加订阅失败'); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError(''); let next = stateRef.current; const failures: string[] = [];
    for (const subscription of stateRef.current.subscriptions) {
      try { next = await fetchOne(subscription.feedUrl, next, subscription.category); }
      catch { failures.push(subscription.title); }
    }
    save(next, setState); if (failures.length) setError(`${failures.join('、')} 刷新失败`); setBusy(false);
  };
  useEffect(() => {
    if (!refreshMinutes) return undefined;
    const timer = window.setInterval(() => { void refresh(); }, refreshMinutes * 60_000);
    return () => window.clearInterval(timer);
  // refresh reads the latest value through stateRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMinutes]);

  const importOpml = async () => {
    const picked = await window.electronAPI.pickFile({ accept: '.opml,.xml' });
    const file = Array.isArray(picked) ? picked[0] : picked;
    if (!file?.text) return;
    setBusy(true); setError(''); let next = state;
    try {
      for (const entry of parseOpml(file.text)) next = await fetchOne(entry.url, next, entry.category);
      save(next, setState);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'OPML 导入失败'); }
    finally { setBusy(false); }
  };
  const exportOpml = () => { void window.electronAPI.saveFile(toOpml(state.subscriptions), 'rss-subscriptions.opml'); };
  const patchArticle = (article: RssArticle, patch: Partial<RssArticle>) => save({ ...state, articles: state.articles.map((item) => item.feedId === article.feedId && item.id === article.id ? { ...item, ...patch } : item) }, setState);
  const openArticle = (article: RssArticle) => { patchArticle(article, { read: true }); setSelectedArticle(`${article.feedId}:${article.id}`); };

  return <div className="flex h-full min-h-0 bg-card text-foreground">
    <aside className="w-60 shrink-0 border-r flex flex-col min-h-0">
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 font-semibold"><Globe className="h-5 w-5 text-primary" />RSS 阅读器</div>
        <div className="flex gap-1 mt-3"><Input value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addFeed(); }} placeholder="粘贴 RSS / Atom 地址" className="h-8 text-xs" /><Button size="sm" className="h-8 px-2" disabled={busy} onClick={() => void addFeed()}><Plus className="h-4 w-4" /></Button></div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-b"><span className="text-xs text-muted-foreground">订阅源</span><div className="flex"><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => void importOpml()} title="导入 OPML"><Upload className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!state.subscriptions.length} onClick={exportOpml} title="导出 OPML"><Download className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busy || !state.subscriptions.length} onClick={() => void refresh()} title="刷新全部"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /></Button></div></div>
      <div className="px-3 py-2 border-b flex items-center justify-between"><span className="text-[11px] text-muted-foreground">自动刷新</span><select className="text-xs bg-background border rounded px-1 py-0.5" value={refreshMinutes} onChange={(event) => { const value = Number(event.target.value); setRefreshMinutes(value); localStorage.setItem(REFRESH_KEY, String(value)); }}><option value={0}>关闭</option><option value={15}>15 分钟</option><option value={60}>1 小时</option><option value={240}>4 小时</option></select></div>
      <div className="overflow-auto flex-1 p-2 space-y-1">
        <button onClick={() => setSelectedFeed('all')} className={`w-full rounded px-2 py-2 text-left text-sm flex justify-between ${selectedFeed === 'all' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><span>全部文章</span><span>{unread()}</span></button>
        {state.subscriptions.map((feed) => <div key={feed.id} className={`group rounded flex items-center ${selectedFeed === feed.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><button onClick={() => setSelectedFeed(feed.id)} className="flex-1 min-w-0 px-2 py-2 text-left text-sm"><span className="block truncate">{feed.title}</span><span className="text-[10px] text-muted-foreground">{feed.category} · {unread(feed.id)} 未读</span></button><button title="修改分类" className="px-1 text-[10px] opacity-0 group-hover:opacity-100 text-muted-foreground" onClick={() => { const category = window.prompt('订阅分类', feed.category); if (category?.trim()) save({ ...state, subscriptions: state.subscriptions.map((item) => item.id === feed.id ? { ...item, category: category.trim() } : item) }, setState); }}>分类</button><button title="删除订阅" className="p-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => { const next = { subscriptions: state.subscriptions.filter((item) => item.id !== feed.id), articles: state.articles.filter((item) => item.feedId !== feed.id) }; save(next, setState); if (selectedFeed === feed.id) setSelectedFeed('all'); }}><Trash2 className="h-3.5 w-3.5" /></button></div>)}
        {!state.subscriptions.length && <p className="px-2 py-8 text-center text-xs text-muted-foreground">添加一个订阅源开始阅读</p>}
      </div>
    </aside>
    <section className="w-80 shrink-0 border-r flex flex-col min-h-0">
      <div className="p-3 border-b space-y-2"><div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章" className="h-8 pl-8 text-xs" /></div><div className="flex gap-1">{(['all', 'unread', 'starred'] as Filter[]).map((value) => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setFilter(value)}>{value === 'all' ? '全部' : value === 'unread' ? '未读' : '收藏'}</Button>)}</div></div>
      <div className="overflow-auto flex-1">{visible.map((article) => <button key={`${article.feedId}:${article.id}`} onClick={() => openArticle(article)} className={`w-full border-b p-3 text-left hover:bg-muted/60 ${!article.read ? 'bg-primary/5' : ''}`}><div className="flex gap-2"><span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${article.read ? 'bg-transparent' : 'bg-primary'}`} /><div className="min-w-0"><h3 className="text-sm font-medium line-clamp-2">{article.title}</h3><div className="flex justify-between gap-2 mt-1 text-[11px] text-muted-foreground"><span className="truncate">{article.feedTitle}</span><span className="shrink-0">{dateLabel(article.publishedAt)}</span></div></div></div></button>)}{!visible.length && <p className="text-center text-xs text-muted-foreground py-12">没有符合条件的文章</p>}</div>
    </section>
    <main className="flex-1 min-w-0 overflow-auto">{current ? <article className="max-w-3xl mx-auto p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs text-primary mb-2">{current.feedTitle}</p><h1 className="text-2xl font-semibold leading-tight">{current.title}</h1><p className="text-xs text-muted-foreground mt-3">{[current.author, dateLabel(current.publishedAt)].filter(Boolean).join(' · ')}</p></div><Button variant="ghost" size="sm" onClick={() => patchArticle(current, { starred: !current.starred })} title={current.starred ? '取消收藏' : '收藏'}><Star className={`h-5 w-5 ${current.starred ? 'text-warning fill-current' : ''}`} /></Button></div><p className="mt-8 text-sm leading-7 whitespace-pre-wrap text-muted-foreground">{current.description || '该订阅源没有提供摘要。'}</p>{current.link && <Button className="mt-8" onClick={() => window.electronAPI.shell.openExternal(current.link)}>阅读原文 <ExternalLink className="ml-2 h-4 w-4" /></Button>}</article> : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">选择一篇文章开始阅读</div>}</main>
  </div>;
};
