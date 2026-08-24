import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as DatabaseNS from 'better-sqlite3';
import type { ScanRecord, SecurityBaseline } from '../../core/security-audit';

type DatabaseCtor = new (filename: string) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));
export interface StoredSecurityAuditData { version: 1; settings: Record<string, string>; scans: ScanRecord[] }
let database: DatabaseNS.Database | null = null;

function legacyFile(): string { return path.join(app.getPath('userData'), 'security-audit', 'data.json'); }
export function getSecurityAuditDatabase(): DatabaseNS.Database {
  if (database) return database;
  const directory = path.join(app.getPath('userData'), 'security-audit'); fs.mkdirSync(directory, { recursive: true });
  database = new Database(path.join(directory, 'security-audit.db')); database.pragma('journal_mode = WAL'); database.pragma('foreign_keys = ON'); database.pragma('busy_timeout = 3000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY, project_dir TEXT NOT NULL, started_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_security_scans_project ON scans(project_dir, started_at DESC);
    CREATE TABLE IF NOT EXISTS finding_events(id INTEGER PRIMARY KEY AUTOINCREMENT, finding_id TEXT NOT NULL, project_dir TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_finding_events_finding ON finding_events(finding_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS baselines(id TEXT PRIMARY KEY, project_dir TEXT NOT NULL, name TEXT NOT NULL, git_ref TEXT NOT NULL, scan_id TEXT, created_at INTEGER NOT NULL, UNIQUE(project_dir, name));
  `);
  if ((database.prepare('SELECT COUNT(*) AS count FROM scans').get() as { count: number }).count === 0 && fs.existsSync(legacyFile())) {
    try { writeSecurityAuditData(JSON.parse(fs.readFileSync(legacyFile(), 'utf8')) as StoredSecurityAuditData); fs.renameSync(legacyFile(), `${legacyFile()}.migrated`); } catch { /* malformed legacy data remains available for manual recovery */ }
  }
  return database;
}

export function readSecurityAuditData(): StoredSecurityAuditData {
  const db = getSecurityAuditDatabase(); const settings = Object.fromEntries((db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
  const scans = (db.prepare('SELECT payload FROM scans ORDER BY started_at DESC LIMIT 100').all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as ScanRecord);
  return { version: 1, settings, scans };
}
export function writeSecurityAuditData(data: StoredSecurityAuditData): void {
  const db = getSecurityAuditDatabase(); const write = db.transaction(() => {
    const setting = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'); for (const [key, value] of Object.entries(data.settings)) setting.run(key, value);
    const scan = db.prepare('INSERT INTO scans(id, project_dir, started_at, status, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload'); for (const item of data.scans.slice(0, 100)) scan.run(item.id, item.projectDir, item.startedAt, item.status, JSON.stringify(item));
  }); write();
}
export function recordFindingEvent(projectDir: string, findingId: string, status: string, reason?: string): void { getSecurityAuditDatabase().prepare('INSERT INTO finding_events(finding_id, project_dir, status, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(findingId, projectDir, status, reason ?? null, Date.now()); }
export function listBaselines(projectDir: string): SecurityBaseline[] { return getSecurityAuditDatabase().prepare('SELECT id, project_dir AS projectDir, name, git_ref AS gitRef, scan_id AS scanId, created_at AS createdAt FROM baselines WHERE project_dir = ? ORDER BY created_at DESC').all(projectDir) as SecurityBaseline[]; }
export function createBaseline(projectDir: string, name: string, gitRef: string, scanId?: string): SecurityBaseline { const baseline = { id: `baseline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, projectDir, name: name.trim().slice(0, 100), gitRef: gitRef.trim().slice(0, 200), scanId, createdAt: Date.now() }; if (!baseline.name || !baseline.gitRef) throw new Error('INVALID_BASELINE'); getSecurityAuditDatabase().prepare('INSERT INTO baselines(id, project_dir, name, git_ref, scan_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(baseline.id, baseline.projectDir, baseline.name, baseline.gitRef, baseline.scanId ?? null, baseline.createdAt); return baseline; }
export function removeBaseline(projectDir: string, id: string): boolean { return getSecurityAuditDatabase().prepare('DELETE FROM baselines WHERE id = ? AND project_dir = ?').run(id, projectDir).changes > 0; }
