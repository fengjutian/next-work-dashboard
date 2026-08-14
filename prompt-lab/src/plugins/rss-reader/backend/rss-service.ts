import { ipcMain, Notification } from 'electron';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseRssFeed } from './rss-parser';
import { extractReadability } from '../../../core/work-browser/parser';
import { deleteRssRule, getRssArticleContent, getRssHttpCache, getRssNotificationsEnabled, getRssRefreshMinutes, listRssRules, loadRssState, pruneRssArticles, saveRssArticleContent, saveRssHttpCache, saveRssRule, saveRssState, searchRssArticles, setRssNotificationsEnabled, setRssRefreshMinutes, setRssRetentionDays } from './rss-database';
import type { RssArticle, RssFeed, RssKeywordRule, RssSubscription } from '../types';

const MAX_FEED_BYTES = 5 * 1024 * 1024;

export function privateAddress(address: string): boolean {
  if (address === '::1' || address === '::' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb')) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function safeHttpUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP/HTTPS 订阅地址');
  if (url.username || url.password) throw new Error('订阅地址不能包含用户名或密码');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('已阻止本机订阅地址');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error('已阻止内网或特殊用途地址');
  return url;
}

async function fetchSafely(rawUrl: string): Promise<{ response: Response; url: URL; cachedBody?: string }> {
  let url = await safeHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const cached = getRssHttpCache(url.toString());
    const headers: Record<string, string> = { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*', 'User-Agent': 'next-work-dashboard/0.2 RSS Reader' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers });
    if (response.status === 304 && cached) return { response, url, cachedBody: cached.body };
    if (response.status < 300 || response.status >= 400) return { response, url };
    const location = response.headers.get('location');
    if (!location) throw new Error('订阅源返回了无效重定向');
    url = await safeHttpUrl(new URL(location, url).toString());
  }
  throw new Error('订阅源重定向次数过多');
}

export function discoverFeedUrl(html: string, pageUrl: URL): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = new Map<string, string>();
    for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) attrs.set(attr[1].toLowerCase(), attr[3]);
    const rel = attrs.get('rel')?.toLowerCase().split(/\s+/) ?? [];
    const type = attrs.get('type')?.toLowerCase() ?? '';
    const href = attrs.get('href');
    if (href && rel.includes('alternate') && ['application/rss+xml', 'application/atom+xml'].includes(type)) return new URL(href, pageUrl).toString();
  }
  return null;
}

async function fetchFeed(rawUrl: string, allowDiscovery = true): Promise<RssFeed> {
  const { response, url, cachedBody } = await fetchSafely(rawUrl.trim());
  if (response.status !== 304 && !response.ok) throw new Error(`订阅源请求失败（HTTP ${response.status}）`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_FEED_BYTES) throw new Error('订阅源超过 5 MB 限制');
  const body = cachedBody ?? await response.text();
  if (body.length > MAX_FEED_BYTES) throw new Error('订阅源超过 5 MB 限制');
  if (!cachedBody) saveRssHttpCache(url.toString(), body, response.headers.get('etag'), response.headers.get('last-modified'));
  try { return parseRssFeed(body, url.toString()); }
  catch (parseError) {
    if (!allowDiscovery) throw parseError;
    const discovered = discoverFeedUrl(body, url);
    if (!discovered) throw new Error('该页面不是订阅源，也没有发现 RSS/Atom 地址');
    return fetchFeed(discovered, false);
  }
}

function subscriptionId(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) hash = Math.imul(hash ^ url.charCodeAt(index), 16777619);
  return `feed-${(hash >>> 0).toString(36)}`;
}

export function ruleMatches(article: RssArticle, rule: RssKeywordRule): boolean {
  if (!rule.enabled) return false;
  const haystack = `${article.title} ${article.description} ${article.author}`.toLowerCase();
  const includes = rule.includeKeywords.map((word) => word.trim().toLowerCase()).filter(Boolean);
  const excludes = rule.excludeKeywords.map((word) => word.trim().toLowerCase()).filter(Boolean);
  return (!includes.length || includes.some((word) => haystack.includes(word))) && !excludes.some((word) => haystack.includes(word));
}

function showNotification(title: string, body: string): void {
  if (getRssNotificationsEnabled() && Notification.isSupported()) new Notification({ title, body: body.slice(0, 240) }).show();
}

function mergeFeed(feed: RssFeed, category = '未分类'): void {
  const state = loadRssState();
  const id = subscriptionId(feed.feedUrl);
  const existingFeed = state.subscriptions.find((item) => item.feedUrl === feed.feedUrl || item.id === id);
  const existingArticles = new Map(state.articles.map((item) => [`${item.feedId}:${item.id}`, item]));
  const knownIds = new Set(state.articles.filter((item) => item.feedId === existingFeed?.id).map((item) => item.id));
  const rules = listRssRules();
  const articles: RssArticle[] = feed.items.map((item) => {
    const existing = existingArticles.get(`${existingFeed?.id ?? id}:${item.id}`);
    const article: RssArticle = { ...item, feedId: existingFeed?.id ?? id, feedTitle: feed.title, read: existing?.read ?? false, starred: existing?.starred ?? false };
    if (existingFeed && !knownIds.has(item.id)) for (const rule of rules) if (ruleMatches(article, rule)) {
      if (rule.action === 'star') article.starred = true;
      if (rule.action === 'mark-read') article.read = true;
      if (rule.action === 'notify') showNotification(`${feed.title} · ${rule.name}`, article.title);
    }
    return article;
  });
  const subscription: RssSubscription = { id: existingFeed?.id ?? id, title: feed.title, description: feed.description, siteUrl: feed.siteUrl, feedUrl: feed.feedUrl, category: existingFeed?.category ?? category, addedAt: existingFeed?.addedAt ?? Date.now(), lastFetchedAt: Date.now() };
  saveRssState({ subscriptions: [...state.subscriptions.filter((item) => item.id !== subscription.id), subscription], articles: [...articles, ...state.articles.filter((item) => item.feedId !== subscription.id)] });
  const newArticles = existingFeed ? articles.filter((article) => !knownIds.has(article.id)) : [];
  if (newArticles.length) showNotification(`${feed.title} 有 ${newArticles.length} 篇新文章`, newArticles.slice(0, 3).map((article) => article.title).join('、'));
}

let refreshRunning = false;
async function refreshAllFeeds(): Promise<void> {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const feeds = loadRssState().subscriptions;
    for (const feed of feeds) {
      try { mergeFeed(await fetchFeed(feed.feedUrl), feed.category); }
      catch (cause) {
        const state = loadRssState();
        saveRssState({ ...state, subscriptions: state.subscriptions.map((item) => item.id === feed.id ? { ...item, lastFetchedAt: Date.now(), error: cause instanceof Error ? cause.message : String(cause) } : item) });
      }
    }
    pruneRssArticles();
  } finally { refreshRunning = false; }
}

let backgroundTimer: NodeJS.Timeout | null = null;
export function startRssBackgroundRefresh(): void {
  if (backgroundTimer) return;
  backgroundTimer = setInterval(() => {
    const minutes = getRssRefreshMinutes();
    if (!minutes) return;
    const feeds = loadRssState().subscriptions;
    if (feeds.some((feed) => Date.now() - feed.lastFetchedAt >= minutes * 60_000)) void refreshAllFeeds();
  }, 60_000);
  backgroundTimer.unref();
}

export function registerRssIpc(): void {
  ipcMain.handle('rss:fetch', async (_event, rawUrl: string) => {
    return fetchFeed(rawUrl);
  });
  ipcMain.handle('rss:state:load', () => loadRssState());
  ipcMain.handle('rss:state:save', (_event, state: { subscriptions: RssSubscription[]; articles: RssArticle[] }) => saveRssState(state));
  ipcMain.handle('rss:refresh:all', async () => { await refreshAllFeeds(); return loadRssState(); });
  ipcMain.handle('rss:settings:refresh', (_event, minutes: number) => setRssRefreshMinutes([0, 15, 60, 240].includes(minutes) ? minutes : 60));
  ipcMain.handle('rss:settings:retention', (_event, days: number) => { setRssRetentionDays([0, 30, 90, 180].includes(days) ? days : 90); return pruneRssArticles(days); });
  ipcMain.handle('rss:settings:notifications', (_event, enabled: boolean) => setRssNotificationsEnabled(!!enabled));
  ipcMain.handle('rss:article:extract', async (_event, feedId: string, articleId: string, rawUrl: string) => {
    const cached = getRssArticleContent(feedId, articleId);
    if (cached) return cached;
    const { response, url, cachedBody } = await fetchSafely(rawUrl);
    if (response.status !== 304 && !response.ok) throw new Error(`正文请求失败（HTTP ${response.status}）`);
    const html = cachedBody ?? await response.text();
    if (html.length > MAX_FEED_BYTES) throw new Error('网页超过 5 MB 限制');
    if (!cachedBody) saveRssHttpCache(url.toString(), html, response.headers.get('etag'), response.headers.get('last-modified'));
    const extracted = await extractReadability(html);
    if (!extracted.contentText) throw new Error('未能提取到正文');
    saveRssArticleContent(feedId, articleId, extracted.contentText, extracted.wordCount);
    return { text: extracted.contentText, wordCount: extracted.wordCount };
  });
  ipcMain.handle('rss:search', (_event, query: string) => searchRssArticles(query));
  ipcMain.handle('rss:rules:list', () => listRssRules());
  ipcMain.handle('rss:rules:save', (_event, rule: RssKeywordRule) => saveRssRule(rule));
  ipcMain.handle('rss:rules:delete', (_event, id: string) => deleteRssRule(id));
  startRssBackgroundRefresh();
}
