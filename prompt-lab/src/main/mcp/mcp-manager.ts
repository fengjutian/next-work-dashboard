import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { deleteToken, getToken } from '../../auth/token-store';
import { resolveSecretReferences } from '../../plugins/terminal/backend/environment';
import { validateMcpServerConfig } from './mcp-config';
import type {
  McpAuditRecord,
  McpOperationResult,
  McpServerConfig,
  McpServerStatus,
  McpToolCallResult,
  McpToolDescriptor,
} from '../../types/mcp';

interface ActiveConnection {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: McpToolDescriptor[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processEnvironment(extra?: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return { ...inherited, ...extra };
}

export class McpManager {
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly connecting = new Map<string, Promise<McpOperationResult>>();
  private readonly states = new Map<string, { state: McpServerStatus['state']; error?: string }>();

  private configPath(): string {
    return path.join(app.getPath('userData'), 'mcp-servers.json');
  }

  private auditPath(): string {
    return path.join(app.getPath('userData'), 'mcp-audit.jsonl');
  }

  private appendAudit(record: McpAuditRecord): void {
    fs.mkdirSync(path.dirname(this.auditPath()), { recursive: true });
    fs.appendFileSync(this.auditPath(), `${JSON.stringify(record)}\n`, 'utf8');
  }

  listAudit(limit = 100): McpAuditRecord[] {
    if (!fs.existsSync(this.auditPath())) return [];
    return fs.readFileSync(this.auditPath(), 'utf8').trim().split(/\r?\n/).filter(Boolean)
      .slice(-Math.max(1, Math.min(limit, 500))).reverse().flatMap((line) => {
        try { return [JSON.parse(line) as McpAuditRecord]; } catch { return []; }
      });
  }

  clearAudit(): McpOperationResult {
    if (fs.existsSync(this.auditPath())) fs.writeFileSync(this.auditPath(), '', 'utf8');
    return { success: true };
  }

  recordDenial(serverId: string, toolName: string, args: Record<string, unknown>): void {
    this.appendAudit({ id: randomUUID(), serverId, toolName, arguments: args, startedAt: Date.now(), durationMs: 0, status: 'denied' });
  }

  listConfigs(): McpServerConfig[] {
    const file = this.configPath();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { servers?: McpServerConfig[] };
      return (parsed.servers ?? []).filter((config) => config.transport === 'stdio' || config.transport === 'streamable-http');
    } catch {
      return [];
    }
  }

  saveConfig(config: McpServerConfig): McpOperationResult {
    const validationError = validateMcpServerConfig(config);
    if (validationError) return { success: false, error: validationError };
    const configs = this.listConfigs();
    const index = configs.findIndex((item) => item.id === config.id);
    const normalized: McpServerConfig = config.transport === 'stdio'
      ? { ...config, name: config.name.trim(), command: config.command.trim() }
      : { ...config, name: config.name.trim(), url: config.url.trim() };
    if (index >= 0) configs[index] = normalized;
    else configs.push(normalized);
    fs.mkdirSync(path.dirname(this.configPath()), { recursive: true });
    fs.writeFileSync(this.configPath(), `${JSON.stringify({ servers: configs }, null, 2)}\n`, 'utf8');
    return { success: true };
  }

  async removeConfig(serverId: string): Promise<McpOperationResult> {
    await this.disconnect(serverId);
    deleteToken(`mcp-http-${serverId}`);
    const servers = this.listConfigs().filter((item) => item.id !== serverId);
    fs.writeFileSync(this.configPath(), `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
    this.states.delete(serverId);
    return { success: true };
  }

  listStatuses(): McpServerStatus[] {
    return this.listConfigs().map((config) => ({
      config,
      state: this.states.get(config.id)?.state ?? 'disconnected',
      error: this.states.get(config.id)?.error,
      toolCount: this.connections.get(config.id)?.tools.length ?? 0,
    }));
  }

  async connect(serverId: string): Promise<McpOperationResult> {
    if (this.connections.has(serverId)) return { success: true };
    const pending = this.connecting.get(serverId);
    if (pending) return pending;
    const operation = this.openConnection(serverId).finally(() => this.connecting.delete(serverId));
    this.connecting.set(serverId, operation);
    return operation;
  }

  private async openConnection(serverId: string): Promise<McpOperationResult> {
    const config = this.listConfigs().find((item) => item.id === serverId);
    if (!config) return { success: false, error: `Unknown MCP server: ${serverId}` };
    this.states.set(serverId, { state: 'connecting' });
    const client = new Client({ name: 'next-work-dashboard', version: '0.1.0' });
    const transport = config.transport === 'stdio'
      ? new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        cwd: config.cwd,
        env: resolveSecretReferences(processEnvironment(config.env), getToken),
        stderr: 'pipe',
      })
      : new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: resolveSecretReferences(config.headers ?? {}, getToken) },
      });
    try {
      await client.connect(transport, { timeout: Math.max(1_000, Math.min(config.connectionTimeoutMs ?? 15_000, 120_000)) });
      const tools: McpToolDescriptor[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools.map((tool) => ({
          serverId,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
          annotations: tool.annotations,
          trustAnnotations: config.trustAnnotations === true,
        })));
        cursor = page.nextCursor;
      } while (cursor);
      this.connections.set(serverId, { client, transport, tools });
      this.states.set(serverId, { state: 'connected' });
      client.onerror = (error) => this.states.set(serverId, { state: 'error', error: error.message });
      client.onclose = () => {
        this.connections.delete(serverId);
        if (this.states.get(serverId)?.state !== 'error') this.states.set(serverId, { state: 'disconnected' });
      };
      return { success: true };
    } catch (error) {
      await client.close().catch(() => undefined);
      const message = errorMessage(error);
      this.states.set(serverId, { state: 'error', error: message });
      return { success: false, error: message };
    }
  }

  async disconnect(serverId: string): Promise<McpOperationResult> {
    await this.connecting.get(serverId)?.catch(() => undefined);
    const connection = this.connections.get(serverId);
    if (connection?.transport instanceof StreamableHTTPClientTransport) await connection.transport.terminateSession().catch(() => undefined);
    if (connection) await connection.client.close().catch(() => undefined);
    this.connections.delete(serverId);
    this.states.set(serverId, { state: 'disconnected' });
    return { success: true };
  }

  listTools(serverId?: string): McpToolDescriptor[] {
    if (serverId) return [...(this.connections.get(serverId)?.tools ?? [])];
    return [...this.connections.values()].flatMap((connection) => connection.tools);
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const connection = this.connections.get(serverId);
    if (!connection) throw new Error(`MCP server is not connected: ${serverId}`);
    if (!connection.tools.some((tool) => tool.name === name)) throw new Error(`Unknown MCP tool: ${serverId}/${name}`);
    const startedAt = Date.now();
    try {
      const result = await connection.client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
      const normalized: McpToolCallResult = {
        isError: result.isError === true,
        content: result.content as unknown[],
        structuredContent: result.structuredContent as Record<string, unknown> | undefined,
      };
      this.appendAudit({ id: randomUUID(), serverId, toolName: name, arguments: args, startedAt, durationMs: Date.now() - startedAt, status: normalized.isError ? 'failed' : 'success', resultPreview: JSON.stringify(normalized.content).slice(0, 500) });
      return normalized;
    } catch (error) {
      this.appendAudit({ id: randomUUID(), serverId, toolName: name, arguments: args, startedAt, durationMs: Date.now() - startedAt, status: 'failed', error: errorMessage(error) });
      throw error;
    }
  }

  async connectAutoServers(): Promise<void> {
    await Promise.all(this.listConfigs().filter((config) => config.autoConnect).map((config) => this.connect(config.id)));
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.connecting.values());
    await Promise.all([...this.connections.keys()].map((serverId) => this.disconnect(serverId)));
  }
}

export const mcpManager = new McpManager();
