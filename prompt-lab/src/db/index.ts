import initSqlJs, { type Database as SqlJsDatabase, type QueryExecResult } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { eq, inArray, desc } from 'drizzle-orm';
import * as schema from './schema';
import type { Skill, SkillFile } from '@/core/skill';

let _db: SQLJsDatabase<typeof schema> | null = null;
let _sqlDb: SqlJsDatabase | null = null;

// ═══════════════════════════════════════════
// 初始化 & 生命周期
// ═══════════════════════════════════════════

export async function initDb(buffer?: ArrayBuffer): Promise<SQLJsDatabase<typeof schema>> {
  // 方案 1：尝试从 public/ 目录加载 wasm（Vite 静态资源）
  // 方案 2：如果失败，回退到 node_modules 路径（Electron file:// 协议下生效）
  const wasmUrl = '/sql-wasm.wasm';
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  try {
    // 先尝试直接 fetch wasm binary，绕过 WebAssembly.instantiateStreaming 的 MIME 问题
    const resp = await fetch(wasmUrl);
    if (resp.ok) {
      const wasmBinary = await resp.arrayBuffer();
      SQL = await initSqlJs({ wasmBinary });
    } else {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch {
    // 回退：尝试 locateFile 方式（适合 file:// 协议）
    SQL = await initSqlJs({
      locateFile: (file: string) => `/${file}`,
    });
  }

  if (buffer && buffer.byteLength > 0) {
    _sqlDb = new SQL.Database(new Uint8Array(buffer));
  } else {
    _sqlDb = new SQL.Database();
  }
  _db = drizzle(_sqlDb, { schema });
  ensureSchema();
  const indexedCount = Number(_sqlDb.exec('SELECT COUNT(*) FROM weread_notes')[0]?.values[0]?.[0] || 0);
  const cachedCount = Number(_sqlDb.exec('SELECT COUNT(*) FROM weread_books')[0]?.values[0]?.[0] || 0);
  if (!indexedCount && cachedCount) rebuildWereadNoteIndex(dbLoadWereadCache());
  return _db;
}

export function getDb(): SQLJsDatabase<typeof schema> {
  if (!_db) throw new Error('DB not initialized — call initDb() first');
  return _db;
}

export function isDbReady(): boolean {
  return _db !== null && _sqlDb !== null;
}

export function exportDb(): Uint8Array {
  if (!_sqlDb) throw new Error('DB not initialized');
  return _sqlDb.export();
}

// ═══════════════════════════════════════════
// Schema auto-migration
// ═══════════════════════════════════════════

function ensureSchema(): void {
  if (!_sqlDb) return;
  _sqlDb.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT ""
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT "active",
      instruction TEXT NOT NULL DEFAULT "",
      worktree_path TEXT,
      worktree_branch TEXT,
      worktree_head TEXT,
      worktree_dirty INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      parent_session_id TEXT,
      token_budget INTEGER,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id, seq);
    CREATE TABLE IF NOT EXISTS agent_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT "info",
      message TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs(session_id, seq);
    CREATE TABLE IF NOT EXISTS agent_proposals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      original TEXT NOT NULL DEFAULT "",
      modified TEXT NOT NULL DEFAULT "",
      language TEXT NOT NULL DEFAULT "",
      previous_path TEXT,
      accepted INTEGER,
      accepted_at INTEGER,
      seq INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      scene TEXT NOT NULL DEFAULT 'chat',
      title TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      compare_models TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT NOT NULL DEFAULT '',
      bound_prompt_ids TEXT NOT NULL DEFAULT '[]',
      bound_skill_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_scene ON chat_sessions(scene, updated_at DESC);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      seq INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, seq);
    CREATE TABLE IF NOT EXISTS agent_tasks (
      task_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workspace_root TEXT NOT NULL DEFAULT "",
      execution_root TEXT,
      instruction TEXT NOT NULL DEFAULT "",
      model_config TEXT NOT NULL DEFAULT "{}",
      multi_file INTEGER NOT NULL DEFAULT 0,
      token_budget INTEGER NOT NULL DEFAULT 32000,
      state TEXT NOT NULL DEFAULT "queued",
      error TEXT,
      recovery TEXT,
      result TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id);
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '通用',
      tags TEXT NOT NULL DEFAULT '[]',
      variables TEXT NOT NULL DEFAULT '[]',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      input_selector TEXT NOT NULL,
      submit_selector TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      use_proxy INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS inject_history (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_response_cache (
      key TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_llm_response_cache_expiry ON llm_response_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_llm_response_cache_access ON llm_response_cache(last_accessed_at);
    CREATE TABLE IF NOT EXISTS embedding_cache (
      key TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_access ON embedding_cache(last_accessed_at);
    CREATE TABLE IF NOT EXISTS semantic_shadow_cache (
      key TEXT PRIMARY KEY, namespace TEXT NOT NULL, model TEXT NOT NULL, prompt TEXT NOT NULL,
      response TEXT NOT NULL, vector TEXT NOT NULL, created_at INTEGER NOT NULL, last_accessed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_shadow_scope ON semantic_shadow_cache(namespace, model, last_accessed_at DESC);
    CREATE TABLE IF NOT EXISTS llm_cache_events (
      id TEXT PRIMARY KEY, event TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      value INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_cache_events_time ON llm_cache_events(created_at DESC);
    CREATE TABLE IF NOT EXISTS weread_books (
      book_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      note_count INTEGER NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      bookmark_count INTEGER NOT NULL DEFAULT 0,
      highlights TEXT NOT NULL DEFAULT '[]',
      reviews TEXT NOT NULL DEFAULT '[]',
      searchable_text TEXT NOT NULL DEFAULT '',
      cached_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weread_books_cached_at ON weread_books(cached_at DESC);
    CREATE TABLE IF NOT EXISTS weread_notes (
      note_id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      book_title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      note_type TEXT NOT NULL,
      chapter TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_weread_notes_book ON weread_notes(book_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS weread_export_state (
      book_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      exported_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weread_review_state (
      book_id TEXT PRIMARY KEY,
      last_reviewed_at INTEGER NOT NULL,
      next_review_at INTEGER NOT NULL,
      review_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_weread_review_next ON weread_review_state(next_review_at);
    CREATE TABLE IF NOT EXISTS weread_actions (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL, source_note_id TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weread_actions_status ON weread_actions(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS weread_sync_history (
      id TEXT PRIMARY KEY, synced_at INTEGER NOT NULL,
      added_books INTEGER NOT NULL, updated_books INTEGER NOT NULL, deleted_books INTEGER NOT NULL,
      added_notes INTEGER NOT NULL, deleted_notes INTEGER NOT NULL,
      total_books INTEGER NOT NULL, total_notes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weread_sync_time ON weread_sync_history(synced_at DESC);
    CREATE TABLE IF NOT EXISTS hanyu_jinjie_executions (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      status TEXT NOT NULL,
      svg_content TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hanyu_jinjie_executions_time ON hanyu_jinjie_executions(created_at DESC);
    CREATE TABLE IF NOT EXISTS classical_readings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      original_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_classical_readings_time ON classical_readings(created_at DESC);
    CREATE TABLE IF NOT EXISTS document_knowledge_records (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
      sections TEXT NOT NULL DEFAULT '[]', plain_text TEXT NOT NULL DEFAULT '', chunks TEXT NOT NULL DEFAULT '[]',
      embedding_mode TEXT NOT NULL DEFAULT 'hash-fallback', created_at INTEGER NOT NULL, last_viewed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_document_knowledge_viewed ON document_knowledge_records(last_viewed_at DESC);
    CREATE TABLE IF NOT EXISTS lyric_generated_music (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT 'mp3',
      duration_ms INTEGER,
      sample_rate INTEGER,
      bitrate INTEGER,
      size INTEGER NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      audio BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lyric_music_project ON lyric_generated_music(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS style_generated_images (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL DEFAULT '',
      style TEXT NOT NULL DEFAULT 'custom',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '1:1',
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      image BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_style_images_created ON style_generated_images(created_at DESC);
    -- ── Video Generation (MiniMax-H3) ──
    -- 视频文件落盘到 userData/video-generation/，这里只存元数据
    CREATE TABLE IF NOT EXISTS video_generation_tasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'text-to-video',
      duration INTEGER NOT NULL DEFAULT 6,
      resolution TEXT NOT NULL DEFAULT '768P',
      ratio TEXT NOT NULL DEFAULT '16:9',
      file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_generation_created ON video_generation_tasks(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_generation_task_id ON video_generation_tasks(task_id);
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT "",
      body TEXT NOT NULL DEFAULT "",
      source TEXT NOT NULL DEFAULT "",
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_files (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT ""
    );
    CREATE INDEX IF NOT EXISTS idx_skill_files_skill ON skill_files(skill_id);

    -- ── Network Observatory (nwd-net-probe) ──
    CREATE TABLE IF NOT EXISTS net_probe_targets (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      probe TEXT NOT NULL DEFAULT 'icmp',
      interval_ms INTEGER NOT NULL DEFAULT 5000,
      timeout_ms INTEGER NOT NULL DEFAULT 3000,
      options_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS net_probe_results (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      probe TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      success INTEGER NOT NULL,
      latency_ms INTEGER,
      error TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_net_probe_results_target_ts
      ON net_probe_results(target_id, timestamp_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_net_probe_results_ts
      ON net_probe_results(timestamp_ms DESC);
    CREATE TABLE IF NOT EXISTS net_probe_alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_id TEXT,
      probe TEXT,
      metric TEXT NOT NULL,
      op TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify TEXT NOT NULL DEFAULT 'desktop',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS net_probe_incidents (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      peak_metric INTEGER NOT NULL,
      trigger_message TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_net_probe_incidents_open
      ON net_probe_incidents(target_id, ended_at);
    CREATE TABLE IF NOT EXISTS net_probe_lan_hosts (
      id TEXT PRIMARY KEY,                 -- e.g. "lan-192.168.1.1"
      ip TEXT NOT NULL UNIQUE,
      mac TEXT,                            -- null if SendARP / proc/net/arp not available
      hostname TEXT,                       -- reverse DNS
      vendor TEXT,                         -- OUI lookup, deferred (always null in V2.5)
      open_ports TEXT NOT NULL DEFAULT '[]',  -- JSON array of numbers
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'tcp',  -- 'tcp' | 'arp' | 'mdns'
      scan_id TEXT                         -- groups hosts from the same scan run
    );
    CREATE INDEX IF NOT EXISTS idx_net_probe_lan_hosts_last_seen
      ON net_probe_lan_hosts(last_seen DESC);

    -- ── 十二星座视角 ──
    CREATE TABLE IF NOT EXISTS zodiac_runs (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '{}',
      perspectives TEXT NOT NULL DEFAULT '[]',
      synthesis TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_zodiac_runs_time
      ON zodiac_runs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_zodiac_runs_favorite
      ON zodiac_runs(favorite, updated_at DESC);
    CREATE TABLE IF NOT EXISTS zodiac_followup_messages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES zodiac_runs(id) ON DELETE CASCADE,
      sign TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_zodiac_followup_run
      ON zodiac_followup_messages(run_id, created_at ASC);
  `);
  try {
    _sqlDb.run(`CREATE VIRTUAL TABLE IF NOT EXISTS weread_notes_fts USING fts5(
      note_id UNINDEXED, book_id UNINDEXED, book_title, author, chapter, content,
      tokenize='unicode61'
    )`);
  } catch {
    // Some custom sql.js builds omit FTS5. The structured notes table remains searchable.
  }

  // V2.3: per-rule notification config (webhook URL, bot tokens, etc.).
  // Idempotent migration: ignore "duplicate column name" on existing DBs.
  try {
    _sqlDb.run(`ALTER TABLE net_probe_alert_rules ADD COLUMN notify_config TEXT NOT NULL DEFAULT '{}'`);
  } catch {
    // column already exists
  }
  const sessionColumns = new Set((_sqlDb.exec('PRAGMA table_info(agent_sessions)')[0]?.values ?? []).map((row) => String(row[1])));
  if (!sessionColumns.has('payload')) _sqlDb.run("ALTER TABLE agent_sessions ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'");

  // Migration: add bound_skill_ids to chat_sessions if missing
  const chatColumns = new Set((_sqlDb.exec('PRAGMA table_info(chat_sessions)')[0]?.values ?? []).map((row) => String(row[1])));
  if (!chatColumns.has('bound_skill_ids')) _sqlDb.run("ALTER TABLE chat_sessions ADD COLUMN bound_skill_ids TEXT NOT NULL DEFAULT '[]'");
  const documentColumns = new Set((_sqlDb.exec('PRAGMA table_info(document_knowledge_records)')[0]?.values ?? []).map((row) => String(row[1])));
  if (!documentColumns.has('cached_file_path')) _sqlDb.run('ALTER TABLE document_knowledge_records ADD COLUMN cached_file_path TEXT');
  const hanyuColumns = new Set((_sqlDb.exec('PRAGMA table_info(hanyu_jinjie_executions)')[0]?.values ?? []).map((row) => String(row[1])));
  if (!hanyuColumns.has('explanation')) _sqlDb.run("ALTER TABLE hanyu_jinjie_executions ADD COLUMN explanation TEXT NOT NULL DEFAULT ''");
}

// ═══════════════════════════════════════════
// 类型适配 — UI 类型 ↔ DB row
// ═══════════════════════════════════════════

interface PromptRow {
  id: string; title: string; content: string; category: string;
  tags: string; variables: string;
  isFavorite: number; isPinned: number; usageCount: number;
  createdAt: number; updatedAt: number;
}

interface SiteRow {
  id: string; name: string; url: string;
  inputSelector: string; submitSelector: string;
  enabled: number; useProxy: number; sortOrder: number;
}

import type { Prompt, SiteConfig } from '@/store/types';

function promptToRow(p: Prompt): PromptRow {
  return {
    id: p.id, title: p.title, content: p.content, category: p.category,
    tags: JSON.stringify(p.tags), variables: JSON.stringify(p.variables),
    isFavorite: p.isFavorite ? 1 : 0, isPinned: p.isPinned ? 1 : 0,
    usageCount: p.usageCount, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function rowToPrompt(row: PromptRow): Prompt {
  return {
    id: row.id, title: row.title, content: row.content, category: row.category,
    tags: safeJsonParse(row.tags, []),
    variables: safeJsonParse(row.variables, []),
    isFavorite: row.isFavorite === 1, isPinned: row.isPinned === 1,
    usageCount: row.usageCount, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function siteToRow(s: SiteConfig): SiteRow {
  return {
    id: s.id, name: s.name, url: s.url,
    inputSelector: s.inputSelector, submitSelector: s.submitSelector,
    enabled: s.enabled ? 1 : 0, useProxy: 0, sortOrder: s.sortOrder,
  };
}

function rowToSite(row: SiteRow): SiteConfig {
  return {
    id: row.id, name: row.name, url: row.url,
    inputSelector: row.inputSelector, submitSelector: row.submitSelector,
    enabled: row.enabled === 1, sortOrder: row.sortOrder,
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ═══════════════════════════════════════════
// Prompts CRUD
// ═══════════════════════════════════════════

export function dbLoadPrompts(): Prompt[] {
  const rows = getDb().select().from(schema.prompts).all() as unknown as PromptRow[];
  return rows.map(rowToPrompt);
}

export function dbInsertPrompt(p: Prompt): void {
  getDb().insert(schema.prompts).values(promptToRow(p) as never).run();
}

export function dbUpdatePrompt(id: string, patch: Partial<Prompt>): void {
  const setObj: Record<string, unknown> = {};
  if (patch.title !== undefined) setObj.title = patch.title;
  if (patch.content !== undefined) setObj.content = patch.content;
  if (patch.category !== undefined) setObj.category = patch.category;
  if (patch.tags !== undefined) setObj.tags = JSON.stringify(patch.tags);
  if (patch.variables !== undefined) setObj.variables = JSON.stringify(patch.variables);
  if (patch.isFavorite !== undefined) setObj.isFavorite = patch.isFavorite ? 1 : 0;
  if (patch.isPinned !== undefined) setObj.isPinned = patch.isPinned ? 1 : 0;
  if (patch.usageCount !== undefined) setObj.usageCount = patch.usageCount;
  if (patch.updatedAt !== undefined) setObj.updatedAt = patch.updatedAt;
  if (Object.keys(setObj).length === 0) return;
  getDb().update(schema.prompts).set(setObj as never).where(eq(schema.prompts.id, id)).run();
}

export function dbDeletePrompt(id: string): void {
  getDb().delete(schema.prompts).where(eq(schema.prompts.id, id)).run();
}

export function dbBatchDeletePrompts(ids: string[]): void {
  if (ids.length === 0) return;
  getDb().delete(schema.prompts).where(inArray(schema.prompts.id, ids)).run();
}

// ═══════════════════════════════════════════
// Sites CRUD
// ═══════════════════════════════════════════

export function dbLoadSites(): SiteConfig[] {
  const rows = getDb().select().from(schema.sites).all() as unknown as SiteRow[];
  return rows.map(rowToSite);
}

export function dbInsertSite(s: SiteConfig): void {
  getDb().insert(schema.sites).values(siteToRow(s) as never).run();
}

export function dbUpdateSite(id: string, patch: Partial<SiteConfig>): void {
  const setObj: Record<string, unknown> = {};
  if (patch.name !== undefined) setObj.name = patch.name;
  if (patch.url !== undefined) setObj.url = patch.url;
  if (patch.inputSelector !== undefined) setObj.inputSelector = patch.inputSelector;
  if (patch.submitSelector !== undefined) setObj.submitSelector = patch.submitSelector;
  if (patch.enabled !== undefined) setObj.enabled = patch.enabled ? 1 : 0;
  if (patch.sortOrder !== undefined) setObj.sortOrder = patch.sortOrder;
  if (Object.keys(setObj).length === 0) return;
  getDb().update(schema.sites).set(setObj as never).where(eq(schema.sites.id, id)).run();
}

// ═══════════════════════════════════════════
// Inject History
// ═══════════════════════════════════════════

export function dbInsertInjectHistory(entry: { promptId: string; siteId: string; success: boolean; timestamp: number }): void {
  const id = `${entry.promptId}-${entry.siteId}-${entry.timestamp}`;
  getDb().insert(schema.injectHistory).values({
    id,
    promptId: entry.promptId,
    siteId: entry.siteId,
    success: entry.success ? 1 : 0,
    timestamp: entry.timestamp,
  } as never).run();
}

// ═══════════════════════════════════════════
// Settings (key-value)
// ═══════════════════════════════════════════

export function dbGetSetting(key: string): string | null {
  const rows = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).all();
  if (rows.length === 0) return null;
  return (rows[0] as unknown as { value: string }).value;
}

export function dbSetSetting(key: string, value: string): void {
  getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run();
  getDb().insert(schema.settings).values({ key, value } as never).run();
}

export interface DbLlmCacheEntry {
  key: string;
  response: string;
  reasoning: string;
  model: string;
  provider: string;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  hitCount: number;
}

export function dbGetLlmCache(key: string, now = Date.now()): DbLlmCacheEntry | null {
  if (!_sqlDb) return null;
  const safeKey = key.replace(/'/g, "''");
  const result = _sqlDb.exec(
    `SELECT key, response, reasoning, model, provider, created_at, expires_at, last_accessed_at, hit_count FROM llm_response_cache WHERE key = '${safeKey}' AND expires_at > ${Math.floor(now)}`,
  )[0];
  const row = result?.values[0];
  if (!row) return null;
  _sqlDb.run('UPDATE llm_response_cache SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE key = ?', [now, key]);
  return {
    key: String(row[0]), response: String(row[1]), reasoning: String(row[2]), model: String(row[3]), provider: String(row[4]),
    createdAt: Number(row[5]), expiresAt: Number(row[6]), lastAccessedAt: now, hitCount: Number(row[8]) + 1,
  };
}

export function dbPutLlmCache(entry: DbLlmCacheEntry, maxEntries = 5000): void {
  if (!_sqlDb) return;
  _sqlDb.run(`INSERT OR REPLACE INTO llm_response_cache
    (key, response, reasoning, model, provider, created_at, expires_at, last_accessed_at, hit_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    entry.key, entry.response, entry.reasoning, entry.model, entry.provider, entry.createdAt,
    entry.expiresAt, entry.lastAccessedAt, entry.hitCount,
  ]);
  _sqlDb.run('DELETE FROM llm_response_cache WHERE expires_at <= ?', [Date.now()]);
  _sqlDb.run(`DELETE FROM llm_response_cache WHERE key IN (
    SELECT key FROM llm_response_cache ORDER BY last_accessed_at DESC LIMIT -1 OFFSET ?
  )`, [Math.max(1, maxEntries)]);
}

export function dbClearLlmCache(): void {
  _sqlDb?.run('DELETE FROM llm_response_cache');
}

export function dbGetLlmCacheCount(now = Date.now()): number {
  if (!_sqlDb) return 0;
  const row = _sqlDb.exec(`SELECT COUNT(*) FROM llm_response_cache WHERE expires_at > ${Math.floor(now)}`)[0]?.values[0];
  return Number(row?.[0] ?? 0);
}

export function dbGetEmbeddingCache(keys: string[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (!_sqlDb || !keys.length) return result;
  const quoted = keys.map((key) => `'${key.replace(/'/g, "''")}'`).join(',');
  const rows = _sqlDb.exec(`SELECT key, vector FROM embedding_cache WHERE key IN (${quoted})`)[0]?.values ?? [];
  const now = Date.now();
  for (const row of rows) {
    try {
      const vector = JSON.parse(String(row[1]));
      if (Array.isArray(vector) && vector.every((value) => typeof value === 'number')) result.set(String(row[0]), vector);
    } catch { /* ignore invalid cache records */ }
  }
  if (result.size) {
    const hits = [...result.keys()].map((key) => `'${key.replace(/'/g, "''")}'`).join(',');
    _sqlDb.run(`UPDATE embedding_cache SET last_accessed_at = ${now}, hit_count = hit_count + 1 WHERE key IN (${hits})`);
  }
  return result;
}

export function dbPutEmbeddingCache(entries: Array<{ key: string; identity: string; vector: number[] }>, maxEntries = 20000): void {
  if (!_sqlDb || !entries.length) return;
  const now = Date.now();
  for (const entry of entries) {
    _sqlDb.run(`INSERT OR REPLACE INTO embedding_cache
      (key, identity, vector, created_at, last_accessed_at, hit_count) VALUES (?, ?, ?, ?, ?, 0)`,
    [entry.key, entry.identity, JSON.stringify(entry.vector), now, now]);
  }
  _sqlDb.run(`DELETE FROM embedding_cache WHERE key IN (
    SELECT key FROM embedding_cache ORDER BY last_accessed_at DESC LIMIT -1 OFFSET ?
  )`, [Math.max(100, maxEntries)]);
}

export function dbClearEmbeddingCache(): void { _sqlDb?.run('DELETE FROM embedding_cache'); }
export function dbGetEmbeddingCacheCount(): number {
  if (!_sqlDb) return 0;
  return Number(_sqlDb.exec('SELECT COUNT(*) FROM embedding_cache')[0]?.values[0]?.[0] ?? 0);
}

export interface DbSemanticShadowEntry { key: string; namespace: string; model: string; prompt: string; response: string; vector: number[]; createdAt: number }
export function dbListSemanticShadow(namespace: string, model: string, limit = 1000): DbSemanticShadowEntry[] {
  if (!_sqlDb) return [];
  const scope = namespace.replace(/'/g, "''"); const safeModel = model.replace(/'/g, "''");
  const rows = _sqlDb.exec(`SELECT key, namespace, model, prompt, response, vector, created_at FROM semantic_shadow_cache
    WHERE namespace = '${scope}' AND model = '${safeModel}' ORDER BY last_accessed_at DESC LIMIT ${Math.max(1, Math.min(5000, limit))}`)[0]?.values ?? [];
  return rows.flatMap((row) => { try { return [{ key: String(row[0]), namespace: String(row[1]), model: String(row[2]), prompt: String(row[3]), response: String(row[4]), vector: JSON.parse(String(row[5])) as number[], createdAt: Number(row[6]) }]; } catch { return []; } });
}
export function dbPutSemanticShadow(entry: DbSemanticShadowEntry, maxEntries = 5000): void {
  if (!_sqlDb) return; const now = Date.now();
  _sqlDb.run(`INSERT OR REPLACE INTO semantic_shadow_cache (key, namespace, model, prompt, response, vector, created_at, last_accessed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [entry.key, entry.namespace, entry.model, entry.prompt, entry.response, JSON.stringify(entry.vector), entry.createdAt, now]);
  _sqlDb.run(`DELETE FROM semantic_shadow_cache WHERE key IN (SELECT key FROM semantic_shadow_cache ORDER BY last_accessed_at DESC LIMIT -1 OFFSET ?)`, [Math.max(100, maxEntries)]);
}
export function dbClearSemanticShadow(): void { _sqlDb?.run('DELETE FROM semantic_shadow_cache'); }
export function dbGetSemanticShadowCount(): number { return Number(_sqlDb?.exec('SELECT COUNT(*) FROM semantic_shadow_cache')[0]?.values[0]?.[0] ?? 0); }

export type LlmCacheEventName = 'memory_hit' | 'persistent_hit' | 'coalesced_hit' | 'miss' | 'bypass' | 'write' | 'shadow_none' | 'shadow_medium' | 'shadow_high';
export function dbRecordLlmCacheEvent(event: LlmCacheEventName, namespace = '', model = '', value = 0): void {
  if (!_sqlDb) return;
  const now = Date.now();
  _sqlDb.run('INSERT INTO llm_cache_events (id, event, namespace, model, value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [`${now}-${Math.random().toString(36).slice(2, 10)}`, event, namespace, model, Math.round(value * 1_000_000), now]);
  _sqlDb.run('DELETE FROM llm_cache_events WHERE created_at < ?', [now - 90 * 24 * 60 * 60 * 1000]);
}

export interface LlmCachePersistentStats { total: number; memoryHits: number; persistentHits: number; coalescedHits: number; misses: number; bypasses: number; writes: number; shadowNone: number; shadowMedium: number; shadowHigh: number; averageShadowSimilarity: number }
export function dbGetLlmCacheStats(since = Date.now() - 30 * 24 * 60 * 60 * 1000): LlmCachePersistentStats {
  const stats: LlmCachePersistentStats = { total: 0, memoryHits: 0, persistentHits: 0, coalescedHits: 0, misses: 0, bypasses: 0, writes: 0, shadowNone: 0, shadowMedium: 0, shadowHigh: 0, averageShadowSimilarity: 0 };
  if (!_sqlDb) return stats;
  const rows = _sqlDb.exec(`SELECT event, COUNT(*), AVG(value) FROM llm_cache_events WHERE created_at >= ${Math.floor(since)} GROUP BY event`)[0]?.values ?? [];
  const map: Record<string, keyof LlmCachePersistentStats> = { memory_hit: 'memoryHits', persistent_hit: 'persistentHits', coalesced_hit: 'coalescedHits', miss: 'misses', bypass: 'bypasses', write: 'writes', shadow_none: 'shadowNone', shadow_medium: 'shadowMedium', shadow_high: 'shadowHigh' };
  for (const row of rows) {
    const field = map[String(row[0])]; if (field) (stats[field] as number) = Number(row[1]);
    if (String(row[0]).startsWith('shadow_')) stats.averageShadowSimilarity += Number(row[2] ?? 0) / 1_000_000 * Number(row[1]);
  }
  stats.total = stats.memoryHits + stats.persistentHits + stats.coalescedHits + stats.misses;
  const shadowTotal = stats.shadowNone + stats.shadowMedium + stats.shadowHigh;
  stats.averageShadowSimilarity = shadowTotal ? stats.averageShadowSimilarity / shadowTotal : 0;
  return stats;
}

export function dbClearLlmCacheEvents(): void { _sqlDb?.run('DELETE FROM llm_cache_events'); }

export interface WereadCachedBook {
  bookId: string;
  title: string;
  author: string;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
  highlights: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  cachedAt: number;
}

interface WereadBookRow extends Omit<WereadCachedBook, 'highlights' | 'reviews'> {
  highlights: string;
  reviews: string;
  searchableText: string;
}

function wereadRowToBook(row: WereadBookRow): WereadCachedBook {
  return {
    bookId: row.bookId, title: row.title, author: row.author,
    noteCount: row.noteCount, reviewCount: row.reviewCount, bookmarkCount: row.bookmarkCount,
    highlights: safeJsonParse(row.highlights, []), reviews: safeJsonParse(row.reviews, []), cachedAt: row.cachedAt,
  };
}

function wereadSearchText(book: Omit<WereadCachedBook, 'cachedAt'>): string {
  const noteText = [...book.highlights, ...book.reviews].map((item) => {
    const review = item.review && typeof item.review === 'object' ? item.review as Record<string, unknown> : item;
    const chapter = item.chapter && typeof item.chapter === 'object' ? item.chapter as Record<string, unknown> : {};
    return [item.markText, item.chapterTitle, chapter.title, review.abstract, review.content, review.chapterName]
      .filter(Boolean).join(' ');
  }).join(' ');
  return `${book.title} ${book.author} ${noteText}`.toLocaleLowerCase();
}

export interface WereadIndexedNote {
  noteId: string;
  bookId: string;
  bookTitle: string;
  author: string;
  noteType: 'highlight' | 'review';
  chapter: string;
  content: string;
  createdAt: number;
}

function wereadIndexedNotes(book: Omit<WereadCachedBook, 'cachedAt'>): WereadIndexedNote[] {
  const highlights = book.highlights.map((item, index) => {
    const chapter = item.chapter && typeof item.chapter === 'object' ? item.chapter as Record<string, unknown> : {};
    return {
      noteId: String(item.bookmarkId || `h:${book.bookId}:${index}`), bookId: book.bookId,
      bookTitle: book.title, author: book.author, noteType: 'highlight' as const,
      chapter: String(chapter.title || item.chapterTitle || ''), content: String(item.markText || ''),
      createdAt: Number(item.createTime) || 0,
    };
  });
  const reviews = book.reviews.map((item, index) => {
    const review = item.review && typeof item.review === 'object' ? item.review as Record<string, unknown> : item;
    return {
      noteId: String(review.reviewId || `r:${book.bookId}:${index}`), bookId: book.bookId,
      bookTitle: book.title, author: book.author, noteType: 'review' as const,
      chapter: String(review.chapterName || ''),
      content: [review.abstract, review.content].filter(Boolean).join(' '), createdAt: Number(review.createTime) || 0,
    };
  });
  return [...highlights, ...reviews];
}

function rebuildWereadNoteIndex(books: Array<Omit<WereadCachedBook, 'cachedAt'>>): void {
  if (!_sqlDb) return;
  _sqlDb.run('DELETE FROM weread_notes');
  const insert = _sqlDb.prepare(`INSERT INTO weread_notes
    (note_id, book_id, book_title, author, note_type, chapter, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  try {
    for (const book of books) for (const note of wereadIndexedNotes(book)) {
      insert.run([note.noteId, note.bookId, note.bookTitle, note.author, note.noteType, note.chapter, note.content, note.createdAt]);
    }
  } finally { insert.free(); }
  try {
    _sqlDb.run('DELETE FROM weread_notes_fts');
    _sqlDb.run(`INSERT INTO weread_notes_fts (note_id, book_id, book_title, author, chapter, content)
      SELECT note_id, book_id, book_title, author, chapter, content FROM weread_notes`);
  } catch { /* FTS5 is optional; dbSearchWereadNotes falls back to LIKE. */ }
}

export interface WereadSyncSummary { id: string; syncedAt: number; addedBooks: number; updatedBooks: number; deletedBooks: number; addedNotes: number; deletedNotes: number; totalBooks: number; totalNotes: number }

function wereadNoteIds(book: Pick<WereadCachedBook, 'bookId' | 'highlights' | 'reviews'>): Set<string> {
  return new Set([...book.highlights.map((item, index) => String(item.bookmarkId || `h:${book.bookId}:${index}`)), ...book.reviews.map((item, index) => { const review = item.review && typeof item.review === 'object' ? item.review as Record<string, unknown> : item; return String(review.reviewId || `r:${book.bookId}:${index}`); })]);
}

export function dbReplaceWereadCache(books: Array<Omit<WereadCachedBook, 'cachedAt'>>): WereadSyncSummary {
  const database = getDb();
  const previous = dbLoadWereadCache(); const oldById = new Map(previous.map((book) => [book.bookId, book])); const nextById = new Map(books.map((book) => [book.bookId, book]));
  const oldNotes = new Set(previous.flatMap((book) => [...wereadNoteIds(book)])); const nextNotes = new Set(books.flatMap((book) => [...wereadNoteIds(book)]));
  const syncedAt = Date.now();
  const summary: WereadSyncSummary = {
    id: `weread-sync-${syncedAt}`, syncedAt,
    addedBooks: books.filter((book) => !oldById.has(book.bookId)).length,
    updatedBooks: books.filter((book) => { const old = oldById.get(book.bookId); return old && (JSON.stringify(old.highlights) !== JSON.stringify(book.highlights) || JSON.stringify(old.reviews) !== JSON.stringify(book.reviews)); }).length,
    deletedBooks: previous.filter((book) => !nextById.has(book.bookId)).length,
    addedNotes: [...nextNotes].filter((id) => !oldNotes.has(id)).length,
    deletedNotes: [...oldNotes].filter((id) => !nextNotes.has(id)).length,
    totalBooks: books.length, totalNotes: nextNotes.size,
  };
  database.transaction((tx) => {
    tx.delete(schema.wereadBooks).run();
    const cachedAt = syncedAt;
    for (const book of books) {
      tx.insert(schema.wereadBooks).values({
        ...book,
        highlights: JSON.stringify(book.highlights),
        reviews: JSON.stringify(book.reviews),
        searchableText: wereadSearchText(book),
        cachedAt,
      } as never).run();
    }
    tx.insert(schema.wereadSyncHistory).values(summary as never).run();
  });
  rebuildWereadNoteIndex(books);
  return summary;
}

export function dbLoadWereadCache(query = ''): WereadCachedBook[] {
  const statement = getDb().select().from(schema.wereadBooks);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const bookIds = terms.length ? new Set(dbSearchWereadNotes(query).map((match) => match.bookId)) : null;
  const rows = statement.orderBy(desc(schema.wereadBooks.cachedAt)).all()
    .filter((row) => !bookIds || bookIds.has(String((row as { bookId: string }).bookId)) || terms.every((term) => `${(row as { title: string }).title} ${(row as { author: string }).author}`.toLocaleLowerCase().includes(term)));
  return (rows as unknown as WereadBookRow[]).map(wereadRowToBook);
}

export interface WereadNoteSearchMatch extends WereadIndexedNote { snippet: string }

function ftsQuery(query: string): string {
  return query.trim().split(/\s+/).filter(Boolean).map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}

export function dbSearchWereadNotes(query: string, limit = 200): WereadNoteSearchMatch[] {
  if (!_sqlDb || !query.trim()) return [];
  try {
    const statement = _sqlDb.prepare(`SELECT n.note_id, n.book_id, n.book_title, n.author, n.note_type,
      n.chapter, n.content, n.created_at,
      snippet(weread_notes_fts, 5, '<mark>', '</mark>', '…', 18) AS search_snippet
      FROM weread_notes_fts JOIN weread_notes n ON n.note_id = weread_notes_fts.note_id
      WHERE weread_notes_fts MATCH ? ORDER BY rank LIMIT ?`);
    try {
      statement.bind([ftsQuery(query), limit]);
      const matches: WereadNoteSearchMatch[] = [];
      while (statement.step()) {
        const row = statement.getAsObject();
        matches.push({
          noteId: String(row.note_id), bookId: String(row.book_id), bookTitle: String(row.book_title), author: String(row.author),
          noteType: row.note_type === 'review' ? 'review' : 'highlight', chapter: String(row.chapter || ''),
          content: String(row.content || ''), createdAt: Number(row.created_at) || 0, snippet: String(row.search_snippet || row.content || ''),
        });
      }
      return matches;
    } finally { statement.free(); }
  } catch {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const statement = _sqlDb.prepare('SELECT * FROM weread_notes ORDER BY created_at DESC');
    try {
      const matches: WereadNoteSearchMatch[] = [];
      while (statement.step() && matches.length < limit) {
        const row = statement.getAsObject();
        const haystack = [row.book_title, row.author, row.chapter, row.content].join(' ').toLocaleLowerCase();
        if (!terms.every((term) => haystack.includes(term))) continue;
        matches.push({ noteId: String(row.note_id), bookId: String(row.book_id), bookTitle: String(row.book_title), author: String(row.author), noteType: row.note_type === 'review' ? 'review' : 'highlight', chapter: String(row.chapter || ''), content: String(row.content || ''), createdAt: Number(row.created_at) || 0, snippet: String(row.content || '') });
      }
      return matches;
    } finally { statement.free(); }
  }
}

export interface WereadExportState { bookId: string; fingerprint: string; exportedAt: number }
export function dbLoadWereadExportStates(): WereadExportState[] {
  if (!_sqlDb) return [];
  const result = _sqlDb.exec('SELECT book_id, fingerprint, exported_at FROM weread_export_state');
  return (result[0]?.values || []).map((row) => ({ bookId: String(row[0]), fingerprint: String(row[1]), exportedAt: Number(row[2]) }));
}
export function dbMarkWereadExported(states: Array<{ bookId: string; fingerprint: string }>): void {
  if (!_sqlDb) throw new Error('DB not initialized');
  const statement = _sqlDb.prepare(`INSERT INTO weread_export_state (book_id, fingerprint, exported_at) VALUES (?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET fingerprint=excluded.fingerprint, exported_at=excluded.exported_at`);
  try { const now = Date.now(); for (const state of states) statement.run([state.bookId, state.fingerprint, now]); }
  finally { statement.free(); }
}

export interface WereadReviewState {
  bookId: string;
  lastReviewedAt: number;
  nextReviewAt: number;
  reviewCount: number;
}

export function dbLoadWereadReviewStates(): WereadReviewState[] {
  return getDb().select().from(schema.wereadReviewState).all() as unknown as WereadReviewState[];
}

export function dbMarkWereadReviewed(bookId: string, intervalDays: number): WereadReviewState {
  const previous = getDb().select().from(schema.wereadReviewState).where(eq(schema.wereadReviewState.bookId, bookId)).get() as WereadReviewState | undefined;
  const now = Date.now();
  const state = { bookId, lastReviewedAt: now, nextReviewAt: now + intervalDays * 86_400_000, reviewCount: (previous?.reviewCount || 0) + 1 };
  getDb().insert(schema.wereadReviewState).values(state as never).onConflictDoUpdate({ target: schema.wereadReviewState.bookId, set: state as never }).run();
  return state;
}

export interface WereadAction { id: string; bookId: string; sourceNoteId: string; content: string; status: 'todo' | 'doing' | 'done'; createdAt: number; updatedAt: number }
export function dbLoadWereadActions(): WereadAction[] { return getDb().select().from(schema.wereadActions).orderBy(desc(schema.wereadActions.updatedAt)).all() as unknown as WereadAction[]; }
export function dbSaveWereadAction(action: WereadAction): void { getDb().insert(schema.wereadActions).values(action as never).onConflictDoUpdate({ target: schema.wereadActions.id, set: action as never }).run(); }
export function dbLoadWereadSyncHistory(): WereadSyncSummary[] { return getDb().select().from(schema.wereadSyncHistory).orderBy(desc(schema.wereadSyncHistory.syncedAt)).all() as unknown as WereadSyncSummary[]; }

export interface HanyuJinjieExecution {
  id: string;
  word: string;
  status: 'success' | 'error';
  svgContent: string;
  explanation: string;
  error: string;
  model: string;
  createdAt: number;
}

export function dbSaveHanyuJinjieExecution(execution: HanyuJinjieExecution): void {
  getDb().insert(schema.hanyuJinjieExecutions).values(execution).run();
}

export function dbLoadHanyuJinjieExecutions(limit = 30): HanyuJinjieExecution[] {
  return getDb().select().from(schema.hanyuJinjieExecutions).orderBy(desc(schema.hanyuJinjieExecutions.createdAt)).limit(Math.max(1, Math.min(200, limit))).all() as HanyuJinjieExecution[];
}

export function dbDeleteHanyuJinjieExecution(id: string): void {
  getDb().delete(schema.hanyuJinjieExecutions).where(eq(schema.hanyuJinjieExecutions.id, id)).run();
}

export function dbUpdateHanyuJinjieExecution(id: string, patch: Partial<Pick<HanyuJinjieExecution, 'svgContent' | 'explanation'>>): void {
  getDb().update(schema.hanyuJinjieExecutions).set(patch).where(eq(schema.hanyuJinjieExecutions.id, id)).run();
}

// ═══════════════════════════════════════════
// 古文阅读 — 用户原文 + LLM 精读卡片（Markdown）
// ═══════════════════════════════════════════

export interface ClassicalReading {
  id: string;
  title: string;
  source: string;
  originalText: string;
  status: 'success' | 'error';
  content: string;
  error: string;
  model: string;
  createdAt: number;
}

export function dbSaveClassicalReading(reading: ClassicalReading): void {
  getDb().insert(schema.classicalReadings).values(reading).run();
}

export function dbLoadClassicalReadings(limit = 30): ClassicalReading[] {
  return getDb()
    .select()
    .from(schema.classicalReadings)
    .orderBy(desc(schema.classicalReadings.createdAt))
    .limit(Math.max(1, Math.min(200, limit)))
    .all() as ClassicalReading[];
}

export function dbDeleteClassicalReading(id: string): void {
  getDb().delete(schema.classicalReadings).where(eq(schema.classicalReadings.id, id)).run();
}

// ═══════════════════════════════════════════
// 十二星座视角 — 一轮运行 + 追问消息
// ═══════════════════════════════════════════

export interface ZodiacRunRecord {
  id: string;
  question: string;
  title: string;
  options: Record<string, unknown>;     // GenerationOptions 的 JSON
  perspectives: unknown[];              // ZodiacPerspective[] 的 JSON
  synthesis: unknown | null;            // ZodiacSynthesis | null 的 JSON
  favorite: boolean;
  partial: boolean;
  model: string;
  createdAt: number;
  updatedAt: number;
}

interface ZodiacRunRow {
  id: string;
  question: string;
  title: string;
  options: string;
  perspectives: string;
  synthesis: string | null;
  favorite: number;
  partial: number;
  model: string;
  createdAt: number;
  updatedAt: number;
}

function zodiacRunRowToRecord(row: ZodiacRunRow): ZodiacRunRecord {
  return {
    id: row.id,
    question: row.question,
    title: row.title,
    options: safeJsonParse(row.options, {}),
    perspectives: safeJsonParse(row.perspectives, []),
    synthesis: row.synthesis == null ? null : safeJsonParse(row.synthesis, null),
    favorite: row.favorite === 1,
    partial: row.partial === 1,
    model: row.model,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function zodiacRunRecordToRow(record: ZodiacRunRecord): ZodiacRunRow {
  return {
    id: record.id,
    question: record.question,
    title: record.title,
    options: JSON.stringify(record.options ?? {}),
    perspectives: JSON.stringify(record.perspectives ?? []),
    synthesis: record.synthesis == null ? null : JSON.stringify(record.synthesis),
    favorite: record.favorite ? 1 : 0,
    partial: record.partial ? 1 : 0,
    model: record.model ?? '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function dbSaveZodiacRun(record: ZodiacRunRecord): void {
  const row = zodiacRunRecordToRow(record);
  getDb().insert(schema.zodiacRuns).values(row as never)
    .onConflictDoUpdate({
      target: schema.zodiacRuns.id,
      set: {
        question: row.question,
        title: row.title,
        options: row.options,
        perspectives: row.perspectives,
        synthesis: row.synthesis,
        favorite: row.favorite,
        partial: row.partial,
        model: row.model,
        updatedAt: row.updatedAt,
      },
    })
    .run();
}

export interface DbLoadZodiacRunsOptions {
  limit?: number;
  favoriteOnly?: boolean;
  search?: string;
}

export function dbLoadZodiacRuns(options: DbLoadZodiacRunsOptions = {}): ZodiacRunRecord[] {
  const limit = Math.max(1, Math.min(500, options.limit ?? 50));
  const search = options.search?.trim() ?? '';
  // MVP：用 sql.js 原生 exec 做 LIKE 过滤；FTS5 留给后续版本。
  if (!_sqlDb) return [];
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (options.favoriteOnly) where.push('favorite = 1');
  if (search) {
    where.push('(question LIKE ? OR title LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const statement = _sqlDb.prepare(
    `SELECT id, question, title, options, perspectives, synthesis, favorite, partial, model, created_at AS createdAt, updated_at AS updatedAt
     FROM zodiac_runs ${whereClause}
     ORDER BY updated_at DESC
     LIMIT ?`,
  );
  try {
    const rows: ZodiacRunRow[] = [];
    statement.bind(params.concat(limit));
    while (statement.step()) {
      const row = statement.getAsObject() as unknown as ZodiacRunRow;
      rows.push(row);
    }
    return rows.map(zodiacRunRowToRecord);
  } finally {
    statement.free();
  }
}

export function dbGetZodiacRun(id: string): ZodiacRunRecord | null {
  const row = (getDb().select().from(schema.zodiacRuns).where(eq(schema.zodiacRuns.id, id)).get() as unknown as ZodiacRunRow | undefined) ?? null;
  return row ? zodiacRunRowToRecord(row) : null;
}

export function dbDeleteZodiacRun(id: string): void {
  getDb().delete(schema.zodiacRuns).where(eq(schema.zodiacRuns.id, id)).run();
}

export function dbUpdateZodiacRun(
  id: string,
  patch: Partial<Pick<ZodiacRunRecord, 'title' | 'favorite' | 'partial' | 'synthesis' | 'perspectives' | 'options'>>,
): void {
  const dbPatch: Record<string, unknown> = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.favorite !== undefined) dbPatch.favorite = patch.favorite ? 1 : 0;
  if (patch.partial !== undefined) dbPatch.partial = patch.partial ? 1 : 0;
  if (patch.synthesis !== undefined) dbPatch.synthesis = patch.synthesis == null ? null : JSON.stringify(patch.synthesis);
  if (patch.perspectives !== undefined) dbPatch.perspectives = JSON.stringify(patch.perspectives);
  if (patch.options !== undefined) dbPatch.options = JSON.stringify(patch.options);
  if (!Object.keys(dbPatch).length) return;
  dbPatch.updatedAt = Date.now();
  getDb().update(schema.zodiacRuns).set(dbPatch as never).where(eq(schema.zodiacRuns.id, id)).run();
}

/** 保留最近 N 条非收藏记录（收藏永不裁剪）；返回被删除的 id 列表。 */
export function dbPruneZodiacRuns(maxRows: number): string[] {
  if (!_sqlDb) return [];
  const rows = _sqlDb.exec(
    `SELECT id FROM zodiac_runs WHERE favorite = 0 ORDER BY updated_at DESC`,
  );
  const ids = (rows[0]?.values ?? []).map((row) => String(row[0]));
  if (ids.length <= maxRows) return [];
  const stale = ids.slice(maxRows);
  if (!stale.length) return [];
  const placeholders = stale.map(() => '?').join(',');
  _sqlDb.run(`DELETE FROM zodiac_runs WHERE id IN (${placeholders})`, stale);
  return stale;
}

export interface ZodiacFollowupMessageRecord {
  id: string;
  runId: string;
  sign: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export function dbLoadZodiacFollowupMessages(runId: string): ZodiacFollowupMessageRecord[] {
  return (getDb().select().from(schema.zodiacFollowupMessages).where(eq(schema.zodiacFollowupMessages.runId, runId)).orderBy(schema.zodiacFollowupMessages.createdAt).all() as unknown as ZodiacFollowupMessageRecord[]);
}

export function dbAppendZodiacFollowupMessage(message: ZodiacFollowupMessageRecord): void {
  getDb().insert(schema.zodiacFollowupMessages).values(message as never).run();
}

export function dbClearZodiacFollowupMessages(runId: string): void {
  getDb().delete(schema.zodiacFollowupMessages).where(eq(schema.zodiacFollowupMessages.runId, runId)).run();
}

export interface DocumentKnowledgeRecord {
  id: string; name: string; kind: string; size: number; sections: unknown[]; plainText: string;
  chunks: unknown[]; embeddingMode: string; createdAt: number; lastViewedAt: number;
  cachedFilePath?: string | null;
}
interface DocumentKnowledgeRow extends Omit<DocumentKnowledgeRecord, 'sections' | 'chunks'> { sections: string; chunks: string }
function documentKnowledgeRow(row: DocumentKnowledgeRow): DocumentKnowledgeRecord {
  return { ...row, sections: safeJsonParse(row.sections, []), chunks: safeJsonParse(row.chunks, []) };
}
export function dbSaveDocumentKnowledge(record: DocumentKnowledgeRecord): void {
  getDb().insert(schema.documentKnowledgeRecords).values({ ...record, sections: JSON.stringify(record.sections), chunks: JSON.stringify(record.chunks) } as never)
    .onConflictDoUpdate({ target: schema.documentKnowledgeRecords.id, set: { name: record.name, kind: record.kind, size: record.size, sections: JSON.stringify(record.sections), plainText: record.plainText, chunks: JSON.stringify(record.chunks), embeddingMode: record.embeddingMode, cachedFilePath: record.cachedFilePath, lastViewedAt: record.lastViewedAt } }).run();
}
export function dbLoadDocumentKnowledge(): DocumentKnowledgeRecord[] {
  return (getDb().select().from(schema.documentKnowledgeRecords).orderBy(desc(schema.documentKnowledgeRecords.lastViewedAt)).all() as unknown as DocumentKnowledgeRow[]).map(documentKnowledgeRow);
}
export function dbTouchDocumentKnowledge(id: string, lastViewedAt = Date.now()): void {
  getDb().update(schema.documentKnowledgeRecords).set({ lastViewedAt }).where(eq(schema.documentKnowledgeRecords.id, id)).run();
}
export function dbDeleteDocumentKnowledge(id: string): void { getDb().delete(schema.documentKnowledgeRecords).where(eq(schema.documentKnowledgeRecords.id, id)).run(); }

export interface DbGeneratedMusicRecord {
  id: string; projectId: string; title: string; model: string; prompt: string; format: 'mp3' | 'wav';
  durationMs?: number; sampleRate?: number; bitrate?: number; size: number; favorite: boolean; createdAt: number; audio: Uint8Array;
}

export async function dbSaveGeneratedMusic(record: DbGeneratedMusicRecord): Promise<void> {
  if (!_sqlDb) throw new Error('DB not initialized');
  _sqlDb.run(`INSERT OR REPLACE INTO lyric_generated_music
    (id, project_id, title, model, prompt, format, duration_ms, sample_rate, bitrate, size, favorite, created_at, audio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [record.id, record.projectId, record.title, record.model, record.prompt, record.format, record.durationMs ?? null, record.sampleRate ?? null, record.bitrate ?? null, record.size, record.favorite ? 1 : 0, record.createdAt, record.audio]);
  await flushDbToDisk();
}

export function dbListGeneratedMusic(projectId: string): DbGeneratedMusicRecord[] {
  if (!_sqlDb) return [];
  const statement = _sqlDb.prepare('SELECT * FROM lyric_generated_music WHERE project_id = ? ORDER BY created_at DESC');
  statement.bind([projectId]); const records: DbGeneratedMusicRecord[] = [];
  while (statement.step()) { const row = statement.getAsObject(); records.push({ id: String(row.id), projectId: String(row.project_id), title: String(row.title), model: String(row.model), prompt: String(row.prompt), format: row.format === 'wav' ? 'wav' : 'mp3', durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms), sampleRate: row.sample_rate == null ? undefined : Number(row.sample_rate), bitrate: row.bitrate == null ? undefined : Number(row.bitrate), size: Number(row.size), favorite: Boolean(row.favorite), createdAt: Number(row.created_at), audio: row.audio as Uint8Array }); }
  statement.free(); return records;
}

export async function dbDeleteGeneratedMusic(id: string): Promise<void> { if (!_sqlDb) throw new Error('DB not initialized'); _sqlDb.run('DELETE FROM lyric_generated_music WHERE id = ?', [id]); await flushDbToDisk(); }
export async function dbUpdateGeneratedMusic(id: string, patch: { title?: string; favorite?: boolean }): Promise<void> { if (!_sqlDb) throw new Error('DB not initialized'); if (patch.title !== undefined) _sqlDb.run('UPDATE lyric_generated_music SET title = ? WHERE id = ?', [patch.title, id]); if (patch.favorite !== undefined) _sqlDb.run('UPDATE lyric_generated_music SET favorite = ? WHERE id = ?', [patch.favorite ? 1 : 0, id]); await flushDbToDisk(); }

export interface DbGeneratedImageRecord {
  id: string; prompt: string; style: string; provider: string; model: string; aspectRatio: string;
  mimeType: string; size: number; createdAt: number; image: Uint8Array;
}

export async function dbSaveGeneratedImage(record: DbGeneratedImageRecord): Promise<void> {
  if (!_sqlDb) throw new Error('DB not initialized');
  _sqlDb.run(`INSERT OR REPLACE INTO style_generated_images
    (id, prompt, style, provider, model, aspect_ratio, mime_type, size, created_at, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [record.id, record.prompt, record.style, record.provider, record.model, record.aspectRatio, record.mimeType, record.size, record.createdAt, record.image]);
  await flushDbToDisk();
}

export function dbListGeneratedImages(): DbGeneratedImageRecord[] {
  if (!_sqlDb) return [];
  const statement = _sqlDb.prepare('SELECT * FROM style_generated_images ORDER BY created_at DESC');
  const records: DbGeneratedImageRecord[] = [];
  while (statement.step()) { const row = statement.getAsObject(); records.push({ id: String(row.id), prompt: String(row.prompt), style: String(row.style), provider: String(row.provider), model: String(row.model), aspectRatio: String(row.aspect_ratio), mimeType: String(row.mime_type), size: Number(row.size), createdAt: Number(row.created_at), image: row.image as Uint8Array }); }
  statement.free(); return records;
}

export async function dbDeleteGeneratedImage(id: string): Promise<void> {
  if (!_sqlDb) throw new Error('DB not initialized');
  _sqlDb.run('DELETE FROM style_generated_images WHERE id = ?', [id]);
  await flushDbToDisk();
}

// ─── Video Generation (MiniMax-H3) ────────────────────────────────
export interface DbVideoTaskRecord {
  id: string;
  taskId: string;
  prompt: string;
  model: string;
  mode: string;
  duration: number;
  resolution: string;
  ratio: string;
  fileName: string;
  filePath: string;
  bytes: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export async function dbUpsertVideoTask(record: DbVideoTaskRecord): Promise<void> {
  if (!_sqlDb) throw new Error('DB not initialized');
  _sqlDb.run(`INSERT OR REPLACE INTO video_generation_tasks
    (id, task_id, prompt, model, mode, duration, resolution, ratio, file_name, file_path, bytes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.id, record.taskId, record.prompt, record.model, record.mode, record.duration, record.resolution, record.ratio,
    record.fileName, record.filePath, record.bytes, record.status, record.createdAt, record.updatedAt,
  ]);
  await flushDbToDisk();
}

export async function dbUpdateVideoTaskStatus(id: string, status: string, updatedAt = Date.now()): Promise<void> {
  if (!_sqlDb) throw new Error('DB not initialized');
  _sqlDb.run('UPDATE video_generation_tasks SET status = ?, updated_at = ? WHERE id = ?', [status, updatedAt, id]);
  await flushDbToDisk();
}

export async function dbUpdateVideoTaskFile(id: string, fileName: string, filePath: string, bytes: number): Promise<void> {
  if (!_sqlDb) throw new Error('DB not initialized');
  _sqlDb.run('UPDATE video_generation_tasks SET file_name = ?, file_path = ?, bytes = ?, updated_at = ? WHERE id = ?',
    [fileName, filePath, bytes, Date.now(), id]);
  await flushDbToDisk();
}

export function dbListVideoTasks(limit = 100, status?: string): DbVideoTaskRecord[] {
  if (!_sqlDb) return [];
  const statement = status
    ? _sqlDb.prepare('SELECT * FROM video_generation_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?')
    : _sqlDb.prepare('SELECT * FROM video_generation_tasks ORDER BY created_at DESC LIMIT ?');
  statement.bind(status ? [status, limit] : [limit]);
  const records: DbVideoTaskRecord[] = [];
  while (statement.step()) {
    const row = statement.getAsObject();
    records.push({
      id: String(row.id),
      taskId: String(row.task_id),
      prompt: String(row.prompt),
      model: String(row.model),
      mode: String(row.mode),
      duration: Number(row.duration),
      resolution: String(row.resolution),
      ratio: String(row.ratio),
      fileName: String(row.file_name),
      filePath: String(row.file_path),
      bytes: Number(row.bytes),
      status: String(row.status),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    });
  }
  statement.free();
  return records;
}

export function dbGetVideoTask(id: string): DbVideoTaskRecord | null {
  if (!_sqlDb) return null;
  const statement = _sqlDb.prepare('SELECT * FROM video_generation_tasks WHERE id = ?');
  statement.bind([id]);
  if (!statement.step()) { statement.free(); return null; }
  const row = statement.getAsObject();
  statement.free();
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    prompt: String(row.prompt),
    model: String(row.model),
    mode: String(row.mode),
    duration: Number(row.duration),
    resolution: String(row.resolution),
    ratio: String(row.ratio),
    fileName: String(row.file_name),
    filePath: String(row.file_path),
    bytes: Number(row.bytes),
    status: String(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function dbDeleteVideoTask(id: string): Promise<string | null> {
  if (!_sqlDb) throw new Error('DB not initialized');
  const existing = dbGetVideoTask(id);
  if (!existing) return null;
  _sqlDb.run('DELETE FROM video_generation_tasks WHERE id = ?', [id]);
  await flushDbToDisk();
  return existing.filePath || null;
}

// ═══════════════════════════════════════════
// 数据库浏览器（只读查询）
// ═══════════════════════════════════════════

export function execSql(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
  if (!_sqlDb) throw new Error('DB not initialized');
  const results = _sqlDb.exec(sql);
  return results.map((r: QueryExecResult) => ({
    columns: r.columns,
    values: r.values,
  }));
}

export function getTableInfo(): Array<{ table: string; columns: Array<{ name: string; type: string }> }> {
  if (!_sqlDb) throw new Error('DB not initialized');
  const result = _sqlDb.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_drizzle%' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }> = [];
  if (result.length === 0) return tables;
  const tableNames = result[0].values.map((row: unknown[]) => String(row[0]))
    .filter((table) => !/_fts_(?:data|idx|content|docsize|config)$/i.test(table));
  for (const table of tableNames) {
    const cols = _sqlDb.exec(`PRAGMA table_info('${table}')`);
    if (cols.length > 0) {
      tables.push({
        table,
        columns: cols[0].values.map((row: unknown[]) => ({
          name: String(row[1]),
          type: String(row[2]),
        })),
      });
    }
  }
  return tables;
}

export interface DatabaseTableStats {
  table: string;
  rowCount?: number;
  payloadBytes?: number;
}

export interface DatabaseStats {
  totalBytes: number;
  pageSize: number;
  pageCount: number;
  freePages: number;
  tables: DatabaseTableStats[];
}

/** 轻量数据库概览。表级统计按需通过 getDatabaseTableStats 获取，避免打开浏览器时扫描全库。 */
export function getDatabaseStats(): DatabaseStats {
  if (!_sqlDb) throw new Error('DB not initialized');
  const tableInfo = getTableInfo();
  const pragmaNumber = (name: 'page_size' | 'page_count' | 'freelist_count'): number =>
    Number(_sqlDb?.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0] ?? 0);
  const tables = tableInfo.map(({ table }) => ({ table }));
  const pageSize = pragmaNumber('page_size');
  const pageCount = pragmaNumber('page_count');
  return {
    totalBytes: pageSize * pageCount,
    pageSize,
    pageCount,
    freePages: pragmaNumber('freelist_count'),
    tables,
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function requireKnownTable(table: string): { name: string; type: string }[] {
  const info = getTableInfo().find((item) => item.table === table);
  if (!info) throw new Error(`Unknown table: ${table}`);
  return info.columns;
}

export function getDatabaseTableStats(table: string): Required<DatabaseTableStats> {
  if (!_sqlDb) throw new Error('DB not initialized');
  const columns = requireKnownTable(table);
  const payloadExpression = columns.length
    ? columns.map(({ name }) => `COALESCE(length(CAST(${quoteIdentifier(name)} AS BLOB)), 0)`).join(' + ')
    : '0';
  const result = _sqlDb.exec(
    `SELECT COUNT(*), COALESCE(SUM(${payloadExpression}), 0) FROM ${quoteIdentifier(table)}`
  )[0];
  return {
    table,
    rowCount: Number(result?.values[0]?.[0] ?? 0),
    payloadBytes: Number(result?.values[0]?.[1] ?? 0),
  };
}

export interface DatabaseTablePage {
  columns: string[];
  values: unknown[][];
  totalRows: number;
}

export interface DatabaseReadonlyQueryResult {
  columns: string[];
  values: unknown[][];
  elapsedMs: number;
  offset: number;
  hasMore: boolean;
}

const SAFE_PRAGMAS = new Set([
  'compile_options', 'database_list', 'encoding', 'foreign_key_list', 'freelist_count',
  'index_info', 'index_list', 'integrity_check', 'page_count', 'page_size',
  'quick_check', 'table_info', 'table_xinfo',
]);

function sqlWithoutCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .trim();
}

export function validateReadonlyDatabaseSql(sql: string): { valid: true } | { valid: false; message: string; offset?: number } {
  const cleaned = sqlWithoutCommentsAndLiterals(sql).replace(/;+\s*$/, '').trim();
  if (!cleaned) return { valid: false, message: '请输入 SQL 查询' };
  const semicolon = cleaned.indexOf(';');
  if (semicolon >= 0) return { valid: false, message: '只允许执行一条 SQL 语句', offset: semicolon };
  const firstKeyword = cleaned.match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  if (!firstKeyword || !['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA'].includes(firstKeyword)) {
    return { valid: false, message: '只允许 SELECT、WITH、EXPLAIN 和安全 PRAGMA' };
  }
  const forbidden = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE)\b/i.exec(cleaned);
  if (forbidden) return { valid: false, message: `只读模式禁止 ${forbidden[1].toUpperCase()}`, offset: forbidden.index };
  if (firstKeyword === 'PRAGMA') {
    if (/=/.test(cleaned)) return { valid: false, message: '只读模式禁止修改 PRAGMA' };
    const pragma = cleaned.match(/^PRAGMA\s+(?:[a-z_][\w]*\.)?([a-z_][\w]*)/i)?.[1]?.toLowerCase();
    if (!pragma || !SAFE_PRAGMAS.has(pragma)) return { valid: false, message: `不允许执行 PRAGMA ${pragma ?? ''}`.trim() };
  }
  return { valid: true };
}

export function runReadonlyDatabaseSql(sql: string, options: { offset?: number; limit?: number } = {}): DatabaseReadonlyQueryResult {
  if (!_sqlDb) throw new Error('DB not initialized');
  const validation = validateReadonlyDatabaseSql(sql);
  if (!validation.valid) throw new Error(validation.offset === undefined ? validation.message : `${validation.message}（位置 ${validation.offset + 1}）`);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 200)));
  const startedAt = performance.now();
  let statement: ReturnType<SqlJsDatabase['prepare']>;
  try {
    statement = _sqlDb.prepare(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const token = message.match(/near "([^"]+)"/)?.[1];
    const offsetHint = token ? sql.toLocaleLowerCase().indexOf(token.toLocaleLowerCase()) : -1;
    throw new Error(offsetHint >= 0 ? `${message}（位置 ${offsetHint + 1}）` : message);
  }
  const columns = statement.getColumnNames();
  const values: unknown[][] = [];
  let seen = 0;
  let hasMore = false;
  while (statement.step()) {
    if (seen++ < offset) continue;
    if (values.length >= limit) { hasMore = true; break; }
    values.push(statement.get());
  }
  statement.free();
  return { columns, values, elapsedMs: performance.now() - startedAt, offset, hasMore };
}

export type DatabaseFilterOperator = 'contains' | 'equals' | 'is-null' | 'not-null';

export interface DatabaseColumnFilter {
  column: string;
  operator: DatabaseFilterOperator;
  value?: string;
}

export interface DatabaseTableSchema {
  createSql: string;
  columns: Array<{ name: string; type: string; notNull: boolean; defaultValue: unknown; primaryKeyOrder: number }>;
  foreignKeys: Array<{ id: number; from: string; targetTable: string; targetColumn: string; onUpdate: string; onDelete: string }>;
  indexes: Array<{ name: string; unique: boolean; origin: string }>;
}

export interface DatabaseColumnAnalysis {
  column: string;
  totalRows: number;
  nullCount: number;
  distinctCount: number;
  min: unknown;
  max: unknown;
  average: number | null;
  minLength: number | null;
  maxLength: number | null;
  averageLength: number | null;
  topValues: Array<{ value: unknown; count: number }>;
  jsonChecked: number;
  invalidJsonCount: number;
}

export function getDatabaseColumnAnalysis(table: string, column: string): DatabaseColumnAnalysis {
  if (!_sqlDb) throw new Error('DB not initialized');
  const columns = requireKnownTable(table);
  if (!columns.some((item) => item.name === column)) throw new Error(`Unknown column: ${column}`);
  const quotedTable = quoteIdentifier(table);
  const quotedColumn = quoteIdentifier(column);
  const aggregate = _sqlDb.exec(`SELECT COUNT(*), COUNT(*) - COUNT(${quotedColumn}), COUNT(DISTINCT ${quotedColumn}), MIN(${quotedColumn}), MAX(${quotedColumn}), AVG(${quotedColumn}), MIN(length(CAST(${quotedColumn} AS TEXT))), MAX(length(CAST(${quotedColumn} AS TEXT))), AVG(length(CAST(${quotedColumn} AS TEXT))) FROM ${quotedTable}`)[0]?.values[0] ?? [];
  const topRows = _sqlDb.exec(`SELECT ${quotedColumn}, COUNT(*) AS frequency FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL GROUP BY ${quotedColumn} ORDER BY frequency DESC LIMIT 10`)[0]?.values ?? [];
  const sampleRows = _sqlDb.exec(`SELECT ${quotedColumn} FROM ${quotedTable} WHERE typeof(${quotedColumn}) = 'text' AND substr(trim(${quotedColumn}), 1, 1) IN ('{', '[') LIMIT 1000`)[0]?.values ?? [];
  let invalidJsonCount = 0;
  for (const row of sampleRows) {
    try { JSON.parse(String(row[0])); } catch { invalidJsonCount += 1; }
  }
  const numberOrNull = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
  return {
    column,
    totalRows: Number(aggregate[0] ?? 0),
    nullCount: Number(aggregate[1] ?? 0),
    distinctCount: Number(aggregate[2] ?? 0),
    min: aggregate[3] ?? null,
    max: aggregate[4] ?? null,
    average: numberOrNull(aggregate[5]),
    minLength: numberOrNull(aggregate[6]),
    maxLength: numberOrNull(aggregate[7]),
    averageLength: numberOrNull(aggregate[8]),
    topValues: topRows.map((row) => ({ value: row[0], count: Number(row[1]) })),
    jsonChecked: sampleRows.length,
    invalidJsonCount,
  };
}

export interface DatabaseSchemaDiagnostic { severity: 'info' | 'warning'; message: string }

export function getDatabaseSchemaDiagnostics(table: string): DatabaseSchemaDiagnostic[] {
  const schemaInfo = getDatabaseTableSchema(table);
  const diagnostics: DatabaseSchemaDiagnostic[] = [];
  if (!schemaInfo.columns.some((column) => column.primaryKeyOrder > 0)) diagnostics.push({ severity: 'warning', message: '该表没有显式主键，行级定位和维护操作存在风险。' });
  for (const foreignKey of schemaInfo.foreignKeys) {
    const covered = schemaInfo.indexes.some((index) => {
      if (!_sqlDb) return false;
      const rows = _sqlDb.exec(`PRAGMA index_info(${quoteIdentifier(index.name)})`)[0]?.values ?? [];
      return rows.some((row) => String(row[2]) === foreignKey.from);
    });
    if (!covered) diagnostics.push({ severity: 'warning', message: `外键列 ${foreignKey.from} 没有索引，关联查询可能较慢。` });
  }
  const signatures = new Map<string, string>();
  for (const index of schemaInfo.indexes) {
    if (!_sqlDb) break;
    const signature = (_sqlDb.exec(`PRAGMA index_info(${quoteIdentifier(index.name)})`)[0]?.values ?? []).map((row) => String(row[2])).join(',');
    const existing = signatures.get(signature);
    if (signature && existing) diagnostics.push({ severity: 'info', message: `索引 ${index.name} 与 ${existing} 覆盖相同字段。` });
    else if (signature) signatures.set(signature, index.name);
  }
  return diagnostics;
}

export function getDatabaseTableSchema(table: string): DatabaseTableSchema {
  if (!_sqlDb) throw new Error('DB not initialized');
  requireKnownTable(table);
  const quotedTable = quoteIdentifier(table);
  const schemaStatement = _sqlDb.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?");
  schemaStatement.bind([table]);
  const createSql = schemaStatement.step() ? String(schemaStatement.get()[0] ?? '') : '';
  schemaStatement.free();
  const columnRows = _sqlDb.exec(`PRAGMA table_info(${quotedTable})`)[0]?.values ?? [];
  const foreignKeyRows = _sqlDb.exec(`PRAGMA foreign_key_list(${quotedTable})`)[0]?.values ?? [];
  const indexRows = _sqlDb.exec(`PRAGMA index_list(${quotedTable})`)[0]?.values ?? [];
  return {
    createSql,
    columns: columnRows.map((row) => ({
      name: String(row[1]), type: String(row[2]), notNull: Boolean(row[3]),
      defaultValue: row[4], primaryKeyOrder: Number(row[5]),
    })),
    foreignKeys: foreignKeyRows.map((row) => ({
      id: Number(row[0]), targetTable: String(row[2]), from: String(row[3]), targetColumn: String(row[4]),
      onUpdate: String(row[5]), onDelete: String(row[6]),
    })),
    indexes: indexRows.map((row) => ({ name: String(row[1]), unique: Boolean(row[2]), origin: String(row[3]) })),
  };
}

export function getDatabaseTablePage(
  table: string,
  options: { offset?: number; limit?: number; sortColumn?: string; sortDirection?: 'asc' | 'desc'; totalRows?: number; filters?: DatabaseColumnFilter[] } = {},
): DatabaseTablePage {
  if (!_sqlDb) throw new Error('DB not initialized');
  const columns = requireKnownTable(table);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const filters = (options.filters ?? []).filter((filter) => {
    if (!columns.some((column) => column.name === filter.column)) throw new Error(`Unknown column: ${filter.column}`);
    return filter.operator === 'is-null' || filter.operator === 'not-null' || Boolean(filter.value?.length);
  });
  const filterValues: string[] = [];
  const whereParts = filters.map((filter) => {
    const column = quoteIdentifier(filter.column);
    if (filter.operator === 'is-null') return `${column} IS NULL`;
    if (filter.operator === 'not-null') return `${column} IS NOT NULL`;
    filterValues.push(filter.operator === 'contains' ? `%${filter.value}%` : String(filter.value));
    return filter.operator === 'contains' ? `CAST(${column} AS TEXT) LIKE ?` : `CAST(${column} AS TEXT) = ?`;
  });
  const where = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';
  let orderBy = '';
  if (options.sortColumn) {
    if (!columns.some((column) => column.name === options.sortColumn)) {
      throw new Error(`Unknown column: ${options.sortColumn}`);
    }
    orderBy = ` ORDER BY ${quoteIdentifier(options.sortColumn)} ${options.sortDirection === 'desc' ? 'DESC' : 'ASC'}`;
  }
  const quotedTable = quoteIdentifier(table);
  const dataStatement = _sqlDb.prepare(`SELECT * FROM ${quotedTable}${where}${orderBy} LIMIT ${limit} OFFSET ${offset}`);
  if (filterValues.length) dataStatement.bind(filterValues);
  const values: unknown[][] = [];
  while (dataStatement.step()) values.push(dataStatement.get());
  const resultColumns = dataStatement.getColumnNames();
  dataStatement.free();
  let totalRows = options.totalRows;
  if (totalRows === undefined) {
    const countStatement = _sqlDb.prepare(`SELECT COUNT(*) FROM ${quotedTable}${where}`);
    if (filterValues.length) countStatement.bind(filterValues);
    totalRows = countStatement.step() ? Number(countStatement.get()[0] ?? 0) : 0;
    countStatement.free();
  }
  return {
    columns: resultColumns.length ? resultColumns : columns.map((column) => column.name),
    values,
    totalRows,
  };
}

// ═══════════════════════════════════════════
// 持久化到磁盘（立即 flush）
// ═══════════════════════════════════════════

/** 将内存中的 SQLite DB 立即写入磁盘文件。在关键设置变更后调用，避免依赖定时器/quit 时机。 */
export async function flushDbToDisk(): Promise<void> {
  if (!_sqlDb) return;
  try {
    const data = _sqlDb.export();
    // 通过 electronAPI 写入磁盘（仅在 Electron 渲染进程下可用）
    const win = window as unknown as { electronAPI?: { db?: { save?: (buf: ArrayBuffer) => Promise<unknown> } } };
    if (win.electronAPI?.db?.save) {
      await win.electronAPI.db.save(data.buffer);
    }
  } catch { /* 静默失败 — 下次定时器仍会保存 */ }
}

// ═══════════════════════════════════════════
// Chat Sessions — SQLite 规范化存储
// ═══════════════════════════════════════════

const CHAT_SESSIONS_KEY = 'chat_sessions';

export function dbLoadChatSessions<T = unknown>(scene = 'chat'): T | null {
  if (!_sqlDb) return null;
  const sessionStatement = _sqlDb.prepare('SELECT * FROM chat_sessions WHERE scene = ? ORDER BY updated_at DESC');
  sessionStatement.bind([scene]);
  const sessions: any[] = [];
  while (sessionStatement.step()) {
    const row = sessionStatement.getAsObject() as Record<string, unknown>;
    const messageStatement = _sqlDb.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY seq ASC');
    messageStatement.bind([String(row.id)]);
    const messages: any[] = [];
    while (messageStatement.step()) {
      const message = messageStatement.getAsObject() as Record<string, unknown>;
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(String(message.payload ?? '{}')); } catch { /* ignore invalid legacy payload */ }
      messages.push({ ...payload, id: String(message.id), role: String(message.role), content: String(message.content), timestamp: Number(message.timestamp) });
    }
    messageStatement.free();
    sessions.push({
      id: String(row.id), scene: String(row.scene), title: String(row.title), model: String(row.model),
      compareModels: JSON.parse(String(row.compare_models ?? '[]')),
      systemPrompt: String(row.system_prompt), boundPromptIds: JSON.parse(String(row.bound_prompt_ids ?? '[]')),
      boundSkillIds: JSON.parse(String(row.bound_skill_ids ?? '[]')),
      createdAt: Number(row.created_at), messages,
    });
  }
  sessionStatement.free();
  if (sessions.length) return sessions as unknown as T;

  // 一次性兼容旧版 settings JSON。
  const raw = dbGetSetting(CHAT_SESSIONS_KEY);
  if (!raw) return null;
  try {
    const legacy = JSON.parse(raw) as Array<Record<string, unknown>>;
    const migrated = legacy.map((session) => ({ ...session, scene: session.scene ?? 'chat' }));
    dbSaveChatSessions(migrated, 'chat');
    return migrated.filter((session) => session.scene === scene) as unknown as T;
  } catch { return null; }
}


// ═══════════════════════════════════════════
// Agent Sessions CRUD
// ═══════════════════════════════════════════

export interface AgentSessionRow {
  id: string; title: string; status: string; instruction: string;
  worktreePath: string | null; worktreeBranch: string | null;
  worktreeHead: string | null; worktreeDirty: number;
  isPinned: number; parentSessionId: string | null;
  tokenBudget: number | null;
  payload: string;
  createdAt: number; updatedAt: number; archivedAt: number | null;
}

interface AgentMessageRow {
  id: string; sessionId: string; role: string; content: string;
  seq: number; timestamp: number;
}

interface AgentLogRow {
  id: string; sessionId: string; level: string; message: string;
  seq: number; timestamp: number;
}

interface AgentProposalRow {
  id: string; sessionId: string; path: string;
  original: string; modified: string; language: string;
  previousPath: string | null; accepted: number | null;
  acceptedAt: number | null; seq: number; createdAt: number;
}

export interface AgentTaskRow {
  taskId: string; sessionId: string; workspaceRoot: string;
  executionRoot: string | null; instruction: string;
  modelConfig: string; multiFile: number; tokenBudget: number;
  state: string; error: string | null;
  recovery: string | null; result: string | null;
  createdAt: number; startedAt: number | null;
  endedAt: number | null; updatedAt: number;
}

// ── Sessions ──

export function dbLoadAgentSessions(): AgentSessionRow[] {
  try {
    return getDb().select().from(schema.agentSessions).orderBy(desc(schema.agentSessions.updatedAt)).all() as unknown as AgentSessionRow[];
  } catch { return []; }
}

export function dbInsertAgentSession(row: AgentSessionRow): void {
  getDb().insert(schema.agentSessions).values(row as never).onConflictDoUpdate({
    target: schema.agentSessions.id,
    set: row as never,
  }).run();
}

export function dbUpdateAgentSession(id: string, patch: Record<string, unknown>): void {
  getDb().update(schema.agentSessions).set(patch as never).where(eq(schema.agentSessions.id, id)).run();
}

export function dbDeleteAgentSession(id: string): void {
  getDb().delete(schema.agentSessions).where(eq(schema.agentSessions.id, id)).run();
}

// ── Messages ──

export function dbLoadAgentMessages(sessionId: string, limit = 100, offset = 0): AgentMessageRow[] {
  try {
    return getDb().select().from(schema.agentMessages)
      .where(eq(schema.agentMessages.sessionId, sessionId))
      .orderBy(schema.agentMessages.seq)
      .limit(limit).offset(offset).all() as unknown as AgentMessageRow[];
  } catch { return []; }
}

export function dbInsertAgentMessage(row: AgentMessageRow): void {
  getDb().insert(schema.agentMessages).values(row as never).onConflictDoUpdate({
    target: schema.agentMessages.id,
    set: row as never,
  }).run();
}

export function dbDeleteAgentMessages(sessionId: string): void {
  getDb().delete(schema.agentMessages).where(eq(schema.agentMessages.sessionId, sessionId)).run();
}

// ── Logs ──

export function dbLoadAgentLogs(sessionId: string, limit = 100, offset = 0): AgentLogRow[] {
  try {
    return getDb().select().from(schema.agentLogs)
      .where(eq(schema.agentLogs.sessionId, sessionId))
      .orderBy(schema.agentLogs.seq)
      .limit(limit).offset(offset).all() as unknown as AgentLogRow[];
  } catch { return []; }
}

export function dbInsertAgentLog(row: AgentLogRow): void {
  getDb().insert(schema.agentLogs).values(row as never).onConflictDoUpdate({
    target: schema.agentLogs.id,
    set: row as never,
  }).run();
}

export function dbDeleteAgentLogs(sessionId: string): void {
  getDb().delete(schema.agentLogs).where(eq(schema.agentLogs.sessionId, sessionId)).run();
}

// ── Proposals ──

export function dbLoadAgentProposals(sessionId: string): AgentProposalRow[] {
  try {
    return getDb().select().from(schema.agentProposals)
      .where(eq(schema.agentProposals.sessionId, sessionId))
      .orderBy(schema.agentProposals.seq).all() as unknown as AgentProposalRow[];
  } catch { return []; }
}

export function dbInsertAgentProposal(row: AgentProposalRow): void {
  getDb().insert(schema.agentProposals).values(row as never).onConflictDoUpdate({
    target: schema.agentProposals.id,
    set: row as never,
  }).run();
}

export function dbUpdateAgentProposal(id: string, patch: Record<string, unknown>): void {
  getDb().update(schema.agentProposals).set(patch as never).where(eq(schema.agentProposals.id, id)).run();
}

export function dbDeleteAgentProposals(sessionId: string): void {
  getDb().delete(schema.agentProposals).where(eq(schema.agentProposals.sessionId, sessionId)).run();
}

// ── Tasks (for persistence and restart recovery) ──

export function dbUpsertAgentTask(row: AgentTaskRow): void {
  // INSERT OR REPLACE
  getDb().delete(schema.agentTasks).where(eq(schema.agentTasks.taskId, row.taskId)).run();
  getDb().insert(schema.agentTasks).values(row as never).run();
}

export function dbLoadAgentTasks(sessionId?: string): AgentTaskRow[] {
  try {
    if (sessionId) {
      return getDb().select().from(schema.agentTasks)
        .where(eq(schema.agentTasks.sessionId, sessionId))
        .orderBy(desc(schema.agentTasks.createdAt)).all() as unknown as AgentTaskRow[];
    }
    return getDb().select().from(schema.agentTasks)
      .orderBy(desc(schema.agentTasks.createdAt)).all() as unknown as AgentTaskRow[];
  } catch { return []; }
}

export function dbLoadRecoverableTasks(): AgentTaskRow[] {
  try {
    return getDb().select().from(schema.agentTasks)
      .where(
        eq(schema.agentTasks.state, "queued")
      ).all() as unknown as AgentTaskRow[];
  } catch { return []; }
}

export function dbDeleteAgentTask(taskId: string): void {
  getDb().delete(schema.agentTasks).where(eq(schema.agentTasks.taskId, taskId)).run();
}

export function dbDeleteAgentTasksBySession(sessionId: string): void {
  getDb().delete(schema.agentTasks).where(eq(schema.agentTasks.sessionId, sessionId)).run();
}

// ── Schema version ──

export function dbGetSchemaVersion(): number {
  try {
    const rows = getDb().select().from(schema.schemaVersion).all();
    if (rows.length === 0) return 0;
    return (rows[rows.length - 1] as unknown as { version: number }).version;
  } catch { return 0; }
}

export function dbSetSchemaVersion(version: number, description = ""): void {
  getDb().insert(schema.schemaVersion).values({
    version, appliedAt: Date.now(), description
  } as never).run();
}

export function dbSaveChatSessions(sessions: unknown, scene = 'chat'): void {
  if (!_sqlDb || !Array.isArray(sessions)) return;
  _sqlDb.run('BEGIN');
  try {
    const ids = sessions.map((session: any) => String(session.id));
    const existing = _sqlDb.exec(`SELECT id FROM chat_sessions WHERE scene = '${scene.replace(/'/g, "''")}'`)[0]?.values.flat().map(String) ?? [];
    for (const id of existing.filter((id) => !ids.includes(id))) {
      _sqlDb.run('DELETE FROM chat_messages WHERE session_id = ?', [id]);
      _sqlDb.run('DELETE FROM chat_sessions WHERE id = ?', [id]);
    }
    for (const session of sessions as any[]) {
      const now = Date.now();
      _sqlDb.run(`INSERT OR REPLACE INTO chat_sessions
        (id, scene, title, model, compare_models, system_prompt, bound_prompt_ids, bound_skill_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        String(session.id), scene, String(session.title ?? '新对话'), String(session.model ?? ''),
        JSON.stringify(session.compareModels ?? []), String(session.systemPrompt ?? ''),
        JSON.stringify(session.boundPromptIds ?? []), JSON.stringify(session.boundSkillIds ?? []), Number(session.createdAt ?? now), now,
      ]);
      _sqlDb.run('DELETE FROM chat_messages WHERE session_id = ?', [String(session.id)]);
      (session.messages ?? []).forEach((message: any, seq: number) => {
        const { id, role, content, timestamp, ...payload } = message;
        _sqlDb!.run(`INSERT INTO chat_messages (id, session_id, role, content, payload, seq, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [String(id), String(session.id), String(role), String(content ?? ''), JSON.stringify(payload), seq, Number(timestamp ?? now)]);
      });
    }
    _sqlDb.run('COMMIT');
  } catch (error) {
    _sqlDb.run('ROLLBACK');
    throw error;
  }
}


// ═══════════════════════════════════════════
// Migration from localStorage to SQLite
// ═══════════════════════════════════════════

const MIGRATION_VERSION = 1;

export function needsMigration(): boolean {
  return dbGetSchemaVersion() < MIGRATION_VERSION;
}

export function migrateFromLocalStorage(): { success: boolean; migrated: number; error?: string } {
  const currentVersion = dbGetSchemaVersion();
  if (currentVersion >= MIGRATION_VERSION) return { success: true, migrated: 0 };

  let migrated = 0;
  try {
    // Migrate agent sessions
    const sessionsRaw = localStorage.getItem("code-editor.agent-sessions.v1");
    if (sessionsRaw) {
      const sessions = JSON.parse(sessionsRaw) as Array<Record<string, unknown>>;
      for (const s of sessions) {
        dbInsertAgentSession({
          id: String(s.id ?? ""), title: String(s.title ?? ""),
          status: String(s.status ?? "active"),
          instruction: String(s.instruction ?? ""),
          worktreePath: s.worktree ? String((s.worktree as Record<string,unknown>).path ?? "") : null,
          worktreeBranch: s.worktree ? String((s.worktree as Record<string,unknown>).branch ?? "") : null,
          worktreeHead: s.worktree ? ((s.worktree as Record<string,unknown>).head as string) ?? null : null,
          worktreeDirty: s.worktree ? ((s.worktree as Record<string,unknown>).dirty ? 1 : 0) : 0,
          isPinned: s.pinned ? 1 : 0, parentSessionId: null, tokenBudget: null,
          payload: JSON.stringify(s),
          createdAt: Number(s.createdAt ?? Date.now()),
          updatedAt: Number(s.updatedAt ?? Date.now()),
          archivedAt: s.archivedAt ? Number(s.archivedAt) : null,
        });
        migrated++;
      }
    }

    // Migrate agent logs
    const logsRaw = localStorage.getItem("code-editor.agent-logs.v1");
    if (logsRaw) {
      const logs = JSON.parse(logsRaw) as Record<string, Array<{ id: string; timestamp: number; level: string; message: string }>>;
      let seq = 0;
      for (const [sid, entries] of Object.entries(logs)) {
        for (const e of entries) {
          dbInsertAgentLog({ id: e.id ?? "log-" + seq, sessionId: sid, level: e.level ?? "info", message: e.message ?? "", seq: seq++, timestamp: e.timestamp ?? Date.now() });
        }
      }
    }

    // Migrate conversations
    const convRaw = localStorage.getItem("code-editor.ai-conversations.v1");
    if (convRaw) {
      const convs = JSON.parse(convRaw) as Record<string, Array<{ role: string; content: string; timestamp?: number }>>;
      let seq = 0;
      for (const [key, msgs] of Object.entries(convs)) {
        const sid = key.split("::")[1] ?? key;
        for (const m of msgs) {
          dbInsertAgentMessage({ id: "msg-" + sid + "-" + seq, sessionId: sid, role: m.role ?? "user", content: m.content ?? "", seq: seq++, timestamp: m.timestamp ?? Date.now() });
        }
      }
    }

    // Migrate proposals (drafts)
    const draftsRaw = localStorage.getItem("code-editor.ai-drafts.v1");
    if (draftsRaw) {
      const drafts = JSON.parse(draftsRaw) as Record<string, { proposals: Array<{ path: string; original: string; modified: string; language: string; previousPath?: string }> }>;
      let seq = 0;
      for (const [key, draft] of Object.entries(drafts)) {
        const sid = key.split("::")[1] ?? key;
        for (const p of (draft.proposals ?? [])) {
          dbInsertAgentProposal({ id: "prop-" + sid + "-" + seq, sessionId: sid, path: p.path ?? "", original: p.original ?? "", modified: p.modified ?? "", language: p.language ?? "", previousPath: p.previousPath ?? null, accepted: null, acceptedAt: null, seq: seq++, createdAt: Date.now() });
        }
      }
    }

    // Record version and flush
    dbSetSchemaVersion(MIGRATION_VERSION, "Initial migration from localStorage");
    flushDbToDisk();
    return { success: true, migrated };
  } catch (error) {
    return { success: false, migrated, error: error instanceof Error ? error.message : String(error) };
  }
}

// ═══════════════════════════════════════════
// Skills CRUD
// ═══════════════════════════════════════════

interface SkillRow {
  id: string; name: string; description: string;
  body: string; source: string; enabled: number;
  createdAt: number; updatedAt: number;
}

interface SkillFileRow {
  id: string; skillId: string; path: string; content: string;
}

function skillToRow(s: Skill): SkillRow {
  return {
    id: s.id, name: s.name, description: s.description,
    body: s.body, source: s.source,
    enabled: s.enabled ? 1 : 0,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

function rowToSkill(row: SkillRow, files: SkillFile[]): Skill {
  return {
    id: row.id, name: row.name, description: row.description,
    body: row.body, source: row.source,
    enabled: row.enabled === 1,
    files,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function dbLoadSkills(): Skill[] {
  try {
    const rows = getDb().select().from(schema.skills).all() as unknown as SkillRow[];
    return rows.map((row) => {
      const fileRows = getDb().select().from(schema.skillFiles)
        .where(eq(schema.skillFiles.skillId, row.id)).all() as unknown as SkillFileRow[];
      const files: SkillFile[] = fileRows.map((f) => ({ path: f.path, content: f.content }));
      return rowToSkill(row, files);
    });
  } catch { return []; }
}

export function dbInsertSkill(s: Skill): void {
  const db = getDb();
  db.insert(schema.skills).values(skillToRow(s) as never).run();
  for (const f of s.files) {
    db.insert(schema.skillFiles).values({
      id: f.path ? `sf-${s.id}-${f.path.replace(/[^a-zA-Z0-9]/g, '-')}` : `sf-${s.id}-${Math.random().toString(36).slice(2, 8)}`,
      skillId: s.id,
      path: f.path,
      content: f.content,
    } as never).run();
  }
}

export function dbUpdateSkill(id: string, patch: Partial<Skill>): void {
  const db = getDb();
  const setObj: Record<string, unknown> = {};
  if (patch.name !== undefined) setObj.name = patch.name;
  if (patch.description !== undefined) setObj.description = patch.description;
  if (patch.body !== undefined) setObj.body = patch.body;
  if (patch.source !== undefined) setObj.source = patch.source;
  if (patch.enabled !== undefined) setObj.enabled = patch.enabled ? 1 : 0;
  if (patch.updatedAt !== undefined) setObj.updatedAt = patch.updatedAt;
  if (Object.keys(setObj).length > 0) {
    db.update(schema.skills).set(setObj as never).where(eq(schema.skills.id, id)).run();
  }
  if (patch.files) {
    db.delete(schema.skillFiles).where(eq(schema.skillFiles.skillId, id)).run();
    for (const f of patch.files) {
      db.insert(schema.skillFiles).values({
        id: `sf-${id}-${f.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        skillId: id, path: f.path, content: f.content,
      } as never).run();
    }
  }
}

export function dbDeleteSkill(id: string): void {
  const db = getDb();
  db.delete(schema.skillFiles).where(eq(schema.skillFiles.skillId, id)).run();
  db.delete(schema.skills).where(eq(schema.skills.id, id)).run();
}
