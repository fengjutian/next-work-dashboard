// ── 工具注册表 ──

import type { ToolDefinition, ToolCall, ToolResult } from './types';
import { toOpenAIFunction } from './types';

const registry = new Map<string, ToolDefinition>();

/** 注册一个工具 */
export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.name)) {
    console.warn(`[tools] Tool "${tool.name}" is being overwritten`);
  }
  registry.set(tool.name, tool);
}

/** 批量注册 */
export function registerTools(tools: ToolDefinition[]): void {
  tools.forEach(registerTool);
}

/** 按名称获取工具 */
export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

/** 列出所有已注册工具 */
export function listTools(): ToolDefinition[] {
  return [...registry.values()];
}

/** 获取所有工具的 OpenAI function 格式定义 */
export function getToolSchemas() {
  return listTools().map(toOpenAIFunction);
}

/** 执行一个工具调用 */
export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  const tool = getTool(call.name);
  if (!tool) {
    return { callId: call.id, name: call.name, error: `Unknown tool: ${call.name}` };
  }
  try {
    const output = await tool.execute(call.arguments);
    return { callId: call.id, name: call.name, output };
  } catch (err: any) {
    return { callId: call.id, name: call.name, error: err?.message ?? 'Tool execution failed' };
  }
}
