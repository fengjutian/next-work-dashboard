import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeWorkspace } from '../src/main/workspace-path';
import { applyWorkspaceFileMutations, applyWorkspaceTextEdits } from '../src/main/workspace-transaction';

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

describe('工作区文件生命周期事务', () => {
  it('在同一事务中创建、修改和删除文件', () => {
    const { root, first, second } = createWorkspace();
    const result = applyWorkspaceFileMutations(root, [
      { kind: 'write', path: 'first.txt', content: 'updated', expectedModifiedAt: fs.statSync(first).mtimeMs },
      { kind: 'create', path: 'created.txt', content: 'created' },
      { kind: 'delete', path: 'second.txt', expectedModifiedAt: fs.statSync(second).mtimeMs },
    ]);

    expect(result.map((item) => item.kind)).toEqual(['write', 'create', 'delete']);
    expect(fs.readFileSync(first, 'utf8')).toBe('updated');
    expect(fs.readFileSync(path.join(root, 'created.txt'), 'utf8')).toBe('created');
    expect(fs.existsSync(second)).toBe(false);
  });

  it('创建目标已存在时在首次写入前拒绝整个事务', () => {
    const { root, first } = createWorkspace();
    expect(() => applyWorkspaceFileMutations(root, [
      { kind: 'write', path: 'first.txt', content: 'must-not-change', expectedModifiedAt: fs.statSync(first).mtimeMs },
      { kind: 'create', path: 'second.txt', content: 'duplicate' },
    ])).toThrow('ALREADY_EXISTS:second.txt');
    expect(fs.readFileSync(first, 'utf8')).toBe('first');
  });

  it('原子重命名文件并同时更新内容', () => {
    const { root, first } = createWorkspace();
    const result = applyWorkspaceFileMutations(root, [{
      kind: 'rename',
      path: 'first.txt',
      targetPath: 'renamed.ts',
      content: 'export const renamed = true;\n',
      expectedModifiedAt: fs.statSync(first).mtimeMs,
    }]);

    expect(result[0].path).toBe('renamed.ts');
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.readFileSync(path.join(root, 'renamed.ts'), 'utf8')).toBe('export const renamed = true;\n');
  });

  it('重命名目标已存在时保留源文件和目标文件', () => {
    const { root, first } = createWorkspace();
    expect(() => applyWorkspaceFileMutations(root, [{
      kind: 'rename',
      path: 'first.txt',
      targetPath: 'second.txt',
      expectedModifiedAt: fs.statSync(first).mtimeMs,
    }])).toThrow('ALREADY_EXISTS:second.txt');
    expect(fs.readFileSync(first, 'utf8')).toBe('first');
    expect(fs.readFileSync(path.join(root, 'second.txt'), 'utf8')).toBe('second');
  });

  it('拒绝越出授权工作区的新文件路径', () => {
    const { root } = createWorkspace();
    expect(() => applyWorkspaceFileMutations(root, [
      { kind: 'create', path: '../outside.txt', content: 'unsafe' },
    ])).toThrow('ACCESS_DENIED');
  });

  it('执行中发生写入错误时回滚已经修改的文件', () => {
    const { root, first, second } = createWorkspace();
    const originalWrite = fs.writeFileSync;
    let writeCount = 0;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      writeCount += 1;
      if (writeCount === 2) throw new Error('simulated write failure');
      return originalWrite(...args);
    }) as typeof fs.writeFileSync);

    try {
      expect(() => applyWorkspaceFileMutations(root, [
        { kind: 'write', path: 'first.txt', content: 'changed-first', expectedModifiedAt: fs.statSync(first).mtimeMs },
        { kind: 'write', path: 'second.txt', content: 'changed-second', expectedModifiedAt: fs.statSync(second).mtimeMs },
      ])).toThrow('simulated write failure');
    } finally {
      writeSpy.mockRestore();
    }

    expect(fs.readFileSync(first, 'utf8')).toBe('first');
    expect(fs.readFileSync(second, 'utf8')).toBe('second');
  });
});
