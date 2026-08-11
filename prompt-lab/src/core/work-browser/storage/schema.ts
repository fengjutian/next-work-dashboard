/**
 * Work Browser · SQLite schema (v1) — 内联为字符串，避免 ESM 读 .sql 资源。
 * 所有时间戳为 Unix 毫秒。
 */
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  icon          TEXT NOT NULL DEFAULT '🌊',
  color         TEXT NOT NULL DEFAULT '#2563eb',
  storage_path  TEXT NOT NULL,
  privacy_mode  TEXT NOT NULL DEFAULT 'normal',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  archived_at   INTEGER
);

CREATE TABLE IF NOT EXISTS tabs (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  url               TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  favicon           TEXT,
  web_contents_id   INTEGER,
  is_pinned         INTEGER NOT NULL DEFAULT 0,
  is_muted          INTEGER NOT NULL DEFAULT 0,
  position          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'loading',
  last_activated_at INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  active_time_ms    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tabs_workspace ON tabs(workspace_id, position);
CREATE INDEX IF NOT EXISTS idx_tabs_status ON tabs(workspace_id, status);

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'web',
  content_path    TEXT NOT NULL,
  raw_path        TEXT NOT NULL,
  screenshot_path TEXT,
  content_hash    TEXT NOT NULL,
  author          TEXT,
  published_at    INTEGER,
  captured_at     INTEGER NOT NULL,
  word_count      INTEGER NOT NULL DEFAULT 0,
  summary         TEXT,
  origin_tab_id   TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(url);

CREATE TABLE IF NOT EXISTS document_versions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  raw_path      TEXT NOT NULL,
  diff_summary  TEXT,
  word_delta    INTEGER NOT NULL DEFAULT 0,
  captured_at   INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  document_id   TEXT,
  tab_id        TEXT,
  task_id       TEXT,
  title         TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  selector    TEXT NOT NULL,
  range_text  TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'yellow',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(document_id);

CREATE TABLE IF NOT EXISTS tasks (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'todo',
  related_document_ids  TEXT NOT NULL DEFAULT '[]',
  related_tab_ids       TEXT NOT NULL DEFAULT '[]',
  related_note_ids      TEXT NOT NULL DEFAULT '[]',
  steps                 TEXT NOT NULL DEFAULT '[]',
  ai_generated          INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  resolved_at           INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  messages      TEXT NOT NULL DEFAULT '[]',
  context       TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace ON ai_conversations(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS search_history (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT,
  text          TEXT NOT NULL,
  providers     TEXT NOT NULL DEFAULT '[]',
  result_count  INTEGER NOT NULL DEFAULT 0,
  executed_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_history_time ON search_history(executed_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
