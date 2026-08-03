import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationMemoryTools } from '../src/core/tools/conversation-memory-tools';
import { conversationMemory } from '../src/core/conversation-memory';

describe('conversation memory agent tools', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns structured, traceable search results', async () => {
    vi.spyOn(conversationMemory, 'search').mockResolvedValue([{
      documentId: 'C:\\history\\one.md', filePath: 'C:\\history\\one.md', fileName: 'one.md',
      title: '架构讨论', site: 'deepseek', startLine: 3, endLine: 8,
      content: '采用本地知识库。', score: 0.82, documentModifiedAt: 1, excerptHash: 'abcdef12',
    }]);
    const tool = conversationMemoryTools.find((item) => item.name === 'search_conversation_history');
    const output = JSON.parse(String(await tool?.execute({ query: '知识库', limit: 3 })));
    expect(output.results[0]).toMatchObject({ documentId: 'C:\\history\\one.md', startLine: 3 });
    expect(output.results[0].content).toContain('本地知识库');
  });

  it('clamps search result limits', async () => {
    const search = vi.spyOn(conversationMemory, 'search').mockResolvedValue([]);
    const tool = conversationMemoryTools.find((item) => item.name === 'search_conversation_history');
    await tool?.execute({ query: '测试', limit: 99 });
    expect(search).toHaveBeenCalledWith('测试', 8);
  });

  it('reads only through the restricted conversation IPC', async () => {
    const readConversation = vi.fn(async () => ({ success: true, content: '第一行\n第二行\n第三行' }));
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { readConversation } });
    const tool = conversationMemoryTools.find((item) => item.name === 'read_conversation_document');
    const output = JSON.parse(String(await tool?.execute({ documentId: 'C:\\history\\one.md', startLine: 2, endLine: 3 })));
    expect(readConversation).toHaveBeenCalledWith('C:\\history\\one.md');
    expect(output.content).toBe('第二行\n第三行');
  });
});
