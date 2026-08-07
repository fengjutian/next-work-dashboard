import { describe, expect, it } from 'vitest';
import { applyTextDiffHunk, computeTextDiffHunks, createUnifiedDiff, prepareTextForComparison } from '../src/lib/text-diff';

describe('text diff', () => {
  it('returns no hunks for identical text', () => {
    expect(computeTextDiffHunks('same\ntext', 'same\ntext')).toEqual([]);
  });

  it('handles insertions, deletions and repeated lines without fixed lookahead', () => {
    const original = ['start', 'repeat', 'one', 'repeat', 'two', 'end'].join('\n');
    const modified = ['start', 'repeat', 'inserted', 'one', 'repeat', 'end'].join('\n');
    expect(computeTextDiffHunks(original, modified)).toEqual([
      { index: 0, originalStart: 3, originalLines: [], modifiedStart: 3, modifiedLines: ['inserted'] },
      { index: 1, originalStart: 5, originalLines: ['two'], modifiedStart: 6, modifiedLines: [] },
    ]);
  });

  it('creates a unified diff for replacements', () => {
    expect(createUnifiedDiff('a\nb', 'a\nc', 'before.txt', 'after.txt')).toBe([
      '--- before.txt',
      '+++ after.txt',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+c',
      '',
    ].join('\n'));
  });

  it('separates distant changes into standard context hunks', () => {
    const original = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const modified = ['A', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'I'].join('\n');
    const patch = createUnifiedDiff(original, modified, 'old', 'new', 1);
    expect(patch).toContain('@@ -1,2 +1,2 @@\n-a\n+A\n b');
    expect(patch).toContain('@@ -8,2 +8,2 @@\n h\n-i\n+I');
  });

  it('applies a hunk in either direction', () => {
    const [hunk] = computeTextDiffHunks('a\nleft\nz', 'a\nright\nz');
    expect(applyTextDiffHunk('a\nleft\nz', 'a\nright\nz', hunk, 'left-to-right').modified).toBe('a\nleft\nz');
    expect(applyTextDiffHunk('a\nleft\nz', 'a\nright\nz', hunk, 'right-to-left').original).toBe('a\nright\nz');
  });

  it('normalizes case and blank lines for display-only comparison', () => {
    const options = { ignoreCase: true, ignoreBlankLines: true };
    expect(prepareTextForComparison('Hello\n  \nWORLD', options)).toBe('hello\nworld');
  });
});
