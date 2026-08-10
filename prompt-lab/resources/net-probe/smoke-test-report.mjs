#!/usr/bin/env node
/**
 * Smoke test for the report builder.
 *
 * Synthesizes a representative dataset:
 *   - 3 targets (ICMP, TCP, HTTP)
 *   - 24h of data sampled at 5s intervals (~17,000 samples total)
 *   - Some loss on TCP, normal ICMP, intermittent HTTP
 *   - 2 incidents: one closed, one still open
 *   - 168-cell heatmap
 *
 * Writes both formats to resources/net-probe/samples/ and prints a summary.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TS_REPORT = path.join(REPO_ROOT, 'src', 'plugins', 'network-observatory', 'backend', 'net-probe-report.ts');

async function main() {
  // Use tsx/esbuild-style dynamic import via the prompt-lab TypeScript build is heavy.
  // Instead, we replicate the heat-band and format helpers and exercise only the
  // public surface by reading the file for sanity, then call buildReportData via
  // a tiny inline reimplementation — but that defeats the point.
  //
  // Approach: use a child process running a `.ts` file via `node --experimental-strip-types`
  // (Node 22+). The prompt-lab environment is Node 22+ via the nwd Electron runtime.
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (major < 22) {
    console.error(`Need Node >= 22 for type stripping, have ${nodeVersion}`);
    process.exit(1);
  }

  const outDir = path.join(__dirname, 'samples');
  fs.mkdirSync(outDir, { recursive: true });

  const child = await import('node:child_process');

  // Use the prompt-lab tsx binary to run a small TS driver that imports the report module.
  const tsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx.cmd');
  const driverPath = path.join(__dirname, '_run-report-test.ts');
  const driver = `
import { buildReportData, buildMarkdownReport, buildHtmlReport, suggestReportFilename } from ${JSON.stringify(TS_REPORT)};

const now = Date.now();
const sinceMs = now - 24 * 60 * 60 * 1000;
const untilMs = now;

function makeResult(targetId: string, probe: string, t: number, latencyMs: number | null, success: boolean, error: string | null = null) {
  return {
    id: 'res-' + t,
    targetId,
    probe,
    timestampMs: t,
    success: success ? 1 : 0,
    latencyMs,
    error,
    payloadJson: '{}',
  };
}

const targets: any[] = [
  { id: 't1', target: '1.1.1.1', probe: 'icmp', intervalMs: 5000, timeoutMs: 3000, optionsJson: '{}', enabled: true, createdAt: now - 86400000, updatedAt: now },
  { id: 't2', target: 'github.com:443', probe: 'tcp', intervalMs: 5000, timeoutMs: 3000, optionsJson: JSON.stringify({ port: 443 }), enabled: true, createdAt: now - 86400000, updatedAt: now },
  { id: 't3', target: 'https://example.com', probe: 'http', intervalMs: 10000, timeoutMs: 5000, optionsJson: '{}', enabled: true, createdAt: now - 86400000, updatedAt: now },
  { id: 't4', target: 'github.com', probe: 'traceroute', intervalMs: 60000, timeoutMs: 30000, optionsJson: '{}', enabled: false, createdAt: now - 86400000, updatedAt: now },
];

const results: any[] = [];
for (const t of targets) {
  if (t.probe === 'traceroute') continue;
  for (let ts = sinceMs; ts < untilMs; ts += t.intervalMs) {
    const hour = new Date(ts).getHours();
    let latency: number | null = 0;
    let success = true;
    if (t.probe === 'icmp') {
      latency = hour >= 9 && hour <= 11 ? 80 + Math.random() * 40 : 30 + Math.random() * 20;
    } else if (t.probe === 'tcp') {
      if (Math.random() < 0.05) { success = false; latency = null; }
      else latency = 60 + Math.random() * 40;
    } else {
      if (Math.random() < 0.01) { success = false; latency = null; }
      else if (Math.random() < 0.02) latency = 2000 + Math.random() * 1000;
      else latency = 100 + Math.random() * 80;
    }
    results.push(makeResult(t.id, t.probe, ts, latency, success, success ? null : 'timeout'));
  }
}

const heatmaps: Record<string, any[]> = {};
for (const t of targets) {
  if (t.probe === 'traceroute') { heatmaps[t.id] = []; continue; }
  const cells: any[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const hasData = Math.random() > 0.2;
      if (hasData) {
        const lat = t.probe === 'icmp' ? 30 + Math.random() * 30 : 60 + Math.random() * 80;
        cells.push({ dayOfWeek: d, hourOfDay: h, avgLatencyMs: lat, sampleCount: 30, lossPct: Math.random() * 2 });
      } else {
        cells.push({ dayOfWeek: d, hourOfDay: h, avgLatencyMs: null, sampleCount: 0, lossPct: 0 });
      }
    }
  }
  heatmaps[t.id] = cells;
}

const incidents: any[] = [
  { id: 'inc1', ruleId: 'rule1', targetId: 't2', startedAt: now - 6 * 3600 * 1000, endedAt: now - 5.5 * 3600 * 1000, peakMetric: 250, triggerMessage: 'TCP 延迟 p95 > 200ms (持续 60s)', acknowledged: 1 },
  { id: 'inc2', ruleId: 'rule2', targetId: 't3', startedAt: now - 30 * 60 * 1000, endedAt: null, peakMetric: 95, triggerMessage: 'HTTP 失联率 > 5% (持续 120s)', acknowledged: 0 },
];

const rules: any[] = [
  { id: 'rule1', name: 'TCP 高延迟', targetId: 't2', probe: 'tcp', metric: 'latency_p95', op: '>', threshold: 200, durationSec: 60, enabled: true, notify: 'desktop', createdAt: 0, updatedAt: 0 },
  { id: 'rule2', name: 'HTTP 失联', targetId: 't3', probe: 'http', metric: 'loss_pct', op: '>', threshold: 5, durationSec: 120, enabled: true, notify: 'desktop', createdAt: 0, updatedAt: 0 },
];

const data = buildReportData({
  title: 'Synthetic Test Report',
  targets,
  sinceMs,
  untilMs,
  results,
  heatmaps,
  incidents,
  rules,
  system: { hostname: 'test-host', platform: 'Windows_NT 10.0' },
});

const md = buildMarkdownReport(data);
const html = buildHtmlReport(data);

const mdPath = ${JSON.stringify(path.join(outDir, 'sample-report.md'))};
const htmlPath = ${JSON.stringify(path.join(outDir, 'sample-report.html'))};
import * as fsSync from 'node:fs';
fsSync.writeFileSync(mdPath, md, 'utf8');
fsSync.writeFileSync(htmlPath, html, 'utf8');

console.log('=== buildReportData ===');
console.log(JSON.stringify(data.totals, null, 2));
console.log('sections:', data.sections.length);
for (const s of data.sections) {
  console.log('  ' + s.target.id, s.target.probe, s.target.target, 'stats:', s.stats ? \`count=\${s.stats.count} p95=\${s.stats.p95?.toFixed(1)}ms loss=\${s.stats.lossPct.toFixed(2)}%\` : 'null');
}
console.log('incidents:', data.incidents.length, '(open:', data.totals.openIncidentCount + ')');
console.log('');
console.log('=== filename helper ===');
console.log('MD  :', suggestReportFilename(data.title, 'md'));
console.log('HTML:', suggestReportFilename(data.title, 'html'));
console.log('');
console.log('=== outputs ===');
console.log('MD  size:', md.length, 'bytes ->', mdPath);
console.log('HTML size:', html.length, 'bytes ->', htmlPath);
`;
  fs.writeFileSync(driverPath, driver, 'utf8');

  const proc = child.spawn(tsxBin, [driverPath], { stdio: 'inherit', cwd: REPO_ROOT, shell: true });
  proc.on('exit', (code) => {
    try { fs.unlinkSync(driverPath); } catch { /* ignore */ }
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
