import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as DatabaseNS from 'better-sqlite3';
import { migrateLegacyWebsiteRegistry } from './legacy-migration';

type DatabaseCtor = new (filename: string) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));
let database: DatabaseNS.Database | null = null;

export function getWebsiteRegistryDatabase(): DatabaseNS.Database {
  if (database) return database;
  const dir = path.join(app.getPath('userData'), 'website-registry');
  fs.mkdirSync(dir, { recursive: true });
  database = new Database(path.join(dir, 'website-registry.db'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS website_categories(
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#6366f1', position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS website_records(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, normalized_url TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', category_id TEXT, tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
      favicon_url TEXT, favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_opened_at INTEGER, open_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(category_id) REFERENCES website_categories(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_website_records_category ON website_records(category_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_website_records_favorite ON website_records(favorite, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_website_records_opened ON website_records(last_opened_at DESC);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ${Date.now()});
  `);
  if (!app.isPackaged) {
    const legacyDatabasePath = path.join(app.getPath('appData'), app.getName(), 'website-registry', 'website-registry.db');
    try {
      const imported = migrateLegacyWebsiteRegistry(database, legacyDatabasePath);
      if (imported > 0) console.info(`[website-registry] Migrated ${imported} records from the legacy development profile.`);
    } catch (error) {
      console.warn('[website-registry] Legacy development profile migration failed; continuing with the current database.', error);
    }
  }
  return database;
}
