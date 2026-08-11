import type { ToolDefinition } from '../../core/work-browser/agent/runner';
import { mcpManager } from '../mcp/mcp-manager';
import type { McpToolDescriptor } from '../../types/mcp';

const descriptorsByAgentName = new Map<string, McpToolDescriptor>();

function agentToolName(tool: McpToolDescriptor): string {
  const raw = `mcp_${tool.serverId}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  let hash = 0;
  for (const char of raw) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const suffix = Math.abs(hash).toString(36);
  return `${raw.slice(0, Math.max(1, 63 - suffix.length))}_${suffix}`;
}

function parameters(tool: McpToolDescriptor): ToolDefinition['parameters'] {
  const schema = tool.inputSchema || {};
  return {
    type: 'object',
    properties: (schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {}) as ToolDefinition['parameters']['properties'],
    required: Array.isArray(schema.required) ? schema.required.map(String) : undefined,
  };
}

export function buildMcpAgentTools(): ToolDefinition[] {
  descriptorsByAgentName.clear();
  return mcpManager.listTools().map((tool) => {
    const name = agentToolName(tool);
    descriptorsByAgentName.set(name, tool);
    return {
      name,
      description: `[MCP ${tool.serverId}] ${tool.description || tool.name}`,
      parameters: parameters(tool),
      // Only a trusted, explicitly read-only annotation can bypass confirmation.
      requiresConfirm: !(tool.trustAnnotations && tool.annotations?.readOnlyHint === true),
      rateLimit: 5,
      execute: async (args) => {
        const result = await mcpManager.callTool(tool.serverId, tool.name, args as Record<string, unknown>);
        if (result.isError) throw new Error(`MCP tool failed: ${tool.serverId}/${tool.name}`);
        return result.structuredContent ?? result.content;
      },
    };
  });
}

export function recordMcpAgentDenial(toolName: string, args: Record<string, unknown>): void {
  const tool = descriptorsByAgentName.get(toolName);
  if (tool) mcpManager.recordDenial(tool.serverId, tool.name, args);
}
