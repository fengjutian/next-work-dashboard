/**
 * Public-facing types for the Network Observatory IPC surface.
 *
 * These mirror the drizzle row types but are intentionally narrower (boolean
 * for `enabled`, plain objects for options) so the renderer doesn't have to
 * care about sql.js integer / text quirks.
 */

export type NetProbeKind = 'icmp' | 'tcp' | 'dns' | 'http' | 'traceroute';

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
export type AlertNotify = 'desktop' | 'webhook' | 'dingtalk' | 'slack' | 'telegram' | 'silent';

/** Configuration for a notification channel. See net-probe-notify.ts for the per-channel shape. */
export interface NotifyChannelConfig {
  // Generic webhook
  url?: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: 'json' | 'text' | 'none';
  // DingTalk-specific
  secret?: string;
  atMobiles?: string[];
  atAll?: boolean;
  // Slack-specific
  channel?: string;
  iconEmoji?: string;
  username?: string;
  // Telegram-specific
  botToken?: string;
  chatId?: string;
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';
  // Free-form extras (forward-compat)
  [k: string]: unknown;
}

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
  /** JSON string of NotifyChannelConfig. Empty {} for 'desktop' / 'silent'. */
  notifyConfig: string;
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

export type LanHostSource = 'tcp' | 'arp' | 'mdns';

export interface NetProbeLanHost {
  id: string;
  ip: string;
  mac: string | null;
  hostname: string | null;
  vendor: string | null;
  /** JSON-encoded array of port numbers. Parse on the renderer side. */
  openPorts: string;
  firstSeen: number;
  lastSeen: number;
  source: LanHostSource;
  scanId: string | null;
}
