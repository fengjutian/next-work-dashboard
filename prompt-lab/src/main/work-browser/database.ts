/**
 * Work Browser — Main 端 SQLite 入口
 *
 * 单例 better-sqlite3，路径：<userData>/work-browser.db
 * Phase 1 与原 next-work-dashboard 的主库（src/db/）独立；Phase 2 评估合并。
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
// better-sqlite3 是 CJS default export，import/resolver 静态分析不识别 default，
// 用 namespace import 解包 default 后再取类型。
// eslint-disable-next-line import/no-unresolved
import * as DatabaseNS from 'better-sqlite3';
import { runMigrations } from '../../core/work-browser/storage';

type DatabaseCtor = new (filename: string) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));

let db: DatabaseNS.Database | null = null;

export function getDatabase(): DatabaseNS.Database {
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
