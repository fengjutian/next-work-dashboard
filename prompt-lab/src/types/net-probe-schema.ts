/**
 * Public-facing types for the Network Observatory IPC surface.
 *
 * These mirror the drizzle row types but are intentionally narrower (boolean
 * for `enabled`, plain objects for options) so the renderer doesn't have to
 * care about sql.js integer / text quirks.
 */

export type NetProbeKind = 'icmp' | 'tcp' | 'dns' | 'http';

export interface NetProbeTarget {
  id: string;
  target: string;
  probe: NetProbeKind;
  intervalMs: number;
  timeoutMs: number;
  optionsJson: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NetProbeTargetInput {
  id?: string;
  target: string;
  probe?: NetProbeKind;
  intervalMs?: number;
  timeoutMs?: number;
  options?: Record<string, unknown>;
  enabled?: boolean;
}

export interface NetProbeResult {
  id: string;
  targetId: string;
  probe: NetProbeKind;
  timestampMs: number;
  success: boolean;
  latencyMs: number | null;
  error: string | null;
  payloadJson: string;
}

export type AlertMetric = 'latency_p95' | 'latency_avg' | 'loss_pct' | 'jitter' | 'status';
export type AlertOp = '>' | '<' | '==' | '!=';
export type AlertNotify = 'desktop' | 'silent';

export interface NetProbeAlertRule {
  id: string;
  name: string;
  targetId: string | null;
  probe: NetProbeKind | null;
  metric: AlertMetric;
  op: AlertOp;
  threshold: number;
  durationSec: number;
  enabled: boolean;
  notify: AlertNotify;
  createdAt: number;
  updatedAt: number;
}

export interface NetProbeIncident {
  id: string;
  ruleId: string;
  targetId: string;
  startedAt: number;
  endedAt: number | null;
  peakMetric: number;
  triggerMessage: string;
  acknowledged: boolean;
}
