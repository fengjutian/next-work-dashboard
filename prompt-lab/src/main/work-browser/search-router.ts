/**
 * SearchRouter — 多引擎搜索 + 本地 FTS5 + AI 摘要
 */
import type Database from 'better-sqlite3';
import { aggregateSearch } from '../../core/work-browser/search/aggregator';
import { BUILTIN_PROVIDERS } from '../../core/work-browser/search/providers';
import type { SearchProvider, SearchQuery, AggregatedSearchResponse } from '../../core/work-browser/types';
import { summarizeResults, loadAIConfig } from '../../core/work-browser/ai/summarizer';
import type { WorkspaceStore } from './workspace-store';

export class SearchRouter {
  private providers: SearchProvider[];

  constructor(private store: WorkspaceStore, private db: Database.Database) {
    this.providers = BUILTIN_PROVIDERS;
  }

  listProviders(): Array<{ id: string; name: string; capabilities: SearchProvider['capabilities'] }> {
    return this.providers.map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities }));
  }

  async runSearch(input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all' }): Promise<AggregatedSearchResponse> {
    const query: SearchQuery = {
      text: input.text,
      locale: input.locale || 'zh-CN',
      safeSearch: true,
      timeRange: 'all',
      page: 1,
      perPage: input.perPage || 20,
    };
    const config = await loadAIConfig(async (key) => this.store.getSetting(key));

    const scope = input.scope || 'workspace';
    const useLocal = scope === 'workspace' || scope === 'library' || scope === 'all';
    const localScope: { kind: 'workspace' | 'library' | 'off'; workspaceId?: string } = useLocal
      ? (scope === 'workspace' ? { kind: 'workspace', workspaceId: input.workspaceId } : { kind: 'library' })
      : { kind: 'off' };

    const response = await aggregateSearch(this.providers, query, {
      timeoutMs: 8000,
      concurrency: 4,
      localDb: useLocal ? this.db : undefined,
      localScope,
      onSummarize: async (results) => {
        if (!config.apiKey && !config.local) return null;
        return await summarizeResults(results, query, config);
      },
    });
    this.store.appendSearchHistory({
      workspaceId: (input.workspaceId as any) || null,
      text: query.text,
      providers: [...this.providers.map((p) => p.id), ...(useLocal ? ['local'] : [])],
      resultCount: response.results.length,
      executedAt: Date.now(),
    });
    return response;
  }

  async getSuggestions(text: string): Promise<string[]> {
    if (text.length < 2) return [];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      for (const p of this.providers) {
        if (p.getSuggestions) {
          try {
            const out = await p.getSuggestions(text, ac.signal);
            if (out.length) return out;
          } catch { /* try next */ }
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return [];
  }
}
