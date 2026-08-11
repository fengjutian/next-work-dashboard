/**
 * Work Browser — Main 端 SQLite 入口
 *
 * 单例 better-sqlite3，路径：<userData>/work-browser.db
 * Phase 1 与原 next-work-dashboard 的主库（src/db/）独立；Phase 2 评估合并。
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as DatabaseNS from 'better-sqlite3';
import { runMigrations } from '../../core/work-browser/storage';

// better-sqlite3 是 CJS default export，import/resolver 静态分析不识别 default。
// 用 namespace import 并 alias 让 lint 通过。
const Database = (DatabaseNS as unknown as { default?: typeof DatabaseNS }).default || DatabaseNS;
type Database = typeof DatabaseNS;

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;
  const dir = path.join(app.getPath('userData'), 'work-browser');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'work-browser.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const result = runMigrations(db);
  console.log(`[work-browser] migrations ${result.from} → ${result.to} (applied ${result.applied})`);
  return db;
}

export function closeDatabase(): void {
  if (db) { db.close(); db = null; }
}
