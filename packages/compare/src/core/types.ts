/**
 * Public types shared between the React layer and the host adapter.
 * The host provides concrete implementations of the file-pick / save
 * APIs and the diff worker factory; this file only describes the
 * contract.
 */

export type WorkspaceEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk';

export interface FilePickResult {
  name: string;
  path: string;
  text?: string;
  content?: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  modifiedAt?: number;
  size?: number;
  readOnly?: boolean;
}

export interface SaveFileOptions {
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
}

export interface SaveFileResult {
  success: boolean;
  path?: string;
  error?: string;
}

export type WriteTextFileError =
  | 'FILE_MODIFIED_EXTERNALLY'
  | 'FILE_READ_ONLY'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export interface WriteTextFileOptions extends SaveFileOptions {
  expectedModifiedAt?: number;
  force?: boolean;
}

export interface WriteTextFileCurrent {
  content: string;
  encoding: WorkspaceEncoding;
  lineEnding: 'LF' | 'CRLF';
  mixedLineEndings: boolean;
  modifiedAt: number;
}

export interface WriteTextFileResult {
  success: boolean;
  path?: string;
  error?: WriteTextFileError | string;
  current?: WriteTextFileCurrent;
  modifiedAt?: number;
}

export interface CompareDocument {
  label: string;
  content: string;
  savedContent?: string;
  path?: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  modifiedAt?: number;
  readOnly?: boolean;
}
