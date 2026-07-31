import fs from 'node:fs';
import path from 'node:path';

function assertInsideWorkspace(root: string, target: string, allowRoot: boolean): void {
  const relative = path.relative(root, target);
  if ((!allowRoot && relative === '') || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('ACCESS_DENIED');
  }
}

export function resolveWorkspacePath(rootPath: string, relativePath = ''): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  assertInsideWorkspace(root, target, true);

  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  assertInsideWorkspace(realRoot, realTarget, true);
  return realTarget;
}

export function resolveNewWorkspacePath(rootPath: string, relativePath: string): string {
  const root = fs.realpathSync(path.resolve(rootPath));
  const target = path.resolve(root, relativePath);
  assertInsideWorkspace(root, target, false);

  const parent = fs.realpathSync(path.dirname(target));
  assertInsideWorkspace(root, parent, true);
  return target;
}
