// V1.1.1 smoke test: HTTPS support + IPv6 (when available).
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const exe = path.join('native', 'net-probe', 'target', 'release', 'nwd-net-probe.exe');
const child = spawn(exe, ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });

const lines = readline.createInterface({ input: child.stdout });
const results = [];
const start = Date.now();
const timeout = setTimeout(() => {
  console.error('[smoke] timeout 40s — killing');
  child.kill();
  process.exit(1);
}, 40000);

function send(obj) {
  const s = JSON.stringify(obj) + '\n';
  console.log('[send]', s.trim());
  child.stdin.write(s);
}

lines.on('line', (line) => {
  if (!line.trim()) return;
  const obj = JSON.parse(line);
  if (obj.type === 'ready') {
    send({ type: 'add_target', id: 'http_plain', target: 'http://example.com', probe: 'http', interval_ms: 5000 });
    send({ type: 'add_target', id: 'https_real', target: 'https://example.com', probe: 'http', interval_ms: 5000 });
    send({ type: 'add_target', id: 'https_github', target: 'https://github.com', probe: 'http', interval_ms: 5000 });
    send({ type: 'add_target', id: 'tcp_v4', target: '1.1.1.1', probe: 'tcp', interval_ms: 3000, options: { port: 443 } });
    send({ type: 'add_target', id: 'dns_a', target: 'github.com', probe: 'dns', interval_ms: 4000, options: { record: 'A' } });
    send({ type: 'add_target', id: 'dns_aaaa', target: 'github.com', probe: 'dns', interval_ms: 4000, options: { record: 'AAAA' } });
    return;
  }
  if (obj.type === 'probe_result') {
    let payload = '';
    if (obj.payload) {
      if (obj.probe === 'http') {
        payload = `dns=${obj.payload.dns_ms?.toFixed(1)} tcp=${obj.payload.tcp_ms?.toFixed(1)} tls=${obj.payload.tls_ms?.toFixed(1)} ttfb=${obj.payload.ttfb_ms?.toFixed(1)} dl=${obj.payload.download_ms?.toFixed(1)} status=${obj.payload.status} bytes=${obj.payload.bytes}`;
      } else if (obj.probe === 'dns') {
        payload = `record=${obj.payload.record} primary=${obj.payload.primary} resolvers=${(obj.payload.resolvers ?? []).length}`;
      } else if (obj.probe === 'tcp') {
        payload = `remote=${obj.payload.remote}`;
      }
    }
    console.log(`[${obj.id}] ${obj.probe} success=${obj.success} latency=${obj.latency_ms ? obj.latency_ms.toFixed(1) : '-'}ms ${payload}${obj.error ? ' err=' + obj.error : ''}`);
    results.push(obj);
    if (results.length >= 12) {
      send({ type: 'shutdown' });
      clearTimeout(timeout);
      setTimeout(() => {
        const byId = {};
        for (const r of results) (byId[r.id] = byId[r.id] || []).push(r);
        console.log(`\n[smoke] OK — ${results.length} results in ${Date.now() - start}ms`);
        for (const [id, arr] of Object.entries(byId)) {
          const ok = arr.filter((r) => r.success).length;
          console.log(`  ${id}: ${ok}/${arr.length} successful`);
        }
        process.exit(0);
      }, 300);
    }
  }
  if (obj.type === 'error') console.error('[err]', obj.message);
});

child.stderr.on('data', (b) => process.stderr.write(`[stderr] ${b}`));
child.on('exit', (code) => console.log(`[smoke] daemon exited code=${code}`));
