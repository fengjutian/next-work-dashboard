import initSqlJs, { type Database as SqlJsDatabase, type QueryExecResult } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { eq, inArray, desc, and, sql } from 'drizzle-orm';
import * as schema from './schema';

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
  `);
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
  const tableNames = result[0].values.map((row: unknown[]) => String(row[0]));
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
// Chat Sessions — 作为 JSON 存在 settings 中
// ═══════════════════════════════════════════

const CHAT_SESSIONS_KEY = 'chat_sessions';

export function dbLoadChatSessions<T = unknown>(): T | null {
  const raw = dbGetSetting(CHAT_SESSIONS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}


// ═══════════════════════════════════════════
// Agent Sessions CRUD
// ═══════════════════════════════════════════

interface AgentSessionRow {
  id: string; title: string; status: string; instruction: string;
  worktreePath: string | null; worktreeBranch: string | null;
  worktreeHead: string | null; worktreeDirty: number;
  isPinned: number; parentSessionId: string | null;
  tokenBudget: number | null;
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
  getDb().insert(schema.agentSessions).values(row as never).run();
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
  getDb().insert(schema.agentMessages).values(row as never).run();
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
  getDb().insert(schema.agentLogs).values(row as never).run();
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
  getDb().insert(schema.agentProposals).values(row as never).run();
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

export function dbSaveChatSessions(sessions: unknown): void {
  dbSetSetting(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
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
