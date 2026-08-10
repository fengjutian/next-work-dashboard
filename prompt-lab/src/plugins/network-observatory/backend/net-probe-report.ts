/**
 * Network Observatory — report builder (V2).
 *
 * Aggregates a set of targets, their results over a time window, and their
 * associated incidents into a self-contained Markdown or HTML report.
 *
 * The output is meant to be sharable: an operator copies the report into a
 * Slack/Notion/Jira ticket, or prints the HTML to PDF via the browser's
 * "Save as PDF" dialog. The HTML is self-contained (no external CSS/JS,
 * SVG-only charts) so it works fully offline.
 *
 * V2 is purely renderer-side: it reads via the existing `db*` helpers in
 * `net-probe-storage.ts` (called through IPC) and produces a string. No
 * new IPC channel is required.
 */
import { computeStats, type ProbeStats } from './net-probe-stats';
import type { HeatmapCell } from './net-probe-storage';
import type { NetProbeTarget, NetProbeResult, NetProbeIncident, NetProbeAlertRule } from './net-probe-storage';

// ── Public types ──

export interface ReportInput {
  /** Caller-supplied metadata, e.g. "Weekly report from production dashboard". */
  title?: string;
  /** All targets in the database. The report picks a subset by `targetIds` or by time-window results. */
  targets: NetProbeTarget[];
  /** Filter to specific target IDs. Empty/undefined = all. */
  targetIds?: string[];
  /** Window start (ms epoch). Defaults to 7 days ago. */
  sinceMs?: number;
  /** Window end (ms epoch). Defaults to now. */
  untilMs?: number;
  /** Recent results across all targets within the window. */
  results: NetProbeResult[];
  /** Heatmap cells per target, keyed by target id. */
  heatmaps: Record<string, HeatmapCell[]>;
  /** Incidents that opened/closed inside the window. */
  incidents: NetProbeIncident[];
  /** All alert rules (so the report can show which rules fired). */
  rules: NetProbeAlertRule[];
  /** Hostname + platform (from `systemInfo`). */
  system?: { hostname: string; platform: string } | null;
}

export interface ReportData {
  title: string;
  generatedAt: number;
  sinceMs: number;
  untilMs: number;
  durationMs: number;
  system: { hostname: string; platform: string } | null;
  totals: {
    targetCount: number;
    enabledTargetCount: number;
    resultCount: number;
    successCount: number;
    incidentCount: number;
    openIncidentCount: number;
  };
  sections: ReportTargetSection[];
  incidents: Array<ReportIncident & { ruleName: string }>;
}

export interface ReportTargetSection {
  target: NetProbeTarget;
  /** `null` if the target has no results in the window. */
  stats: ProbeStats | null;
  heatmap: HeatmapCell[];
  /**
   * Hourly rollup of the window's results. 24 entries (one per hour 0-23),
   * averaged across all days in the window. Indexed by hour-of-day.
   */
  hourly: Array<{
    hour: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    lossPct: number;
    sampleCount: number;
  }>;
  /** First / last sample timestamps in the window (for "data range" sub-line). */
  firstSampleMs: number | null;
  lastSampleMs: number | null;
  /** Most recent error string if the target is currently failing. */
  lastError: string | null;
}

export interface ReportIncident {
  id: string;
  targetId: string;
  ruleId: string;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  peakMetric: number;
  triggerMessage: string;
  acknowledged: boolean;
}

// ── Aggregation ──

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function buildReportData(input: ReportInput): ReportData {
  const now = Date.now();
  const untilMs = input.untilMs ?? now;
  const sinceMs = input.sinceMs ?? untilMs - DEFAULT_WINDOW_MS;
  const title = (input.title ?? '').trim() || 'Network Observatory Report';
  const targetIdsFilter = input.targetIds && input.targetIds.length > 0 ? new Set(input.targetIds) : null;

  // Filter targets.
  const selectedTargets = input.targets.filter((t) => !targetIdsFilter || targetIdsFilter.has(t.id));

  // Group results by target id.
  const resultsByTarget = new Map<string, NetProbeResult[]>();
  for (const r of input.results) {
    if (r.timestampMs < sinceMs || r.timestampMs > untilMs) continue;
    if (targetIdsFilter && !targetIdsFilter.has(r.targetId)) continue;
    const arr = resultsByTarget.get(r.targetId) ?? [];
    arr.push(r);
    resultsByTarget.set(r.targetId, arr);
  }

  // Build per-target sections.
  const sections: ReportTargetSection[] = selectedTargets.map((t) => {
    const rows = resultsByTarget.get(t.id) ?? [];
    const sorted = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
    const latencies = sorted.map((r) => (r.success ? r.latencyMs : null));
    const stats = sorted.length > 0 ? computeStats(latencies, sorted.length) : null;
    const heatmap = input.heatmaps[t.id] ?? [];
    const firstSampleMs = sorted.length > 0 ? sorted[0].timestampMs : null;
    const lastSampleMs = sorted.length > 0 ? sorted[sorted.length - 1].timestampMs : null;
    const lastError = sorted.length > 0 && !sorted[sorted.length - 1].success ? sorted[sorted.length - 1].error ?? 'failed' : null;
    const hourly = computeHourlyRollup(sorted);
    return { target: t, stats, heatmap, hourly, firstSampleMs, lastSampleMs, lastError };
  });

  // Filter incidents to the window.
  const rulesById = new Map(input.rules.map((r) => [r.id, r]));
  const incidents: Array<ReportIncident & { ruleName: string }> = input.incidents
    .filter((i) => {
      const ended = i.endedAt ?? now;
      // Include if any part of the incident overlaps the window.
      return ended >= sinceMs && i.startedAt <= untilMs;
    })
    .map((i) => {
      const ended = i.endedAt;
      const durationSec = ended != null ? Math.round((ended - i.startedAt) / 1000) : null;
      return {
        id: i.id,
        targetId: i.targetId,
        ruleId: i.ruleId,
        startedAt: i.startedAt,
        endedAt: i.endedAt,
        durationSec,
        peakMetric: i.peakMetric,
        triggerMessage: i.triggerMessage,
        acknowledged: i.acknowledged,
        ruleName: rulesById.get(i.ruleId)?.name ?? '(deleted rule)',
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);

  // Totals.
  let resultCount = 0;
  let successCount = 0;
  for (const s of sections) {
    if (s.stats) {
      resultCount += s.stats.count;
      successCount += s.stats.successCount;
    }
  }

  return {
    title,
    generatedAt: now,
    sinceMs,
    untilMs,
    durationMs: untilMs - sinceMs,
    system: input.system ?? null,
    totals: {
      targetCount: selectedTargets.length,
      enabledTargetCount: selectedTargets.filter((t) => t.enabled).length,
      resultCount,
      successCount,
      incidentCount: incidents.length,
      openIncidentCount: incidents.filter((i) => i.endedAt == null).length,
    },
    sections,
    incidents,
  };
}

// ── Hourly rollup (used by report) ──

function computeHourlyRollup(rows: NetProbeResult[]): ReportTargetSection['hourly'] {
  const buckets: Array<{ sum: number; count: number; loss: number; total: number; latencies: number[] }> = Array.from({ length: 24 }, () => ({
    sum: 0,
    count: 0,
    loss: 0,
    total: 0,
    latencies: [],
  }));
  for (const r of rows) {
    const h = new Date(r.timestampMs).getHours();
    const b = buckets[h];
    b.total += 1;
    if (r.success && r.latencyMs != null) {
      b.sum += r.latencyMs;
      b.count += 1;
      b.latencies.push(r.latencyMs);
    } else {
      b.loss += 1;
    }
  }
  return buckets.map((b, hour) => {
    const sorted = [...b.latencies].sort((a, b) => a - b);
    const p95 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] : null;
    return {
      hour,
      avgLatencyMs: b.count > 0 ? b.sum / b.count : null,
      p95LatencyMs: p95,
      lossPct: b.total > 0 ? (b.loss / b.total) * 100 : 0,
      sampleCount: b.total,
    };
  });
}

// ── Heatmap rendering helpers (shared by MD & HTML) ──

const HEAT_BANDS_MS: Array<{ max: number; glyph: string; color: string }> = [
  { max: 25, glyph: '▁', color: '#10b981' },
  { max: 50, glyph: '▂', color: '#34d399' },
  { max: 100, glyph: '▃', color: '#6ee7b7' },
  { max: 150, glyph: '▄', color: '#fbbf24' },
  { max: 250, glyph: '▅', color: '#f59e0b' },
  { max: 500, glyph: '▆', color: '#f97316' },
  { max: 1000, glyph: '▇', color: '#ef4444' },
  { max: Infinity, glyph: '█', color: '#b91c1c' },
];

function heatGlyph(latencyMs: number | null): { glyph: string; color: string } {
  if (latencyMs == null) return { glyph: ' ', color: 'transparent' };
  for (const b of HEAT_BANDS_MS) {
    if (latencyMs <= b.max) return { glyph: b.glyph, color: b.color };
  }
  return { glyph: '█', color: '#b91c1c' };
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function heatmapToGlyphGrid(cells: HeatmapCell[]): Array<{ dayLabel: string; cells: Array<{ hour: number; glyph: string; color: string; latencyMs: number | null; lossPct: number; count: number }> }> {
  const byKey = new Map<string, HeatmapCell>();
  for (const c of cells) byKey.set(`${c.dayOfWeek}:${c.hourOfDay}`, c);
  const out: Array<{ dayLabel: string; cells: Array<{ hour: number; glyph: string; color: string; latencyMs: number | null; lossPct: number; count: number }> }> = [];
  for (let d = 0; d < 7; d++) {
    const row: Array<{ hour: number; glyph: string; color: string; latencyMs: number | null; lossPct: number; count: number }> = [];
    for (let h = 0; h < 24; h++) {
      const c = byKey.get(`${d}:${h}`);
      const g = heatGlyph(c?.avgLatencyMs ?? null);
      row.push({
        hour: h,
        glyph: g.glyph,
        color: g.color,
        latencyMs: c?.avgLatencyMs ?? null,
        lossPct: c?.lossPct ?? 0,
        count: c?.sampleCount ?? 0,
      });
    }
    out.push({ dayLabel: DAY_LABELS[d], cells: row });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMsShort(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatTimestamp(ms: number | null): string {
  if (ms == null) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatNumber(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function formatPercent(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '仍在进行';
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分 ${sec % 60} 秒`;
  return `${(sec / 3600).toFixed(1)} 小时`;
}

// ── Markdown report ──

export function buildMarkdownReport(data: ReportData): string {
  const lines: string[] = [];
  const winStart = formatTimestamp(data.sinceMs);
  const winEnd = formatTimestamp(data.untilMs);

  lines.push(`# ${data.title}`);
  lines.push('');
  lines.push(`> 生成于 ${formatTimestamp(data.generatedAt)} · ${data.system ? `${data.system.hostname} · ${data.system.platform}` : '本地主机'}`);
  lines.push(`> 统计窗口: ${winStart} — ${winEnd} (${formatMsShort(data.durationMs)})`);
  lines.push('');

  // Summary
  lines.push('## 概览');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 目标总数 | ${data.totals.targetCount} (启用 ${data.totals.enabledTargetCount}) |`);
  lines.push(`| 采样总数 | ${data.totals.resultCount} (成功 ${data.totals.successCount}) |`);
  if (data.totals.resultCount > 0) {
    const lossPct = ((data.totals.resultCount - data.totals.successCount) / data.totals.resultCount) * 100;
    lines.push(`| 整体失联率 | ${lossPct.toFixed(2)}% |`);
  }
  lines.push(`| 告警事件 | ${data.totals.incidentCount} (进行中 ${data.totals.openIncidentCount}) |`);
  lines.push('');

  // Per target
  if (data.sections.length === 0) {
    lines.push('## 目标');
    lines.push('');
    lines.push('_所选窗口内无目标_');
    lines.push('');
  } else {
    lines.push('## 目标总览');
    lines.push('');
    lines.push('| ID | 类型 | 目标 | 间隔 | 状态 | 采样 | 失败率 | p50 | p95 | p99 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of data.sections) {
      const t = s.target;
      const st = s.stats;
      const loss = st ? `${st.lossPct.toFixed(2)}%` : '—';
      lines.push(
        `| ${t.id} | ${t.probe.toUpperCase()} | \`${t.target}\` | ${t.intervalMs}ms | ${t.enabled ? '启用' : '暂停'} | ${st?.count ?? 0} | ${loss} | ${formatNumber(st?.p50)} | ${formatNumber(st?.p95)} | ${formatNumber(st?.p99)} |`,
      );
    }
    lines.push('');

    for (const s of data.sections) {
      const t = s.target;
      const st = s.stats;
      lines.push(`## ${t.probe.toUpperCase()} · \`${t.target}\``);
      lines.push('');
      lines.push(`- ID: \`${t.id}\``);
      lines.push(`- 间隔: ${t.intervalMs}ms · 超时: ${t.timeoutMs}ms · ${t.enabled ? '运行中' : '已暂停'}`);
      if (t.optionsJson && t.optionsJson !== '{}') {
        try {
          const opts = JSON.parse(t.optionsJson);
          const keys = Object.keys(opts);
          if (keys.length > 0) {
            const optStr = keys.map((k) => `${k}=${JSON.stringify(opts[k])}`).join(', ');
            lines.push(`- 选项: \`${optStr}\``);
          }
        } catch {
          // ignore bad JSON
        }
      }
      if (s.firstSampleMs != null) {
        lines.push(`- 数据范围: ${formatTimestamp(s.firstSampleMs)} — ${formatTimestamp(s.lastSampleMs)}`);
      }
      if (s.lastError) {
        lines.push(`- 最近错误: \`${s.lastError}\``);
      }
      lines.push('');

      // Stats
      lines.push('### 统计');
      lines.push('');
      if (st == null) {
        lines.push('_所选窗口内无采样_');
        lines.push('');
      } else {
        lines.push('| 指标 | 数值 |');
        lines.push('| --- | --- |');
        lines.push(`| 采样数 | ${st.count} (成功 ${st.successCount}) |`);
        lines.push(`| 失联率 | ${st.lossPct.toFixed(2)}% |`);
        lines.push(`| min | ${formatNumber(st.min)} ms |`);
        lines.push(`| max | ${formatNumber(st.max)} ms |`);
        lines.push(`| avg | ${formatNumber(st.avg)} ms |`);
        lines.push(`| p50 | ${formatNumber(st.p50)} ms |`);
        lines.push(`| p90 | ${formatNumber(st.p90)} ms |`);
        lines.push(`| p95 | ${formatNumber(st.p95)} ms |`);
        lines.push(`| p99 | ${formatNumber(st.p99)} ms |`);
        lines.push(`| jitter | ${formatNumber(st.jitter)} ms |`);
        lines.push('');
      }

      // Heatmap (markdown)
      if (s.heatmap.length > 0) {
        lines.push('### 7×24 热图 (按小时平均延迟)');
        lines.push('');
        const grid = heatmapToGlyphGrid(s.heatmap);
        lines.push('| 星期 \\ 时 | ' + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).join(' | ') + ' |');
        lines.push('| ' + ['---', ...Array(24).fill('---')].join(' | ') + ' |');
        for (const row of grid) {
          const cells = row.cells.map((c) => {
            if (c.latencyMs == null) return '·';
            const text = c.latencyMs < 10 ? c.latencyMs.toFixed(0) : c.latencyMs.toFixed(0);
            return `${c.glyph} ${text}`;
          });
          lines.push(`| ${row.dayLabel} | ${cells.join(' | ')} |`);
        }
        lines.push('');
        lines.push('> 图例: `▁` ≤25ms · `▂` ≤50ms · `▃` ≤100ms · `▄` ≤150ms · `▅` ≤250ms · `▆` ≤500ms · `▇` ≤1s · `█` >1s · `·` 无数据');
        lines.push('');
      }

      // Hourly bar (markdown)
      if (s.hourly.some((h) => h.sampleCount > 0)) {
        lines.push('### 24h 延迟分布 (按小时)');
        lines.push('');
        lines.push('| 小时 | avg ms | p95 ms | 采样 | 失联率 |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const h of s.hourly) {
          if (h.sampleCount === 0) {
            lines.push(`| ${String(h.hour).padStart(2, '0')}:00 | — | — | 0 | — |`);
            continue;
          }
          lines.push(
            `| ${String(h.hour).padStart(2, '0')}:00 | ${formatNumber(h.avgLatencyMs)} | ${formatNumber(h.p95LatencyMs)} | ${h.sampleCount} | ${h.lossPct.toFixed(2)}% |`,
          );
        }
        lines.push('');
      }
    }
  }

  // Incidents
  lines.push('## 告警事件');
  lines.push('');
  if (data.incidents.length === 0) {
    lines.push('_所选窗口内无告警事件_');
  } else {
    lines.push('| 开始 | 持续 | 目标 | 规则 | 触发信息 | 峰值 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const i of data.incidents) {
      const target = data.sections.find((s) => s.target.id === i.targetId);
      const targetLabel = target ? `\`${target.target.target}\` (${target.target.probe})` : i.targetId;
      lines.push(
        `| ${formatTimestamp(i.startedAt)} | ${formatDuration(i.durationSec)} | ${targetLabel} | ${i.ruleName} | ${i.triggerMessage} | ${formatNumber(i.peakMetric)} |`,
      );
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`_由 nwd Network Observatory 在 ${formatTimestamp(data.generatedAt)} 生成_`);

  return lines.join('\n');
}

// ── HTML report ──

export function buildHtmlReport(data: ReportData): string {
  const titleEsc = escapeHtml(data.title);
  const hostname = escapeHtml(data.system?.hostname ?? '本地主机');
  const platform = escapeHtml(data.system?.platform ?? '');
  const winStart = formatTimestamp(data.sinceMs);
  const winEnd = formatTimestamp(data.untilMs);
  const generatedAt = formatTimestamp(data.generatedAt);

  const sectionsHtml = data.sections.map((s) => renderTargetSection(s)).join('\n');

  const incidentsHtml = data.incidents.length === 0
    ? '<p class="muted">所选窗口内无告警事件</p>'
    : `<table class="incidents">
        <thead><tr><th>开始</th><th>持续</th><th>目标</th><th>规则</th><th>触发信息</th><th>峰值</th><th>状态</th></tr></thead>
        <tbody>
          ${data.incidents
            .map((i) => {
              const target = data.sections.find((s) => s.target.id === i.targetId);
              const targetLabel = target
                ? `<code>${escapeHtml(target.target.target)}</code> <span class="probe-badge">${escapeHtml(target.target.probe.toUpperCase())}</span>`
                : `<code>${escapeHtml(i.targetId)}</code>`;
              const isOpen = i.endedAt == null;
              return `<tr>
                <td class="mono">${formatTimestamp(i.startedAt)}</td>
                <td>${formatDuration(i.durationSec)}</td>
                <td>${targetLabel}</td>
                <td>${escapeHtml(i.ruleName)}</td>
                <td>${escapeHtml(i.triggerMessage)}</td>
                <td class="num">${formatNumber(i.peakMetric)}</td>
                <td>${isOpen ? '<span class="pill pill-open">OPEN</span>' : '<span class="pill pill-closed">CLOSED</span>'}</td>
              </tr>`;
            })
            .join('\n')}
        </tbody>
      </table>`;

  // Compute overall loss %.
  const overallLoss = data.totals.resultCount > 0
    ? ((data.totals.resultCount - data.totals.successCount) / data.totals.resultCount) * 100
    : 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${titleEsc}</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #0f172a;
    --muted: #64748b;
    --border: #e2e8f0;
    --accent: #6366f1;
    --good: #10b981;
    --bad: #ef4444;
    --warn: #f59e0b;
    --code-bg: #f1f5f9;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.55;
    margin: 0;
    padding: 32px;
    max-width: 1100px;
    margin: 0 auto;
  }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 28px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  h3 { font-size: 15px; margin: 18px 0 8px; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
  .meta code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 12px 0 24px; }
  .stat-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 18px; font-weight: 600; margin-top: 2px; }
  .stat-value.bad { color: var(--bad); }
  .stat-value.good { color: var(--good); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  th { background: #f8fafc; color: var(--muted); text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  td.mono, .mono { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11px; }
  td.num, .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  code { font-family: ui-monospace, "SF Mono", Consolas, monospace; background: var(--code-bg); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  .muted { color: var(--muted); font-style: italic; }
  .probe-badge { display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 3px; font-size: 9px; padding: 1px 4px; font-family: ui-monospace, monospace; margin-left: 4px; }
  .target-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--muted); margin: 4px 0 12px; }
  .target-meta code { background: var(--code-bg); }
  .target-section { page-break-inside: avoid; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px dashed var(--border); }
  .heatmap-svg { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  .heatmap-table { font-size: 10px; }
  .heatmap-table td { padding: 0; text-align: center; font-family: ui-monospace, monospace; }
  .heatmap-table .h { color: var(--muted); font-size: 9px; }
  .heatmap-table .d { color: var(--muted); font-size: 10px; text-align: right; padding-right: 6px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .pill-open { background: #fef3c7; color: #92400e; }
  .pill-closed { background: #d1fae5; color: #065f46; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 10px; color: var(--muted); }
  @media print {
    body { padding: 12mm; max-width: none; font-size: 11px; }
    .target-section { page-break-inside: avoid; }
    h1 { font-size: 18px; }
    h2 { font-size: 14px; margin: 16px 0 8px; }
    h3 { font-size: 12px; }
    .stats-grid { gap: 8px; }
    .stat-card { padding: 6px 10px; }
    .stat-value { font-size: 14px; }
    .no-print { display: none; }
  }
  .print-tip { background: #fef9c3; border: 1px solid #facc15; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin: 0 0 16px; }
  @media print { .print-tip { display: none; } }
</style>
</head>
<body>
<h1>${titleEsc}</h1>
<p class="meta">
  生成于 <code>${generatedAt}</code> · ${hostname}${platform ? ` · <code>${platform}</code>` : ''}<br>
  统计窗口: <code>${winStart}</code> — <code>${winEnd}</code> (${formatMsShort(data.durationMs)})
</p>

<div class="print-tip no-print">
  📄 这是可打印的 HTML 报告。点击浏览器菜单 <strong>打印 / Print</strong> (Ctrl/⌘+P)，目标选择 <strong>另存为 PDF</strong> 即可导出 PDF 副本。
</div>

<h2>概览</h2>
<div class="stats-grid">
  <div class="stat-card"><div class="stat-label">目标总数</div><div class="stat-value">${data.totals.targetCount}</div></div>
  <div class="stat-card"><div class="stat-label">运行中</div><div class="stat-value good">${data.totals.enabledTargetCount}</div></div>
  <div class="stat-card"><div class="stat-label">采样总数</div><div class="stat-value">${data.totals.resultCount}</div></div>
  <div class="stat-card"><div class="stat-label">失联率</div><div class="stat-value ${overallLoss > 5 ? 'bad' : 'good'}">${overallLoss.toFixed(2)}%</div></div>
  <div class="stat-card"><div class="stat-label">告警事件</div><div class="stat-value ${data.totals.openIncidentCount > 0 ? 'bad' : ''}">${data.totals.incidentCount}</div></div>
  <div class="stat-card"><div class="stat-label">进行中</div><div class="stat-value ${data.totals.openIncidentCount > 0 ? 'bad' : 'good'}">${data.totals.openIncidentCount}</div></div>
</div>

<h2>目标</h2>
${sectionsHtml}

<h2>告警事件</h2>
${incidentsHtml}

<footer>
  由 nwd Network Observatory 在 ${generatedAt} 生成 · 数据保留 7 天 · ${data.totals.resultCount} 样本 / ${data.sections.length} 目标
</footer>
</body>
</html>`;
}

function renderTargetSection(s: ReportTargetSection): string {
  const t = s.target;
  const st = s.stats;
  const lossClass = st == null ? '' : st.lossPct > 5 ? 'bad' : st.lossPct < 0.5 ? 'good' : '';

  let optionsHtml = '';
  if (t.optionsJson && t.optionsJson !== '{}') {
    try {
      const opts = JSON.parse(t.optionsJson);
      const keys = Object.keys(opts);
      if (keys.length > 0) {
        const parts = keys.map((k) => `<code>${escapeHtml(k)}=${escapeHtml(JSON.stringify(opts[k]))}</code>`);
        optionsHtml = `<span>选项: ${parts.join(', ')}</span>`;
      }
    } catch {
      // ignore
    }
  }

  const dataRange = s.firstSampleMs != null
    ? `数据范围: <code>${formatTimestamp(s.firstSampleMs)}</code> — <code>${formatTimestamp(s.lastSampleMs)}</code>`
    : '<span class="muted">窗口内无采样</span>';

  const lastErrorHtml = s.lastError
    ? `<span>最近错误: <code>${escapeHtml(s.lastError)}</code></span>`
    : '';

  let statsHtml: string;
  if (st == null) {
    statsHtml = '<p class="muted">所选窗口内无采样</p>';
  } else {
    statsHtml = `<div class="stats-grid">
      <div class="stat-card"><div class="stat-label">采样</div><div class="stat-value">${st.count}</div></div>
      <div class="stat-card"><div class="stat-label">成功</div><div class="stat-value good">${st.successCount}</div></div>
      <div class="stat-card"><div class="stat-label">失联率</div><div class="stat-value ${lossClass}">${st.lossPct.toFixed(2)}%</div></div>
      <div class="stat-card"><div class="stat-label">min</div><div class="stat-value">${formatNumber(st.min)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">max</div><div class="stat-value">${formatNumber(st.max)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">avg</div><div class="stat-value">${formatNumber(st.avg)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">p50</div><div class="stat-value">${formatNumber(st.p50)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">p90</div><div class="stat-value">${formatNumber(st.p90)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">p95</div><div class="stat-value">${formatNumber(st.p95)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">p99</div><div class="stat-value">${formatNumber(st.p99)} <small>ms</small></div></div>
      <div class="stat-card"><div class="stat-label">jitter</div><div class="stat-value">${formatNumber(st.jitter)} <small>ms</small></div></div>
    </div>`;
  }

  const heatmapHtml = s.heatmap.length > 0 ? renderHeatmapTable(s.heatmap) : '';
  const hourlyHtml = s.hourly.some((h) => h.sampleCount > 0) ? renderHourlyTable(s.hourly) : '';

  return `<div class="target-section">
    <h3><span class="probe-badge">${escapeHtml(t.probe.toUpperCase())}</span> <code>${escapeHtml(t.target)}</code></h3>
    <div class="target-meta">
      <span>ID: <code>${escapeHtml(t.id)}</code></span>
      <span>间隔: <code>${t.intervalMs}ms</code> · 超时: <code>${t.timeoutMs}ms</code></span>
      <span>状态: ${t.enabled ? '<span class="pill pill-closed">ENABLED</span>' : '<span class="pill pill-open">PAUSED</span>'}</span>
      ${optionsHtml}
      <span>${dataRange}</span>
      ${lastErrorHtml}
    </div>
    ${statsHtml}
    ${heatmapHtml}
    ${hourlyHtml}
  </div>`;
}

function renderHeatmapTable(cells: HeatmapCell[]): string {
  const grid = heatmapToGlyphGrid(cells);
  const headerCells = Array.from({ length: 24 }, (_, h) => `<th class="h">${String(h).padStart(2, '0')}</th>`).join('');
  const rows = grid.map((row) => {
    const cellsHtml = row.cells.map((c) => {
      if (c.latencyMs == null) return `<td style="color:#cbd5e1">·</td>`;
      const title = `${row.dayLabel} ${String(c.hour).padStart(2, '0')}:00 · ${c.latencyMs.toFixed(1)} ms · ${c.lossPct.toFixed(1)}% loss · ${c.count} samples`;
      return `<td style="background:${c.color};color:#fff" title="${escapeHtml(title)}">${c.latencyMs.toFixed(0)}</td>`;
    }).join('');
    return `<tr><td class="d">${row.dayLabel}</td>${cellsHtml}</tr>`;
  }).join('\n');

  return `<h3>7×24 热图 (按小时平均延迟)</h3>
  <table class="heatmap-table">
    <thead><tr><th></th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="muted" style="font-size:10px;margin:4px 0 0">图例: ≤25ms 浅绿 · ≤50ms 绿 · ≤100ms 翠绿 · ≤150ms 黄 · ≤250ms 橙黄 · ≤500ms 橙 · ≤1s 红 · &gt;1s 深红 · 灰色 = 无数据 · 鼠标悬停查看具体数值</p>`;
}

function renderHourlyTable(hourly: ReportTargetSection['hourly']): string {
  const rows = hourly
    .map((h) => {
      if (h.sampleCount === 0) {
        return `<tr><td class="mono">${String(h.hour).padStart(2, '0')}:00</td><td class="num muted">—</td><td class="num muted">—</td><td class="num">0</td><td class="num muted">—</td></tr>`;
      }
      const lossCls = h.lossPct > 5 ? 'bad' : '';
      return `<tr><td class="mono">${String(h.hour).padStart(2, '0')}:00</td><td class="num">${formatNumber(h.avgLatencyMs)}</td><td class="num">${formatNumber(h.p95LatencyMs)}</td><td class="num">${h.sampleCount}</td><td class="num ${lossCls}">${h.lossPct.toFixed(2)}%</td></tr>`;
    })
    .join('\n');
  return `<h3>24h 延迟分布</h3>
  <table>
    <thead><tr><th>小时</th><th>avg ms</th><th>p95 ms</th><th>采样</th><th>失联率</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Filename helper ──

export function suggestReportFilename(title: string, format: 'md' | 'html'): string {
  const safe = (title || 'report')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `net-obs_${safe}_${ts}.${format}`;
}
