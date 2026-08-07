/// <reference lib="webworker" />
import { computeTextDiffHunks, createUnifiedDiff } from './text-diff';
import type { TextDiffWorkerRequest, TextDiffWorkerResponse } from './text-diff-worker-protocol';

self.onmessage = (event: MessageEvent<TextDiffWorkerRequest>) => {
  const request = event.data;
  try {
    const response: TextDiffWorkerResponse = request.operation === 'hunks'
      ? { id: request.id, success: true, operation: 'hunks', result: computeTextDiffHunks(request.original, request.modified) }
      : {
        id: request.id,
        success: true,
        operation: 'patch',
        result: createUnifiedDiff(request.original, request.modified, request.originalLabel, request.modifiedLabel, request.contextLines),
      };
    self.postMessage(response);
  } catch (error) {
    const response: TextDiffWorkerResponse = { id: request.id, success: false, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};

export {};

