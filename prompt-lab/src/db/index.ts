import Database from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    // In Electron, sql.js can use in-memory or persisted to a file
    // For now, use in-memory; will add file persistence in main process
    const SQL = Database();
    _db = drizzle(SQL, { schema });
  }
  return _db;
}
