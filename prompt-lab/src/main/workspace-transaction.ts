import fs from 'node:fs';
import { resolveNewWorkspacePath, resolveWorkspacePath } from './workspace-path';
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

export type WorkspaceFileMutation =
  | ({ kind: 'write' } & WorkspaceTextEdit)
  | { kind: 'create'; path: string; content: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF' }
  | { kind: 'delete'; path: string; expectedModifiedAt?: number }
  | { kind: 'rename'; path: string; targetPath: string; content?: string; encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF'; expectedModifiedAt?: number };

export interface WorkspaceFileMutationResult {
  kind: WorkspaceFileMutation['kind'];
  path: string;
  size?: number;
  modifiedAt?: number;
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

interface PreparedMutation {
  mutation: WorkspaceFileMutation;
  absolutePath: string;
  original?: Buffer;
  next?: Buffer;
  targetAbsolutePath?: string;
}

/** Atomically applies AI-style create/write/delete operations to regular files. */
export function applyWorkspaceFileMutations(
  rootPath: string,
  mutations: WorkspaceFileMutation[],
): WorkspaceFileMutationResult[] {
  if (mutations.length === 0 || mutations.length > MAX_BATCH_FILES) throw new Error('INVALID_MUTATION_BATCH');

  const seen = new Set<string>();
  let totalBytes = 0;
  const prepared: PreparedMutation[] = mutations.map((mutation) => {
    const absolutePath = mutation.kind === 'create'
      ? resolveNewWorkspacePath(rootPath, mutation.path)
      : resolveWorkspacePath(rootPath, mutation.path);
    if (seen.has(absolutePath)) throw new Error('DUPLICATE_MUTATION_PATH');
    seen.add(absolutePath);

    const targetPath = mutation.kind === 'rename' ? mutation.targetPath : undefined;
    const targetAbsolutePath = targetPath
      ? resolveNewWorkspacePath(rootPath, targetPath)
      : undefined;
    if (targetAbsolutePath) {
      if (seen.has(targetAbsolutePath)) throw new Error('DUPLICATE_MUTATION_PATH');
      if (fs.existsSync(targetAbsolutePath)) throw new Error(`ALREADY_EXISTS:${targetPath}`);
      seen.add(targetAbsolutePath);
    }

    if (mutation.kind === 'create') {
      if (fs.existsSync(absolutePath)) throw new Error(`ALREADY_EXISTS:${mutation.path}`);
      const next = encodeWorkspaceText(mutation.content, mutation);
      totalBytes += next.length;
      if (totalBytes > MAX_BATCH_BYTES) throw new Error('MUTATION_BATCH_TOO_LARGE');
      return { mutation, absolutePath, next };
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) throw new Error('NOT_A_FILE');
    if ((stat.mode & 0o200) === 0) throw new Error('FILE_READ_ONLY');
    if (fileWasModified(stat.mtimeMs, mutation.expectedModifiedAt)) {
      throw new Error(`FILE_MODIFIED_EXTERNALLY:${mutation.path}`);
    }
    const original = fs.readFileSync(absolutePath);
    const next = mutation.kind === 'write'
      ? encodeWorkspaceText(mutation.content, mutation)
      : mutation.kind === 'rename' && mutation.content !== undefined
        ? encodeWorkspaceText(mutation.content, mutation)
        : undefined;
    totalBytes += original.length + (next?.length ?? 0);
    if (totalBytes > MAX_BATCH_BYTES) throw new Error('MUTATION_BATCH_TOO_LARGE');
    return { mutation, absolutePath, original, next, targetAbsolutePath };
  });

  const applied: PreparedMutation[] = [];
  try {
    for (const item of prepared) {
      // Register before the first filesystem mutation so a failure in a
      // multi-step rename (rename + content write) is also rolled back.
      applied.push(item);
      if (item.mutation.kind === 'delete') fs.unlinkSync(item.absolutePath);
      else if (item.mutation.kind === 'create') fs.writeFileSync(item.absolutePath, item.next!, { flag: 'wx' });
      else if (item.mutation.kind === 'rename') {
        fs.renameSync(item.absolutePath, item.targetAbsolutePath!);
        if (item.next) fs.writeFileSync(item.targetAbsolutePath!, item.next);
      } else fs.writeFileSync(item.absolutePath, item.next!);
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const item of applied.reverse()) {
      try {
        if (item.mutation.kind === 'create') {
          if (fs.existsSync(item.absolutePath)) fs.unlinkSync(item.absolutePath);
        } else if (item.mutation.kind === 'rename') {
          if (item.targetAbsolutePath && fs.existsSync(item.targetAbsolutePath)) {
            fs.renameSync(item.targetAbsolutePath, item.absolutePath);
          }
          fs.writeFileSync(item.absolutePath, item.original!);
        } else {
          fs.writeFileSync(item.absolutePath, item.original!);
        }
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) throw new Error('MUTATION_ROLLBACK_FAILED');
    throw error;
  }

  return prepared.map((item) => {
    if (item.mutation.kind === 'delete') return { kind: 'delete', path: item.mutation.path };
    const resultPath = item.mutation.kind === 'rename' ? item.mutation.targetPath : item.mutation.path;
    const resultAbsolutePath = item.mutation.kind === 'rename' ? item.targetAbsolutePath! : item.absolutePath;
    const stat = fs.statSync(resultAbsolutePath);
    return { kind: item.mutation.kind, path: resultPath, size: stat.size, modifiedAt: stat.mtimeMs };
  });
}
