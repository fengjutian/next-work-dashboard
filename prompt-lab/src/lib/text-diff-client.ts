// Vite exposes worker query modules as constructors; ESLint cannot infer this virtual-module shape.
// eslint-disable-next-line import/default
import TextDiffWorker from './text-diff.worker?worker';
import type { TextDiffHunk } from './text-diff';
import type { TextDiffWorkerRequest, TextDiffWorkerResponse } from './text-diff-worker-protocol';

let requestSequence = 0;
type WorkerRequestWithoutId = TextDiffWorkerRequest extends infer Request
  ? Request extends TextDiffWorkerRequest ? Omit<Request, 'id'> : never
  : never;

function runWorker<T>(request: WorkerRequestWithoutId, signal?: AbortSignal, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new TextDiffWorker();
    const id = ++requestSequence;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback();
    };
    const abort = () => finish(() => reject(new DOMException('Diff calculation cancelled', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject(new Error('DIFF_TIMEOUT'))), timeoutMs);
    worker.onmessage = (event: MessageEvent<TextDiffWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.success === false) finish(() => reject(new Error(response.error)));
      else finish(() => resolve(response.result as T));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'DIFF_WORKER_ERROR')));
    if (signal?.aborted) abort();
    else {
      signal?.addEventListener('abort', abort, { once: true });
      worker.postMessage({ ...request, id } as TextDiffWorkerRequest);
    }
  });
}

export function computeTextDiffHunksAsync(original: string, modified: string, signal?: AbortSignal): Promise<TextDiffHunk[]> {
  return runWorker<TextDiffHunk[]>({ operation: 'hunks', original, modified }, signal);
}

export function createUnifiedDiffAsync(
  original: string,
  modified: string,
  originalLabel: string,
  modifiedLabel: string,
  contextLines = 3,
  signal?: AbortSignal,
): Promise<string> {
  return runWorker<string>({ operation: 'patch', original, modified, originalLabel, modifiedLabel, contextLines }, signal);
}
