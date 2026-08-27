import { describe, expect, it } from 'vitest';
import {
  prepareTextForComparison,
  applyTextDiffHunk,
  applyUnifiedPatch,
  parseUnifiedPatch,
  formatCsvForComparison,
  formatJsonForComparison,
  canonicalizeJson,
  diffJsonTree,
  applyJsonPatch,
  createJsonPatch,
  type TextDiffHunk,
} from '../src/core';

describe('@next-work-dashboard/compare core', () => {
  it('exports a unified diff surface', () => {
    expect(typeof prepareTextForComparison).toBe('function');
    expect(typeof applyTextDiffHunk).toBe('function');
  });

  it('prepareTextForComparison applies whitespace + case filters', () => {
    expect(prepareTextForComparison('A\n\nB', { ignoreBlankLines: true, ignoreCase: true })).toBe('a\nb');
  });

  it('applyTextDiffHunk pushes lines from the opposite side', () => {
    const left = 'one\ntwo\nthree\n';
    const right = 'one\nTWO\nthree\n';
    const hunk: TextDiffHunk = {
      index: 0,
      originalStart: 2,
      originalLines: ['two'],
      modifiedStart: 2,
      modifiedLines: ['TWO'],
    };
    const result = applyTextDiffHunk(left, right, hunk, 'left-to-right');
    expect(result.modified).toBe('one\ntwo\nthree\n');
  });

  it('parseUnifiedPatch + applyUnifiedPatch round-trips a simple patch', () => {
    const source = 'a\nb\nc\n';
    const patchText = '--- orig\n+++ mod\n@@ -1,3 +1,3 @@\n a\n-b\n+BB\n c\n';
    const patch = parseUnifiedPatch(patchText);
    const result = applyUnifiedPatch(source, patch);
    expect(result.success).toBe(true);
    expect(result.content).toBe('a\nBB\nc\n');
  });

  it('formatCsvForComparison pads columns', () => {
    const csv = 'a,b\nc,d,e\n';
    expect(formatCsvForComparison(csv)).toContain('a │ b');
    expect(formatCsvForComparison(csv)).toContain('c │ d │ e');
  });

  it('JSON diff: canonicalize + diff + apply round-trip', () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 1, b: 22, d: 4 };
    const changes = diffJsonTree(
      canonicalizeJson(before),
      canonicalizeJson(after),
    );
    expect(changes.some((change) => change.path === '/b' && change.type === 'replace')).toBe(true);
    expect(applyJsonPatch(before, createJsonPatch(before, after))).toEqual(after);
  });
});
