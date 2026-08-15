import { spawn } from 'node:child_process';

export type ExternalScannerCommand = 'semgrep' | 'gitleaks' | 'osv-scanner' | 'trivy';
const ALLOWED_COMMANDS = new Set<ExternalScannerCommand>(['semgrep', 'gitleaks', 'osv-scanner', 'trivy']);
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export interface ExternalProcessResult { exitCode: number; stdout: string; stderr: string }

export function runScannerProcess(command: ExternalScannerCommand, args: string[], cwd: string, signal: AbortSignal, timeoutMs = 120_000): Promise<ExternalProcessResult> {
  if (!ALLOWED_COMMANDS.has(command)) return Promise.reject(new Error('SCANNER_NOT_ALLOWED'));
  if (args.some((arg) => arg.includes('\0'))) return Promise.reject(new Error('INVALID_SCANNER_ARGUMENT'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        HOME: process.env.HOME,
        NO_COLOR: '1',
        CI: 'true',
      },
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, result?: ExternalProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error('SCANNER_NO_RESULT'));
    };
    const abort = (): void => { child.kill(); finish(new DOMException('Scan cancelled', 'AbortError')); };
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('SCANNER_OUTPUT_LIMIT'));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('error', (error) => finish(error));
    child.once('close', (code) => finish(undefined, { exitCode: code ?? -1, stdout, stderr }));
    const timer = setTimeout(() => { child.kill(); finish(new Error('SCANNER_TIMEOUT')); }, timeoutMs);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

export async function commandAvailable(command: ExternalScannerCommand): Promise<boolean> {
  try {
    const result = await runScannerProcess(command, ['--version'], process.cwd(), new AbortController().signal, 5_000);
    return result.exitCode === 0;
  } catch { return false; }
}
