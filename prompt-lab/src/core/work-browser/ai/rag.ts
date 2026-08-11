/**
 * RAG — Retrieval-Augmented Generation
 *
 * query → 双路召回（hybridSearch）→ 拼成 systemPrompt + citations
 * 复用 hybrid.ts 和 context.ts
 */
import type Database from 'better-sqlite3';
import type { AIContext, Citation } from '../types';
import { hybridSearch, hybridToSearchResults, type HybridChunk } from '../search/hybrid';
import type { SearchQuery } from '../types';
import { DEFAULT_MODEL_ID } from '../embedding/embedder';

export interface BuildRagInput {
  query: string;
  db: Database.Database;
  vectorSearch: (vector: number[], modelId: string, limit: number) => Promise<Array<{ id: string; distance: number; content?: string; sectionTitle?: string; page?: number }>>;
  embedder: (text: string) => Promise<{ vector: number[]; model: string }>;
  workspaceId?: string;
  modelId?: string;
  topK?: number;
  scope?: 'workspace' | 'library';
}

export interface RagBundle {
  systemPrompt: string;
  citations: Citation[];
  chunks: HybridChunk[];
  context: AIContext;
}

const RAG_SYSTEM_HEADER = `你是 Work Browser 的 RAG 助手。基于用户工作区里检索到的真实文档回答问题。
规则：
1. 每条关键事实必须以 [n] 标注来源编号，n 对应下方"来源"列表的序号。
2. 严禁编造未在来源中出现的数字、命令、API 名字。
3. 如果来源不足以回答，坦白说"来源不足"，并列出你需要什么补充资料。
4. 回答结构：结论 → 关键证据（带 [n] 引用）→ 可能的延伸/不确定项。`;

export async function buildRagContext(input: BuildRagInput): Promise<RagBundle> {
  const { query, db, vectorSearch, embedder, workspaceId, modelId = DEFAULT_MODEL_ID, topK = 8, scope = 'workspace' } = input;
  if (!query.trim()) {
    return emptyBundle(query, workspaceId);
  }

  const searchQuery: SearchQuery = {
    text: query,
    locale: 'zh-CN',
    safeSearch: true,
    timeRange: 'all',
    page: 1,
    perPage: topK * 2,
  };

  const chunks = await hybridSearch({
    query: searchQuery,
    db,
    vectorSearch,
    embedder,
    localOptions: { scope, workspaceId, limit: topK * 2 },
    modelId,
    topK,
  });

  if (!chunks.length) {
    return {
      systemPrompt: RAG_SYSTEM_HEADER + '\n\n（未在本地知识库检索到与该问题相关的文档。）',
      citations: [],
      chunks: [],
      context: { scope: scope === 'workspace' ? 'current-workspace' : 'all-library', documentIds: [], noteIds: [], taskId: null },
    };
  }

  // 拼 systemPrompt + citations
  const sourceList = chunks.map((c, i) => {
    const title = c.documentTitle || c.sectionTitle || `文档 ${c.documentId.slice(0, 8)}`;
    const url = c.documentUrl || '';
    return `[${i + 1}] ${title}${url ? `\n    URL: ${url}` : ''}${c.sectionTitle ? `\n    章节: ${c.sectionTitle}` : ''}${c.page >= 0 ? ` (p.${c.page + 1})` : ''}`;
  }).join('\n\n');

  const excerpts = chunks.map((c, i) => {
    const excerpt = c.content.length > 1200 ? c.content.slice(0, 1200) + '…' : c.content;
    return `[${i + 1}]\n${excerpt}`;
  }).join('\n\n---\n\n');

  const systemPrompt = `${RAG_SYSTEM_HEADER}\n\n## 来源\n${sourceList}\n\n## 原文片段\n${excerpts}`;

  const citations: Citation[] = chunks.map((c) => ({
    documentId: c.documentId as any,
    url: c.documentUrl || '',
    title: c.documentTitle || c.sectionTitle || '',
    excerpt: c.content.slice(0, 200),
  }));

  return {
    systemPrompt,
    citations,
    chunks,
    context: {
      scope: scope === 'workspace' ? 'current-workspace' : 'all-library',
      documentIds: Array.from(new Set(chunks.map((c) => c.documentId))) as any,
      noteIds: [],
      taskId: null,
    },
  };
}

function emptyBundle(query: string, workspaceId?: string): RagBundle {
  return {
    systemPrompt: RAG_SYSTEM_HEADER,
    citations: [],
    chunks: [],
    context: { scope: workspaceId ? 'current-workspace' : 'all-library', documentIds: [], noteIds: [], taskId: null },
  };
}

/**
 * 便捷：把 RAG bundle 转成 SearchResult 列表（供 SearchResults 弹层复用）
 */
export function ragToSearchResults(bundle: RagBundle): ReturnType<typeof hybridToSearchResults> {
  return hybridToSearchResults(bundle.chunks);
}
