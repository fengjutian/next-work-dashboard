import { describe, expect, it } from 'vitest';
import { summarizeAiProposal } from '../src/plugins/code-editor/agents/ai-proposal-summary';

describe('AI proposal summary', () => {
  it('classifies and counts a modified file', () => {
    expect(summarizeAiProposal({ path: 'a.ts', original: 'a\nb', modified: 'a\nc', language: 'typescript' }))
      .toEqual({ kind: 'modify', additions: 1, deletions: 1 });
  });

  it('classifies create, delete and rename proposals', () => {
    expect(summarizeAiProposal({ path: 'new.ts', original: '', modified: 'new', language: 'typescript' }).kind).toBe('create');
    expect(summarizeAiProposal({ path: 'old.ts', original: 'old', modified: '', language: 'typescript' }).kind).toBe('delete');
    expect(summarizeAiProposal({ path: 'new.ts', previousPath: 'old.ts', original: 'old', modified: 'new', language: 'typescript' }).kind).toBe('rename');
  });
});
