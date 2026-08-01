import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizeWorkspace } from '../src/main/workspace-path';
import { applyWorkspaceTextEdits } from '../src/main/workspace-transaction';

const temporaryDirectories: string[] = [];

function createWorkspace(): { root: string; first: string; second: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nwd-transaction-'));
  temporaryDirectories.push(root);
  const first = path.join(root, 'first.txt');
  const second = path.join(root, 'second.txt');
  fs.writeFileSync(first, 'first', 'utf8');
  fs.writeFileSync(second, 'second', 'utf8');
  authorizeWorkspace(root);
  return { root, first, second };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('工作区文本事务', () => {
  it('在一次事务中写入多个文件', () => {
    const { root, first, second } = createWorkspace();
    const result = applyWorkspaceTextEdits(root, [
      { path: 'first.txt', content: 'FIRST', expectedModifiedAt: fs.statSync(first).mtimeMs },
      { path: 'second.txt', content: 'SECOND', expectedModifiedAt: fs.statSync(second).mtimeMs },
    ]);

    expect(result).toHaveLength(2);
    expect(fs.readFileSync(first, 'utf8')).toBe('FIRST');
    expect(fs.readFileSync(second, 'utf8')).toBe('SECOND');
  });

  it('任一文件已外部修改时在写入前拒绝整个事务', () => {
    const { root, first, second } = createWorkspace();
    const firstModifiedAt = fs.statSync(first).mtimeMs;
    const staleSecondModifiedAt = fs.statSync(second).mtimeMs - 10_000;

    expect(() => applyWorkspaceTextEdits(root, [
      { path: 'first.txt', content: 'changed', expectedModifiedAt: firstModifiedAt },
      { path: 'second.txt', content: 'changed', expectedModifiedAt: staleSecondModifiedAt },
    ])).toThrow('FILE_MODIFIED_EXTERNALLY:second.txt');

    expect(fs.readFileSync(first, 'utf8')).toBe('first');
    expect(fs.readFileSync(second, 'utf8')).toBe('second');
  });

  it('拒绝重复路径，避免同一文件在事务内产生顺序歧义', () => {
    const { root, first } = createWorkspace();
    const modifiedAt = fs.statSync(first).mtimeMs;
    expect(() => applyWorkspaceTextEdits(root, [
      { path: 'first.txt', content: 'one', expectedModifiedAt: modifiedAt },
      { path: 'first.txt', content: 'two', expectedModifiedAt: modifiedAt },
    ])).toThrow('DUPLICATE_EDIT_PATH');
    expect(fs.readFileSync(first, 'utf8')).toBe('first');
  });
});
