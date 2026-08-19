/**
 * SearchRouter — 多引擎搜索 + 本地 FTS5 + AI 摘要
 */
import type Database from 'better-sqlite3';
import { aggregateSearch } from '../../core/work-browser/search/aggregator';
import { BUILTIN_PROVIDERS } from '../../core/work-browser/search/providers';
import type { SearchProvider, SearchQuery, AggregatedSearchResponse } from '../../core/work-browser/types';
import { loadAIConfig, summarizeResults, type AIProviderConfig } from '../../core/work-browser/ai/summarizer';
import { buildRagContext } from '../../core/work-browser/ai/rag';
import { embed } from '../../core/work-browser/embedding/embedder';
import { searchLanceDocuments } from '../lancedb-memory';
import { DEFAULT_MODEL_ID } from '../../core/work-browser/embedding/embedder';
import type { WorkspaceStore } from './workspace-store';

export class SearchRouter {
  private providers: SearchProvider[];

  constructor(
    private store: WorkspaceStore,
    private db: Database.Database,
    private getAIConfig?: () => Promise<AIProviderConfig>,
  ) {
    this.providers = BUILTIN_PROVIDERS;
  }

  listProviders(): Array<{ id: string; name: string; capabilities: SearchProvider['capabilities'] }> {
    return this.providers.map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities }));
  }

  async runSearch(input: { text: string; locale?: string; perPage?: number; workspaceId?: string; scope?: 'web' | 'workspace' | 'library' | 'all' }, options: {
    signal?: AbortSignal;
    onProgress?: (progress: { results: AggregatedSearchResponse['results']; providers: AggregatedSearchResponse['providers']; took: number }) => void;
  } = {}): Promise<AggregatedSearchResponse> {
    const query: SearchQuery = {
      text: input.text,
      locale: input.locale || 'zh-CN',
      safeSearch: true,
      timeRange: 'all',
      page: 1,
      perPage: input.perPage || 20,
    };
    const config = this.getAIConfig
      ? await this.getAIConfig()
      : await loadAIConfig((key) => Promise.resolve(this.store.getSetting(key)));

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
      signal: options.signal,
      onProgress: options.onProgress,
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

  /**
   * RAG 检索：双路召回 → context bundle
   * 不调 LLM，由调用方拿到 systemPrompt + citations 后自己组装
   */
  async runRag(input: { query: string; workspaceId?: string; topK?: number; scope?: 'workspace' | 'library' }) {
    const modelId = (await this.store.getSetting('workBrowser.ai.embeddingModel')) || DEFAULT_MODEL_ID;
    const bundle = await buildRagContext({
      query: input.query,
      db: this.db,
      vectorSearch: (vec, mid, limit) => searchLanceDocuments(vec, mid, limit).then((rows) => rows.map((r) => ({
        id: r.id,
        distance: r.distance,
        documentId: r.documentId,
        content: r.content,
        sectionTitle: r.sectionTitle,
        page: r.page,
      }))),
      embedder: (text) => embed(text, modelId),
      workspaceId: input.workspaceId,
      modelId,
      topK: input.topK,
      scope: input.scope,
    });
    return bundle;
  }
}
