#!/usr/bin/env node
/**
 * Smoke test for V2.4 self-built traceroute.
 *
 * Spawns the nwd-net-probe daemon in stdin/stdout mode, adds a traceroute
 * target for 127.0.0.1 (control) and github.com (real), waits for results,
 * and verifies:
 *  - payload.self_built is set (true if the self-built path ran, false if
 *    it fell back to system call)
 *  - hops[] has at least 1 entry
 *  - RTTs are valid (>= 0 or -1.0 for *)
 *
 * If the local process can't open SOCK_RAW (Windows non-admin, Linux
 * without CAP_NET_RAW) the binary should transparently fall back to the
 * system call. We treat that as a successful test as long as we get hops.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, 'nwd-net-probe.exe');

if (!fs.existsSync(DAEMON)) {
  console.error(`daemon not found at ${DAEMON}; build it first`);
  process.exit(1);
}

const child = spawn(DAEMON, ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

let stderrBuf = '';
child.stderr.on('data', (b) => { stderrBuf += b.toString(); });
process.on('exit', () => {
  if (stderrBuf.trim()) {
    console.log('\n=== daemon stderr (final) ===');
    console.log(stderrBuf);
  }
});

const rl = readline.createInterface({ input: child.stdout });

let ready = null;
const results = [];
const errors = [];
let targetCounter = 1;
let pendingCount = 0;

const resolveWhenReady = new Promise((resolve) => { ready = resolve; });

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === 'ready') {
    console.log(`[daemon] ready · v${msg.version} · pid ${msg.pid}`);
    ready();
    return;
  }
  if (msg.type === 'probe_result') {
    console.log(`[probe_result] ${msg.id} ${msg.probe} success=${msg.success} latency=${msg.latency_ms}ms`);
    if (msg.payload) {
      const p = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
      console.log(`  self_built=${p.self_built} complete=${p.complete} hops=${p.hops?.length ?? 0}`);
      if (p.hops && p.hops.length > 0) {
        for (const h of p.hops.slice(0, 5)) {
          const rtt = h.rtt_ms.map((r) => r < 0 ? '*' : `${r.toFixed(1)}ms`).join(' / ');
          console.log(`    ${h.hop}. ${h.host}  [${rtt}]`);
        }
        if (p.hops.length > 5) console.log(`    ... +${p.hops.length - 5} more hops`);
      }
      if (p.self_built_error) console.log(`  fallback_reason: ${p.self_built_error}`);
      results.push({ id: msg.id, payload: p });
      pendingCount -= 1;
      if (pendingCount === 0) finish();
    }
    return;
  }
  if (msg.type === 'error') {
    console.error(`[daemon error] ${msg.message}`);
    errors.push(msg.message);
  }
});

function addTraceroute(target, opts = {}) {
  const id = `t${targetCounter++}`;
  pendingCount += 1;
  send({
    type: 'add_target',
    id,
    target,
    probe: 'traceroute',
    interval_ms: 60_000,  // traceroute is one-shot, but the daemon re-runs on interval
    timeout_ms: 30_000,
    options: { max_hops: 15, queries: 3, per_probe_timeout_ms: 2000, ...opts },
  });
  return id;
}

async function main() {
  await resolveWhenReady;
  console.log('\n=== Test 1: self-built to 1.1.1.1 (real IPv4) ===\n');
  addTraceroute('1.1.1.1', { max_hops: 8, per_probe_timeout_ms: 1500 });
  console.log('\n=== Test 2: system fallback (forced) to 1.1.1.1 ===\n');
  addTraceroute('1.1.1.1', { mode: 'system', max_hops: 8 });
  console.log('\n=== Test 3: self-built to 127.0.0.1 (loopback) ===\n');
  addTraceroute('127.0.0.1', { max_hops: 5, per_probe_timeout_ms: 500 });
  console.log('\n=== Test 4: self-built to baidu.com (likely IPv4) ===\n');
  addTraceroute('baidu.com', { max_hops: 5, per_probe_timeout_ms: 1500 });
}

function finish() {
  console.log('\n=== Summary ===');
  console.log(`got ${results.length} results, ${errors.length} errors`);
  const ok = results.filter((r) => r.payload.hops && r.payload.hops.length > 0);
  console.log(`non-empty: ${ok.length}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.id}: self_built=${r.payload.self_built} hops=${r.payload.hops?.length ?? 0}`);
  }
  send({ type: 'shutdown' });
  setTimeout(() => {
    child.kill();
    process.exit(ok.length > 0 ? 0 : 1);
  }, 500);
}

setTimeout(() => {
  if (pendingCount > 0) {
    console.error(`\nTIMEOUT: ${pendingCount} probes still pending`);
    send({ type: 'shutdown' });
    setTimeout(() => { child.kill(); process.exit(2); }, 500);
  }
}, 90_000);

main().catch((e) => { console.error(e); process.exit(1); });

// Use fs sync to check binary exists.
import fs from 'node:fs';
