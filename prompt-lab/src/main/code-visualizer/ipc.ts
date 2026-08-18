import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authorizeWorkspace, resolveWorkspacePath } from '../workspace/path';
import { scanCodeRepository } from './scanner';
import { listProjectHistory, recordProjectHistory, removeProjectHistory } from './history';
import { listSnapshots, loadSnapshot, saveSnapshot } from './snapshots';
import { calculateGitImpact, compareOpenApi, diffRepositorySnapshots, type RepositoryAnalysis } from '../../core/code-visualizer';
import { load as loadYaml } from 'js-yaml';
import { parseRuntimeMetrics, readGitInfo, resolveSourceTarget } from './integrations';
import { listGitChangedFiles, parseCoverageFile, runRelatedTests } from './quality';

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
    result.git = await readGitInfo(safeRoot);
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
  ipcMain.handle('code-visualizer:source:open-external', async (_event, rootPath: string, relativePath: string, line = 1) => {
    const safeRoot = resolveWorkspacePath(rootPath);
    const target = resolveSourceTarget(safeRoot, relativePath);
    const url = `vscode://file/${target.replace(/\\/g, '/')}:${Math.max(1, Number(line) || 1)}`;
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('code-visualizer:runtime:import', async (_event, rootPath: string) => {
    resolveWorkspacePath(rootPath);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], title: '导入运行时日志', filters: [{ name: '日志', extensions: ['log', 'jsonl', 'ndjson', 'txt'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true, metrics: [] };
    return { ok: true, metrics: await parseRuntimeMetrics(selected.filePaths[0]) };
  });
  ipcMain.handle('code-visualizer:openapi:import', async (_event, rootPath: string, analysis: RepositoryAnalysis) => {
    resolveWorkspacePath(rootPath);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], title: '导入 OpenAPI 契约', filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true };
    const content = await fs.readFile(selected.filePaths[0], 'utf8');
    return { ok: true, report: compareOpenApi(analysis, loadYaml(content)) };
  });
  ipcMain.handle('code-visualizer:git:impact', async (_event, rootPath: string, base: string, analysis: RepositoryAnalysis) => {
    const safeRoot = resolveWorkspacePath(rootPath);
    const changedFiles = await listGitChangedFiles(safeRoot, base);
    return calculateGitImpact(analysis, changedFiles, base);
  });
  ipcMain.handle('code-visualizer:test:run', async (_event, rootPath: string, files: string[]) => runRelatedTests(resolveWorkspacePath(rootPath), files));
  ipcMain.handle('code-visualizer:coverage:import', async (_event, rootPath: string) => {
    resolveWorkspacePath(rootPath);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], title: '导入覆盖率', filters: [{ name: 'Coverage', extensions: ['info', 'lcov', 'json'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true };
    return { ok: true, report: await parseCoverageFile(selected.filePaths[0]) };
  });
}
