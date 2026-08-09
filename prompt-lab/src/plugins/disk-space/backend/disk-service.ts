import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

const scans = new Map<string, ChildProcess>();
const authorizedRoots = new Set<string>();

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
    const sender = event.sender;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => { try { sender.send('disk-space:event', scanId, JSON.parse(line)); } catch { /* ignore malformed sidecar output */ } });
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
}

export function disposeDiskSpaceService(): void { for (const child of scans.values()) child.kill(); scans.clear(); }
