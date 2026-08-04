// ── 工具系统类型定义 ──

/**
 * 工具定义 — 对齐 OpenAI function calling schema
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** 实际执行函数，返回字符串结果 */
  execute(args: Record<string, unknown>): Promise<string> | string;
}

export interface ToolParameterSchema {
  type?: string | string[];
  properties?: Record<string, ToolParamProperty>;
  required?: string[];
  additionalProperties?: boolean | ToolParamProperty;
  [key: string]: unknown;
}

export interface ToolParamProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: ToolParamProperty | ToolParamProperty[];
  properties?: Record<string, ToolParamProperty>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * LLM 返回的工具调用
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  callId: string;
  name: string;
  output?: string;
  error?: string;
}

/**
 * 转换为 OpenAI function calling 格式的 function 定义
 */
export function toOpenAIFunction(tool: ToolDefinition): {
  type: 'function';
  function: { name: string; description: string; parameters: ToolParameterSchema };
} {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
