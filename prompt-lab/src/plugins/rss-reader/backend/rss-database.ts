import { app } from 'electron';
import path from 'node:path';
import * as DatabaseNS from 'better-sqlite3';
import type { RssArticle, RssKeywordRule, RssSubscription } from '../types';

type DatabaseCtor = new (filename: string) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));
let database: DatabaseNS.Database | null = null;

function db(): DatabaseNS.Database {
  if (database) return database;
  database = new Database(path.join(app.getPath('userData'), 'rss-reader.db'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS rss_feeds (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', site_url TEXT NOT NULL DEFAULT '',
      feed_url TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT '未分类', added_at INTEGER NOT NULL,
      last_fetched_at INTEGER NOT NULL DEFAULT 0, error TEXT, source_url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS rss_articles (
      id TEXT NOT NULL, feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE, feed_title TEXT NOT NULL,
      title TEXT NOT NULL, link TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
      published_at TEXT, is_read INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (feed_id, id)
    );
    CREATE INDEX IF NOT EXISTS rss_articles_published ON rss_articles(published_at DESC);
    CREATE TABLE IF NOT EXISTS rss_http_cache (
      url TEXT PRIMARY KEY, etag TEXT, last_modified TEXT, body TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rss_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rss_article_content (
      feed_id TEXT NOT NULL, article_id TEXT NOT NULL, content_text TEXT NOT NULL, word_count INTEGER NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '',
      cached_at INTEGER NOT NULL, format_version INTEGER NOT NULL DEFAULT 2, PRIMARY KEY(feed_id, article_id),
      FOREIGN KEY(feed_id, article_id) REFERENCES rss_articles(feed_id, id) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS rss_articles_fts USING fts5(feed_id UNINDEXED, article_id UNINDEXED, title, description, author, full_text);
    CREATE TABLE IF NOT EXISTS rss_keyword_rules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, include_keywords TEXT NOT NULL, exclude_keywords TEXT NOT NULL,
      action TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    );
  `);
  const feedColumns = new Set((database.prepare('PRAGMA table_info(rss_feeds)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!feedColumns.has('source_url')) database.exec("ALTER TABLE rss_feeds ADD COLUMN source_url TEXT NOT NULL DEFAULT ''");
  const contentColumns = new Set((database.prepare('PRAGMA table_info(rss_article_content)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!contentColumns.has('content_markdown')) database.exec("ALTER TABLE rss_article_content ADD COLUMN content_markdown TEXT NOT NULL DEFAULT ''");
  if (!contentColumns.has('format_version')) database.exec('ALTER TABLE rss_article_content ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1');
  return database;
}

export interface RssHttpCache { etag: string | null; lastModified: string | null; body: string }
export function getRssHttpCache(url: string): RssHttpCache | null {
  const row = db().prepare('SELECT etag, last_modified, body FROM rss_http_cache WHERE url = ?').get(url) as { etag: string | null; last_modified: string | null; body: string } | undefined;
  return row ? { etag: row.etag, lastModified: row.last_modified, body: row.body } : null;
}
export function saveRssHttpCache(url: string, body: string, etag: string | null, lastModified: string | null): void {
  db().prepare(`INSERT INTO rss_http_cache(url,etag,last_modified,body,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET etag=excluded.etag,last_modified=excluded.last_modified,body=excluded.body,updated_at=excluded.updated_at`).run(url, etag, lastModified, body, Date.now());
}
export function getRssRefreshMinutes(): number {
  const row = db().prepare("SELECT value FROM rss_settings WHERE key = 'refreshMinutes'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 60;
}
export function setRssRefreshMinutes(minutes: number): void {
  db().prepare("INSERT INTO rss_settings(key,value) VALUES('refreshMinutes',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(minutes));
}
export function getRssRetentionDays(): number {
  const row = db().prepare("SELECT value FROM rss_settings WHERE key = 'retentionDays'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 90;
}
export function setRssRetentionDays(days: number): void {
  db().prepare("INSERT INTO rss_settings(key,value) VALUES('retentionDays',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(days));
}
export function pruneRssArticles(days = getRssRetentionDays()): number {
  if (!days) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const databaseHandle = db();
  const changes = databaseHandle.prepare("DELETE FROM rss_articles WHERE starred = 0 AND published_at IS NOT NULL AND datetime(published_at) < datetime(?)").run(cutoff).changes;
  databaseHandle.prepare('DELETE FROM rss_articles_fts WHERE NOT EXISTS (SELECT 1 FROM rss_articles a WHERE a.feed_id=rss_articles_fts.feed_id AND a.id=rss_articles_fts.article_id)').run();
  return changes;
}
export function getRssNotificationsEnabled(): boolean {
  const row = db().prepare("SELECT value FROM rss_settings WHERE key = 'notificationsEnabled'").get() as { value: string } | undefined;
  return row?.value === 'true';
}
export function setRssNotificationsEnabled(enabled: boolean): void {
  db().prepare("INSERT INTO rss_settings(key,value) VALUES('notificationsEnabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(enabled));
}
export function saveRssArticleContent(feedId: string, articleId: string, text: string, markdown: string, wordCount: number): void {
  const databaseHandle = db();
  databaseHandle.transaction(() => {
    databaseHandle.prepare(`INSERT INTO rss_article_content(feed_id,article_id,content_text,word_count,content_markdown,cached_at,format_version) VALUES(?,?,?,?,?,?,2) ON CONFLICT(feed_id,article_id)
      DO UPDATE SET content_text=excluded.content_text,word_count=excluded.word_count,content_markdown=excluded.content_markdown,cached_at=excluded.cached_at,format_version=2`).run(feedId, articleId, text, wordCount, markdown, Date.now());
    const article = databaseHandle.prepare('SELECT title,description,author FROM rss_articles WHERE feed_id=? AND id=?').get(feedId, articleId) as { title: string; description: string; author: string } | undefined;
    if (article) {
      databaseHandle.prepare('DELETE FROM rss_articles_fts WHERE feed_id=? AND article_id=?').run(feedId, articleId);
      databaseHandle.prepare('INSERT INTO rss_articles_fts VALUES(?,?,?,?,?,?)').run(feedId, articleId, article.title, article.description, article.author, text);
    }
  })();
}
export function getRssArticleContent(feedId: string, articleId: string): { text: string; markdown: string; wordCount: number } | null {
  const row = db().prepare('SELECT content_text,content_markdown,word_count,format_version FROM rss_article_content WHERE feed_id=? AND article_id=?').get(feedId, articleId) as { content_text: string; content_markdown: string; word_count: number; format_version: number } | undefined;
  return row && row.format_version >= 2 ? { text: row.content_text, markdown: row.content_markdown || row.content_text, wordCount: row.word_count } : null;
}
export function searchRssArticles(query: string, limit = 200): Array<{ feedId: string; articleId: string }> {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map((token) => `"${token.replace(/"/g, '""')}"`);
  if (!tokens.length) return [];
  return (db().prepare('SELECT feed_id,article_id FROM rss_articles_fts WHERE rss_articles_fts MATCH ? ORDER BY rank LIMIT ?').all(tokens.join(' AND '), limit) as Array<{ feed_id: string; article_id: string }>).map((row) => ({ feedId: row.feed_id, articleId: row.article_id }));
}
export function listRssRules(): RssKeywordRule[] {
  return (db().prepare('SELECT * FROM rss_keyword_rules ORDER BY name').all() as Array<{ id: string; name: string; include_keywords: string; exclude_keywords: string; action: RssKeywordRule['action']; enabled: number }>).map((row) => ({ id: row.id, name: row.name, includeKeywords: JSON.parse(row.include_keywords) as string[], excludeKeywords: JSON.parse(row.exclude_keywords) as string[], action: row.action, enabled: !!row.enabled }));
}
export function saveRssRule(rule: RssKeywordRule): void {
  db().prepare(`INSERT INTO rss_keyword_rules VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,include_keywords=excluded.include_keywords,exclude_keywords=excluded.exclude_keywords,action=excluded.action,enabled=excluded.enabled`).run(rule.id, rule.name, JSON.stringify(rule.includeKeywords), JSON.stringify(rule.excludeKeywords), rule.action, rule.enabled ? 1 : 0);
}
export function deleteRssRule(id: string): void { db().prepare('DELETE FROM rss_keyword_rules WHERE id=?').run(id); }

interface FeedRow { id: string; title: string; description: string; site_url: string; feed_url: string; category: string; added_at: number; last_fetched_at: number; error: string | null; source_url: string }
interface ArticleRow { id: string; feed_id: string; feed_title: string; title: string; link: string; description: string; author: string; published_at: string | null; is_read: number; starred: number }

export function loadRssState(): { subscriptions: RssSubscription[]; articles: RssArticle[] } {
  const feeds = db().prepare('SELECT * FROM rss_feeds ORDER BY title').all() as FeedRow[];
  const articles = db().prepare('SELECT * FROM rss_articles ORDER BY published_at DESC').all() as ArticleRow[];
  return {
    subscriptions: feeds.map((row) => ({ id: row.id, title: row.title, description: row.description, siteUrl: row.site_url, feedUrl: row.feed_url, sourceUrl: row.source_url || row.feed_url, category: row.category, addedAt: row.added_at, lastFetchedAt: row.last_fetched_at, error: row.error ?? undefined })),
    articles: articles.map((row) => ({ id: row.id, feedId: row.feed_id, feedTitle: row.feed_title, title: row.title, link: row.link, description: row.description, author: row.author, publishedAt: row.published_at, read: !!row.is_read, starred: !!row.starred })),
  };
}

export function saveRssState(state: { subscriptions: RssSubscription[]; articles: RssArticle[] }): void {
  const databaseHandle = db();
  const saveFeed = databaseHandle.prepare(`INSERT INTO rss_feeds(id,title,description,site_url,feed_url,category,added_at,last_fetched_at,error,source_url)
    VALUES (@id,@title,@description,@siteUrl,@feedUrl,@category,@addedAt,@lastFetchedAt,@error,@sourceUrl)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,site_url=excluded.site_url,feed_url=excluded.feed_url,category=excluded.category,last_fetched_at=excluded.last_fetched_at,error=excluded.error,source_url=excluded.source_url`);
  const saveArticle = databaseHandle.prepare(`INSERT INTO rss_articles VALUES (@id,@feedId,@feedTitle,@title,@link,@description,@author,@publishedAt,@read,@starred)
    ON CONFLICT(feed_id,id) DO UPDATE SET feed_title=excluded.feed_title,title=excluded.title,link=excluded.link,description=excluded.description,author=excluded.author,published_at=excluded.published_at,is_read=excluded.is_read,starred=excluded.starred`);
  databaseHandle.transaction(() => {
    const feedIds = new Set(state.subscriptions.map((feed) => feed.id));
    for (const row of databaseHandle.prepare('SELECT id FROM rss_feeds').all() as Array<{ id: string }>) if (!feedIds.has(row.id)) databaseHandle.prepare('DELETE FROM rss_feeds WHERE id = ?').run(row.id);
    for (const feed of state.subscriptions) saveFeed.run({ ...feed, sourceUrl: feed.sourceUrl || feed.feedUrl, category: feed.category || '未分类', error: feed.error ?? null });
    for (const article of state.articles) if (feedIds.has(article.feedId)) {
      saveArticle.run({ ...article, read: article.read ? 1 : 0, starred: article.starred ? 1 : 0 });
      const content = databaseHandle.prepare('SELECT content_text FROM rss_article_content WHERE feed_id=? AND article_id=?').get(article.feedId, article.id) as { content_text: string } | undefined;
      databaseHandle.prepare('DELETE FROM rss_articles_fts WHERE feed_id=? AND article_id=?').run(article.feedId, article.id);
      databaseHandle.prepare('INSERT INTO rss_articles_fts VALUES(?,?,?,?,?,?)').run(article.feedId, article.id, article.title, article.description, article.author, content?.content_text ?? '');
    }
  })();
}
