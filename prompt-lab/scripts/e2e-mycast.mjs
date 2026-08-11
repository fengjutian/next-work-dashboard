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
// end. Requires `ws` to be installed (devDependency) and the sidecar binary
// at `resources/mycast/nwd-mycast[.exe]`.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const exe = isWindows ? 'nwd-mycast.exe' : 'nwd-mycast';
const bin = path.join(root, 'resources', 'mycast', exe);

if (!existsSync(bin)) {
  console.error(`✗ binary not found at ${bin}; run: npm run build:mycast`);
  process.exit(1);
}

const tmpDir = path.join(root, '.cache', 'e2e-mycast');
mkdirSync(tmpDir, { recursive: true });
const stderrLog = path.join(tmpDir, 'stderr.log');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

async function main() {
  console.log(`▶ e2e-mycast — binary: ${bin}`);
  console.log(`  cwd: ${root}`);
  console.log('');

  // ── 1. Spawn the sidecar and wait for ready ────────────────────────────
  // Use non-default ports so we never collide with an Electron-managed
  // sidecar the developer may have running on the standard 17890/17891.
  console.log('[1] spawn sidecar + await ready');
  const proc = spawn(bin, [
    'daemon',
    '--http-port', '27890',
    '--ws-port',   '27891',
    '--no-mdns',
    '--device-name', 'E2E Sidecar',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => writeFileSync(stderrLog, d, { flag: 'a' }));

  // Single stdout reader. Dispatches by `type`:
  //   - "ready" event → boots the test
  //   - numbered id → RPC response → resolves pending RPC promises
  //   - other events (webrtc.offer, session.created, ...) → fan-out to subscribers
  let ready = null;
  let rpcReady = null;
  const readyPromise = new Promise((res) => { rpcReady = res; });
  const rpcPending = new Map();
  let rpcNextId = 1;
  const eventSubs = new Set();
  const stdoutReader = createInterface({ input: proc.stdout });
  stdoutReader.on('line', (line) => {
    if (!line.trim()) return;
    let obj;
    try { obj = JSON.parse(line); } catch { return; }
    if (obj.type === 'ready') { ready = obj; rpcReady(obj); return; }
    if (typeof obj.id === 'number' && 'ok' in obj) {
      const p = rpcPending.get(obj.id);
      if (p) { rpcPending.delete(obj.id); clearTimeout(p.timer); p.resolve(obj); }
      return;
    }
    for (const sub of eventSubs) sub(obj);
  });

  const got = await Promise.race([
    readyPromise,
    sleep(6000).then(() => null),
  ]);
  check('ready event', !!got, got ? `device=${got.device_name} lan=${got.lan_addr}` : 'timed out');
  if (!got) { proc.kill(); process.exit(1); }
  const info = got;
  const port = info.http_port;
  const wsPort = info.ws_port;
  const host = info.lan_addr || '127.0.0.1';
  check('lan_addr present', !!info.lan_addr, info.lan_addr);
  check('pair_code present only on local RPC ready event', !!info.pair_code, info.pair_code);

  // Helper: send an RPC and await the matching response.
  function sendRpc(type, payload = {}) {
    return new Promise((resolve) => {
      const id = rpcNextId++;
      const timer = setTimeout(() => { rpcPending.delete(id); resolve(null); }, 4000);
      rpcPending.set(id, { resolve, timer });
      try { proc.stdin.write(JSON.stringify({ id, type, ...payload }) + '\n'); } catch { resolve(null); }
    });
  }

  // ── 2. HTTP /api/info ───────────────────────────────────────────────────
  console.log('\n[2] HTTP /api/info');
  const info2 = await get(`${baseUrl(host, port)}/api/info`);
  check('returns 200 + device_id', info2.status === 200 && !!info2.json.device_id,
        `status=${info2.status} device_id=${info2.json.device_id}`);

  // ── 3. Pair flow ───────────────────────────────────────────────────────
  console.log('\n[3] local RPC issue_pairing + /api/pair/complete');
  check('/api/info does not expose pair_code', !('pair_code' in info2.json), '');
  check('/api/info does not expose sessions', !('sessions' in info2.json), '');
  const anonymousPairRequest = await postJson(`${baseUrl(host, port)}/api/pair/request`, {
    device_id: 'attacker', device_name: 'Attacker', platform: 'web',
  });
  check('remote pair issuance is disabled', anonymousPairRequest.status === 404, `status=${anonymousPairRequest.status}`);
  const issuedPairing = await sendRpc('issue_pairing');
  const freshCode = issuedPairing?.data?.pair_code ?? issuedPairing?.pair_code;
  check('local RPC issues pair_code', !!freshCode, freshCode);
  const pairComplete = await postJson(`${baseUrl(host, port)}/api/pair/complete`, {
    device_id: 'e2e-ws',
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
  const anonymousSessions = await get(`${baseUrl(host, port)}/api/sessions`);
  check('unauthenticated /api/sessions → 401', anonymousSessions.status === 401, `status=${anonymousSessions.status}`);
  const anonymousWsRejected = await openWebSocketWithoutToken(host, port);
  check('unauthenticated WebSocket rejected', anonymousWsRejected, '');

  // ── 5. File upload + listing + download ────────────────────────────────
  console.log('\n[5] File upload + list + download');
  const uploadContent = randomBytes(1024 * 32);
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

  const listRes = await get(`${baseUrl(host, port)}/api/files`, { Authorization: `Bearer ${token}` });
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

  // ── 7. WebSocket signaling: hello + offer → answer roundtrip ────────────
  // The sidecar is a relay: phone sends offer → desktop receives `webrtc.offer`
  // event on stdout → desktop pushes `Answer` frame back via `send_to_phone` RPC.
  // Note: WS is served on the same port as HTTP (single axum server). The
  // `ws_port` field in the ready event is an advertised label only.
  console.log('\n[7] WebSocket signaling');
  const wsOk = await runWebSocketRoundtrip(host, port, token, sendRpc, eventSubs);
  check('ws hello + offer → answer roundtrip', wsOk, '');

  // ── 8. RPC roundtrip over stdin/stdout (mimics Electron Main) ──────────
  console.log('\n[8] RPC roundtrip over stdin/stdout');
  const listSessions = await sendRpc('list_sessions');
  const issue = await sendRpc('issue_pairing');
  const transfers = await sendRpc('list_transfers');
  check('list_sessions returns ok=true', !!listSessions && listSessions.ok === true, '');
  check('issue_pairing returns ok=true', !!issue && issue.ok === true, '');
  check('list_transfers returns ok=true', !!transfers && transfers.ok === true, '');

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(`▶ summary: ${passed} passed, ${failed} failed`);
  try { proc.kill(); } catch { /* noop */ }
  setTimeout(() => process.exit(failed === 0 ? 0 : 1), 200);
}

function baseUrl(host, port) {
  return `http://${host}:${port}`;
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers });
  let json = {};
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
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
  return createHash('sha256').update(buf).digest('hex');
}

async function runWebSocketRoundtrip(host, port, sessionToken, sendRpc, eventSubs) {
  return await new Promise((resolve) => {
    const phoneDeviceId = 'e2e-ws';
    // Pass the session token via Authorization header. The sidecar's
    // ws_upgrade handler validates it against the live token table.
    const ws = new WebSocket(`ws://${host}:${port}/ws`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    let helloOk = false;
    let offerSent = false;
    let answerOk = false;
    let done = false;
    const cleanup = () => { eventSubs.delete(sub); };
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      cleanup();
      try { ws.close(); } catch { /* noop */ }
      resolve(helloOk && offerSent && answerOk && ok);
    };
    const timeout = setTimeout(() => finish(false), 8000);

    // Subscribe to sidecar events. When we see `webrtc.offer` for this
    // phone device, push an `Answer` frame back via the `send_to_phone` RPC.
    const sub = (event) => {
      if (event.type === 'webrtc.offer' && event.phone_device_id === phoneDeviceId) {
        const sessionId = event.session_id;
        sendRpc('send_to_phone', {
          device_id: phoneDeviceId,
          frame: {
            type: 'answer',
            session_id: sessionId,
            sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
          },
        });
      }
    };
    eventSubs.add(sub);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        device_id: phoneDeviceId,
        device_name: 'E2E WS',
        platform: 'web',
      }));
      helloOk = true;
      // After the WS is open and hello registered, send create_session + offer.
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'create_session',
          session_id: 'e2e-session-1',
          kind: 'screen',
        }));
        ws.send(JSON.stringify({
          type: 'offer',
          session_id: 'e2e-session-1',
          sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
        }));
        offerSent = true;
      }, 100);
    });
    ws.on('message', (raw) => {
      let f;
      try { f = JSON.parse(raw.toString()); } catch { return; }
      if (f.type === 'answer') {
        answerOk = true;
        finish(true);
      }
    });
    ws.on('error', () => finish(false));
    ws.on('close', () => finish(false));
  });
}

async function openWebSocketWithoutToken(host, port) {
  return await new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}:${port}/ws`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 2000);
    ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(false); });
    ws.on('unexpected-response', (_request, response) => { clearTimeout(timer); resolve(response.statusCode === 401); });
    ws.on('error', () => { clearTimeout(timer); resolve(true); });
  });
}

main().catch((e) => {
  console.error(`✗ unhandled error: ${e.stack || e}`);
  process.exit(1);
});
