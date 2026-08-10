#!/usr/bin/env node
/**
 * Smoke test for alert notification channels (V2.3).
 *
 * Starts a local HTTP mock receiver, then exercises each channel against it:
 *  - webhook: generic JSON POST
 *  - dingtalk: signed markdown
 *  - slack: blocks-based message
 *  - telegram: simulated (no live API call; verifies the request shape)
 *
 * Also verifies the dispatcher error path (missing url, wrong port, etc).
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TS_NOTIFY = path.join(REPO_ROOT, 'src', 'plugins', 'network-observatory', 'backend', 'net-probe-notify.ts');

/** Spin up a local HTTP receiver that records all incoming requests. */
function startMockServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        timestampMs: Date.now(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok', ok: true }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, received });
    });
  });
}

async function main() {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (major < 22) {
    console.error(`Need Node >= 22, have ${nodeVersion}`);
    process.exit(1);
  }

  const tsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx.cmd');
  const child = await import('node:child_process');

  // Start mock server first
  const { server, port, received } = await startMockServer();
  console.log(`Mock receiver: http://127.0.0.1:${port}/`);

  const driver = `
import { dispatchNotification, testChannel, buildNotifyEvent, parseNotifyConfig, eventToText } from ${JSON.stringify(pathToFileURL(TS_NOTIFY).href)};
import * as fsSync from 'node:fs';

const PORT = ${port};
const MOCK_URL = 'http://127.0.0.1:' + PORT + '/webhook';

async function main() {
  // Synthetic event used by every channel.
  const target: any = { id: 't1', target: '1.1.1.1', probe: 'icmp', intervalMs: 5000, timeoutMs: 3000, optionsJson: '{}', enabled: true, createdAt: 0, updatedAt: 0 };
  const rule: any = { id: 'r1', name: 'P95 告警', targetId: null, probe: null, metric: 'latency_p95', op: '>', threshold: 200, durationSec: 60, enabled: true, notify: 'webhook', notifyConfig: '{}', createdAt: 0, updatedAt: 0 };
  const incident: any = { id: 'inc-1', ruleId: 'r1', targetId: 't1', startedAt: Date.now() - 30000, endedAt: null, peakMetric: 250, triggerMessage: 'P95 延迟 > 200ms (持续 60s)', acknowledged: false };
  const event = buildNotifyEvent('open', rule, target, incident);

  console.log('=== eventToText (sanity) ===');
  console.log(eventToText(event));
  console.log('');

  async function tryChannel(name: string, notify: string, config: any) {
    console.log('--- ' + name + ' ---');
    const cfg = JSON.stringify(config);
    const r = await dispatchNotification(notify, cfg, event);
    console.log(JSON.stringify(r, null, 2));
    console.log('');
    return r;
  }

  async function tryTestChannel(name: string, notify: string, config: any) {
    console.log('--- testChannel ' + name + ' ---');
    const r = await testChannel(notify, JSON.stringify(config));
    console.log(JSON.stringify(r, null, 2));
    console.log('');
    return r;
  }

  const results: Record<string, any> = {};

  results.webhook = await tryChannel('webhook (json)', 'webhook', { url: MOCK_URL, bodyTemplate: 'json' });
  results.webhookText = await tryChannel('webhook (text)', 'webhook', { url: MOCK_URL, bodyTemplate: 'text' });
  results.dingtalk = await tryChannel('dingtalk (unsigned)', 'dingtalk', { url: MOCK_URL, atMobiles: ['13800138000'] });
  results.dingtalkSigned = await tryChannel('dingtalk (signed)', 'dingtalk', { url: MOCK_URL, secret: 'SECabc123456' });
  results.slack = await tryChannel('slack', 'slack', { url: MOCK_URL, channel: '#alerts', iconEmoji: ':satellite:' });
  results.telegram = await tryChannel('telegram (mock)', 'telegram', { botToken: '123:abc', chatId: '-100', parseMode: 'Markdown' });
  results.testChannel = await tryTestChannel('webhook (via testChannel)', 'webhook', { url: MOCK_URL, bodyTemplate: 'json' });
  results.errorNoUrl = await tryChannel('webhook (no url)', 'webhook', {});
  results.errorConnRefused = await tryChannel('webhook (bad port)', 'webhook', { url: 'http://127.0.0.1:1/no-listener' });
  results.silent = await tryChannel('silent', 'silent', {});
  results.desktop = await tryChannel('desktop', 'desktop', {});

  fsSync.writeFileSync(${JSON.stringify(path.join(__dirname, 'samples', 'notify-results.json'))}, JSON.stringify(results, null, 2), 'utf8');
  console.log('---');
  console.log('Results saved to samples/notify-results.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
`;

  const driverPath = path.join(__dirname, '_run-notify-test.ts');
  fs.writeFileSync(driverPath, driver, 'utf8');

  // Run the driver
  const proc = child.spawn(tsxBin, [driverPath], { stdio: 'inherit', cwd: REPO_ROOT, shell: true });
  proc.on('exit', (code) => {
    try { fs.unlinkSync(driverPath); } catch { /* ignore */ }
    // Inspect mock receiver
    console.log('');
    console.log('=== Mock receiver captured', received.length, 'requests ===');
    for (const r of received) {
      const parsed = (() => { try { return JSON.parse(r.body); } catch { return r.body; } })();
      const summary = {
        method: r.method,
        path: r.url,
        userAgent: r.headers['user-agent'],
        hasAuth: Boolean(r.headers.authorization),
        contentType: r.headers['content-type'],
        bodyKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : null,
        bodySize: r.body.length,
      };
      console.log(JSON.stringify(summary));
    }
    server.close();
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
