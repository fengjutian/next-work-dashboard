import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as DatabaseNS from 'better-sqlite3';
import { createConnection, type Connection } from 'mysql2/promise';
import type { ExplainReport, LiveDatabaseConnection, LiveMySqlConfig } from '../../core/code-visualizer';
import { parseExplain } from '../../core/code-visualizer';

type DatabaseCtor = new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));
const connections = new Map<string, { db: DatabaseNS.Database; path: string }>();
const mysqlConnections = new Map<string, { connection: Connection; timer: ReturnType<typeof setTimeout> }>();

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

export async function openReadonlyMySql(input: LiveMySqlConfig): Promise<LiveDatabaseConnection> {
  const host = input.host.trim(); const user = input.user.trim(); const database = input.database.trim();
  if (!host || !user || !database) throw new Error('MySQL host、user、database 必填');
  if (!/^[\w.-]+$/.test(host) && host !== 'localhost') throw new Error('MySQL host 格式无效');
  if (!/^[\w$-]+$/.test(database)) throw new Error('MySQL database 格式无效');
  if (isPublicHost(host) && !input.ssl) throw new Error('公网 MySQL 连接必须启用 TLS');
  const connection = await createConnection({ host, port: Math.min(65535, Math.max(1, input.port ?? 3306)), user, password: input.password, database, ssl: input.ssl ? { rejectUnauthorized: input.rejectUnauthorized ?? true } : undefined, connectTimeout: 5_000, enableKeepAlive: false, multipleStatements: false, namedPlaceholders: false });
  try {
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query('SET SESSION max_execution_time = 5000');
    const [[accountRow], [sslRows], [grantRows], [columnRows], [indexRows]] = await Promise.all([
      connection.query('SELECT CURRENT_USER() AS account'), connection.query("SHOW STATUS LIKE 'Ssl_cipher'"), connection.query('SHOW GRANTS FOR CURRENT_USER()'),
      connection.execute('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [database]),
      connection.execute('SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', [database]),
    ]);
    const grants = (grantRows as Array<Record<string, unknown>>).flatMap((row) => Object.values(row).map(String)); const writeGrant = grants.some((grant) => /\b(?:ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT OPTION|SUPER)\b/i.test(grant));
    if (writeGrant) throw new Error('MySQL 账号包含写入或管理权限，请使用仅授予 SELECT 的专用账号');
    const tableMap = new Map<string, Array<{ name: string; type: string; nullable: boolean; defaultValue?: unknown }>>();
    for (const row of columnRows as Array<{ tableName: string; columnName: string; columnType: string; isNullable: string; defaultValue?: unknown }>) tableMap.set(row.tableName, [...(tableMap.get(row.tableName) ?? []), { name: row.columnName, type: row.columnType, nullable: row.isNullable === 'YES', defaultValue: row.defaultValue }]);
    const indexMap = new Map<string, Map<string, { name: string; unique: boolean; columns: string[] }>>();
    for (const row of indexRows as Array<{ tableName: string; indexName: string; nonUnique: number; columnName: string }>) { const byName = indexMap.get(row.tableName) ?? new Map(); const index = byName.get(row.indexName) ?? { name: row.indexName, unique: row.nonUnique === 0, columns: [] }; index.columns.push(row.columnName); byName.set(row.indexName, index); indexMap.set(row.tableName, byName); }
    const sslCipher = String((sslRows as Array<{ Value?: string }>)[0]?.Value ?? ''); const account = String((accountRow as Array<{ account?: string }>)[0]?.account ?? user);
    const warnings = [...(!sslCipher ? ['连接未使用 TLS/SSL'] : []), ...(isPublicHost(host) ? ['数据库主机看起来是公网地址'] : [])];
    const id = randomUUID(); mysqlConnections.set(id, { connection, timer: idleTimer(id) });
    return { id, engine: 'mysql', name: `${account}@${host}:${input.port ?? 3306}/${database}`, tables: [...tableMap].map(([name, columns]) => ({ name, columns, indexes: [...(indexMap.get(name)?.values() ?? [])] })), security: { ssl: Boolean(sslCipher), readOnlyGrants: true, account, warnings } };
  } catch (error) { await connection.end(); throw error; }
}

export async function explainReadonlyMySql(id: string, sql: string): Promise<ExplainReport> {
  const active = mysqlConnections.get(id); if (!active) throw new Error('MySQL 连接不存在或已关闭'); touch(id, active); const { connection } = active;
  validateReadonlySelect(sql);
  const [rows] = await connection.query(`EXPLAIN FORMAT=JSON ${sql.replace(/;+\s*$/, '')}`);
  const first = (rows as Array<Record<string, unknown>>)[0]; const raw = typeof first?.EXPLAIN === 'string' ? first.EXPLAIN : JSON.stringify(rows, null, 2);
  return parseExplain(raw);
}

export async function closeLiveDatabase(id: string): Promise<void> { const connection = connections.get(id); if (connection) { connection.db.close(); connections.delete(id); } const mysql = mysqlConnections.get(id); if (mysql) { mysqlConnections.delete(id); clearTimeout(mysql.timer); await mysql.connection.end(); } }

export function validateReadonlySelect(sql: string): void {
  const cleaned = sql.replace(/--[^\n\r]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:''|[^'])*'/g, "''").replace(/;+\s*$/, '').trim();
  if (!/^(?:SELECT|WITH)\b/i.test(cleaned)) throw new Error('实时数据库仅允许 SELECT 或 WITH 查询');
  if (cleaned.includes(';')) throw new Error('实时数据库只允许一条语句');
  if (/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(cleaned)) throw new Error('只读连接拒绝写入或结构修改语句');
}

function quoteIdentifier(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
function idleTimer(id: string): ReturnType<typeof setTimeout> { return setTimeout(() => { void closeLiveDatabase(id); }, 10 * 60_000); }
function touch(id: string, active: { connection: Connection; timer: ReturnType<typeof setTimeout> }): void { clearTimeout(active.timer); active.timer = idleTimer(id); }
function isPublicHost(host: string): boolean { return host !== 'localhost' && host !== '127.0.0.1' && !/^10\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host); }
