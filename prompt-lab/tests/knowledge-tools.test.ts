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

  it('creates a review proposal without writing files', async () => {
    const read = vi.spyOn(activeKnowledgeWorkspace, 'read').mockResolvedValue({ content: '# Before', modifiedAt: 42 });
    const propose = vi.spyOn(activeKnowledgeWorkspace, 'propose').mockReturnValue({
      id: 'proposal-1', instruction: 'Update note', createdAt: 1, status: 'ready-for-review',
      mutations: [{ kind: 'write', path: 'note.md', before: '# Before', content: '# After', expectedModifiedAt: 42 }],
    });
    const tool = knowledgeTools.find((item) => item.name === 'propose_knowledge_change')!;
    const output = JSON.parse(await tool.execute({
      instruction: 'Update note', changesJson: JSON.stringify([{ kind: 'write', path: 'note.md', content: '# After' }]),
    }));
    expect(output).toMatchObject({ proposalId: 'proposal-1', status: 'ready-for-review' });
    expect(read).toHaveBeenCalledWith('note.md');
    expect(propose).toHaveBeenCalledWith('Update note', [expect.objectContaining({ before: '# Before', expectedModifiedAt: 42 })]);
  });

  it('exposes deterministic knowledge update impact to the agent', async () => {
    vi.spyOn(activeKnowledgeWorkspace, 'updateImpact').mockResolvedValue([{
      documentUri: 'knowledge://architecture.md', documentPath: 'architecture.md', documentTitle: 'Architecture',
      changedSources: [{ path: 'src/main.ts', status: ' M' }],
    }]);
    const tool = knowledgeTools.find((item) => item.name === 'get_knowledge_update_impact')!;
    const output = JSON.parse(await tool.execute({}));
    expect(output.count).toBe(1);
    expect(output.results[0].documentPath).toBe('architecture.md');
  });

  it('exposes the knowledge health report to the agent', async () => {
    vi.spyOn(activeKnowledgeWorkspace, 'health').mockResolvedValue({ score: 94, grade: 'healthy', issueCount: 1, metrics: [] });
    const tool = knowledgeTools.find((item) => item.name === 'get_knowledge_health')!;
    expect(JSON.parse(await tool.execute({}))).toMatchObject({ score: 94, grade: 'healthy', issueCount: 1 });
  });
});
