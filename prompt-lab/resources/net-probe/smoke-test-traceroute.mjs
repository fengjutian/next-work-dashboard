// V2 Traceroute smoke test.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import fs from 'node:fs';

const src = path.join('native', 'net-probe', 'target2', 'release', 'nwd-net-probe.exe');
const dst = path.join('native', 'net-probe', 'target', 'release', 'nwd-net-probe.exe');
if (fs.existsSync(src)) fs.copyFileSync(src, dst);

const exe = dst;
const child = spawn(exe, ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });

const lines = readline.createInterface({ input: child.stdout });
const start = Date.now();
const timeout = setTimeout(() => {
  console.error('[smoke] timeout 90s — killing');
  child.kill();
  process.exit(1);
}, 90000);

function send(obj) {
  const s = JSON.stringify(obj) + '\n';
  console.log('[send]', s.trim());
  child.stdin.write(s);
}

lines.on('line', (line) => {
  if (!line.trim()) return;
  const obj = JSON.parse(line);
  if (obj.type === 'ready') {
    send({
      type: 'add_target',
      id: 'trace_github',
      target: 'github.com',
      probe: 'traceroute',
      interval_ms: 60000,
      timeout_ms: 45000,
      options: { max_hops: 10, queries: 3, resolve_dns: false },
    });
    return;
  }
  if (obj.type === 'probe_result') {
    const elapsed = Date.now() - start;
    console.log(`[${obj.id}] ${obj.probe} success=${obj.success} latency=${obj.latency_ms ? obj.latency_ms.toFixed(0) : '-'}ms elapsed=${elapsed}ms`);
    if (obj.payload) {
      console.log(`  target=${obj.payload.target} complete=${obj.payload.complete} max_hops=${obj.payload.max_hops}`);
      if (Array.isArray(obj.payload.hops)) {
        for (const h of obj.payload.hops) {
          const rtts = h.rtt_ms.map((r) => (r < 0 ? '*' : r.toFixed(1) + 'ms')).join(' / ');
          console.log(`  hop ${h.hop}: ${h.host.padEnd(30)} ${rtts}`);
        }
      }
    }
    if (obj.error) console.log('  err:', obj.error);
    send({ type: 'shutdown' });
    clearTimeout(timeout);
    setTimeout(() => process.exit(0), 200);
  }
  if (obj.type === 'error') console.error('[err]', obj.message);
});

child.stderr.on('data', (b) => process.stderr.write(`[stderr] ${b}`));
child.on('exit', (code) => console.log(`[smoke] daemon exited code=${code}`));
