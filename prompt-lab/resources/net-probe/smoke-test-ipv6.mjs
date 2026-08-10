// IPv6 smoke test: ICMPv6 to 2001:4860:4860::8888 (Google DNS) and AAAA.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const exe = path.join('native', 'net-probe', 'target', 'release', 'nwd-net-probe.exe');
const child = spawn(exe, ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });

const lines = readline.createInterface({ input: child.stdout });
const results = [];
const start = Date.now();
const timeout = setTimeout(() => {
  console.error('[smoke] timeout 30s');
  child.kill();
  process.exit(1);
}, 30000);

function send(obj) {
  const s = JSON.stringify(obj) + '\n';
  console.log('[send]', s.trim());
  child.stdin.write(s);
}

lines.on('line', (line) => {
  if (!line.trim()) return;
  const obj = JSON.parse(line);
  if (obj.type === 'ready') {
    send({ type: 'add_target', id: 'icmp_v4', target: '1.1.1.1', probe: 'icmp', interval_ms: 2000, options: { ip_version: 'v4' } });
    send({ type: 'add_target', id: 'icmp_v6', target: '2001:4860:4860::8888', probe: 'icmp', interval_ms: 2000, options: { ip_version: 'v6' } });
    send({ type: 'add_target', id: 'icmp_auto', target: 'github.com', probe: 'icmp', interval_ms: 3000 });
    send({ type: 'add_target', id: 'tcp_v4', target: 'github.com', probe: 'tcp', interval_ms: 4000, options: { port: 443, ip_version: 'v4' } });
    send({ type: 'add_target', id: 'tcp_v6', target: 'github.com', probe: 'tcp', interval_ms: 4000, options: { port: 443, ip_version: 'v6' } });
    send({ type: 'add_target', id: 'dns_aaaa', target: 'github.com', probe: 'dns', interval_ms: 5000, options: { record: 'AAAA' } });
    return;
  }
  if (obj.type === 'probe_result') {
    let extra = '';
    if (obj.payload) {
      if (obj.probe === 'icmp') extra = `ip=${obj.payload.ip_version} remote=${obj.payload.remote}`;
      if (obj.probe === 'tcp') extra = `ip=${obj.payload.ip_version} remote=${obj.payload.remote}`;
      if (obj.probe === 'dns') extra = `record=${obj.payload.record} primary=${obj.payload.primary}`;
    }
    console.log(`[${obj.id}] ${obj.probe} success=${obj.success} latency=${obj.latency_ms ? obj.latency_ms.toFixed(1) : '-'}ms ${extra}${obj.error ? ' err=' + obj.error : ''}`);
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
