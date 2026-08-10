
import { dispatchNotification, testChannel, buildNotifyEvent, parseNotifyConfig, eventToText } from "file:///D:/github/next-work-dashboard/prompt-lab/src/plugins/network-observatory/backend/net-probe-notify.ts";
import * as fsSync from 'node:fs';

const PORT = 51811;
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

  fsSync.writeFileSync("D:\\github\\next-work-dashboard\\prompt-lab\\resources\\net-probe\\samples\\notify-results.json", JSON.stringify(results, null, 2), 'utf8');
  console.log('---');
  console.log('Results saved to samples/notify-results.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
