import { dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authorizeWorkspace, resolveWorkspacePath } from '../workspace/path';
import { scanCodeRepository } from './scanner';
import { listProjectHistory, recordProjectHistory, removeProjectHistory } from './history';
import { listSnapshots, loadSnapshot, saveSnapshot } from './snapshots';
import { diffRepositorySnapshots } from '../../core/code-visualizer';

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
    const result = await scanCodeRepository(safeRoot);
    const snapshot = await saveSnapshot(result);
    if (result.scan) result.scan.snapshotId = snapshot.id;
    await recordProjectHistory(result);
    return result;
  });
  ipcMain.handle('code-visualizer:history:list', () => listProjectHistory());
  ipcMain.handle('code-visualizer:history:open', async (_event, rootPath: string) => {
    const entry = (await listProjectHistory()).find((item) => path.resolve(item.rootPath) === path.resolve(rootPath));
    if (!entry?.available) throw new Error('项目目录已移动或不存在');
    authorizeWorkspace(entry.rootPath);
    return { ok: true, rootPath: resolveWorkspacePath(entry.rootPath) };
  });
  ipcMain.handle('code-visualizer:history:remove', async (_event, rootPath: string) => {
    await removeProjectHistory(rootPath);
    return { ok: true };
  });
  ipcMain.handle('code-visualizer:snapshot:list', (_event, rootPath: string) => listSnapshots(resolveWorkspacePath(rootPath)));
  ipcMain.handle('code-visualizer:snapshot:load', (_event, rootPath: string, id: string) => loadSnapshot(resolveWorkspacePath(rootPath), id));
  ipcMain.handle('code-visualizer:snapshot:diff', async (_event, rootPath: string, fromId: string, toId: string) => {
    const safeRoot = resolveWorkspacePath(rootPath);
    return diffRepositorySnapshots(await loadSnapshot(safeRoot, fromId), await loadSnapshot(safeRoot, toId), fromId, toId);
  });
  ipcMain.handle('code-visualizer:source:read', async (_event, rootPath: string, relativePath: string) => {
    const safeRoot = resolveWorkspacePath(rootPath);
    const target = path.resolve(safeRoot, relativePath);
    const relative = path.relative(safeRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('源码路径超出已授权仓库');
    return { content: await fs.readFile(target, 'utf8'), path: relative.replace(/\\/g, '/') };
  });
}
