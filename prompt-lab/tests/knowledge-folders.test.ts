import { describe, expect, it } from 'vitest';
import { parseKnowledgeDocument } from '../src/core/knowledge';
import { buildKnowledgeFolderTree } from '../src/plugins/knowledge-graph/knowledge-folders';

describe('knowledge topic folders', () => {
  it('groups documents by nested relative folders and counts descendants', () => {
    const tree = buildKnowledgeFolderTree([
      parseKnowledgeDocument('product/roadmap.md', '# Roadmap'),
      parseKnowledgeDocument('product/research/users.md', '# Users'),
      parseKnowledgeDocument('engineering/api.md', '# API'),
      parseKnowledgeDocument('inbox.md', '# Inbox'),
    ]);

    expect(tree.documentCount).toBe(4);
    expect(tree.documents.map((document) => document.title)).toEqual(['Inbox']);
    expect(tree.children.map((folder) => folder.path)).toEqual(['engineering', 'product']);
    expect(tree.children[1]).toMatchObject({ path: 'product', documentCount: 2 });
    expect(tree.children[1].children[0]).toMatchObject({ path: 'product/research', documentCount: 1 });
  });

  it('normalizes Windows separators into the same topic hierarchy', () => {
    const tree = buildKnowledgeFolderTree([parseKnowledgeDocument('topics\\design\\tokens.md', '# Tokens')]);
    expect(tree.children[0].children[0]).toMatchObject({ path: 'topics/design', documentCount: 1 });
  });

  it('keeps empty folders visible before they contain documents', () => {
    const tree = buildKnowledgeFolderTree([], ['product/research']);
    expect(tree.children[0].children[0]).toMatchObject({ path: 'product/research', documentCount: 0 });
  });
});
