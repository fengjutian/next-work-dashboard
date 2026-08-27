/**
 * Host capabilities consumed by the Compare panel.
 *
 * The package is host-agnostic. Hosts (e.g. prompt-lab) provide:
 *  - file IO adapters (pickFile / saveFile / writeTextFile)
 *  - Zustand store subset (theme + activeActivity + setter)
 *  - Monaco setup (configureMonaco, languageIdFromName, decodeBase64Utf8)
 *  - worker factory (the `?worker` import is host-specific)
 *  - cross-panel event bus (open content from another panel)
 */

import type {
  FilePickResult,
  SaveFileOptions,
  SaveFileResult,
  WriteTextFileCurrent,
  WriteTextFileOptions,
  WriteTextFileResult,
  WorkspaceEncoding,
} from '../core/types';
import type { TextDiffWorkerRequest, TextDiffWorkerResponse } from '../core/text-diff-worker-protocol';
import type { CompareMode } from '../core/comparison-modes';

export type {
  FilePickResult,
  SaveFileOptions,
  SaveFileResult,
  WriteTextFileCurrent,
  WriteTextFileOptions,
  WriteTextFileResult,
  WorkspaceEncoding,
  CompareMode,
};

export type CompareTheme = 'light' | 'dark' | 'system';

export interface PickedFileSingle {
  path: string;
  text?: string;
  content?: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  modifiedAt?: number;
  size?: number;
  readOnly?: boolean;
}

export interface CompareHostApi {
  pickFile(options?: { accept?: string; multiple?: boolean }): Promise<PickedFileSingle | PickedFileSingle[] | null>;
  saveFile(content: string, defaultName: string, options?: SaveFileOptions): Promise<SaveFileResult>;
  writeTextFile(path: string, content: string, options: WriteTextFileOptions): Promise<WriteTextFileResult>;
}

export interface CompareHostStore {
  theme: CompareTheme;
  activeActivity: string;
  setActiveActivity(activity: string): void;
}

export interface CompareHostMonaco {
  /** Configure Monaco workers / environment. Idempotent. */
  configureMonaco(): void;
  /** Decode a base64 string to UTF-8 text. */
  decodeBase64Utf8(base64: string): string;
  /** Best-effort mapping from a filename / label to a Monaco language id. */
  languageIdFromName(name: string): string;
}

export interface CompareHostWorker {
  /** Spawn a fresh Web Worker that speaks TextDiffWorkerRequest/Response. */
  spawnDiffWorker(): Worker;
  /** Send `request` to the worker and await a single matching response. */
  requestDiff(request: Omit<TextDiffWorkerRequest, 'id'>, signal?: AbortSignal, timeoutMs?: number): Promise<TextDiffWorkerResponse>;
}

export interface CompareHostEvents {
  /** Subscribe to a global `compare:open-content` event (CustomEvent on `window`). */
  onOpenContent(handler: (detail: { left?: FilePickResult; right?: FilePickResult }) => void): () => void;
}

export interface CompareAdapter {
  api: CompareHostApi;
  store: CompareHostStore;
  monaco: CompareHostMonaco;
  worker: CompareHostWorker;
  events: CompareHostEvents;
}
