import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface AgentScriptResult {
  script: string;
  command: string;
  output: string;
  exitCode: number;
  startedAt: number;
  endedAt: number;
}

export interface AgentScriptRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

const SAFE_ENV_NAMES = [
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR',
  'TEMP', 'TMP', 'COMSPEC', 'ComSpec', 'LANG', 'LC_ALL',
] as const;

export function buildAgentProcessEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SAFE_ENV_NAMES) if (source[name] !== undefined) env[name] = source[name];
  env.CI = 'true';
  env.NO_COLOR = '1';
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  return env;
}

export function loadPackageScripts(rootPath: string): Record<string, string> {
  const packagePath = path.join(rootPath, 'package.json');
  if (!fs.existsSync(packagePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: unknown };
  if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return {};
  return Object.fromEntries(Object.entries(parsed.scripts).filter((entry): entry is [string, string] => (
    Boolean(entry[0]) && typeof entry[1] === 'string'
  )));
}

export function validateAgentScriptName(script: string, scripts: Record<string, string>): string {
  const value = script.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/.test(value)) throw new Error('INVALID_AGENT_SCRIPT');
  if (!Object.prototype.hasOwnProperty.call(scripts, value)) throw new Error('AGENT_SCRIPT_NOT_FOUND');
  return value;
}

export async function runAgentPackageScript(rootPath: string, script: string, options: AgentScriptRunnerOptions = {}): Promise<AgentScriptResult> {
  const scripts = loadPackageScripts(rootPath);
  const safeScript = validateAgentScriptName(script, scripts);
  const timeoutMs = Math.max(1000, Math.min(600_000, Math.floor(options.timeoutMs ?? 120_000)));
  const maxOutputBytes = Math.max(1024, Math.min(10 * 1024 * 1024, Math.floor(options.maxOutputBytes ?? 2 * 1024 * 1024)));
  const windows = (options.platform ?? process.platform) === 'win32';
  const executable = windows ? (options.environment?.ComSpec ?? options.environment?.COMSPEC ?? process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe') : 'npm';
  const args = windows ? ['/d', '/s', '/c', `npm run ${safeScript}`] : ['run', safeScript];
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: rootPath,
      env: buildAgentProcessEnv(options.environment),
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join(stderr ? '\n[stderr]\n' : '').slice(0, maxOutputBytes);
      if (error) {
        if ((error as NodeJS.ErrnoException & { killed?: boolean }).killed) reject(new Error('AGENT_SCRIPT_TIMEOUT'));
        else if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(new Error('AGENT_SCRIPT_OUTPUT_LIMIT'));
        else reject(new Error(`AGENT_SCRIPT_FAILED:${error.code ?? 1}\n${output}`));
        return;
      }
      resolve({ script: safeScript, command: scripts[safeScript], output, exitCode: 0, startedAt, endedAt: Date.now() });
    });
  });
}
