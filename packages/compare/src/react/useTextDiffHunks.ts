import { useEffect, useMemo, useState } from 'react';
import { computeTextDiffHunks, type TextDiffHunk } from '../core/text-diff';
import { useCompareAdapter } from './context';
import { createDiffClient } from './diff-worker-client';

export const DIFF_WORKER_THRESHOLD = 100_000;

interface TextDiffState {
  hunks: TextDiffHunk[];
  computing: boolean;
  error?: string;
  worker: boolean;
}

export function useTextDiffHunks(original: string, modified: string): TextDiffState {
  const { worker: hostWorker } = useCompareAdapter();
  const diffClient = useMemo(() => createDiffClient(hostWorker), [hostWorker]);
  const [state, setState] = useState<TextDiffState>(() => ({
    hunks: original.length + modified.length < DIFF_WORKER_THRESHOLD ? computeTextDiffHunks(original, modified) : [],
    computing: original.length + modified.length >= DIFF_WORKER_THRESHOLD,
    worker: original.length + modified.length >= DIFF_WORKER_THRESHOLD,
  }));

  useEffect(() => {
    if (original.length + modified.length < DIFF_WORKER_THRESHOLD) {
      setState({ hunks: computeTextDiffHunks(original, modified), computing: false, worker: false });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, computing: true, error: undefined, worker: true }));
    diffClient.computeTextDiffHunksAsync(original, modified, controller.signal).then(
      (hunks) => setState({ hunks, computing: false, worker: true }),
      (error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ hunks: [], computing: false, worker: true, error: error instanceof Error && error.message === 'DIFF_TIMEOUT' ? '差异计算超时，仍可使用 Monaco 浏览差异' : '后台差异计算失败，仍可使用 Monaco 浏览差异' });
      },
    );
    return () => controller.abort();
  }, [diffClient, modified, original]);

  return state;
}

