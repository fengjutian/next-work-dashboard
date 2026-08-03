import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalConversationMemoryProvider, splitConversationDocument, toMemoryCitation } from '../src/core/conversation-memory';
import type { ConversationFile } from '../src/types/electron';

const file: ConversationFile = {
  site: 'deepseek',
  date: '2026-08-03',
  fileName: 'deepseek-2026-08-03.md',
  path: 'C:\\conversations\\deepseek-2026-08-03.md',
  size: 100,
  modifiedAt: 1,
  title: '项目架构讨论',
};

describe('conversation memory chunking', () => {
  it('persists citations without duplicating source content', () => {
    const citation = toMemoryCitation({
      documentId: file.path, filePath: file.path, fileName: file.fileName,
      title: file.title, site: file.site, startLine: 1, endLine: 2,
      content: '这段正文只用于模型上下文，不应写入聊天会话。', score: 0.9,
    });
    expect(citation).not.toHaveProperty('content');
    expect(citation.filePath).toBe(file.path);
  });

  it('preserves original document references and line ranges', () => {
    const chunks = splitConversationDocument(file, '# 项目架构讨论\n\n### 用户\n\n如何设计历史知识库？\n\n### AI\n\n使用分块检索。');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({
      filePath: file.path,
      fileName: file.fileName,
      title: file.title,
      startLine: 1,
    });
    expect(chunks[0].content).toContain('历史知识库');
    expect(chunks[0].norm).toBeGreaterThan(0);
  });

  it('splits long documents without losing the source identity', () => {
    const content = Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 行：这是对话历史中的项目决策。`).join('\n');
    const chunks = splitConversationDocument(file, content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.documentId === file.path)).toBe(true);
    expect(chunks.at(-1)?.endLine).toBe(100);
  });
});

describe('local conversation memory index', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('indexedDB', undefined);
  });

  it('reuses unchanged chunks and only reads changed documents', async () => {
    let files = [file];
    const readConversation = vi.fn(async () => ({ success: true, content: '# 决策\n采用本地向量知识库。' }));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        listConversations: vi.fn(async () => files),
        readConversation,
      },
    });
    const provider = new LocalConversationMemoryProvider();
    await provider.sync();
    await provider.sync();
    expect(readConversation).toHaveBeenCalledTimes(1);

    files = [{ ...file, modifiedAt: 2 }];
    await provider.sync();
    expect(readConversation).toHaveBeenCalledTimes(2);
  });

  it('returns traceable original-document sources', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        listConversations: vi.fn(async () => [file]),
        readConversation: vi.fn(async () => ({ success: true, content: '# 架构决策\n历史对话使用向量知识库检索，并保留原始文件。' })),
      },
    });
    const results = await new LocalConversationMemoryProvider().search('向量知识库');
    expect(results[0]).toMatchObject({ filePath: file.path, fileName: file.fileName });
    expect(results[0].content).toContain('原始文件');
  });
});
