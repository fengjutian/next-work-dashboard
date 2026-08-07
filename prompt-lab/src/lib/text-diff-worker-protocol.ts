import type { TextDiffHunk } from './text-diff';

export type TextDiffWorkerRequest =
  | { id: number; operation: 'hunks'; original: string; modified: string }
  | { id: number; operation: 'patch'; original: string; modified: string; originalLabel: string; modifiedLabel: string; contextLines: number };

export type TextDiffWorkerResponse =
  | { id: number; success: true; operation: 'hunks'; result: TextDiffHunk[] }
  | { id: number; success: true; operation: 'patch'; result: string }
  | { id: number; success: false; error: string };

