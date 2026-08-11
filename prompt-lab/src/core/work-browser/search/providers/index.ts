/**
 * 内置 provider 集合 — Phase 1 默认启用
 */
import type { SearchProvider } from './provider';
import { duckduckgoProvider } from './duckduckgo';
import { braveProvider } from './brave';
import { githubProvider } from './github';
import { stackoverflowProvider } from './stackoverflow';

export const BUILTIN_PROVIDERS: SearchProvider[] = [
  duckduckgoProvider,
  braveProvider,
  githubProvider,
  stackoverflowProvider,
];

export { duckduckgoProvider, braveProvider, githubProvider, stackoverflowProvider };
