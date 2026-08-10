import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

interface WorkerResponse {
  id: string | number | null;
  result?: unknown;
  error?: { code: string; message: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function executablePath(): string {
  const executable = process.platform === 'win32' ? 'nwd-rag-worker.exe' : 'nwd-rag-worker';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'rag-worker', executable)]
    : [
        path.join(app.getAppPath(), 'native', 'rag-worker', 'target', 'release', executable),
        path.join(app.getAppPath(), 'native', 'rag-worker', 'target', 'debug', executable),
        path.join(process.cwd(), 'native', 'rag-worker', 'target', 'release', executable),
        path.join(process.cwd(), 'native', 'rag-worker', 'target', 'debug', executable),
      ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('RAG_WORKER_NOT_BUILT');
  return found;
}

export class RagWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, PendingRequest>();
  private sequence = 0;
  private stderr = '';

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const database = path.join(app.getPath('userData'), 'rag', 'rag.db');
    const child = spawn(executablePath(), [`--database=${database}`], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.stderr = '';
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => { this.stderr = `${this.stderr}${String(chunk)}`.slice(-4096); });
    child.on('error', (error) => this.failAll(error));
    child.on('close', (code) => {
      const detail = this.stderr.trim();
      this.child = null;
      this.failAll(new Error(detail || `RAG_WORKER_EXITED_${code ?? 'UNKNOWN'}`));
    });
    return child;
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;
    try { response = JSON.parse(line) as WorkerResponse; } catch { return; }
    if (typeof response.id !== 'number') return;
    const request = this.pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(response.id);
    if (response.error) request.reject(new Error(`${response.error.code}: ${response.error.message}`));
    else request.resolve(response.result);
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  async request<T = unknown>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    const child = this.ensureStarted();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RAG_WORKER_TIMEOUT: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async availability(): Promise<{ available: boolean; version?: string; schemaVersion?: number; error?: string }> {
    try {
      const result = await this.request<{ version: string; schemaVersion: number }>('ping', {}, 5_000);
      return { available: true, ...result };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    this.failAll(new Error('RAG_WORKER_DISPOSED'));
    child?.kill();
  }
}

export const ragWorkerClient = new RagWorkerClient();

