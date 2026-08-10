// Quick smoke test: spawn nwd-net-probe, send add_target, read 3 probe_results, exit.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const exe = path.join('native', 'net-probe', 'target', 'release', 'nwd-net-probe.exe');
const child = spawn(exe, ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });

const lines = readline.createInterface({ input: child.stdout });
let ready = false;
let received = 0;
const start = Date.now();
const timeout = setTimeout(() => {
  console.error('[smoke] timeout 8s — killing');
  child.kill();
  process.exit(1);
}, 8000);

lines.on('line', (line) => {
  if (!line.trim()) return;
  console.log('[out]', line);
  if (!ready) {
    const obj = JSON.parse(line);
    if (obj.type === 'ready') {
      ready = true;
      child.stdin.write(JSON.stringify({ type: 'add_target', id: 't1', target: '127.0.0.1', interval_ms: 500 }) + '\n');
      child.stdin.write(JSON.stringify({ type: 'add_target', id: 't2', target: '1.1.1.1', interval_ms: 500 }) + '\n');
    }
  } else {
    received += 1;
    if (received >= 4) {
      child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
      clearTimeout(timeout);
      setTimeout(() => {
        console.log(`[smoke] OK — received ${received} probe_results in ${Date.now() - start}ms`);
        process.exit(0);
      }, 300);
    }
  }
});

child.stderr.on('data', (b) => process.stderr.write(`[err] ${b}`));
child.on('exit', (code) => console.log(`[smoke] daemon exited with code ${code}`));
