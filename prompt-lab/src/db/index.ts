import initSqlJs, { type Database as SqlJsDatabase, type QueryExecResult } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { eq, inArray } from 'drizzle-orm';
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
  is_favorite: number; is_pinned: number; usage_count: number;
  created_at: number; updated_at: number;
}

interface SiteRow {
  id: string; name: string; url: string;
  input_selector: string; submit_selector: string;
  enabled: number; use_proxy: number; sort_order: number;
}

import type { Prompt, SiteConfig } from '@/store/types';

function promptToRow(p: Prompt): PromptRow {
  return {
    id: p.id, title: p.title, content: p.content, category: p.category,
    tags: JSON.stringify(p.tags), variables: JSON.stringify(p.variables),
    is_favorite: p.isFavorite ? 1 : 0, is_pinned: p.isPinned ? 1 : 0,
    usage_count: p.usageCount, created_at: p.createdAt, updated_at: p.updatedAt,
  };
}

function rowToPrompt(row: PromptRow): Prompt {
  return {
    id: row.id, title: row.title, content: row.content, category: row.category,
    tags: safeJsonParse(row.tags, []),
    variables: safeJsonParse(row.variables, []),
    isFavorite: row.is_favorite === 1, isPinned: row.is_pinned === 1,
    usageCount: row.usage_count, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function siteToRow(s: SiteConfig): SiteRow {
  return {
    id: s.id, name: s.name, url: s.url,
    input_selector: s.inputSelector, submit_selector: s.submitSelector,
    enabled: s.enabled ? 1 : 0, use_proxy: 0, sort_order: s.sortOrder,
  };
}

function rowToSite(row: SiteRow): SiteConfig {
  return {
    id: row.id, name: row.name, url: row.url,
    inputSelector: row.input_selector, submitSelector: row.submit_selector,
    enabled: row.enabled === 1, sortOrder: row.sort_order,
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
  if (patch.isFavorite !== undefined) setObj.is_favorite = patch.isFavorite ? 1 : 0;
  if (patch.isPinned !== undefined) setObj.is_pinned = patch.isPinned ? 1 : 0;
  if (patch.usageCount !== undefined) setObj.usage_count = patch.usageCount;
  if (patch.updatedAt !== undefined) setObj.updated_at = patch.updatedAt;
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
  if (patch.inputSelector !== undefined) setObj.input_selector = patch.inputSelector;
  if (patch.submitSelector !== undefined) setObj.submit_selector = patch.submitSelector;
  if (patch.enabled !== undefined) setObj.enabled = patch.enabled ? 1 : 0;
  if (patch.sortOrder !== undefined) setObj.sort_order = patch.sortOrder;
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
    prompt_id: entry.promptId,
    site_id: entry.siteId,
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
