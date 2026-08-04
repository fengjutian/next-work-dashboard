import { describe, expect, it } from 'vitest';
import { KnowledgeSearchIndex, parseKnowledgeDocument, splitKnowledgeDocument } from '../src/core/knowledge';

const input = (path: string, content: string) => ({ document: parseKnowledgeDocument(path, content), content });

describe('knowledge search index', () => {
  it('chunks long documents with source line ranges', () => {
    const chunks = splitKnowledgeDocument(input('long.md', `# Start\n${'alpha '.repeat(200)}\n## Next\nBeta`));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].line).toBe(1);
    expect(chunks[1].endLine).toBeGreaterThanOrEqual(chunks[1].line);
  });

  it('combines BM25, sparse similarity and title boost', () => {
    const index = new KnowledgeSearchIndex();
    index.replace([
      input('architecture.md', '---\ntype: spec\ntags: [storage]\n---\n# Local Architecture\nSQLite stores metadata locally.'),
      input('notes/other.md', '# Other\nArchitecture appears once.'),
    ]);
    const results = index.search('local architecture');
    expect(results[0].path).toBe('architecture.md');
    expect(results[0].snippets[0].line).toBeGreaterThan(0);
    expect(index.search('SQLite', 20, { types: ['note'] })).toEqual([]);
    expect(index.search('SQLite', 20, { tags: ['storage'], pathPrefix: 'arch' })[0].path).toBe('architecture.md');
  });

  it('replaces removed documents instead of returning stale hits', () => {
    const index = new KnowledgeSearchIndex();
    index.replace([input('old.md', '# Old\nUnique phrase')]);
    expect(index.search('unique')).toHaveLength(1);
    index.replace([input('new.md', '# New')]);
    expect(index.search('unique')).toEqual([]);
  });
});
