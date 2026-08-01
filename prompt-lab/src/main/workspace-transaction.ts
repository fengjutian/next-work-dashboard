import fs from 'node:fs';
import { resolveWorkspacePath } from './workspace-path';
import { encodeWorkspaceText, fileWasModified, type WorkspaceEncoding } from './workspace-text';

export interface WorkspaceTextEdit {
  path: string;
  content: string;
  encoding?: WorkspaceEncoding;
  lineEnding?: 'LF' | 'CRLF';
  expectedModifiedAt?: number;
}

export interface WorkspaceTextEditResult {
  path: string;
  size: number;
  modifiedAt: number;
}

interface PreparedEdit extends WorkspaceTextEdit {
  absolutePath: string;
  original: Buffer;
  next: Buffer;
}

const MAX_BATCH_FILES = 200;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;

/** Preflights every file before writing and rolls back earlier writes on failure. */
export function applyWorkspaceTextEdits(rootPath: string, edits: WorkspaceTextEdit[]): WorkspaceTextEditResult[] {
  if (edits.length === 0 || edits.length > MAX_BATCH_FILES) throw new Error('INVALID_EDIT_BATCH');

  const seen = new Set<string>();
  let totalBytes = 0;
  const prepared: PreparedEdit[] = edits.map((edit) => {
    const absolutePath = resolveWorkspacePath(rootPath, edit.path);
    if (seen.has(absolutePath)) throw new Error('DUPLICATE_EDIT_PATH');
    seen.add(absolutePath);

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) throw new Error('NOT_A_FILE');
    if ((stat.mode & 0o200) === 0) throw new Error('FILE_READ_ONLY');
    if (fileWasModified(stat.mtimeMs, edit.expectedModifiedAt)) {
      throw new Error(`FILE_MODIFIED_EXTERNALLY:${edit.path}`);
    }

    const original = fs.readFileSync(absolutePath);
    const next = encodeWorkspaceText(edit.content, edit);
    totalBytes += original.length + next.length;
    if (totalBytes > MAX_BATCH_BYTES) throw new Error('EDIT_BATCH_TOO_LARGE');
    return { ...edit, absolutePath, original, next };
  });

  const written: PreparedEdit[] = [];
  try {
    for (const edit of prepared) {
      fs.writeFileSync(edit.absolutePath, edit.next);
      written.push(edit);
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const edit of written.reverse()) {
      try { fs.writeFileSync(edit.absolutePath, edit.original); } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new Error('EDIT_ROLLBACK_FAILED');
    throw error;
  }

  return prepared.map((edit) => ({
    path: edit.path,
    size: edit.next.length,
    modifiedAt: fs.statSync(edit.absolutePath).mtimeMs,
  }));
}
