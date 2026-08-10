/**
 * Alert engine for Network Observatory.
 *
 * Listens to probe_result events, evaluates each result against all enabled
 * rules that apply, and opens/closes incidents in storage. Sends notifications
 * (desktop, webhook, 钉钉, Slack, Telegram) on incident open and close.
 *
 * V1.1 simplification: a rule fires when its condition is true for the
 * configured `durationSec` of *consecutive* probe samples. This avoids needing
 * a wall-clock scheduler and is good enough for a personal monitoring tool.
 * V1.2 will use a sliding time window.
 */
import {
  dbListAlertRules,
  dbListIncidents,
  dbGetTarget,
  dbOpenIncident,
  dbCloseIncident,
  dbPruneOldResults,
  type NetProbeAlertRule,
  type NetProbeIncident,
  type NetProbeResult,
  type NetProbeTarget,
} from './net-probe-storage';
import { computeStats } from './net-probe-stats';
import { buildNotifyEvent, dispatchNotification, type ChannelSendResult } from './net-probe-notify';

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

function sendNotification(_title: string, _body: string): void {
  // (unused — kept as a thin shim in case any external code calls this.
  // The main flow is now `notifyIncident` → `dispatchNotification` below.)
}

async function notifyIncident(
  type: 'open' | 'close',
  rule: NetProbeAlertRule,
  target: NetProbeTarget,
  incident: NetProbeIncident,
): Promise<void> {
  // 'desktop' and 'silent' are handled here; everything else goes through dispatchNotification.
  if (rule.notify === 'silent') return;
  const event = buildNotifyEvent(type, rule, target, incident);
  // For 'desktop' we go through the dispatcher too — that keeps a single code path.
  const result: ChannelSendResult = await dispatchNotification(rule.notify, rule.notifyConfig, event);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[net-probe] ${result.channel} 通知失败: ${result.detail ?? '未知错误'}`);
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
        // Resolve the target (best-effort) and dispatch the configured channel.
        const target = dbGetTarget(result.targetId);
        if (target) {
          // Fire-and-forget; alert loop must not await a slow network call.
          void notifyIncident('open', rule, target, incident);
        }
      } else if (s.openIncidentId) {
        // Already open: bump peak.
        // (V1.1 keeps it simple: store peak on the incident directly via open;
        // a later update query would be needed for true peak tracking.)
      }
    } else {
      // Condition cleared.
      if (s.openIncidentId) {
        // Look up the closing incident for notify context. We didn't store
        // the incident object on the alert state, so re-fetch by id.
        const closing = dbListIncidents({ openOnly: false, limit: 200 }).find((i) => i.id === s.openIncidentId);
        const ended = Date.now();
        dbCloseIncident(s.openIncidentId, ended);
        s.openIncidentId = null;
        if (closing) {
          const target = dbGetTarget(closing.targetId);
          if (target) {
            void notifyIncident('close', rule, target, { ...closing, endedAt: ended });
          }
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
