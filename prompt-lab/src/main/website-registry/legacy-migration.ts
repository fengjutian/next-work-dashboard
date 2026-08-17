import fs from 'node:fs';
import * as DatabaseNS from 'better-sqlite3';

type DatabaseCtor = new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));

const CATEGORY_COLUMNS = 'id,name,color,position,created_at,updated_at';
const RECORD_COLUMNS = 'id,name,url,normalized_url,description,category_id,tags,notes,favicon_url,favorite,archived,created_at,updated_at,last_opened_at,open_count';

/** Import the pre-profile-isolation website database once, without replacing newer data. */
export function migrateLegacyWebsiteRegistry(target: DatabaseNS.Database, legacyDatabasePath: string): number {
  if (!fs.existsSync(legacyDatabasePath)) return 0;
  const targetCount = (target.prepare('SELECT COUNT(*) AS value FROM website_records').get() as { value: number }).value;
  if (targetCount > 0) return 0;

  const legacy = new Database(legacyDatabasePath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set((legacy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
    if (!tables.has('website_records') || !tables.has('website_categories')) return 0;

    const categories = legacy.prepare(`SELECT ${CATEGORY_COLUMNS} FROM website_categories`).all() as Record<string, unknown>[];
    const records = legacy.prepare(`SELECT ${RECORD_COLUMNS} FROM website_records`).all() as Record<string, unknown>[];
    if (!categories.length && !records.length) return 0;

    const insertCategory = target.prepare(`INSERT OR IGNORE INTO website_categories(${CATEGORY_COLUMNS}) VALUES(@id,@name,@color,@position,@created_at,@updated_at)`);
    const insertRecord = target.prepare(`INSERT OR IGNORE INTO website_records(${RECORD_COLUMNS}) VALUES(@id,@name,@url,@normalized_url,@description,@category_id,@tags,@notes,@favicon_url,@favorite,@archived,@created_at,@updated_at,@last_opened_at,@open_count)`);
    target.transaction(() => {
      for (const category of categories) insertCategory.run(category);
      for (const record of records) insertRecord.run(record);
    })();
    return records.length;
  } finally {
    legacy.close();
  }
}
