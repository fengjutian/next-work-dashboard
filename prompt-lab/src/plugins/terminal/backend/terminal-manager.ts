/**
 * TerminalManager — 管理 node-pty 终端实例的生命周期。
 *
 * 主进程运行，通过 IPC 与渲染进程 xterm.js 通信。
 * 架构对标 VS Code：Renderer(xterm.js) ←IPC→ Main(node-pty) → OS PTY
 */

import { spawn, IPty } from 'node-pty';

export interface TerminalSession {
  id: string;
  pty: IPty;
  title: string;
  profile?: TerminalProfile;
}

export interface TerminalProfile {
  name: string;
  shell: string;
  args?: string[];
  env?: Record<string, string>;
}

const sessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

export function createSession(id: string, cwd?: string, profile?: TerminalProfile): TerminalSession {
  const existing = sessions.get(id);
  if (existing) return existing;

  const shell = profile?.shell || getDefaultShell();
  const shellArgs: string[] = profile?.args ?? [];
  const env = { ...process.env as Record<string, string>, ...(profile?.env ?? {}), TERM: 'xterm-256color' };

  const pty = spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 80, rows: 24,
    cwd: cwd || process.cwd(),
    env,
  });

  const session: TerminalSession = { id, pty, profile, title: profile?.name || 'Terminal' };
  sessions.set(id, session);
  pty.onExit(() => { sessions.delete(id); });
  return session;
}

export function write(id: string, data: string): void { sessions.get(id)?.pty.write(data); }
export function resize(id: string, cols: number, rows: number): void { sessions.get(id)?.pty.resize(cols, rows); }
export function destroySession(id: string): void { sessions.get(id)?.pty.kill(); sessions.delete(id); }
export function destroyAll(): void { for (const [id] of sessions) destroySession(id); }
export function getSession(id: string): TerminalSession | undefined { return sessions.get(id); }
