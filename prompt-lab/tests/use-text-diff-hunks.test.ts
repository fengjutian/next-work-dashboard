// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock('@/lib/text-diff-client', () => ({ computeTextDiffHunksAsync: mocks.compute }));

import { DIFF_WORKER_THRESHOLD, useTextDiffHunks } from '../src/plugins/compare/useTextDiffHunks';

describe('useTextDiffHunks', () => {
  it('uses background calculation for large text', async () => {
    mocks.compute.mockResolvedValue([{ index: 0, originalStart: 1, originalLines: ['a'], modifiedStart: 1, modifiedLines: ['b'] }]);
    const original = 'a'.repeat(DIFF_WORKER_THRESHOLD);
    const { result } = renderHook(() => useTextDiffHunks(original, 'b'));
    expect(result.current.computing).toBe(true);
    expect(result.current.worker).toBe(true);
    await waitFor(() => expect(result.current.computing).toBe(false));
    expect(result.current.hunks).toHaveLength(1);
    expect(mocks.compute).toHaveBeenCalledWith(original, 'b', expect.any(AbortSignal));
  });
});

