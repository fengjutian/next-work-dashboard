// store/index.ts — 统一入口，re-export store + selectors + types
export { useStore } from './store';
export { useAllTags, useRecentPrompts, useAllCategories } from './selectors';
export type { PromptSlice } from './prompt-slice';
export { CATEGORIES } from './types';
export type { Prompt, PromptVariable, SiteConfig, Tab, InjectMode, InjectStrategy, AiApiConfig, MemoryConfig, Role } from './types';
