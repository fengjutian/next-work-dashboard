/**
 * SQLite persistence for Network Observatory.
 *
 * Owns 4 tables: net_probe_targets / net_probe_results / net_probe_alert_rules
 * / net_probe_incidents. Provides CRUD + history queries with 7-day retention.
 *
 * V1.1: no in-memory cache. UI subscribes to NetProbeService events and asks
 * storage for historical data on demand.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, isDbReady } from '@/db';
import {
  netProbeTargets,
  netProbeResults,
  netProbeAlertRules,
  netProbeIncidents,
  type NetProbeTargetRow,
  type NetProbeResultRow,
  type NetProbeAlertRuleRow,
  type NetProbeIncidentRow,
} from '@/db/schema';

export type NetProbeTarget = Omit<NetProbeTargetRow, 'enabled'> & { enabled: boolean };
export type NetProbeResult = Omit<NetProbeResultRow, 'success'> & { success: boolean };
export type NetProbeAlertRule = Omit<NetProbeAlertRuleRow, 'enabled'> & { enabled: boolean };
export type NetProbeIncident = Omit<NetProbeIncidentRow, 'acknowledged'> & { acknowledged: boolean };

function toTarget(row: NetProbeTargetRow): NetProbeTarget {
  return { ...row, enabled: row.enabled === 1 };
}
function toResult(row: NetProbeResultRow): NetProbeResult {
  return { ...row, success: row.success === 1 };
}
function toAlertRule(row: NetProbeAlertRuleRow): NetProbeAlertRule {
  return { ...row, enabled: row.enabled === 1 };
}
function toIncident(row: NetProbeIncidentRow): NetProbeIncident {
  return { ...row, acknowledged: row.acknowledged === 1 };
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Targets ──

export function dbListTargets(): NetProbeTarget[] {
  if (!isDbReady()) return [];
  return getDb().select().from(netProbeTargets).orderBy(desc(netProbeTargets.createdAt)).all().map(toTarget);
}

export function dbGetTarget(id: string): NetProbeTarget | null {
  if (!isDbReady()) return null;
  const row = getDb().select().from(netProbeTargets).where(eq(netProbeTargets.id, id)).get();
  return row ? toTarget(row) : null;
}

export function dbUpsertTarget(input: {
  id?: string;
  target: string;
  probe?: string;
  intervalMs?: number;
  timeoutMs?: number;
  optionsJson?: string;
  enabled?: boolean;
}): NetProbeTarget {
  const now = Date.now();
  const id = input.id ?? uid('tgt');
  const existing = dbGetTarget(id);
  const enabledInt: number = input.enabled != null
    ? (input.enabled ? 1 : 0)
    : (existing?.enabled ?? 1);
  const row: NetProbeTarget = {
    id,
    target: input.target,
    probe: input.probe ?? existing?.probe ?? 'icmp',
    intervalMs: input.intervalMs ?? existing?.intervalMs ?? 5000,
    timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? 3000,
    optionsJson: input.optionsJson ?? existing?.optionsJson ?? '{}',
    enabled: enabledInt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (!isDbReady()) return row;
  getDb()
    .insert(netProbeTargets)
    .values(row)
    .onConflictDoUpdate({
      target: netProbeTargets.id,
      set: {
        target: row.target,
        probe: row.probe,
        intervalMs: row.intervalMs,
        timeoutMs: row.timeoutMs,
        optionsJson: row.optionsJson,
        enabled: row.enabled,
        updatedAt: row.updatedAt,
      },
    })
    .run();
  return row;
}

export function dbDeleteTarget(id: string): boolean {
  if (!isDbReady()) return false;
  getDb().delete(netProbeResults).where(eq(netProbeResults.targetId, id)).run();
  getDb().delete(netProbeTargets).where(eq(netProbeTargets.id, id)).run();
  return true;
}

// ── Results (history) ──

export function dbInsertResult(input: {
  targetId: string;
  probe: string;
  timestampMs: number;
  success: boolean;
  latencyMs: number | null;
  error: string | null;
  payloadJson?: string;
}): NetProbeResult {
  const row: NetProbeResult = {
    id: uid('res'),
    targetId: input.targetId,
    probe: input.probe,
    timestampMs: input.timestampMs,
    success: input.success ? 1 : 0,
    latencyMs: input.latencyMs == null ? null : Math.max(0, Math.round(input.latencyMs * 10) / 10),
    error: input.error,
    payloadJson: input.payloadJson ?? '{}',
  };
  if (isDbReady()) {
    getDb().insert(netProbeResults).values(row).run();
  }
  return toResult(row);
}

export function dbListResults(opts: {
  targetId?: string;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
}): NetProbeResult[] {
  if (!isDbReady()) return [];
  const conds = [];
  if (opts.targetId) conds.push(eq(netProbeResults.targetId, opts.targetId));
  if (opts.sinceMs != null) conds.push(gte(netProbeResults.timestampMs, opts.sinceMs));
  if (opts.untilMs != null) conds.push(sql`${netProbeResults.timestampMs} <= ${opts.untilMs}`);
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const query = getDb()
    .select()
    .from(netProbeResults)
    .where(where)
    .orderBy(desc(netProbeResults.timestampMs))
    .limit(opts.limit ?? 1000);
  return query.all().map(toResult);
}

/** Delete results older than the retention window. */
export function dbPruneOldResults(): number {
  if (!isDbReady()) return 0;
  const cutoff = Date.now() - RETENTION_MS;
  // sql.js doesn't surface `changes` from the drizzle run() result, so we
  // delete via a count-then-delete approach for accurate reporting.
  const countRow = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(netProbeResults)
    .where(sql`${netProbeResults.timestampMs} < ${cutoff}`)
    .get();
  const n = Number(countRow?.n ?? 0);
  if (n > 0) {
    getDb()
      .delete(netProbeResults)
      .where(sql`${netProbeResults.timestampMs} < ${cutoff}`)
      .run();
  }
  return n;
}

// ── Alert rules ──

export function dbListAlertRules(): NetProbeAlertRule[] {
  if (!isDbReady()) return [];
  return getDb().select().from(netProbeAlertRules).orderBy(desc(netProbeAlertRules.createdAt)).all().map(toAlertRule);
}

export function dbGetAlertRule(id: string): NetProbeAlertRule | null {
  if (!isDbReady()) return null;
  const row = getDb().select().from(netProbeAlertRules).where(eq(netProbeAlertRules.id, id)).get();
  return row ? toAlertRule(row) : null;
}

export function dbUpsertAlertRule(input: Omit<NetProbeAlertRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): NetProbeAlertRule {
  const now = Date.now();
  const existing = input.id ? dbGetAlertRule(input.id) : null;
  const id = input.id ?? uid('rule');
  const row: NetProbeAlertRule = {
    id,
    name: input.name,
    targetId: input.targetId ?? null,
    probe: input.probe ?? null,
    metric: input.metric,
    op: input.op,
    threshold: input.threshold,
    durationSec: input.durationSec,
    enabled: input.enabled,
    notify: input.notify,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (isDbReady()) {
    getDb()
      .insert(netProbeAlertRules)
      .values(row)
      .onConflictDoUpdate({
        target: netProbeAlertRules.id,
        set: {
          name: row.name,
          targetId: row.targetId,
          probe: row.probe,
          metric: row.metric,
          op: row.op,
          threshold: row.threshold,
          durationSec: row.durationSec,
          enabled: row.enabled,
          notify: row.notify,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }
  return toAlertRule(row);
}

export function dbDeleteAlertRule(id: string): boolean {
  if (!isDbReady()) return false;
  getDb().delete(netProbeAlertRules).where(eq(netProbeAlertRules.id, id)).run();
  return true;
}

// ── Incidents ──

export function dbListIncidents(opts: { openOnly?: boolean; limit?: number } = {}): NetProbeIncident[] {
  if (!isDbReady()) return [];
  const where = opts.openOnly
    ? sql`${netProbeIncidents.endedAt} IS NULL`
    : undefined;
  return getDb()
    .select()
    .from(netProbeIncidents)
    .where(where)
    .orderBy(desc(netProbeIncidents.startedAt))
    .limit(opts.limit ?? 200)
    .all()
    .map(toIncident);
}

export function dbOpenIncident(input: {
  ruleId: string;
  targetId: string;
  startedAt: number;
  peakMetric: number;
  triggerMessage: string;
}): NetProbeIncident {
  const row: NetProbeIncident = {
    id: uid('inc'),
    ruleId: input.ruleId,
    targetId: input.targetId,
    startedAt: input.startedAt,
    endedAt: null,
    peakMetric: input.peakMetric,
    triggerMessage: input.triggerMessage,
    acknowledged: 0,
  };
  if (isDbReady()) {
    getDb().insert(netProbeIncidents).values(row).run();
  }
  return toIncident(row);
}

export function dbCloseIncident(id: string, endedAt: number): boolean {
  if (!isDbReady()) return false;
  getDb()
    .update(netProbeIncidents)
    .set({ endedAt })
    .where(eq(netProbeIncidents.id, id))
    .run();
  return true;
}
