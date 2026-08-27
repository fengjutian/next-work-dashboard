/**
 * TextDiff worker client — host-agnostic. Uses the
 * `CompareHostWorker` adapter to spawn the actual Web Worker
 * (Vite's `?worker` query syntax is host-specific).
 */

import type { TextDiffHunk } from '../core/text-diff';
import type { TextDiffWorkerRequest, TextDiffWorkerResponse } from '../core/text-diff-worker-protocol';
import type { CompareHostWorker } from './adapter';

export function createDiffClient(worker: CompareHostWorker) {
  return {
    computeTextDiffHunksAsync(original: string, modified: string, signal?: AbortSignal): Promise<TextDiffHunk[]> {
      return worker
        .requestDiff({ operation: 'hunks', original, modified }, signal)
        .then((response) => {
          if (response.success === false) throw new Error(response.error);
          return response.result as TextDiffHunk[];
        });
    },
    createUnifiedDiffAsync(
      original: string,
      modified: string,
      originalLabel: string,
      modifiedLabel: string,
      contextLines = 3,
      signal?: AbortSignal,
    ): Promise<string> {
      return worker
        .requestDiff({ operation: 'patch', original, modified, originalLabel, modifiedLabel, contextLines }, signal)
        .then((response) => {
          if (response.success === false) throw new Error(response.error);
          return response.result as string;
        });
    },
  };
}

export type DiffClient = ReturnType<typeof createDiffClient>;

/** Re-export the request/response types so consumers don't have to
 *  import them from the worker protocol file. */
export type { TextDiffWorkerRequest, TextDiffWorkerResponse };
