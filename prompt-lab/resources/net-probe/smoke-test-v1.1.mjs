// V1.1 smoke test: spawn nwd-net-probe, test 4 probe types, exit.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const exe = path.join('native', 'net-probe', 'target', 'release', 'nwd-net-probe.exe');
const child = spawn(exe, ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });

const lines = readline.createInterface({ input: child.stdout });
let phase = 'init';
const results = [];
const start = Date.now();
const timeout = setTimeout(() => {
  console.error('[smoke] timeout 30s — killing');
  child.kill();
  process.exit(1);
}, 30_000);

lines.on('line', (line) => {
  if (!line.trim()) return;
  const obj = JSON.parse(line);
  if (obj.type === 'ready') {
    phase = 'running';
    // Add targets for each probe type
    child.stdin.write(JSON.stringify({ type: 'add_target', id: 'icmp1', target: '1.1.1.1', probe: 'icmp', interval_ms: 1000 }) + '\n');
    child.stdin.write(JSON.stringify({ type: 'add_target', id: 'tcp1', target: '1.1.1.1:443', probe: 'tcp', interval_ms: 2000, options: { port: 443 } }) + '\n');
    child.stdin.write(JSON.stringify({ type: 'dns1', target: 'example.com', probe: 'dns', interval_ms: 2000, options: { record: 'A' } }) + '\n');
    child.stdin.write(JSON.stringify({ type: 'http1', target: 'http://example.com', probe: 'http', interval_ms: 3000 }) + '\n');
    return;
  }
  if (obj.type === 'probe_result') {
    const payloadKeys = obj.payload ? Object.keys(obj.payload).slice(0, 3).join(',') : 'none';
    console.log(`[${obj.id}] ${obj.probe} success=${obj.success} latency=${obj.latency_ms?.toFixed(1)}ms payload_keys=${payloadKeys}${obj.error ? ' err=' + obj.error : ''}`);
    results.push(obj);
    if (results.length >= 8) {
      child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
      clearTimeout(timeout);
      setTimeout(() => {
        const byId = {};
        for (const r of results) (byId[r.id] ??= []).push(r);
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
