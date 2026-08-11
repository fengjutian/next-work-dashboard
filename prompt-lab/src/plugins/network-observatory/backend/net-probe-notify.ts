/**
 * Network Observatory — notification channels (V2.3).
 *
 * Each alert rule carries a `notify` channel kind and a JSON `notifyConfig`
 * with channel-specific fields (webhook URL, bot tokens, etc.). When an
 * incident opens or closes, `dispatchNotification` formats a payload for
 * the chosen channel and POSTs it.
 *
 * Channels:
 *  - desktop: Electron Notification (no config, default)
 *  - webhook: generic HTTP POST
 *  - dingtalk: 钉钉自定义机器人 (signed webhook if `secret` is set)
 *  - slack: Slack Incoming Webhook
 *  - telegram: Telegram Bot API
 *  - silent: no notification (rule just records in the incident log)
 *
 * Errors are best-effort: any single channel failure must not crash the
 * alert engine or affect other channels.
 */
import { createHmac } from 'node:crypto';
import os from 'node:os';
import type { Notification as ElectronNotification } from 'electron';

import type { NetProbeAlertRule, NetProbeIncident, NetProbeTarget } from './net-probe-storage';
import type { NotifyChannelConfig } from '@/types/net-probe-schema';

// Lazy-load electron at runtime so this module can also be imported in pure
// Node contexts (smoke tests, scripts that don't have the Electron binary).
let _Notification: typeof ElectronNotification | null = null;
function getNotification(): typeof ElectronNotification | null {
  if (_Notification) return _Notification;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (electron && typeof electron.Notification === 'function') {
      _Notification = electron.Notification as typeof ElectronNotification;
    }
  } catch {
    // electron module not available (e.g. in pure node tests)
  }
  return _Notification;
}

// ── Payload ──

export interface NotifyEvent {
  /** 'open' or 'close'. */
  type: 'open' | 'close';
  /** The rule that fired. */
  rule: {
    id: string;
    name: string;
    metric: string;
    op: string;
    threshold: number;
    durationSec: number;
  };
  /** The target that triggered the alert. */
  target: {
    id: string;
    target: string;
    probe: string;
    /** Parsed target options (port, url, etc.). */
    options: Record<string, unknown>;
  };
  /** The incident being opened/closed. */
  incident: {
    id: string;
    startedAt: number;
    endedAt: number | null;
    peakMetric: number;
    triggerMessage: string;
    /** Seconds the incident lasted, or null if still ongoing. */
    durationSec: number | null;
  };
  /** ISO-ish string of the current local time. */
  timestampMs: number;
  host: {
    hostname: string;
    platform: string;
  };
}

export function buildNotifyEvent(
  type: 'open' | 'close',
  rule: NetProbeAlertRule,
  target: NetProbeTarget,
  incident: NetProbeIncident,
): NotifyEvent {
  let options: Record<string, unknown> = {};
  try {
    if (target.optionsJson) {
      const parsed = JSON.parse(target.optionsJson);
      if (parsed && typeof parsed === 'object') options = parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  const durationSec = incident.endedAt != null ? Math.round((incident.endedAt - incident.startedAt) / 1000) : null;
  return {
    type,
    rule: {
      id: rule.id,
      name: rule.name,
      metric: rule.metric,
      op: rule.op,
      threshold: rule.threshold,
      durationSec: rule.durationSec,
    },
    target: {
      id: target.id,
      target: target.target,
      probe: target.probe,
      options,
    },
    incident: {
      id: incident.id,
      startedAt: incident.startedAt,
      endedAt: incident.endedAt,
      peakMetric: incident.peakMetric,
      triggerMessage: incident.triggerMessage,
      durationSec,
    },
    timestampMs: Date.now(),
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
    },
  };
}

// ── Pretty formatting helpers ──

const SEVERITY_TAG: Record<string, string> = {
  latency_p95: '⏱️ 延迟 p95',
  latency_avg: '⏱️ 平均延迟',
  loss_pct: '📉 丢包率',
  jitter: '〰️ 抖动',
  status: '🚨 可用性',
};

const PROBE_TAG: Record<string, string> = {
  icmp: 'ICMP',
  tcp: 'TCP',
  dns: 'DNS',
  http: 'HTTP',
  traceroute: 'Trace',
};

export function eventToText(ev: NotifyEvent): string {
  const ts = new Date(ev.timestampMs).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  const probeTag = PROBE_TAG[ev.target.probe] ?? ev.target.probe.toUpperCase();
  const sevTag = SEVERITY_TAG[ev.rule.metric] ?? ev.rule.metric;
  const head = ev.type === 'open' ? '🚨 告警触发' : '✅ 告警恢复';
  const dur = ev.incident.durationSec != null ? formatDuration(ev.incident.durationSec) : '仍在进行';
  return [
    `${head} · ${probeTag} · ${ev.target.target}`,
    `${sevTag} ${ev.rule.op} ${ev.rule.threshold} (当前 ${ev.incident.peakMetric})`,
    `规则: ${ev.rule.name}`,
    `触发: ${ev.incident.triggerMessage}`,
    `开始: ${new Date(ev.incident.startedAt).toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    `持续: ${dur}`,
    `事件 ID: ${ev.incident.id}`,
    `主机: ${ev.host.hostname} (${ev.host.platform})`,
    `时间: ${ts}`,
  ].join('\n');
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
  return `${(sec / 3600).toFixed(1)} 小时`;
}

// ── Channel implementations ──

export interface ChannelSendResult {
  ok: boolean;
  channel: string;
  detail?: string;
  durationMs: number;
}

interface ChannelSender {
  send(ev: NotifyEvent, cfg: NotifyChannelConfig): Promise<ChannelSendResult>;
}

class DesktopChannel implements ChannelSender {
  async send(ev: NotifyEvent): Promise<ChannelSendResult> {
    const t0 = Date.now();
    const Notification = getNotification();
    if (!Notification) {
      return { ok: false, channel: 'desktop', detail: 'electron Notification 不可用 (仅在 Electron 主进程中支持)', durationMs: 0 };
    }
    try {
      if (!Notification.isSupported()) {
        return { ok: false, channel: 'desktop', detail: 'Notification not supported on this OS', durationMs: 0 };
      }
      const head = ev.type === 'open' ? `🚨 ${ev.rule.name}` : `✅ 已恢复`;
      const body = `${PROBE_TAG[ev.target.probe] ?? ev.target.probe} ${ev.target.target}\n${ev.incident.triggerMessage}`;
      new Notification({ title: head, body, silent: false }).show();
      return { ok: true, channel: 'desktop', durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, channel: 'desktop', detail: String((e as Error).message ?? e), durationMs: Date.now() - t0 };
    }
  }
}

class WebhookChannel implements ChannelSender {
  async send(ev: NotifyEvent, cfg: NotifyChannelConfig): Promise<ChannelSendResult> {
    const t0 = Date.now();
    if (!cfg.url) {
      return { ok: false, channel: 'webhook', detail: 'url is required', durationMs: 0 };
    }
    const template = cfg.bodyTemplate ?? 'json';
    let body: string;
    if (template === 'json') {
      body = JSON.stringify(ev);
    } else if (template === 'text') {
      body = JSON.stringify({ text: eventToText(ev) });
    } else {
      body = ''; // 'none': send empty body
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `nwd-network-observatory/1.0 (${ev.host.hostname})`,
      ...(cfg.headers ?? {}),
    };
    try {
      const res = await fetch(cfg.url, {
        method: cfg.method ?? 'POST',
        headers,
        body: body || undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          channel: 'webhook',
          detail: `HTTP ${res.status} ${res.statusText}${text ? ` · ${text.slice(0, 200)}` : ''}`,
          durationMs: Date.now() - t0,
        };
      }
      return { ok: true, channel: 'webhook', detail: `HTTP ${res.status}`, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, channel: 'webhook', detail: String((e as Error).message ?? e), durationMs: Date.now() - t0 };
    }
  }
}

class DingTalkChannel implements ChannelSender {
  async send(ev: NotifyEvent, cfg: NotifyChannelConfig): Promise<ChannelSendResult> {
    const t0 = Date.now();
    if (!cfg.url) {
      return { ok: false, channel: 'dingtalk', detail: 'url is required (钉钉机器人 webhook URL)', durationMs: 0 };
    }
    let url = cfg.url;
    // Signed webhook: append ?timestamp=...&sign=...
    if (cfg.secret) {
      const timestamp = Date.now();
      const stringToSign = `${timestamp}\n${cfg.secret}`;
      const sign = createHmac('sha256', cfg.secret).update(stringToSign).digest('base64');
      url = `${cfg.url}${cfg.url.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
    }
    const at: { atMobiles: string[]; atUserIds: string[]; isAtAll: boolean } = {
      atMobiles: cfg.atMobiles ?? [],
      atUserIds: [],
      isAtAll: Boolean(cfg.atAll),
    };
    const body = {
      msgtype: 'markdown',
      markdown: {
        title: ev.type === 'open' ? `🚨 ${ev.rule.name}` : `✅ ${ev.rule.name} 已恢复`,
        text: [
          `# ${ev.type === 'open' ? '🚨 告警触发' : '✅ 告警恢复'}`,
          ``,
          `**${PROBE_TAG[ev.target.probe] ?? ev.target.probe}** \`${ev.target.target}\``,
          ``,
          `> ${ev.incident.triggerMessage}`,
          ``,
          `- 规则: **${ev.rule.name}**`,
          `- 阈值: \`${ev.rule.metric} ${ev.rule.op} ${ev.rule.threshold}\``,
          `- 当前: \`${ev.incident.peakMetric}\``,
          `- 持续: \`${ev.incident.durationSec != null ? formatDuration(ev.incident.durationSec) : '仍在进行'}\``,
          `- 主机: \`${ev.host.hostname}\``,
          `- 事件 ID: \`${ev.incident.id}\``,
        ].join('\n'),
      },
      at,
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, channel: 'dingtalk', detail: `HTTP ${res.status} ${text.slice(0, 200)}`, durationMs: Date.now() - t0 };
      }
      const respJson = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
      if (typeof respJson.errcode === 'number' && respJson.errcode !== 0) {
        return { ok: false, channel: 'dingtalk', detail: `errcode=${respJson.errcode} · ${respJson.errmsg ?? ''}`, durationMs: Date.now() - t0 };
      }
      return { ok: true, channel: 'dingtalk', detail: `HTTP ${res.status}`, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, channel: 'dingtalk', detail: String((e as Error).message ?? e), durationMs: Date.now() - t0 };
    }
  }
}

class SlackChannel implements ChannelSender {
  async send(ev: NotifyEvent, cfg: NotifyChannelConfig): Promise<ChannelSendResult> {
    const t0 = Date.now();
    if (!cfg.url) {
      return { ok: false, channel: 'slack', detail: 'url is required (Slack Incoming Webhook URL)', durationMs: 0 };
    }
    const icon = ev.type === 'open' ? ':rotating_light:' : ':white_check_mark:';
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} ${ev.rule.name} · ${ev.type === 'open' ? '告警触发' : '告警恢复'}` },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${PROBE_TAG[ev.target.probe] ?? ev.target.probe}* \`${ev.target.target}\`\n${ev.incident.triggerMessage}`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `*规则:* ${ev.rule.name} · *阈值:* \`${ev.rule.metric} ${ev.rule.op} ${ev.rule.threshold}\` · *当前:* \`${ev.incident.peakMetric}\`` },
          { type: 'mrkdwn', text: `*主机:* \`${ev.host.hostname}\` · *事件 ID:* \`${ev.incident.id}\`` },
        ],
      },
    ];
    const payload: Record<string, unknown> = {
      text: `${icon} ${ev.rule.name} · ${ev.target.target} · ${ev.incident.triggerMessage}`,
      blocks,
    };
    if (cfg.channel) payload.channel = cfg.channel;
    if (cfg.username) payload.username = cfg.username;
    if (cfg.iconEmoji) payload.icon_emoji = cfg.iconEmoji;
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, channel: 'slack', detail: `HTTP ${res.status} ${text.slice(0, 200)}`, durationMs: Date.now() - t0 };
      }
      return { ok: true, channel: 'slack', detail: `HTTP ${res.status}`, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, channel: 'slack', detail: String((e as Error).message ?? e), durationMs: Date.now() - t0 };
    }
  }
}

class TelegramChannel implements ChannelSender {
  async send(ev: NotifyEvent, cfg: NotifyChannelConfig): Promise<ChannelSendResult> {
    const t0 = Date.now();
    if (!cfg.botToken) {
      return { ok: false, channel: 'telegram', detail: 'botToken is required', durationMs: 0 };
    }
    if (!cfg.chatId) {
      return { ok: false, channel: 'telegram', detail: 'chatId is required', durationMs: 0 };
    }
    const parseMode = cfg.parseMode ?? 'Markdown';
    const icon = ev.type === 'open' ? '🚨' : '✅';
    // Build the text via concatenation so we can use String.raw-style escaping
    // for the inline-code backticks that Telegram Markdown requires.
    const probe = PROBE_TAG[ev.target.probe] ?? ev.target.probe;
    const target = escapeMarkdown(ev.target.target, parseMode);
    const host = escapeMarkdown(ev.host.hostname, parseMode);
    const dur = ev.incident.durationSec != null ? formatDuration(ev.incident.durationSec) : '仍在进行';
    const lines: string[] = [
      icon + ' *' + ev.rule.name + '* (' + (ev.type === 'open' ? '告警触发' : '告警恢复') + ')',
      '',
      '*' + probe + '* `' + target + '`',
      ev.incident.triggerMessage,
      '',
      '• 阈值: `' + ev.rule.metric + ' ' + ev.rule.op + ' ' + ev.rule.threshold + '`',
      '• 当前: `' + ev.incident.peakMetric + '`',
      '• 持续: ' + dur,
      '• 主机: `' + host + '`',
      '• 事件 ID: `' + ev.incident.id + '`',
    ];
    const text = lines.join('\n');
    try {
      const apiUrl = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const respBody = await res.text().catch(() => '');
        return { ok: false, channel: 'telegram', detail: `HTTP ${res.status} ${respBody.slice(0, 200)}`, durationMs: Date.now() - t0 };
      }
      const respJson = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (respJson.ok === false) {
        return { ok: false, channel: 'telegram', detail: respJson.description ?? 'unknown error', durationMs: Date.now() - t0 };
      }
      return { ok: true, channel: 'telegram', detail: `HTTP ${res.status}`, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, channel: 'telegram', detail: String((e as Error).message ?? e), durationMs: Date.now() - t0 };
    }
  }
}

// Telegram MarkdownV2 escapes most special chars. For simplicity (we control the
// content) we just escape the user-controlled parts: target/host strings.
function escapeMarkdown(s: string, parseMode: string): string {
  if (parseMode === 'MarkdownV2') {
    return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }
  if (parseMode === 'Markdown') {
    return s.replace(/[`_*[]/g, '\\$&');
  }
  return s;
}

class SilentChannel implements ChannelSender {
  async send(_ev: NotifyEvent): Promise<ChannelSendResult> {
    return { ok: true, channel: 'silent', detail: 'no-op', durationMs: 0 };
  }
}

// ── Dispatcher ──

const CHANNELS: Record<string, ChannelSender> = {
  desktop: new DesktopChannel(),
  webhook: new WebhookChannel(),
  dingtalk: new DingTalkChannel(),
  slack: new SlackChannel(),
  telegram: new TelegramChannel(),
  silent: new SilentChannel(),
};

export function parseNotifyConfig(json: string | undefined | null): NotifyChannelConfig {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as NotifyChannelConfig;
  } catch {
    // fall through
  }
  return {};
}

export function parseNotifyKind(notify: string): keyof typeof CHANNELS {
  const k = notify as keyof typeof CHANNELS;
  if (k in CHANNELS) return k;
  return 'desktop';
}

export async function dispatchNotification(
  notify: string,
  notifyConfigJson: string | undefined | null,
  event: NotifyEvent,
): Promise<ChannelSendResult> {
  const kind = parseNotifyKind(notify);
  const sender = CHANNELS[kind];
  if (!sender) {
    return { ok: false, channel: notify, detail: 'unknown channel', durationMs: 0 };
  }
  const cfg = parseNotifyConfig(notifyConfigJson);
  try {
    return await sender.send(event, cfg);
  } catch (e) {
    return {
      ok: false,
      channel: kind,
      detail: String((e as Error).message ?? e),
      durationMs: 0,
    };
  }
}

/** Sends a synthetic test event through the chosen channel. For UI "test" buttons. */
export async function testChannel(
  notify: string,
  notifyConfigJson: string | undefined | null,
): Promise<ChannelSendResult> {
  const target: NetProbeTarget = {
    id: 'test',
    target: '1.1.1.1',
    probe: 'icmp',
    intervalMs: 5000,
    timeoutMs: 3000,
    optionsJson: '{}',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const now = Date.now();
  const incident: NetProbeIncident = {
    id: 'test-incident',
    ruleId: 'test-rule',
    targetId: 'test',
    startedAt: now,
    endedAt: null,
    peakMetric: 250,
    triggerMessage: 'TCP 延迟 p95 > 200ms (持续 60s)',
    acknowledged: false,
  };
  const rule: NetProbeAlertRule = {
    id: 'test-rule',
    name: 'Test Alert',
    targetId: null,
    probe: null,
    metric: 'latency_p95',
    op: '>',
    threshold: 200,
    durationSec: 60,
    enabled: true,
    notify: 'desktop',
    notifyConfig: '{}',
    createdAt: now,
    updatedAt: now,
  };
  return dispatchNotification(notify, notifyConfigJson, buildNotifyEvent('open', rule, target, incident));
}
