import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/text-diff.worker?worker', () => ({
  default: class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminate() { /* no-op test worker */ }

    postMessage(request: { id: number; operation: 'hunks' | 'patch' }) {
      queueMicrotask(() => this.onmessage?.({
        data: request.operation === 'hunks'
          ? { id: request.id, success: true, operation: 'hunks', result: [{ index: 0 }] }
          : { id: request.id, success: true, operation: 'patch', result: 'patch output' },
      } as MessageEvent));
    }
  },
}));

import { computeTextDiffHunksAsync, createUnifiedDiffAsync } from '../src/lib/text-diff-client';

describe('text diff worker client', () => {
  it('returns hunk and patch worker responses', async () => {
    await expect(computeTextDiffHunksAsync('a', 'b')).resolves.toEqual([{ index: 0 }]);
    await expect(createUnifiedDiffAsync('a', 'b', 'old', 'new')).resolves.toBe('patch output');
  });

  it('supports cancellation before work starts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(computeTextDiffHunksAsync('a', 'b', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
