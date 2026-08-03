import type { ToolDefinition } from './types';
import { conversationMemory } from '../conversation-memory';

const searchConversationHistory: ToolDefinition = {
  name: 'search_conversation_history',
  description: '搜索用户知识库中的已保存文档。返回相关原文件、行号和原始片段；当问题需要查阅既有资料、讨论、决策或结论时使用。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '用于检索知识库的关键词或自然语言问题' },
      limit: { type: 'number', description: '最多返回多少个片段，范围 1-8，默认 5' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) return JSON.stringify({ error: 'QUERY_REQUIRED' });
    const requestedLimit = Number(args.limit ?? 5);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(8, Math.floor(requestedLimit))) : 5;
    const results = await conversationMemory.search(query, limit);
    return JSON.stringify({
      query,
      count: results.length,
      results: results.map((source, index) => ({
        sourceId: `S${index + 1}`,
        documentId: source.documentId,
        filePath: source.filePath,
        fileName: source.fileName,
        title: source.title,
        site: source.site,
        startLine: source.startLine,
        endLine: source.endLine,
        score: Number(source.score.toFixed(4)),
        documentModifiedAt: source.documentModifiedAt,
        excerptHash: source.excerptHash,
        content: source.content,
      })),
    });
  },
};

const readConversationDocument: ToolDefinition = {
  name: 'read_conversation_document',
  description: '读取搜索结果对应的完整历史原文件，或读取指定行范围。只能读取应用历史目录中的对话文件。',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'search_conversation_history 返回的 documentId' },
      startLine: { type: 'number', description: '可选，起始行（从 1 开始）' },
      endLine: { type: 'number', description: '可选，结束行（包含）' },
    },
    required: ['documentId'],
  },
  execute: async (args) => {
    const documentId = String(args.documentId ?? '').trim();
    if (!documentId) return JSON.stringify({ error: 'DOCUMENT_ID_REQUIRED' });
    const result = await window.electronAPI.readConversation(documentId);
    if (!result.success) return JSON.stringify({ error: result.error ?? 'READ_FAILED' });
    const lines = (result.content ?? '').split(/\r?\n/);
    const requestedStart = Number(args.startLine ?? 1);
    const requestedEnd = Number(args.endLine ?? lines.length);
    const startLine = Number.isFinite(requestedStart) ? Math.max(1, Math.floor(requestedStart)) : 1;
    const endLine = Number.isFinite(requestedEnd)
      ? Math.max(startLine, Math.min(lines.length, Math.floor(requestedEnd)))
      : lines.length;
    const content = lines.slice(startLine - 1, endLine).join('\n');
    const maxChars = 12000;
    return JSON.stringify({
      documentId,
      startLine,
      endLine,
      totalLines: lines.length,
      truncated: content.length > maxChars,
      content: content.length > maxChars ? `${content.slice(0, maxChars)}\n[内容已截断]` : content,
    });
  },
};

export const conversationMemoryTools: ToolDefinition[] = [
  searchConversationHistory,
  readConversationDocument,
];
