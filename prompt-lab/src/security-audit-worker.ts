import { parentPort } from 'node:worker_threads';
import { analyzeTypeScriptProject } from './core/security-audit/semantic-scanner';

interface Request { id: string; projectDir: string; files: string[]; networkPolicy: 'deny' | 'allow' }
parentPort?.on('message', (request: Request) => {
  try { const result = analyzeTypeScriptProject({ projectDir: request.projectDir, files: request.files, networkPolicy: request.networkPolicy, signal: new AbortController().signal, emit: () => undefined }); parentPort?.postMessage({ id: request.id, findings: result.findings }); }
  catch (error) { parentPort?.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
});
