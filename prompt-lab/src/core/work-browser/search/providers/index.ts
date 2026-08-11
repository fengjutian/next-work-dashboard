/**
 * 内置 provider 集合 — Phase 1 默认启用
 */
import type { SearchProvider } from '../provider';
import { duckduckgoProvider } from './duckduckgo';
import { braveProvider } from './brave';
import { githubProvider } from './github';
import { stackoverflowProvider } from './stackoverflow';
import { bingProvider } from './bing';
import { baiduProvider } from './baidu';
import { googleProvider } from './google';

export const BUILTIN_PROVIDERS: SearchProvider[] = [
  bingProvider,
  baiduProvider,
  googleProvider,
  duckduckgoProvider,
  braveProvider,
  githubProvider,
  stackoverflowProvider,
];

export { bingProvider, baiduProvider, googleProvider, duckduckgoProvider, braveProvider, githubProvider, stackoverflowProvider };
