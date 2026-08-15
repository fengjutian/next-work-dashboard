import { dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authorizeWorkspace, resolveWorkspacePath } from '../workspace/path';
import { scanCodeRepository } from './scanner';

let initialized = false;

export function setupCodeVisualizerIPC(): void {
  if (initialized) return;
  initialized = true;
  ipcMain.handle('code-visualizer:repository:select', async () => {
    const selected = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择 Python + Vue 仓库' });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true };
    authorizeWorkspace(selected.filePaths[0]);
    return { ok: true, rootPath: resolveWorkspacePath(selected.filePaths[0]) };
  });
  ipcMain.handle('code-visualizer:repository:scan', async (_event, rootPath: string) => {
    const safeRoot = resolveWorkspacePath(rootPath);
    return scanCodeRepository(safeRoot);
  });
  ipcMain.handle('code-visualizer:source:read', async (_event, rootPath: string, relativePath: string) => {
    const safeRoot = resolveWorkspacePath(rootPath);
    const target = path.resolve(safeRoot, relativePath);
    const relative = path.relative(safeRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('源码路径超出已授权仓库');
    return { content: await fs.readFile(target, 'utf8'), path: relative.replace(/\\/g, '/') };
  });
}
