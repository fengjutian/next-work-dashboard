export interface McpStdioServerConfig {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  autoConnect?: boolean;
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
