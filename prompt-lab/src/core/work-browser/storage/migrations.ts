/**
 * 启动时迁移：按版本号顺序应用未执行的 SQL。
 */
import type Database from 'better-sqlite3';
import { SCHEMA_V1 } from './schema';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const ALL_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    up: (db) => {
      db.exec(SCHEMA_V1);
    },
  },
];

export interface MigrationResult {
  from: number;
  to: number;
  applied: number;
}

export function runMigrations(db: Database.Database): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null } | undefined;
  const currentVersion = row?.v ?? 0;
  const pending = ALL_MIGRATIONS.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  if (pending.length === 0) return { from: currentVersion, to: currentVersion, applied: 0 };

  const apply = db.transaction((m: Migration) => {
    m.up(db);
    db.prepare('INSERT INTO schema_migrations(version, description, applied_at) VALUES (?, ?, ?)').run(
      m.version,
      m.description,
      Date.now(),
    );
  });

  let last = currentVersion;
  for (const m of pending) {
    apply(m);
    last = m.version;
  }
  return { from: currentVersion, to: last, applied: pending.length };
}
