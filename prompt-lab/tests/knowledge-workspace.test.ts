import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeIndex,
  createKnowledgeProposal,
  extractWikiLinks,
  instantiateKnowledgeTemplate,
  parseKnowledgeDocument,
  validateKnowledgeDocument,
} from '../src/core/knowledge';

describe('knowledge markdown', () => {
  it('parses metadata and wiki links while ignoring inline code', () => {
    const document = parseKnowledgeDocument('notes/alpha.md', `---\ntitle: Alpha\ntype: note\ntags: [one, two]\naliases: [A]\n---\n# Ignored fallback\n[[Beta|shown]] and ![[assets/Diagram]] and \`[[Code]]\``);
    expect(document).toMatchObject({ title: 'Alpha', type: 'note', tags: ['one', 'two'], aliases: ['A'] });
    expect(document.links.map((link) => [link.target, link.embedded])).toEqual([['Beta', false], ['assets/Diagram', true]]);
    expect(extractWikiLinks('[[Page#Section]]')[0].target).toBe('Page');
  });

  it('builds backlinks and reports unresolved, ambiguous and orphan links', () => {
    const alpha = parseKnowledgeDocument('alpha.md', '# Alpha\n[[Beta]]\n[[Missing]]\n[[Shared]]');
    const beta = parseKnowledgeDocument('folder/beta.md', '---\naliases: [B]\n---\n# Beta');
    const shared1 = parseKnowledgeDocument('one/shared.md', '# One');
    const shared2 = parseKnowledgeDocument('two/shared.md', '# Two');
    const orphan = parseKnowledgeDocument('orphan.md', '# Orphan');
    const index = buildKnowledgeIndex([alpha, beta, shared1, shared2, orphan]);
    expect(index.backlinks[beta.uri]).toHaveLength(1);
    expect(index.links.map((link) => link.status)).toEqual(['resolved', 'unresolved', 'ambiguous']);
    expect(index.orphanUris).toContain(orphan.uri);
  });
});

describe('knowledge templates and review', () => {
  it('instantiates a safe template and validates content rules', () => {
    const created = instantiateKnowledgeTemplate({
      id: 'adr', name: 'ADR', directory: 'decisions', fileName: '{{title}}',
      content: '---\ntype: spec\ntitle: {{title}}\n---\n# {{title}}\n## Context',
    }, { title: 'Use SQLite/Local' });
    expect(created.path).toBe('decisions/use-sqlite-local.md');
    const document = parseKnowledgeDocument(created.path, created.content);
    expect(validateKnowledgeDocument(document, created.content, [{
      include: 'decisions/**', requiredFrontmatter: ['status'], requiredSections: ['Decision'], allowedTypes: ['spec'],
    }]).map((item) => item.code)).toEqual(['MISSING_FRONTMATTER', 'MISSING_SECTION']);
  });

  it('rejects traversal and duplicate proposal paths', () => {
    expect(() => instantiateKnowledgeTemplate({ id: 'bad', name: 'Bad', directory: '../out', fileName: 'x', content: '' }, {})).toThrow('INVALID_TEMPLATE_DIRECTORY');
    expect(() => createKnowledgeProposal('edit', [
      { kind: 'create', path: 'a.md', content: '' }, { kind: 'create', path: 'A.md', content: '' },
    ], 1)).toThrow('DUPLICATE_MUTATION_PATH');
  });
});
