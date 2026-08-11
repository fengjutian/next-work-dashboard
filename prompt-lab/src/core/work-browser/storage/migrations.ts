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
  {
    version: 2,
    description: 'FTS5: documents_fts + notes_fts + plain_text column + triggers',
    up: (db) => {
      // v1 → v2: 加 plain_text 列
      const cols = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
      if (!cols.find((c) => c.name === 'plain_text')) {
        db.exec('ALTER TABLE documents ADD COLUMN plain_text TEXT NOT NULL DEFAULT ""');
      }
      // 建 FTS5 虚拟表 + 触发器（v1 schema 不包含）
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          title, summary, plain_text,
          content='documents', content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
          INSERT INTO documents_fts(rowid, title, summary, plain_text) VALUES (new.rowid, new.title, new.summary, new.plain_text);
        END;
        CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, summary, plain_text) VALUES ('delete', old.rowid, old.title, old.summary, old.plain_text);
        END;
        CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, summary, plain_text) VALUES ('delete', old.rowid, old.title, old.summary, old.plain_text);
          INSERT INTO documents_fts(rowid, title, summary, plain_text) VALUES (new.rowid, new.title, new.summary, new.plain_text);
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title, content, tags,
          content='notes', content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
          INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
        END;
      `);
      // 回填已存在的 documents 进 FTS（如果 rowid 不连续）
      const backfill = db.prepare(`
        INSERT INTO documents_fts(rowid, title, summary, plain_text)
        SELECT rowid, title, summary, plain_text FROM documents
        WHERE rowid NOT IN (SELECT rowid FROM documents_fts)
      `);
      backfill.run();
      const backfillNotes = db.prepare(`
        INSERT INTO notes_fts(rowid, title, content, tags)
        SELECT rowid, title, content, tags FROM notes
        WHERE rowid NOT IN (SELECT rowid FROM notes_fts)
      `);
      backfillNotes.run();
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
