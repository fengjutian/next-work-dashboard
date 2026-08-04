import { afterEach, describe, expect, it, vi } from 'vitest';
import { knowledgeTools } from '../src/core/tools/knowledge-tools';
import { activeKnowledgeWorkspace } from '../src/services/knowledge-workspace';

afterEach(() => vi.restoreAllMocks());

describe('knowledge agent tools', () => {
  it('searches the active workspace with bounded filters', async () => {
    const search = vi.spyOn(activeKnowledgeWorkspace, 'search').mockResolvedValue([{
      uri: 'knowledge://docs/adr.md', path: 'docs/adr.md', title: 'ADR', type: 'spec', tags: ['architecture'], score: 0.9,
      snippets: [{ line: 4, endLine: 8, text: 'Use SQLite', score: 0.9 }],
    }]);
    const tool = knowledgeTools.find((item) => item.name === 'search_knowledge')!;
    const output = JSON.parse(await tool.execute({ query: 'storage', limit: 200, type: 'spec', tags: ['architecture'] }));
    expect(output.count).toBe(1);
    expect(search).toHaveBeenCalledWith('storage', 20, { types: ['spec'], tags: ['architecture'], pathPrefix: undefined });
  });

  it('reads a bounded line range and reports backlinks', async () => {
    vi.spyOn(activeKnowledgeWorkspace, 'read').mockResolvedValue({ content: 'one\ntwo\nthree', modifiedAt: 10 });
    vi.spyOn(activeKnowledgeWorkspace, 'backlinks').mockResolvedValue([{ sourceUri: 'knowledge://a.md', sourcePath: 'a.md', sourceTitle: 'A', line: 2, target: 'B' }]);
    const read = knowledgeTools.find((item) => item.name === 'read_knowledge_document')!;
    const backlinks = knowledgeTools.find((item) => item.name === 'get_knowledge_backlinks')!;
    expect(JSON.parse(await read.execute({ path: 'b.md', startLine: 2, endLine: 3 }))).toMatchObject({ content: 'two\nthree', startLine: 2, endLine: 3 });
    expect(JSON.parse(await backlinks.execute({ path: 'b.md' })).count).toBe(1);
  });

  it('returns stable tool errors when no active workspace is available', async () => {
    vi.spyOn(activeKnowledgeWorkspace, 'search').mockRejectedValue(new Error('KNOWLEDGE_WORKSPACE_NOT_OPEN'));
    const tool = knowledgeTools.find((item) => item.name === 'search_knowledge')!;
    expect(JSON.parse(await tool.execute({ query: 'anything' })).error).toBe('KNOWLEDGE_WORKSPACE_NOT_OPEN');
  });
});
