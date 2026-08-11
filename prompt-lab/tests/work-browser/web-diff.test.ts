/**
 * Web Diff — 行级 LCS
 */
import { describe, it, expect } from 'vitest';
import { lineDiff, collapseHunks, summarizeDiff } from '@/core/work-browser/document/diff';

describe('lineDiff', () => {
  it('detects added lines', () => {
    const a = 'one\ntwo\nthree';
    const b = 'one\ntwo\nthree\nfour';
    const hunks = lineDiff(a, b);
    expect(hunks.filter((h) => h.kind === 'add').map((h) => h.text)).toContain('four');
  });

  it('detects removed lines', () => {
    const a = 'one\ntwo\nthree';
    const b = 'one\nthree';
    const hunks = lineDiff(a, b);
    expect(hunks.find((h) => h.kind === 'remove' && h.text === 'two')).toBeTruthy();
  });

  it('keeps context for unchanged lines', () => {
    const a = 'a\nb\nc';
    const b = 'a\nx\nc';
    const hunks = lineDiff(a, b);
    const ctx = hunks.filter((h) => h.kind === 'context').map((h) => h.text);
    expect(ctx).toContain('a');
    expect(ctx).toContain('c');
  });
});

describe('collapseHunks', () => {
  it('collapses long context gaps', () => {
    const a = Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join('\n');
    const b = a.replace('L15', 'L15-changed');
    const hunks = collapseHunks(lineDiff(a, b), 3);
    expect(hunks.length).toBeLessThan(20);
  });
});

describe('summarizeDiff', () => {
  it('produces "+N / -M / K 段"', () => {
    const a = 'a\nb\nc';
    const b = 'a\nx\nc\nd';
    const s = summarizeDiff(lineDiff(a, b));
    expect(s).toMatch(/^\+\d+ \/ -\d+ \/ \d+ 段$/);
  });
});
