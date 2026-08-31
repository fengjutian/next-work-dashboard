import { parseRssFeed, type RssArticle, type RssFeed, type RssKeywordRule, type RssState } from '../core';
import type { RssExtractedContent, RssReaderAdapter } from '../react/adapter';

const DEFAULT_STORAGE_KEY = 'next-work-dashboard:rss-reader:web:v1';

interface WebStore {
  state: RssState;
  rules: RssKeywordRule[];
  refreshMinutes: number;
  retentionDays: number;
  notificationsEnabled: boolean;
  content: Record<string, RssExtractedContent>;
}

export interface WebRssReaderOptions {
  storage?: Storage;
  storageKey?: string;
  /** Transform remote URLs, for example `(url) => `/api/rss?url=${encodeURIComponent(url)}`. */
  resolveFetchUrl?: (url: string, kind: 'feed' | 'article') => string;
  fetch?: typeof globalThis.fetch;
  openExternal?: (url: string) => void | Promise<void>;
}

function emptyStore(): WebStore {
  return { state: { subscriptions: [], articles: [] }, rules: [], refreshMinutes: 60, retentionDays: 90, notificationsEnabled: false, content: {} };
}

function subscriptionId(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) hash = Math.imul(hash ^ url.charCodeAt(index), 16777619);
  return `feed-${(hash >>> 0).toString(36)}`;
}

function mergeFeed(state: RssState, feed: RssFeed, sourceUrl = feed.feedUrl): RssState {
  const id = subscriptionId(feed.feedUrl);
  const previous = new Map(state.articles.map((article) => [`${article.feedId}:${article.id}`, article]));
  const existing = state.subscriptions.find((item) => item.id === id);
  return {
    subscriptions: [...state.subscriptions.filter((item) => item.id !== id), {
      id, title: feed.title, description: feed.description, siteUrl: feed.siteUrl,
      feedUrl: feed.feedUrl, sourceUrl: existing?.sourceUrl ?? sourceUrl,
      category: existing?.category ?? '未分类', addedAt: existing?.addedAt ?? Date.now(), lastFetchedAt: Date.now(),
    }],
    articles: [
      ...feed.items.map((item): RssArticle => {
        const old = previous.get(`${id}:${item.id}`);
        return { ...item, feedId: id, feedTitle: feed.title, read: old?.read ?? false, starred: old?.starred ?? false };
      }),
      ...state.articles.filter((article) => article.feedId !== id),
    ],
  };
}

function htmlToText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,noscript,svg').forEach((node) => node.remove());
  return (document.querySelector('article,main') ?? document.body).textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function createWebRssReaderAdapter(options: WebRssReaderOptions = {}): RssReaderAdapter {
  const storage = options.storage ?? globalThis.localStorage;
  const key = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const resolveUrl = options.resolveFetchUrl ?? ((url: string) => url);
  const read = (): WebStore => {
    try { return { ...emptyStore(), ...JSON.parse(storage.getItem(key) ?? '') as WebStore }; } catch { return emptyStore(); }
  };
  const write = (store: WebStore) => storage.setItem(key, JSON.stringify(store));
  const fetchFeed = async (rawUrl: string): Promise<RssFeed> => {
    const response = await fetcher(resolveUrl(rawUrl, 'feed'), { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html' } });
    if (!response.ok) throw new Error(`RSS request failed (HTTP ${response.status})`);
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(body)) {
      const document = new DOMParser().parseFromString(body, 'text/html');
      const alternate = document.querySelector<HTMLLinkElement>('link[rel~="alternate"][type="application/rss+xml"],link[rel~="alternate"][type="application/atom+xml"]');
      if (!alternate?.href) throw new Error('No RSS or Atom feed was found on this page');
      return fetchFeed(new URL(alternate.getAttribute('href') ?? alternate.href, rawUrl).toString());
    }
    return parseRssFeed(body, rawUrl);
  };
  const prune = (store: WebStore): number => {
    if (!store.retentionDays) return 0;
    const before = store.state.articles.length;
    const cutoff = Date.now() - store.retentionDays * 86_400_000;
    store.state.articles = store.state.articles.filter((article) => article.starred || !article.publishedAt || Date.parse(article.publishedAt) >= cutoff);
    return before - store.state.articles.length;
  };

  return { api: {
    rss: {
      fetch: fetchFeed,
      loadState: async () => read().state,
      saveState: async (state) => { const store = read(); store.state = state; write(store); },
      refreshAll: async () => {
        const store = read(); let state = store.state;
        for (const subscription of state.subscriptions) {
          try { state = mergeFeed(state, await fetchFeed(subscription.sourceUrl || subscription.feedUrl), subscription.sourceUrl); }
          catch (cause) { state = { ...state, subscriptions: state.subscriptions.map((item) => item.id === subscription.id ? { ...item, error: cause instanceof Error ? cause.message : String(cause) } : item) }; }
        }
        store.state = state; prune(store); write(store); return store.state;
      },
      setRefreshMinutes: async (minutes) => { const store = read(); store.refreshMinutes = minutes; write(store); },
      setRetentionDays: async (days) => { const store = read(); store.retentionDays = days; const count = prune(store); write(store); return count; },
      setNotificationsEnabled: async (enabled) => { const store = read(); store.notificationsEnabled = enabled; write(store); if (enabled && 'Notification' in globalThis && Notification.permission === 'default') await Notification.requestPermission(); },
      extractArticle: async (feedId, articleId, rawUrl) => {
        const store = read(); const contentKey = `${feedId}:${articleId}`;
        if (store.content[contentKey]) return store.content[contentKey];
        const response = await fetcher(resolveUrl(rawUrl, 'article'));
        if (!response.ok) throw new Error(`Article request failed (HTTP ${response.status})`);
        const text = htmlToText(await response.text());
        const content = { text, markdown: text, wordCount: text.split(/\s+/).filter(Boolean).length };
        store.content[contentKey] = content; write(store); return content;
      },
      search: async (query) => { const needle = query.toLocaleLowerCase(); return read().state.articles.filter((article) => `${article.title} ${article.description} ${article.author}`.toLocaleLowerCase().includes(needle)).map(({ feedId, id: articleId }) => ({ feedId, articleId })); },
      listRules: async () => read().rules,
      saveRule: async (rule) => { const store = read(); store.rules = [...store.rules.filter((item) => item.id !== rule.id), rule]; write(store); },
      deleteRule: async (id) => { const store = read(); store.rules = store.rules.filter((item) => item.id !== id); write(store); },
    },
    shell: { openExternal: async (url) => { if (options.openExternal) await options.openExternal(url); else globalThis.open(url, '_blank', 'noopener,noreferrer'); } },
    copyText: (text) => { void globalThis.navigator.clipboard.writeText(text); },
    pickFile: async ({ accept }) => new Promise((resolve) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = accept ?? '';
      input.onchange = () => { const file = input.files?.[0]; if (!file) resolve(null); else void file.text().then((text) => resolve({ path: file.name, text })); };
      input.click();
    }),
    saveFile: async ({ defaultName, content }) => { const blobUrl = URL.createObjectURL(new Blob([content], { type: 'application/xml;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = defaultName ?? 'download'; anchor.click(); URL.revokeObjectURL(blobUrl); return { success: true }; },
  } };
}
