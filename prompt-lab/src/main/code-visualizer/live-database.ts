import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as DatabaseNS from 'better-sqlite3';
import type { ExplainReport, LiveDatabaseConnection } from '../../core/code-visualizer';
import { parseExplain } from '../../core/code-visualizer';

type DatabaseCtor = new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));
const connections = new Map<string, { db: DatabaseNS.Database; path: string }>();

export function openReadonlySqlite(filePath: string): LiveDatabaseConnection {
  const db = new Database(filePath, { readonly: true, fileMustExist: true, timeout: 3_000 });
  db.pragma('query_only = ON'); db.pragma('busy_timeout = 3000');
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  const tables = tableNames.map(({ name }) => ({ name, columns: (db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string; type: string }>).map((column) => ({ name: column.name, type: column.type })) }));
  const id = randomUUID(); connections.set(id, { db, path: filePath });
  return { id, engine: 'sqlite', name: path.basename(filePath), tables };
}

export function explainReadonlySqlite(id: string, sql: string): ExplainReport {
  const connection = connections.get(id); if (!connection) throw new Error('数据库连接不存在或已关闭');
  validateReadonlySelect(sql);
  const started = Date.now(); const rows = connection.db.prepare(`EXPLAIN QUERY PLAN ${sql.replace(/;+\s*$/, '')}`).all() as Array<Record<string, unknown>>;
  const text = [`QUERY PLAN (${Date.now() - started} ms)`, ...rows.map((row) => Object.values(row).join(' | '))].join('\n');
  return parseExplain(text);
}

export function closeLiveDatabase(id: string): void { const connection = connections.get(id); if (connection) { connection.db.close(); connections.delete(id); } }

export function validateReadonlySelect(sql: string): void {
  const cleaned = sql.replace(/--[^\n\r]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:''|[^'])*'/g, "''").replace(/;+\s*$/, '').trim();
  if (!/^(?:SELECT|WITH)\b/i.test(cleaned)) throw new Error('实时数据库仅允许 SELECT 或 WITH 查询');
  if (cleaned.includes(';')) throw new Error('实时数据库只允许一条语句');
  if (/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(cleaned)) throw new Error('只读连接拒绝写入或结构修改语句');
}

function quoteIdentifier(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
