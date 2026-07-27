/**
 * TerminalManager — 管理 node-pty 终端实例的生命周期。
 *
 * 在主进程中运行，通过 IPC 与渲染进程的 xterm.js 通信。
 * 架构对标 VS Code：Renderer(xterm.js) ←IPC→ Main(node-pty) → OS PTY
 *
 * P6: 支持 profile 配置（自定义 shell/args/env）
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

/** 获取当前平台默认 shell */
function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || 'bash';
}

/** 创建一个新的终端会话 */
export function createSession(id: string, cwd?: string, profile?: TerminalProfile): TerminalSession {
  const existing = sessions.get(id);
  if (existing) return existing;

  const shell = profile?.shell || getDefaultShell();
  const shellArgs: string[] = profile?.args ?? (process.platform === 'win32' ? [] : []);
  const env = {
    ...process.env as { [key: string]: string },
    ...(profile?.env ?? {}),
  };

  const pty = spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || process.cwd(),
    env,
  });

  const session: TerminalSession = { id, pty, profile, title: profile?.name || 'Terminal' };
  sessions.set(id, session);

  pty.onExit(() => { sessions.delete(id); });
  return session;
}

/** 向指定终端写入数据 */
export function write(id: string, data: string): void {
  sessions.get(id)?.pty.write(data);
}

/** 调整终端尺寸 */
export function resize(id: string, cols: number, rows: number): void {
  sessions.get(id)?.pty.resize(cols, rows);
}

/** 销毁终端会话 */
export function destroySession(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.pty.kill();
    sessions.delete(id);
  }
}

/** 销毁所有终端会话 */
export function destroyAll(): void {
  for (const [id] of sessions) destroySession(id);
}

/** 获取指定会话 */
export function getSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}
