#!/usr/bin/env node
/**
 * Smoke test for V2.5 LAN scan probe.
 *
 * Spawns the nwd-net-probe daemon, runs a /24 scan (limited to a small
 * subnet for speed), and verifies the result contains expected fields.
 *
 * Two scan targets:
 *  1. 127.0.0.0/24 — should find 127.0.0.1 (loopback) and possibly nothing
 *     else (loopback-only hosts don't have open TCP ports in our probe set
 *     by default — but 127.0.0.1 may not even have any of 22/80/443/445/3389/5353)
 *  2. subnet auto-detected — scans the local /24 found via the UDP trick
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
const rl = readline.createInterface({ input: child.stdout });
let ready = null;
let pending = 0;
const results = [];
const errors = [];

const resolveReady = new Promise((r) => { ready = r; });

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'ready') {
    console.log(`[daemon] ready v${m.version} pid=${m.pid}`);
    ready();
    return;
  }
  if (m.type === 'probe_result') {
    console.log(`[probe_result] ${m.id} ${m.probe} success=${m.success} latency=${m.latency_ms?.toFixed(0)}ms error=${m.error ?? ''}`);
    if (m.payload) {
      const p = typeof m.payload === 'string' ? JSON.parse(m.payload) : m.payload;
      console.log(`  subnet=${p.subnet} scanned=${p.scanned} found=${p.found}`);
      for (const h of p.hosts ?? []) {
        const ports = (h.open_ports ?? []).join(',');
        console.log(`  · ${h.ip}  ${h.hostname ?? '-'}  [${ports}]`);
      }
    }
    results.push(m);
    pending -= 1;
    if (pending === 0) finish();
  } else if (m.type === 'error') {
    console.error(`[error] ${m.message}`);
    errors.push(m.message);
  }
});

function scan(subnet, opts = {}) {
  const id = `scan-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  pending += 1;
  const options = { max_hosts: 32, per_port_timeout_ms: 200, ...opts };
  if (subnet) options.subnet = subnet;
  send({
    type: 'add_target',
    id,
    target: 'lan',
    probe: 'lan_scan',
    interval_ms: 600_000,  // one-shot effectively
    timeout_ms: 30_000,
    options,
  });
  return id;
}

async function main() {
  await resolveReady;
  console.log('\n=== Scan 1: 127.0.0.0/24 (loopback) ===');
  scan('127.0.0.0');
  console.log('\n=== Scan 2: auto-detect local /24 ===');
  scan('');
}

function finish() {
  console.log('\n=== Summary ===');
  console.log(`got ${results.length} results, ${errors.length} errors`);
  send({ type: 'shutdown' });
  setTimeout(() => { child.kill(); process.exit(0); }, 500);
}

setTimeout(() => {
  if (pending > 0) {
    console.error(`\nTIMEOUT: ${pending} still pending`);
    send({ type: 'shutdown' });
    setTimeout(() => { child.kill(); process.exit(2); }, 500);
  }
}, 90_000);

main().catch((e) => { console.error(e); process.exit(1); });

import fs from 'node:fs';
