// ── Agent Execution Environment Interface ──
// Abstraction over where agent code runs: local worktree, container, SSH remote, etc.

import fs from 'node:fs';
import path from 'node:path';
import { authorizeWorkspace, resolveWorkspacePath } from './workspace-path';
import { applyWorkspaceFileMutations } from './workspace-transaction';

export type ExecutionEnvState = "preparing" | "ready" | "running" | "disconnected" | "cleanup_failed" | "destroyed";

export interface ExecutionEnvStatus {
  state: ExecutionEnvState;
  id: string;
  label: string;
  startedAt: number;
  lastHeartbeat: number;
  error?: string;
}

export interface ExecutionEnv {
  readonly id: string;
  readonly type: string;

  /** Prepare the environment (build container, connect SSH, etc.) */
  prepare(): Promise<ExecutionEnvStatus>;

  /** Read a file from the environment */
  readFile(relativePath: string): Promise<{ content: string; encoding: string }>;

  /** Write files transactionally (all or nothing) */
  writeFiles(files: Array<{ path: string; content: string }>): Promise<void>;

  /** Run a shell command, stream output */
  runCommand(command: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }): AsyncIterable<{ stream: "stdout" | "stderr"; text: string }>;

  /** Cancel current operation */
  cancel(): void;

  /** Get current status */
  status(): ExecutionEnvStatus;

  /** Heartbeat to keep connection alive */
  heartbeat(): Promise<void>;

  /** Clean up resources (stop container, disconnect SSH, etc.) */
  destroy(): Promise<void>;
}

// ── Local Worktree Environment (default) ──

export function createLocalWorktreeEnv(
  worktreePath: string,
): ExecutionEnv {
  authorizeWorkspace(worktreePath);
  let state: ExecutionEnvState = "ready";
  let startedAt = Date.now();
  let lastHeartbeat = Date.now();
  let controller: AbortController | null = null;

  return {
    id: "local-" + worktreePath.replace(/[^a-zA-Z0-9]/g, "_"),
    type: "local-worktree",

    async prepare() {
      state = "ready";
      startedAt = Date.now();
      return this.status();
    },

    async readFile(relativePath: string) {
      const fullPath = resolveWorkspacePath(worktreePath, relativePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      return { content, encoding: "utf8" };
    },

    async writeFiles(files: Array<{ path: string; content: string }>) {
      const root = fs.realpathSync(worktreePath);
      for (const file of files) {
        const target = path.resolve(root, file.path);
        const relative = path.relative(root, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('ACCESS_DENIED');
        fs.mkdirSync(path.dirname(target), { recursive: true });
      }
      applyWorkspaceFileMutations(worktreePath, files.map((file) => ({
        kind: fs.existsSync(resolveWorkspacePath(worktreePath, file.path)) ? 'write' as const : 'create' as const,
        path: file.path,
        content: file.content,
      })));
    },

    async *runCommand(command: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }) {
      const { spawn } = await import("node:child_process");
      controller = new AbortController();
      const cwd = opts?.cwd ? resolveWorkspacePath(worktreePath, opts.cwd) : resolveWorkspacePath(worktreePath);
      const child = spawn(command, {
        cwd, shell: true, windowsHide: true,
        env: { ...process.env, ...opts?.env },
        signal: controller.signal,
        timeout: opts?.timeout ?? 300_000,
      });
      state = "running";
      child.stdout?.on("data", (chunk: Buffer) => {});
      child.stderr?.on("data", (chunk: Buffer) => {});
      try {
        for await (const chunk of child.stdout ?? []) {
          lastHeartbeat = Date.now();
          yield { stream: "stdout" as const, text: String(chunk) };
        }
      } finally {
        state = "ready";
        controller = null;
      }
    },

    cancel() { controller?.abort(); },

    status() { return { state, id: this.id, label: "Local Worktree", startedAt, lastHeartbeat }; },

    async heartbeat() { lastHeartbeat = Date.now(); },

    async destroy() {
      controller?.abort();
      state = "destroyed";
    },
  };
}

// ── Environment Registry ──

const envs = new Map<string, ExecutionEnv>();

export function registerExecutionEnv(env: ExecutionEnv): void {
  envs.set(env.id, env);
}

export function getExecutionEnv(id: string): ExecutionEnv | undefined {
  return envs.get(id);
}

export function listExecutionEnvs(): ExecutionEnv[] {
  return [...envs.values()];
}

export async function destroyAllEnvs(): Promise<void> {
  for (const env of envs.values()) {
    try { await env.destroy(); } catch {}
  }
  envs.clear();
}

// ── External Agent Provider Interface ──

export interface AgentProviderCapability {
  streaming: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportsMultiFile: boolean;
  supportsVision: boolean;
  supportsToolCalling: boolean;
}

export interface AgentProviderConfig {
  id: string;
  label: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export interface AgentProvider {
  readonly id: string;
  readonly capabilities: AgentProviderCapability;

  /** Stream a chat completion */
  chat(messages: Array<{ role: string; content: string }>, opts: {
    model: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<{ delta: string; finishReason?: string }>;

  /** Validate credentials */
  validate(): Promise<boolean>;

  /** List available models */
  listModels(): Promise<Array<{ id: string; name: string; contextWindow: number }>>;
}

const agentProviders = new Map<string, AgentProvider>();

export function registerAgentProvider(provider: AgentProvider): void {
  agentProviders.set(provider.id, provider);
}

export function getAgentProvider(id: string): AgentProvider | undefined {
  return agentProviders.get(id);
}

/** Wrap the existing OpenAI-compatible provider as an AgentProvider */
export function wrapLLMProvider(llmProvider: {
  id: string;
  chat(messages: any[], opts: any): AsyncIterable<{ delta: string; finishReason?: string | null }>;
  validate(): Promise<boolean>;
  listModels(): Promise<Array<{ id: string; name: string; contextWindow: number }>>;
}): AgentProvider {
  return {
    id: llmProvider.id,
    capabilities: { streaming: true, maxContextTokens: 128000, maxOutputTokens: 16000, supportsMultiFile: true, supportsVision: false, supportsToolCalling: false },
    chat: llmProvider.chat,
    validate: llmProvider.validate,
    listModels: llmProvider.listModels,
  };
}


// ── Orphan Resource Cleanup ──

const HEARTBEAT_TIMEOUT_MS = 60_000;
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Start heartbeat monitoring; auto-destroy env after timeout */
export function startHeartbeatMonitor(env: ExecutionEnv, onTimeout: (envId: string) => void): void {
  const existing = heartbeatTimers.get(env.id);
  if (existing) clearInterval(existing);
  const timer = setInterval(async () => {
    try {
      await env.heartbeat();
      const status = env.status();
      if (Date.now() - status.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        try { await env.destroy(); } catch {}
        clearInterval(timer);
        heartbeatTimers.delete(env.id);
        onTimeout(env.id);
      }
    } catch {
      // heartbeat failed — consider disconnected
      try { await env.destroy(); } catch {}
      clearInterval(timer);
      heartbeatTimers.delete(env.id);
      onTimeout(env.id);
    }
  }, 15_000);
  heartbeatTimers.set(env.id, timer);
}

/** Stop heartbeat monitoring */
export function stopHeartbeatMonitor(envId: string): void {
  const timer = heartbeatTimers.get(envId);
  if (timer) { clearInterval(timer); heartbeatTimers.delete(envId); }
}

/** Clean up all heartbeat timers */
export function stopAllHeartbeatMonitors(): void {
  for (const [id, timer] of heartbeatTimers) { clearInterval(timer); }
  heartbeatTimers.clear();
}
