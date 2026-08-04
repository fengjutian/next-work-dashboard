// ── 工具注册表 ──

import type { ToolDefinition, ToolCall, ToolResult } from './types';
import { toOpenAIFunction } from './types';

const registry = new Map<string, ToolDefinition>();

/** 工具启用状态（默认全部启用） */
const enabledMap = new Map<string, boolean>();

/** 注册一个工具 */
export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.name)) {
    console.warn(`[tools] Tool "${tool.name}" is being overwritten`);
  }
  registry.set(tool.name, tool);
  // 默认启用
  if (!enabledMap.has(tool.name)) {
    enabledMap.set(tool.name, true);
  }
}

/** 批量注册 */
export function registerTools(tools: ToolDefinition[]): void {
  tools.forEach(registerTool);
}

/** 移除动态工具（例如断开的 MCP Server 工具）。 */
export function unregisterTool(name: string): void {
  registry.delete(name);
  enabledMap.delete(name);
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

/** 设置工具启用/禁用 */
export function setToolEnabled(name: string, enabled: boolean): void {
  if (registry.has(name)) {
    enabledMap.set(name, enabled);
  }
}

/** 检查工具是否启用 */
export function isToolEnabled(name: string): boolean {
  return enabledMap.get(name) ?? true;
}

/** 获取工具启用状态快照 */
export function getToolEnabledMap(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [name] of registry) {
    result[name] = enabledMap.get(name) ?? true;
  }
  return result;
}

/** 获取仅已启用工具的 OpenAI function 格式定义 */
export function getEnabledToolSchemas() {
  return listTools()
    .filter((t) => isToolEnabled(t.name))
    .map(toOpenAIFunction);
}

/** 执行一个工具调用（会检查工具是否已启用） */
export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  const tool = getTool(call.name);
  if (!tool) {
    return { callId: call.id, name: call.name, error: `Unknown tool: ${call.name}` };
  }
  if (!isToolEnabled(call.name)) {
    return { callId: call.id, name: call.name, error: `Tool "${call.name}" is disabled` };
  }
  try {
    const output = await tool.execute(call.arguments);
    return { callId: call.id, name: call.name, output };
  } catch (err: any) {
    return { callId: call.id, name: call.name, error: err?.message ?? 'Tool execution failed' };
  }
}
