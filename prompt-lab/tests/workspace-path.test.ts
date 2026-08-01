import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeWorkspace,
  resolveNewWorkspacePath,
  resolveWorkspacePath,
} from '../src/main/workspace-path';

const temporaryDirectories: string[] = [];

function createWorkspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nwd-workspace-'));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, 'src', 'index.ts'), 'export {};', 'utf-8');
  authorizeWorkspace(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('工作区路径边界', () => {
  it('允许解析工作区内的现有文件', () => {
    const workspace = createWorkspace();
    expect(resolveWorkspacePath(workspace, 'src/index.ts'))
      .toBe(fs.realpathSync(path.join(workspace, 'src', 'index.ts')));
  });

  it('拒绝通过相对路径越出工作区', () => {
    const workspace = createWorkspace();
    expect(() => resolveWorkspacePath(workspace, '../outside.txt')).toThrow('ACCESS_DENIED');
    expect(() => resolveNewWorkspacePath(workspace, '../outside.txt')).toThrow('ACCESS_DENIED');
  });

  it('允许在现有目录中创建新路径，但拒绝覆盖工作区根目录', () => {
    const workspace = createWorkspace();
    expect(resolveNewWorkspacePath(workspace, 'src/new.ts'))
      .toBe(path.join(fs.realpathSync(workspace), 'src', 'new.ts'));
    expect(() => resolveNewWorkspacePath(workspace, '')).toThrow('ACCESS_DENIED');
  });
});
