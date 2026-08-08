import { describe, expect, it } from 'vitest';
import { analyzeKnowledgeUpdateImpact, parseKnowledgeDocument } from '../src/core/knowledge';

describe('knowledge update impact', () => {
  it('maps changed sources to documents and preserves git status', () => {
    const architecture = parseKnowledgeDocument('docs/architecture.md', '---\ntitle: Architecture\nsources: [src/main.ts, src/preload.ts]\n---\n# Architecture');
    const security = parseKnowledgeDocument('docs/security.md', '---\ntitle: Security\nsources: src/preload.ts\n---\n# Security');
    const note = parseKnowledgeDocument('notes/unrelated.md', '# Unrelated');
    const result = analyzeKnowledgeUpdateImpact([security, note, architecture], [
      { path: 'src\\preload.ts', status: ' M' },
      { path: 'README.md', status: '??' },
    ]);
    expect(result.map((item) => item.documentPath)).toEqual(['docs/architecture.md', 'docs/security.md']);
    expect(result[0].changedSources).toEqual([{ path: 'src\\preload.ts', status: ' M' }]);
  });

  it('matches source paths case-insensitively for Windows workspaces', () => {
    const document = parseKnowledgeDocument('docs/runtime.md', '---\nsources: [SRC/Main.ts]\n---\n# Runtime');
    expect(analyzeKnowledgeUpdateImpact([document], [{ path: 'src/main.ts', status: 'M ' }])).toHaveLength(1);
  });
});
