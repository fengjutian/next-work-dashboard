import { app } from 'electron';
import path from 'node:path';
import * as DatabaseNS from 'better-sqlite3';
import type { RssArticle, RssSubscription } from '../types';

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
      last_fetched_at INTEGER NOT NULL DEFAULT 0, error TEXT
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
  `);
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

interface FeedRow { id: string; title: string; description: string; site_url: string; feed_url: string; category: string; added_at: number; last_fetched_at: number; error: string | null }
interface ArticleRow { id: string; feed_id: string; feed_title: string; title: string; link: string; description: string; author: string; published_at: string | null; is_read: number; starred: number }

export function loadRssState(): { subscriptions: RssSubscription[]; articles: RssArticle[] } {
  const feeds = db().prepare('SELECT * FROM rss_feeds ORDER BY title').all() as FeedRow[];
  const articles = db().prepare('SELECT * FROM rss_articles ORDER BY published_at DESC').all() as ArticleRow[];
  return {
    subscriptions: feeds.map((row) => ({ id: row.id, title: row.title, description: row.description, siteUrl: row.site_url, feedUrl: row.feed_url, category: row.category, addedAt: row.added_at, lastFetchedAt: row.last_fetched_at, error: row.error ?? undefined })),
    articles: articles.map((row) => ({ id: row.id, feedId: row.feed_id, feedTitle: row.feed_title, title: row.title, link: row.link, description: row.description, author: row.author, publishedAt: row.published_at, read: !!row.is_read, starred: !!row.starred })),
  };
}

export function saveRssState(state: { subscriptions: RssSubscription[]; articles: RssArticle[] }): void {
  const databaseHandle = db();
  const saveFeed = databaseHandle.prepare(`INSERT INTO rss_feeds VALUES (@id,@title,@description,@siteUrl,@feedUrl,@category,@addedAt,@lastFetchedAt,@error)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,site_url=excluded.site_url,feed_url=excluded.feed_url,category=excluded.category,last_fetched_at=excluded.last_fetched_at,error=excluded.error`);
  const saveArticle = databaseHandle.prepare(`INSERT INTO rss_articles VALUES (@id,@feedId,@feedTitle,@title,@link,@description,@author,@publishedAt,@read,@starred)
    ON CONFLICT(feed_id,id) DO UPDATE SET feed_title=excluded.feed_title,title=excluded.title,link=excluded.link,description=excluded.description,author=excluded.author,published_at=excluded.published_at,is_read=excluded.is_read,starred=excluded.starred`);
  databaseHandle.transaction(() => {
    const feedIds = new Set(state.subscriptions.map((feed) => feed.id));
    for (const row of databaseHandle.prepare('SELECT id FROM rss_feeds').all() as Array<{ id: string }>) if (!feedIds.has(row.id)) databaseHandle.prepare('DELETE FROM rss_feeds WHERE id = ?').run(row.id);
    for (const feed of state.subscriptions) saveFeed.run({ ...feed, category: feed.category || '未分类', error: feed.error ?? null });
    for (const article of state.articles) if (feedIds.has(article.feedId)) saveArticle.run({ ...article, read: article.read ? 1 : 0, starred: article.starred ? 1 : 0 });
  })();
}
