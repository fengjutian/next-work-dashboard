// ── Core 模块 — IDE/UI 无关的纯逻辑层 ──

// 注入引擎
export {
  extractVariables,
  fillVariables,
  buildInjectionScript,
  parseInjectResult,
} from './injector';
export type { InjectOptions, InjectResult } from './injector';

// 对话内容提取
export {
  buildConversationExtractScript,
  parseExtractResult,
} from './conversation-extractor';
export type { ExtractResult } from './conversation-extractor';

// LLM 对话引擎
export {
  createOpenAIProvider,
  registerProvider,
  getProvider,
  listProviders,
} from './llm';
export type {
  ChatMessage,
  ChatOptions,
  ChatChunk,
  ModelInfo,
  LLMProvider,
  OpenAIConfig,
} from './llm';

// 工具系统
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
} from './tools';
export {
  registerTool,
  registerTools,
  getTool,
  listTools,
  getToolSchemas,
  getEnabledToolSchemas,
  setToolEnabled,
  isToolEnabled,
  getToolEnabledMap,
  executeToolCall,
} from './tools';

// ReAct Agent
export { runAgent } from './agent';
export type { AgentStep, AgentOptions } from './agent';

// 知识图谱实体抽取
export { extractFromDocuments, quickExtract } from './graph-extractor';
export type { ExtractConfig } from './graph-extractor';
export { extractCodeGraph, isSupportedCodePath } from './code-graph-extractor';
export type { CodeDocument, CodeGraphOptions } from './code-graph-extractor';
export * from './knowledge';

export { TencentDbMemoryAdapter } from './tencentdb-memory-adapter';
export type {
  TencentDbMemoryCapabilities,
  TencentDbMemoryConfig,
} from './tencentdb-memory-adapter';
