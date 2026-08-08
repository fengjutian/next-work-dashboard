import { describe, expect, it } from 'vitest';
import { buildKnowledgeIndex, evaluateKnowledgeHealth, parseKnowledgeDocument } from '../src/core/knowledge';

describe('knowledge health', () => {
  it('reports a perfect empty workspace without dividing by zero', () => {
    expect(evaluateKnowledgeHealth(buildKnowledgeIndex([]), [])).toMatchObject({ score: 100, grade: 'healthy', issueCount: 0 });
  });

  it('scores deterministic source, link, rule and orphan issues', () => {
    const source = parseKnowledgeDocument('source.md', '# Source\n[[Missing]]');
    const orphan = parseKnowledgeDocument('orphan.md', '# Orphan');
    const report = evaluateKnowledgeHealth(buildKnowledgeIndex([source, orphan]), [
      { severity: 'error', code: 'MISSING_FRONTMATTER', message: 'missing', path: 'source.md' },
      { severity: 'warning', code: 'SOURCE_STALE', message: 'stale', path: 'source.md' },
      { severity: 'warning', code: 'SOURCE_NOT_TRACKED', message: 'baseline', path: 'source.md' },
    ]);
    expect(report.score).toBe(70);
    expect(report.grade).toBe('warning');
    expect(Object.fromEntries(report.metrics.map((item) => [item.key, item.count]))).toMatchObject({
      errors: 1, staleSources: 1, untrackedSources: 1, unresolvedLinks: 1, orphanDocuments: 2,
    });
  });

  it('caps penalties and never returns a negative score', () => {
    const document = parseKnowledgeDocument('doc.md', '# Doc');
    const diagnostics = Array.from({ length: 100 }, (_, index) => ({
      severity: 'error' as const, code: 'RULE_ERROR', message: String(index), path: 'doc.md',
    }));
    const report = evaluateKnowledgeHealth(buildKnowledgeIndex([document]), diagnostics);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.grade).toBe('critical');
  });
});
