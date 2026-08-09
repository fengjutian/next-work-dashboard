import { app, BrowserWindow, dialog, ipcMain, shell, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

const scans = new Map<string, ChildProcess>();
const authorizedRoots = new Set<string>();
type AuthorizedFile = { path: string; size: number; modifiedAt: number };
const scanResults = new Map<string, { root: string; files: Map<string, AuthorizedFile>; groups: Map<string, string[]> }>();

function normalizeWindowsPath(value: string): string {
  if (process.platform !== 'win32') return value;
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(normalizeWindowsPath(root), normalizeWindowsPath(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function scannerPath(): string {
  const executable = process.platform === 'win32' ? 'nwd-disk-scanner.exe' : 'nwd-disk-scanner';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'disk-scanner', executable)]
    : [
        path.join(app.getAppPath(), 'native', 'disk-scanner', 'target', 'release', executable),
        path.join(process.cwd(), 'native', 'disk-scanner', 'target', 'release', executable),
      ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Rust 磁盘扫描器尚未构建，请运行 npm run build:disk-scanner');
  return found;
}

export function setupDiskSpaceIPC(): void {
  ipcMain.handle('disk-space:pick-root', async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = { properties: ['openDirectory'], title: '选择要分析的目录' };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const selected = result.canceled ? null : result.filePaths[0] ?? null;
    if (selected) authorizedRoots.add(fs.realpathSync(selected));
    return selected;
  });
  ipcMain.handle('disk-space:start', (event, scanId: string, rootPath: string) => {
    if (!scanId || typeof rootPath !== 'string' || scans.has(scanId)) throw new Error('无效或重复的扫描任务');
    const canonicalRoot = fs.realpathSync(rootPath);
    if (!authorizedRoots.has(canonicalRoot)) throw new Error('目录未经过用户授权，请重新选择');
    const child = spawn(scannerPath(), ['scan', canonicalRoot], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!child.stdout || !child.stderr) throw new Error('无法连接 Rust 扫描器输出');
    scans.set(scanId, child);
    scanResults.set(scanId, { root: canonicalRoot, files: new Map(), groups: new Map() });
    const sender = event.sender;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const payload = JSON.parse(line) as { type?: string; groupId?: string; files?: AuthorizedFile[] };
        if (payload.type === 'duplicate' && Array.isArray(payload.files)) {
          const result = scanResults.get(scanId);
          payload.files.forEach((file) => result?.files.set(file.path, file));
          if (result && payload.groupId) result.groups.set(payload.groupId, payload.files.map((file) => file.path));
        }
        sender.send('disk-space:event', scanId, payload);
      } catch { /* ignore malformed sidecar output */ }
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4096); });
    child.on('close', (code) => {
      scans.delete(scanId);
      sender.send('disk-space:exit', scanId, { code, error: code === 0 ? undefined : stderr.trim() || '扫描器异常退出' });
    });
    return { success: true };
  });
  ipcMain.handle('disk-space:cancel', (_event, scanId: string) => {
    const child = scans.get(scanId);
    if (!child) return false;
    child.kill(); scans.delete(scanId); return true;
  });
  ipcMain.handle('disk-space:trash', async (_event, scanId: string, requestedPaths: string[]) => {
    const result = scanResults.get(scanId);
    if (!result || !Array.isArray(requestedPaths) || requestedPaths.length === 0 || requestedPaths.length > 100) {
      throw new Error('无效的回收站请求');
    }
    const uniquePaths = [...new Set(requestedPaths)];
    const requestedSet = new Set(uniquePaths);
    for (const groupPaths of result.groups.values()) {
      if (groupPaths.length > 0 && groupPaths.every((filePath) => requestedSet.has(filePath))) {
        throw new Error('每组重复文件必须至少保留一个副本');
      }
    }
    const verified: AuthorizedFile[] = [];
    for (const requestedPath of uniquePaths) {
      const expected = result.files.get(requestedPath);
      if (!expected) throw new Error('文件不属于本次重复文件扫描结果');
      const canonical = normalizeWindowsPath(fs.realpathSync(requestedPath));
      if (!isWithinRoot(result.root, canonical)) throw new Error('拒绝处理授权目录之外的文件');
      const stat = fs.statSync(canonical);
      if (!stat.isFile() || stat.size !== expected.size || Math.trunc(stat.mtimeMs) !== Math.trunc(expected.modifiedAt)) {
        throw new Error(`文件已发生变化，请重新扫描：${requestedPath}`);
      }
      verified.push({ ...expected, path: canonical });
    }
    const total = verified.reduce((sum, file) => sum + file.size, 0);
    const window = BrowserWindow.getFocusedWindow();
    const confirmOptions: MessageBoxOptions = {
      type: 'warning', buttons: ['取消', '移入回收站'], defaultId: 0, cancelId: 0,
      title: '确认清理重复文件',
      message: `将 ${verified.length} 个文件移入系统回收站？`,
      detail: `预计释放 ${(total / 1024 / 1024).toFixed(1)} MB。此操作不会永久删除文件。`,
    };
    const confirmation = window ? await dialog.showMessageBox(window, confirmOptions) : await dialog.showMessageBox(confirmOptions);
    if (confirmation.response !== 1) return { success: false, canceled: true, trashed: [] as string[] };
    const trashed: string[] = [];
    for (const file of verified) {
      await shell.trashItem(file.path);
      trashed.push(file.path);
      result.files.delete(file.path);
    }
    return { success: true, canceled: false, trashed };
  });
}

export function disposeDiskSpaceService(): void { for (const child of scans.values()) child.kill(); scans.clear(); scanResults.clear(); }
