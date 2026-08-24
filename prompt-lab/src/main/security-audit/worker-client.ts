import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { SecurityFinding, SecurityScanner } from '../../core/security-audit';

export const backgroundSemanticScanner: SecurityScanner = {
  id: 'semantic-analysis', name: 'TypeScript AST / Data-flow Analysis (Worker)',
  async detect(context) { return context.files.some((file) => /\.[cm]?[jt]sx?$/i.test(file)); },
  async scan(context) {
    const worker = new Worker(path.join(__dirname, 'security-audit-worker.js')); const id = `semantic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<SecurityFinding[]>((resolve, reject) => {
      const abort = () => { void worker.terminate(); reject(new DOMException('Scan cancelled', 'AbortError')); }; context.signal.addEventListener('abort', abort, { once: true });
      worker.once('error', reject); worker.on('message', (message: { id: string; findings?: SecurityFinding[]; error?: string }) => { if (message.id !== id) return; context.signal.removeEventListener('abort', abort); void worker.terminate(); if (message.error) reject(new Error(message.error)); else resolve(message.findings ?? []); });
      worker.postMessage({ id, projectDir: context.projectDir, files: context.files, networkPolicy: context.networkPolicy });
    });
  },
};
