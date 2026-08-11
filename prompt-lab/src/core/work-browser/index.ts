/**
 * Work Browser — Barrel
 *
 * 命名空间：workBrowser.*
 * 公开 API 故意保持稳定；core 内部的子模块不对外直接暴露。
 */
export * from './types';

export { INVESTIGATION_TEMPLATE, RESEARCH_TEMPLATE, ALL_TEMPLATES, instantiateTask, nextStepIndex } from './task/template';
export { runTask, applyStepUpdate } from './task/runner';
export type { TaskRunHandle, TaskRunEvent, TaskStepHandler, RunTaskOptions } from './task/runner';

export { htmlClean, extractReadability, extractReadabilityFromDom, htmlToMarkdown, htmlToMarkdownInline } from './parser';

export { dedupeResults } from './search/dedup';
export { rankResults } from './search/rank';
export { aggregateSearch } from './search/aggregator';
export type { AggregateOptions } from './search/aggregator';
// 注意：SearchProvider 类型在 ./types 中已 re-export（来自 provider.ts），避免双重导出。
export { canonicalizeUrl, contentFingerprint, decodeHtmlEntities } from './search/provider';
export { BUILTIN_PROVIDERS, duckduckgoProvider, braveProvider, githubProvider, stackoverflowProvider } from './search/providers';

export { loadAIConfig, summarizeResults } from './ai/summarizer';
export { buildContextBundle } from './ai/context';
export type { ContextBundle } from './ai/context';
export type { AIProviderConfig } from './ai/summarizer';

export { suggestWorkspacesForDocument } from './workspace/auto-group';
export type { GroupCandidate } from './workspace/auto-group';

export { computeContentHash, isContentChanged, newDocument, newDocumentVersion } from './document/version';
export { lineDiff, collapseHunks, summarizeDiff } from './document/diff';
export type { DiffHunk } from './document/diff';

export { createAnnotation, normalizeSelector } from './annotation/model';

export { runMigrations } from './storage/migrations';
export { SCHEMA_V1 } from './storage/schema';
export type { MigrationResult } from './storage/migrations';
