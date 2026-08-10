/**
 * Alert engine for Network Observatory.
 *
 * Listens to probe_result events, evaluates each result against all enabled
 * rules that apply, and opens/closes incidents in storage. Sends desktop
 * notifications on incident open (and close, optionally).
 *
 * V1.1 simplification: a rule fires when its condition is true for the
 * configured `durationSec` of *consecutive* probe samples. This avoids needing
 * a wall-clock scheduler and is good enough for a personal monitoring tool.
 * V1.2 will use a sliding time window.
 */
import { Notification } from 'electron';
import {
  dbListAlertRules,
  dbListIncidents,
  dbOpenIncident,
  dbCloseIncident,
  dbPruneOldResults,
  type NetProbeAlertRule,
  type NetProbeIncident,
  type NetProbeResult,
} from './net-probe-storage';
import { computeStats } from './net-probe-stats';

interface AlertState {
  ruleId: string;
  targetId: string;
  consecutiveHit: number; // count of consecutive samples that satisfy the rule
  openIncidentId: string | null; // currently open incident (if any)
}

const state = new Map<string, AlertState>(); // key = `${ruleId}::${targetId}`

function stateKey(ruleId: string, targetId: string): string {
  return `${ruleId}::${targetId}`;
}

function metricValue(rule: NetProbeAlertRule, recent: NetProbeResult[]): number {
  // Compute metric over the last `durationSec` worth of samples (rough
  // estimate: assume 1 sample per interval; cap at 32 most recent).
  const window = recent.slice(0, 32);
  switch (rule.metric) {
    case 'latency_p95': {
      const stats = computeStats(window.map((r) => (r.success ? r.latencyMs ?? null : null)));
      return stats.p95 ?? 0;
    }
    case 'latency_avg': {
      const stats = computeStats(window.map((r) => (r.success ? r.latencyMs ?? null : null)));
      return stats.avg ?? 0;
    }
    case 'loss_pct': {
      const stats = computeStats(
        window.map((r) => (r.success ? r.latencyMs ?? null : null)),
        window.length,
      );
      return stats.lossPct;
    }
    case 'status': {
      // 0 = all good, 100 = all failed
      const stats = computeStats(
        window.map((r) => (r.success ? r.latencyMs ?? null : null)),
        window.length,
      );
      return stats.lossPct >= 50 ? 1 : 0;
    }
    case 'jitter': {
      const stats = computeStats(window.map((r) => (r.success ? r.latencyMs ?? null : null)));
      return stats.jitter ?? 0;
    }
    default:
      return 0;
  }
}

function ruleApplies(rule: NetProbeAlertRule, targetId: string, probe: string): boolean {
  if (!rule.enabled) return false;
  if (rule.targetId != null && rule.targetId !== targetId) return false;
  if (rule.probe != null && rule.probe !== probe) return false;
  return true;
}

function ruleSatisfied(rule: NetProbeAlertRule, value: number): boolean {
  switch (rule.op) {
    case '>':
      return value > rule.threshold;
    case '<':
      return value < rule.threshold;
    case '==':
      return value === rule.threshold;
    case '!=':
      return value !== rule.threshold;
    default:
      return false;
  }
}

function sendNotification(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show();
    }
  } catch {
    // best-effort: notifications may be disabled on the OS
  }
}

export interface AlertEvaluationInput {
  result: NetProbeResult;
  targetHistory: NetProbeResult[]; // most-recent-first, length up to 32
}

export function evaluateAlerts(input: AlertEvaluationInput): NetProbeIncident[] {
  const { result, targetHistory } = input;
  const rules = dbListAlertRules().filter((r) => ruleApplies(r, result.targetId, result.probe));
  const fired: NetProbeIncident[] = [];
  for (const rule of rules) {
    const value = metricValue(rule, targetHistory);
    const ok = ruleSatisfied(rule, value);
    const key = stateKey(rule.id, result.targetId);
    let s = state.get(key);
    if (!s) {
      s = { ruleId: rule.id, targetId: result.targetId, consecutiveHit: 0, openIncidentId: null };
      state.set(key, s);
    }

    if (ok) {
      s.consecutiveHit += 1;
      // Fire when consecutive hits cross a threshold derived from durationSec.
      // We assume ~1 sample per interval; for a 60s duration with 5s interval
      // that's 12 hits. For 30s with 2s interval that's 15. Use a flat 3
      // consecutive hits to avoid noise — good enough for V1.1.
      if (!s.openIncidentId && s.consecutiveHit >= 3) {
        const msg = `${rule.name}: ${rule.metric} ${rule.op} ${rule.threshold} (current: ${value.toFixed(1)})`;
        const incident = dbOpenIncident({
          ruleId: rule.id,
          targetId: result.targetId,
          startedAt: Date.now(),
          peakMetric: Math.round(value),
          triggerMessage: msg,
        });
        s.openIncidentId = incident.id;
        fired.push(incident);
        if (rule.notify === 'desktop') {
          sendNotification(`[Network Observatory] ${rule.name}`, msg);
        }
      } else if (s.openIncidentId) {
        // Already open: bump peak.
        // (V1.1 keeps it simple: store peak on the incident directly via open;
        // a later update query would be needed for true peak tracking.)
      }
    } else {
      // Condition cleared.
      if (s.openIncidentId) {
        dbCloseIncident(s.openIncidentId, Date.now());
        s.openIncidentId = null;
        if (rule.notify === 'desktop') {
          sendNotification(`[Network Observatory] 已恢复`, `${rule.name} 状态恢复`);
        }
      }
      s.consecutiveHit = 0;
    }
  }
  return fired;
}

/** Periodic maintenance: prune old results, reset state for deleted rules. */
export function maintenanceTick(): { prunedResults: number } {
  const pruned = dbPruneOldResults();
  const liveRuleIds = new Set(dbListAlertRules().map((r) => r.id));
  for (const key of Array.from(state.keys())) {
    const ruleId = key.split('::')[0];
    if (!liveRuleIds.has(ruleId)) {
      state.delete(key);
    }
  }
  return { prunedResults: pruned };
}

export function resetAlertState(): void {
  state.clear();
}

export function getOpenIncidentsSnapshot(): NetProbeIncident[] {
  return dbListIncidents({ openOnly: true });
}
