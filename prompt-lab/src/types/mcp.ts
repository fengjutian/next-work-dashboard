export interface McpStdioServerConfig {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  autoConnect?: boolean;
  trustAnnotations?: boolean;
}

export type McpServerConfig = McpStdioServerConfig;
export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerStatus {
  config: McpServerConfig;
  state: McpConnectionState;
  error?: string;
  toolCount: number;
}

export interface McpToolDescriptor {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  trustAnnotations: boolean;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpAuditRecord {
  id: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  startedAt: number;
  durationMs: number;
  status: 'success' | 'failed' | 'denied';
  resultPreview?: string;
  error?: string;
}

export interface McpToolCallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

export interface McpOperationResult {
  success: boolean;
  error?: string;
}
