import type { KnowledgeDocumentType } from '../knowledge';
import { activeKnowledgeWorkspace } from '@/services/knowledge-workspace';
import type { ToolDefinition } from './types';

const searchKnowledge: ToolDefinition = {
  name: 'search_knowledge',
  description: '搜索当前活动 Markdown 知识工作区。返回相关文档、来源行号和原文片段；回答项目知识、规范、决策或笔记问题时优先使用。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '自然语言问题或检索关键词' },
      limit: { type: 'number', description: '最多返回多少篇文档，范围 1-20，默认 8' },
      type: { type: 'string', description: '可选文档类型：conversation/note/spec/prompt/code/document' },
      tags: { type: 'array', items: { type: 'string' }, description: '可选标签过滤，文档必须包含全部标签' },
      pathPrefix: { type: 'string', description: '可选工作区相对目录前缀' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) return JSON.stringify({ error: 'QUERY_REQUIRED' });
    const requestedLimit = Number(args.limit ?? 8);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.floor(requestedLimit))) : 8;
    const allowedTypes: KnowledgeDocumentType[] = ['conversation', 'note', 'spec', 'prompt', 'code', 'document'];
    const requestedType = String(args.type ?? '');
    const types = allowedTypes.includes(requestedType as KnowledgeDocumentType) ? [requestedType as KnowledgeDocumentType] : undefined;
    const tags = Array.isArray(args.tags) ? args.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : undefined;
    try {
      const results = await activeKnowledgeWorkspace.search(query, limit, {
        types, tags, pathPrefix: String(args.pathPrefix ?? '').trim() || undefined,
      });
      return JSON.stringify({ activeRoot: activeKnowledgeWorkspace.activeRoot, query, count: results.length, results });
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  },
};

const readKnowledgeDocument: ToolDefinition = {
  name: 'read_knowledge_document',
  description: '读取 search_knowledge 返回的 Markdown/MDX 文档，可限制行号范围。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '工作区相对路径' },
      startLine: { type: 'number', description: '可选起始行，从 1 开始' },
      endLine: { type: 'number', description: '可选结束行，包含该行' },
    },
    required: ['path'],
  },
  execute: async (args) => {
    const path = String(args.path ?? '').trim();
    if (!path) return JSON.stringify({ error: 'PATH_REQUIRED' });
    try {
      const result = await activeKnowledgeWorkspace.read(path);
      const lines = result.content.split(/\r?\n/);
      const startLine = Math.max(1, Math.floor(Number(args.startLine ?? 1)) || 1);
      const endLine = Math.max(startLine, Math.min(lines.length, Math.floor(Number(args.endLine ?? lines.length)) || lines.length));
      const content = lines.slice(startLine - 1, endLine).join('\n');
      return JSON.stringify({ path, startLine, endLine, totalLines: lines.length, modifiedAt: result.modifiedAt, truncated: content.length > 12000, content: content.slice(0, 12000) });
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  },
};

const getKnowledgeBacklinks: ToolDefinition = {
  name: 'get_knowledge_backlinks',
  description: '查询哪些知识文档通过 Wiki Link 引用了指定文档。',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: '工作区相对路径或 knowledge:// URI' } },
    required: ['path'],
  },
  execute: async (args) => {
    const path = String(args.path ?? '').trim();
    if (!path) return JSON.stringify({ error: 'PATH_REQUIRED' });
    try {
      const results = await activeKnowledgeWorkspace.backlinks(path);
      return JSON.stringify({ path, count: results.length, results });
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  },
};

const proposeKnowledgeChange: ToolDefinition = {
  name: 'propose_knowledge_change',
  description: '创建待用户审查的知识文件修改候选。不会直接写文件。changesJson 是 create/write/delete/rename 操作数组。',
  parameters: {
    type: 'object',
    properties: {
      instruction: { type: 'string', description: '说明为什么需要这些修改' },
      changesJson: { type: 'string', description: 'JSON 数组。create: {kind,path,content}；write: {kind,path,content}；delete: {kind,path}；rename: {kind,path,targetPath,content?}' },
    },
    required: ['instruction', 'changesJson'],
  },
  execute: async (args) => {
    const instruction = String(args.instruction ?? '').trim();
    if (!instruction) return JSON.stringify({ error: 'INSTRUCTION_REQUIRED' });
    try {
      const changes = JSON.parse(String(args.changesJson ?? '')) as Array<Record<string, unknown>>;
      if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw new Error('INVALID_CHANGE_BATCH');
      const mutations = [] as import('../knowledge').KnowledgeMutation[];
      for (const change of changes) {
        const kind = String(change.kind ?? '');
        const path = String(change.path ?? '').replace(/\\/g, '/').trim();
        if (!path || !/\.mdx?$/i.test(path)) throw new Error(`INVALID_KNOWLEDGE_PATH:${path}`);
        if (kind === 'create') {
          mutations.push({ kind, path, content: String(change.content ?? '') });
          continue;
        }
        const original = await activeKnowledgeWorkspace.read(path);
        if (kind === 'write') mutations.push({ kind, path, before: original.content, content: String(change.content ?? ''), expectedModifiedAt: original.modifiedAt });
        else if (kind === 'delete') mutations.push({ kind, path, before: original.content, expectedModifiedAt: original.modifiedAt });
        else if (kind === 'rename') {
          const targetPath = String(change.targetPath ?? '').replace(/\\/g, '/').trim();
          if (!/\.mdx?$/i.test(targetPath)) throw new Error(`INVALID_KNOWLEDGE_PATH:${targetPath}`);
          mutations.push({ kind, path, targetPath, before: original.content, content: change.content === undefined ? undefined : String(change.content), expectedModifiedAt: original.modifiedAt });
        } else throw new Error(`INVALID_CHANGE_KIND:${kind}`);
      }
      const proposal = activeKnowledgeWorkspace.propose(instruction, mutations);
      return JSON.stringify({ proposalId: proposal.id, status: proposal.status, changes: proposal.mutations.map((mutation) => ({ kind: mutation.kind, path: mutation.path })) });
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  },
};

export const knowledgeTools: ToolDefinition[] = [searchKnowledge, readKnowledgeDocument, getKnowledgeBacklinks, proposeKnowledgeChange];
