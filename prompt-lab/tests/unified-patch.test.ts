import { describe, expect, it } from 'vitest';
import { createUnifiedDiff } from '../src/lib/text-diff';
import { applyUnifiedPatch, parseUnifiedPatch } from '../src/lib/unified-patch';

describe('unified patch', () => {
  const original = ['one', 'two', 'three', 'four', 'five'].join('\n');
  const modified = ['one', 'TWO', 'three', 'inserted', 'four', 'five'].join('\n');
  const patchText = createUnifiedDiff(original, modified, 'old.txt', 'new.txt', 1);

  it('parses and applies generated patches in both directions', () => {
    const patch = parseUnifiedPatch(patchText);
    expect(patch.originalLabel).toBe('old.txt');
    expect(patch.hunks.length).toBeGreaterThan(0);
    expect(applyUnifiedPatch(original, patch)).toMatchObject({ success: true, content: modified });
    expect(applyUnifiedPatch(modified, patch, true)).toMatchObject({ success: true, content: original });
  });

  it('is atomic and reports a context mismatch', () => {
    const result = applyUnifiedPatch(original.replace('three', 'changed externally'), parseUnifiedPatch(patchText));
    expect(result).toMatchObject({ success: false, appliedHunks: 0, failedHunk: 0 });
    expect(result.content).toBe(original.replace('three', 'changed externally'));
    expect(result.error).toContain('PATCH_CONTEXT_MISMATCH');
  });

  it('rejects malformed patches', () => {
    expect(() => parseUnifiedPatch('not a patch')).toThrow('PATCH_HEADERS_MISSING');
    expect(() => parseUnifiedPatch('--- a\n+++ b\n@@ -1,2 +1,1 @@\n-old')).toThrow('PATCH_HUNK_COUNT_MISMATCH');
  });
});

