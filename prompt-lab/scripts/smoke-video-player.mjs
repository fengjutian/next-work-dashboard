/**
 * smoke-video-player.mjs — 视频播放器 IPC 链路烟测
 *
 * 启动 mpv，连接 IPC server，按 V2 关键路径发送命令，验证 mpv 响应符合预期。
 * 不需要真实视频文件——只验证 IPC + JSON-RPC + 命令路由。
 *
 * 用法：
 *   node scripts/smoke-video-player.mjs
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function findMpv() {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv';
  const candidates = [
    path.join(projectRoot, 'resources', 'video-player', 'win32', exe),
    path.join(projectRoot, 'resources', 'video-player', 'darwin', exe),
    path.join(projectRoot, 'resources', 'video-player', 'linux', exe),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const mpvBin = findMpv();
if (!mpvBin) {
  console.error('未找到 mpv 二进制（resources/video-player/<platform>/mpv(.exe)）');
  console.error('先跑：npm run fetch:mpv');
  process.exit(1);
}

const pipeName = process.platform === 'win32'
  ? `\\\\.\\pipe\\nwd-mpv-smoke-${process.pid}-${Date.now()}`
  : path.join(os.tmpdir(), `nwd-mpv-smoke-${process.pid}-${Date.now()}.sock`);

console.log(`[smoke] mpv: ${mpvBin}`);
console.log(`[smoke] pipe: ${pipeName}`);

// 在 Windows 上用 array + 不带 shell:true（Node v24 行为）。
// shell:true 会在 named pipe 反斜杠上出问题。
const child = spawn(mpvBin, [
  '--no-config',
  '--idle=yes',
  '--keep-open=always',
  '--pause',
  '--no-border',
  '--vo=gpu',
  '--ao=auto',
  '--msg-level=all=info,ipc=v',
  `--input-ipc-server=${pipeName}`,
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

// 等 mpv 真的 listen 后再连接
const ready = new Promise((resolve) => {
  const onData = (chunk) => {
    if (chunk.toString('utf8').includes('Listening to IPC pipe')) {
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      setTimeout(resolve, 100);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  setTimeout(resolve, 4000);
});
await ready;

child.stderr?.on('data', (chunk) => {
  process.stderr.write(`[mpv-stderr] ${chunk.toString('utf8')}`);
});
child.stdout?.on('data', (chunk) => {
  process.stderr.write(`[mpv-stdout] ${chunk.toString('utf8')}`);
});
child.on('exit', (code, signal) => {
  console.log(`[smoke] mpv exited code=${code} signal=${signal}`);
});
child.on('error', (err) => {
  console.log(`[smoke] mpv error: ${err.message}`);
});

let requestId = 0;
const pending = new Map();

const socket = net.connect(pipeName);
let buffer = '';
let connected = false;

await new Promise((resolve, reject) => {
  socket.once('connect', () => {
    connected = true;
    resolve();
  });
  socket.once('error', (err) => reject(err));
  setTimeout(() => reject(new Error('connect timeout')), 5000);
});
console.log('[smoke] ✓ 连接到 mpv IPC server');

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) handleLine(line);
  }
});

socket.on('error', (err) => {
  console.error('[smoke] socket error:', err.message);
});

function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof msg.request_id === 'number') {
    const p = pending.get(msg.request_id);
    if (p) {
      pending.delete(msg.request_id);
      clearTimeout(p.timer);
      if (msg.error === 'success') p.resolve(msg.data);
      else p.reject(new Error(msg.error));
    }
  } else if (msg.event) {
    console.log(`[smoke] event: ${msg.event}${msg.name ? ` (${msg.name}=${JSON.stringify(msg.data)})` : ''}`);
  }
}

function command(args, timeoutMs = 3000) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${JSON.stringify(args)}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.write(JSON.stringify({ command: args, request_id: id }) + '\n');
  });
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    const result = await fn();
    if (result === false) {
      console.log(`[smoke] ✗ ${name}`);
      failed += 1;
    } else {
      console.log(`[smoke] ✓ ${name}` + (result !== undefined ? ` (${JSON.stringify(result)})` : ''));
      passed += 1;
    }
  } catch (err) {
    console.log(`[smoke] ✗ ${name}: ${err.message}`);
    failed += 1;
  }
}

console.log('\n[smoke] 测试命令…');

await check('get_property pause', async () => {
  const r = await command(['get_property', 'pause']);
  return r === false;
});

await check('set_property pause = true', async () => {
  await command(['set_property', 'pause', true]);
  const r = await command(['get_property', 'pause']);
  return r === true;
});

await check('set_property pause = false', async () => {
  await command(['set_property', 'pause', false]);
  const r = await command(['get_property', 'pause']);
  return r === false;
});

await check('set_property volume = 75', async () => {
  await command(['set_property', 'volume', 75]);
  const r = await command(['get_property', 'volume']);
  return r === 75;
});

await check('set_property speed = 1.5', async () => {
  await command(['set_property', 'speed', 1.5]);
  const r = await command(['get_property', 'speed']);
  return Math.abs(r - 1.5) < 0.01;
});

await check('observe_property (id=1, name=time-pos)', async () => {
  await command(['observe_property', 1, 'time-pos']);
  return true;
});

await check('cycle audio track (无媒体应 no-op)', async () => {
  // 没有加载文件，cycle 应该 no-op 或返回错误
  try {
    await command(['cycle', 'audio']);
    return true; // 命令成功即视为 OK
  } catch {
    return false;
  }
});

await check('loadfile / __none__ (loadfile invalid path)', async () => {
  // 故意加载一个不存在的文件，验证错误处理不崩
  try {
    await command(['loadfile', '__nonexistent__', 'replace']);
    return true;
  } catch (err) {
    return /failed|error/i.test(err.message);
  }
});

await check('quit mpv', async () => {
  await command(['quit']);
  return true;
});

console.log(`\n[smoke] 总结：${passed} 通过 / ${failed} 失败`);

// 等 mpv 退出
await new Promise((resolve) => {
  if (child.exitCode !== null) resolve();
  else child.once('exit', () => resolve());
});

socket.destroy();
if (process.platform !== 'win32') {
  try { fs.unlinkSync(pipeName); } catch {}
}

process.exit(failed > 0 ? 1 : 0);
