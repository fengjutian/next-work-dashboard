import type { McpToolCallResult, McpToolDescriptor } from '@/types/mcp';
import type { ToolDefinition, ToolParameterSchema } from './types';
import { listTools, registerTools, unregisterTool } from './registry';
import { requestMcpApproval } from '@/services/mcp-approval';

const MCP_PREFIX = 'mcp__';

function toolName(serverId: string, name: string): string {
  return `${MCP_PREFIX}${serverId}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function resultText(result: McpToolCallResult): string {
  const parts = result.content.map((content) => {
    if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text;
    return JSON.stringify(content);
  });
  if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const output = parts.filter(Boolean).join('\n');
  if (result.isError) throw new Error(output || 'MCP tool reported an error');
  return output;
}

export function toMcpToolDefinition(tool: McpToolDescriptor): ToolDefinition {
  return {
    name: toolName(tool.serverId, tool.name),
    description: `[MCP: ${tool.serverId}] ${tool.description ?? tool.name}`,
    parameters: tool.inputSchema as ToolParameterSchema,
    execute: async (args) => {
      const trustedReadOnly = tool.trustAnnotations && tool.annotations?.readOnlyHint === true;
      if (!trustedReadOnly) {
        const approved = await requestMcpApproval(tool, args);
        if (!approved) {
          await window.electronAPI.mcp.recordDenial(tool.serverId, tool.name, args);
          throw new Error('MCP tool call denied by user');
        }
      }
      return resultText(await window.electronAPI.mcp.callTool(tool.serverId, tool.name, args));
    },
  };
}

export async function syncMcpTools(connectAuto = true): Promise<number> {
  for (const tool of listTools()) if (tool.name.startsWith(MCP_PREFIX)) unregisterTool(tool.name);
  const statuses = await window.electronAPI.mcp.listServers();
  if (connectAuto) {
    await Promise.all(statuses.filter((server) => server.config.autoConnect && server.state !== 'connected').map((server) => window.electronAPI.mcp.connect(server.config.id)));
  }
  const tools = (await window.electronAPI.mcp.listTools()).map(toMcpToolDefinition);
  registerTools(tools);
  return tools.length;
}
