/**
 * Work Browser — Barrel
 *
 * 命名空间：workBrowser.*
 * 公开 API 故意保持稳定；core 内部的子模块不对外直接暴露。
 */
export * from './types';

export {
  parseWorkspaceTasks,
  resolveTaskOrder,
  type WorkspaceTaskDefinition,
} from './task/template';
export { runTask } from './task/runner';
export type { TaskRunHandle, TaskRunEvent } from './task/runner';

export { htmlClean, extractReadability, htmlToMarkdown } from './parser';
export type { CleanOptions, ReadabilityResult } from './parser';

export { dedupeResults } from './search/dedup';
export { rankResults } from './search/rank';
export { aggregateSearch } from './search/aggregator';
export type { SearchProvider } from './search/provider';

export { suggestWorkspacesForDocument } from './workspace/auto-group';
