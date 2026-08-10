// End-to-end smoke test for the MyCast desktop sidecar.
//
// Simulates a phone by walking through every public surface the sidecar
// exposes. This is the script to run on a developer machine to verify a
// freshly-built binary before doing the full Android/iOS build dance.
//
//   $ npm run build:mycast
//   $ node scripts/e2e-mycast.mjs
//
// Exits with non-zero status on the first failure; prints a summary at the
// end. Requires PowerShell's `node` to be on PATH (bundled with the project).

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const nodeCrypto = { createHash, randomBytes };

process.stderr.write('▶ e2e-mycast: top-level\n');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const exe = isWindows ? 'nwd-mycast.exe' : 'nwd-mycast';
const bin = path.join(root, 'resources', 'mycast', exe);

process.stderr.write(`▶ bin: ${bin}\n`);

if (!existsSync(bin)) {
  process.stderr.write(`✗ binary not found at ${bin}; run: npm run build:mycast\n`);
  process.exit(1);
}
process.stderr.write('▶ existsSync passed\n');

const tmpDir = path.join(root, '.cache', 'e2e-mycast');
mkdirSync(tmpDir, { recursive: true });
const stderrLog = path.join(tmpDir, 'stderr.log');
const stdoutLog = path.join(tmpDir, 'stdout.log');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

async function main() {
  process.stderr.write(`▶ entering main()\n`);
  console.log(`▶ e2e-mycast — binary: ${bin}`);
  console.log(`  cwd: ${root}`);
  console.log('');

  // ── 1. Spawn the sidecar and wait for ready ────────────────────────────
  console.log('[1] spawn sidecar + await ready');
  const proc = spawn(bin, ['daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => writeFileSync(stderrLog, d, { flag: 'a' }));
  const stdoutReader = createInterface({ input: proc.stdout });
  stdoutReader.on('line', (l) => writeFileSync(stdoutLog, l + '\n', { flag: 'a' }));
  let ready = null;
  stdoutReader.on('line', (l) => {
    if (!l.trim()) return;
    try {
      const obj = JSON.parse(l);
      if (obj.type === 'ready') ready = obj;
    } catch { /* ignore */ }
  });
  const waitReady = async () => {
    const t0 = Date.now();
    while (!ready && Date.now() - t0 < 6000) await sleep(50);
    return ready;
  };
  const info = await waitReady();
  check('ready event', !!info, info ? `device=${info.device_name} lan=${info.lan_addr}` : 'timed out');
  if (!info) { killAndExit(proc, 1); return; }
  const port = info.http_port;
  const wsPort = info.ws_port;
  const host = info.lan_addr || '127.0.0.1';
  check('lan_addr present', !!info.lan_addr, info.lan_addr);
  check('pair_code present', !!info.pair_code, info.pair_code);

  // ── 2. HTTP /api/info ───────────────────────────────────────────────────
  console.log('\n[2] HTTP /api/info');
  const info2 = await get(`${baseUrl(host, port)}/api/info`);
  check('returns 200 + device_id', info2.status === 200 && !!info2.json.device_id,
        `status=${info2.status} device_id=${info2.json.device_id}`);

  // ── 3. Pair flow ───────────────────────────────────────────────────────
  console.log('\n[3] /api/pair/request + /api/pair/complete');
  const code = info.pair_code;
  const pairReq = await postJson(`${baseUrl(host, port)}/api/pair/request`, {
    device_id: 'e2e-device',
    device_name: 'E2E Test Phone',
    platform: 'web',
  });
  check('pair_request returns 200', pairReq.status === 200, `status=${pairReq.status}`);
  check('pair_code present', !!pairReq.json.pair_code, pairReq.json.pair_code);
  // The new pair code replaces the old one, so use the freshly returned code.
  const freshCode = pairReq.json.pair_code;
  const pairComplete = await postJson(`${baseUrl(host, port)}/api/pair/complete`, {
    device_id: 'e2e-device',
    device_name: 'E2E Test Phone',
    pairing_code: freshCode,
  });
  check('pair_complete returns 200', pairComplete.status === 200, `status=${pairComplete.status}`);
  check('session_token present', !!pairComplete.json.session_token, pairComplete.json.session_token?.slice(0, 12) + '…');
  const token = pairComplete.json.session_token;

  // ── 4. Auth enforcement ────────────────────────────────────────────────
  console.log('\n[4] Bearer auth enforcement');
  const noAuth = await get(`${baseUrl(host, port)}/api/files`);
  check('unauthenticated /api/files → 401', noAuth.status === 401, `status=${noAuth.status}`);
  const wrongAuth = await get(`${baseUrl(host, port)}/api/files`, { Authorization: 'Bearer wrong-token' });
  check('wrong token → 401', wrongAuth.status === 401, `status=${wrongAuth.status}`);

  // ── 5. File upload + listing + download ────────────────────────────────
  console.log('\n[5] File upload + list + download');
  const uploadSrc = path.join(tmpDir, 'e2e-upload.bin');
  const uploadContent = cryptoRandomBytes(1024 * 32);
  writeFileSync(uploadSrc, uploadContent);
  const upForm = new FormData();
  upForm.set('filename', 'e2e-upload.bin');
  upForm.set('size', String(uploadContent.length));
  upForm.set('file', new Blob([uploadContent]), 'e2e-upload.bin');
  const upRes = await fetch(`${baseUrl(host, port)}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: upForm,
  });
  check('upload returns 200', upRes.status === 200, `status=${upRes.status}`);
  const upJson = await upRes.json();
  check('upload reports expected sha256', upJson.sha256 === sha256Hex(uploadContent),
        `expected=${sha256Hex(uploadContent).slice(0, 12)} got=${upJson.sha256?.slice(0, 12)}`);
  check('upload reports expected size', upJson.size === uploadContent.length,
        `expected=${uploadContent.length} got=${upJson.size}`);

  const listRes = await getJson(`${baseUrl(host, port)}/api/files`, { Authorization: `Bearer ${token}` });
  check('list contains uploaded file', Array.isArray(listRes.json.files) &&
        listRes.json.files.some((f) => f.name === 'e2e-upload.bin' && f.size === uploadContent.length),
        `count=${listRes.json.files?.length}`);

  const fileEntry = listRes.json.files.find((f) => f.name === 'e2e-upload.bin');
  if (fileEntry) {
    const dlRes = await fetch(`${baseUrl(host, port)}/api/files/download/${fileEntry.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check('download returns 200', dlRes.status === 200, `status=${dlRes.status}`);
    const dlBuf = Buffer.from(await dlRes.arrayBuffer());
    check('download content matches upload',
          Buffer.compare(dlBuf, uploadContent) === 0,
          `upload=${uploadContent.length} download=${dlBuf.length}`);
  }

  // ── 6. Pair code reuse / wrong code enforcement ────────────────────────
  console.log('\n[6] Pair code one-time use');
  const reuse = await postJson(`${baseUrl(host, port)}/api/pair/complete`, {
    device_id: 'e2e-device-2',
    device_name: 'E2E Phone 2',
    pairing_code: freshCode,
  });
  check('reused code → 401', reuse.status === 401, `status=${reuse.status}`);
  const wrong = await postJson(`${baseUrl(host, port)}/api/pair/complete`, {
    device_id: 'e2e-device-3',
    device_name: 'E2E Phone 3',
    pairing_code: '000000',
  });
  check('wrong code → 401', wrong.status === 401, `status=${wrong.status}`);

  // ── 7. WebSocket signaling: hello + offer/answer roundtrip ─────────────
  console.log('\n[7] WebSocket signaling');
  const wsOk = await runWebSocketRoundtrip(host, wsPort, token);
  check('ws hello + offer + answer + ice roundtrip', wsOk, '');

  // ── 8. RPC roundtrip via stdin/stdout (mimics Electron Main) ──────────
  console.log('\n[8] RPC roundtrip over stdin/stdout');
  const rpc = await runRpcRoundtrip(proc);
  check('list_sessions returns ok=true', rpc.listSessionsOk, '');
  check('issue_pairing returns ok=true', rpc.issueOk, '');
  check('list_transfers returns ok=true', rpc.transfersOk, '');

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(`▶ summary: ${passed} passed, ${failed} failed`);
  killAndExit(proc, failed === 0 ? 0 : 1);
}

function baseUrl(host, port) {
  return `http://${host}:${port}`;
}

function killAndExit(proc, code) {
  try { proc.kill(); } catch { /* noop */ }
  setTimeout(() => process.exit(code), 200);
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers });
  let json = {};
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}

async function getJson(url, headers = {}) {
  return get(url, headers);
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}

function sha256Hex(buf) {
  // We delegate to Node's crypto to avoid pulling in extra deps.
  return nodeCrypto.createHash('sha256').update(buf).digest('hex');
}

function cryptoRandomBytes(n) {
  return nodeCrypto.randomBytes(n);
}

async function runWebSocketRoundtrip(host, port, token) {
  return await new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}:${port}/ws`, ['mycast', 'bearer', token]);
    let helloOk = false;
    let sessionOk = false;
    let offerOk = false;
    let answerOk = false;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* noop */ }
      resolve(helloOk && sessionOk && offerOk && answerOk && ok);
    };
    const timeout = setTimeout(() => finish(false), 5000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'hello', device_id: 'e2e-ws', device_name: 'E2E WS', platform: 'web',
      }));
    });
    ws.on('message', (raw) => {
      let f;
      try { f = JSON.parse(raw.toString()); } catch { return; }
      if (f.type === 'session_created') {
        sessionOk = true;
        // Drive an offer/answer roundtrip.
        ws.send(JSON.stringify({
          type: 'offer', session_id: f.session_id, sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
        }));
        ws.send(JSON.stringify({
          type: 'ice', session_id: f.session_id, candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host' },
        }));
      }
      if (f.type === 'webrtc.answer') {
        answerOk = true;
        finish(true);
      }
    });
    ws.on('error', () => { clearTimeout(timeout); finish(false); });
    ws.on('close', () => { clearTimeout(timeout); finish(false); });
  });
}

async function runRpcRoundtrip(proc) {
  return new Promise((resolve) => {
    let buf = '';
    let nextId = 100;
    const pending = new Map();
    const onLine = (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.id === 'number' && 'ok' in obj) {
          const p = pending.get(obj.id);
          if (p) {
            pending.delete(obj.id);
            clearTimeout(p.timer);
            p.resolve(obj);
          }
        }
      } catch { /* ignore */ }
    };
    const lines = createInterface({ input: proc.stdout });
    lines.on('line', onLine);
    function send(type) {
      return new Promise((res) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); res(null); }, 4000);
        pending.set(id, { resolve: res, timer });
        try { proc.stdin.write(JSON.stringify({ id, type }) + '\n'); } catch { /* noop */ }
      });
    }
    (async () => {
      const listSessions = await send('list_sessions');
      const issue = await send('issue_pairing');
      const transfers = await send('list_transfers');
      lines.removeListener('line', onLine);
      resolve({
        listSessionsOk: !!listSessions && listSessions.ok === true,
        issueOk: !!issue && issue.ok === true,
        transfersOk: !!transfers && transfers.ok === true,
      });
    })();
  });
}

main().catch((e) => {
  process.stderr.write(`✗ unhandled error: ${e.stack || e}\n`);
  process.exit(1);
});
