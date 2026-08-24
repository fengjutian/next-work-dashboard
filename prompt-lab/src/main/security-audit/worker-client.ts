import path from 'node:path';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { SecurityFinding, SecurityScanner } from '../../core/security-audit';

type Pending = { resolve: (findings: SecurityFinding[]) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void };
let sharedWorker: Worker | null = null; const pending = new Map<string, Pending>();
function workerEntry(): string { const candidates = ['security-audit-worker.js', 'security-audit-worker.mjs'].map((file) => path.join(__dirname, file)); const entry = candidates.find((file) => fs.existsSync(file)); if (!entry) throw new Error('SECURITY_AUDIT_WORKER_NOT_BUILT'); return entry; }
function terminateWorker(error: Error): void { const worker = sharedWorker; sharedWorker = null; if (worker) void worker.terminate(); for (const item of pending.values()) { item.signal.removeEventListener('abort', item.abort); item.reject(error); } pending.clear(); }
function getWorker(): Worker {
  if (sharedWorker) return sharedWorker; const worker = new Worker(workerEntry()); sharedWorker = worker;
  worker.on('error', (error) => terminateWorker(error)); worker.on('exit', (code) => { if (sharedWorker === worker && code !== 0) terminateWorker(new Error(`SECURITY_AUDIT_WORKER_EXIT_${code}`)); });
  worker.on('message', (message: { id: string; findings?: SecurityFinding[]; error?: string }) => { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); item.signal.removeEventListener('abort', item.abort); if (message.error) item.reject(new Error(message.error)); else item.resolve(message.findings ?? []); }); return worker;
}

export const backgroundSemanticScanner: SecurityScanner = {
  id: 'semantic-analysis', name: 'TypeScript AST / Data-flow Analysis (Worker)',
  async detect(context) { return context.files.some((file) => /\.[cm]?[jt]sx?$/i.test(file)); },
  async scan(context) {
    const worker = getWorker(); const id = `semantic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<SecurityFinding[]>((resolve, reject) => {
      const abort = () => terminateWorker(new DOMException('Scan cancelled', 'AbortError')); pending.set(id, { resolve, reject, signal: context.signal, abort }); context.signal.addEventListener('abort', abort, { once: true });
      worker.postMessage({ id, projectDir: context.projectDir, files: context.files, networkPolicy: context.networkPolicy });
    });
  },
};
