// Simulate Electron Main's spawn + JSONL RPC behavior.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(__dirname, '..', 'resources', 'mycast', process.platform === 'win32' ? 'nwd-mycast.exe' : 'nwd-mycast');

console.log('[test] spawning', bin);
const child = spawn(bin, ['daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => { stderr += String(d); });

const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  console.log('[stdout]', line);
});

const pending = new Map();
let nextId = 1;
lines.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const obj = JSON.parse(line);
    if (typeof obj.id === 'number' && 'ok' in obj) {
      const p = pending.get(obj.id);
      if (p) {
        pending.delete(obj.id);
        clearTimeout(p.timer);
        if (obj.ok === false) p.reject(new Error(obj.error || 'rpc error'));
        else p.resolve(obj);
      }
    }
  } catch (_) { /* ignore non-JSONL */ }
});

function send(payload) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const line = JSON.stringify({ id, ...payload });
    console.log('[stdin ]', line);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rpc timeout: ${payload.type}`));
    }, 6000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(line + '\n');
  });
}

async function main() {
  // Wait for ready
  await new Promise((r) => setTimeout(r, 2500));
  console.log('[test] sending list_sessions');
  try {
    const r = await send({ type: 'list_sessions' });
    console.log('[test] list_sessions OK:', JSON.stringify(r).slice(0, 200));
  } catch (e) {
    console.log('[test] list_sessions FAIL:', e.message);
  }
  console.log('[test] sending issue_pairing');
  try {
    const r = await send({ type: 'issue_pairing' });
    console.log('[test] issue_pairing OK:', JSON.stringify(r).slice(0, 200));
  } catch (e) {
    console.log('[test] issue_pairing FAIL:', e.message);
  }
  console.log('[test] sending list_transfers');
  try {
    const r = await send({ type: 'list_transfers' });
    console.log('[test] list_transfers OK:', JSON.stringify(r).slice(0, 200));
  } catch (e) {
    console.log('[test] list_transfers FAIL:', e.message);
  }
  console.log('[test] stderr total:', stderr.length, 'bytes');
  console.log('[test] stderr tail:', stderr.slice(-500));
  child.kill();
  process.exit(0);
}

main();
