import { app, BrowserWindow, dialog, ipcMain, shell, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';

const scans = new Map<string, ChildProcess>();
const authorizedRoots = new Set<string>();
type AuthorizedFile = { path: string; size: number; modifiedAt: number };
const scanResults = new Map<string, {
  root: string;
  files: Map<string, AuthorizedFile>;
  groups: Map<string, string[]>;
  entries: Map<string, 'file' | 'directory'>;
}>();

function normalizeWindowsPath(value: string): string {
  if (process.platform !== 'win32') return value;
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(normalizeWindowsPath(root), normalizeWindowsPath(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function isWithinOrEqualRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(normalizeWindowsPath(root));
  const normalizedCandidate = path.resolve(normalizeWindowsPath(candidate));
  return normalizedRoot === normalizedCandidate || isWithinRoot(normalizedRoot, normalizedCandidate);
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

function authorizedPath(rootPath: string, candidatePath?: string): { root: string; candidate: string } {
  if (typeof rootPath !== 'string') throw new Error('无效的授权目录');
  const root = fs.realpathSync(rootPath);
  if (!authorizedRoots.has(root)) throw new Error('目录未经过用户授权，请重新选择');
  const candidate = fs.realpathSync(candidatePath || root);
  if (!isWithinOrEqualRoot(root, candidate)) throw new Error('拒绝访问授权目录之外的路径');
  return { root, candidate };
}

const textExtensions = new Set(['.txt', '.md', '.markdown', '.json', '.jsonc', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log', '.csv']);
const imageMimeTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function commandOutput(command: string, args: string[]): Promise<{ available: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    const timer = setTimeout(() => child.kill(), 8_000);
    child.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(0, 200_000); });
    child.stderr?.on('data', (chunk) => { error = `${error}${String(chunk)}`.slice(0, 20_000); });
    child.on('error', () => { clearTimeout(timer); resolve({ available: false, output: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ available: code === 0, output: (output || error).trim() }); });
  });
}

async function findSpecialFiles(root: string, extensions: Set<string>, maxDepth = 3): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || found.length >= 100) return;
    let entries: fs.Dirent[]; try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate, depth + 1);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) { try { const stat = await fs.promises.stat(candidate); found.push(`${candidate} · ${(stat.size / 1024 ** 3).toFixed(1)} GB`); } catch { /* ignore disappearing files */ } }
    }));
  }
  await walk(root, 0); return found;
}

export function setupDiskSpaceIPC(): void {
  ipcMain.handle('disk-space:system-info', async () => {
    let disks: Array<{ path: string; total: number; free: number; used: number }> = [];
    const result = spawnSync(scannerPath(), ['disks'], { windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    if (result.status === 0) {
      try { disks = (JSON.parse(result.stdout) as { disks?: typeof disks }).disks ?? []; } catch { /* use statfs fallback */ }
    }
    if (disks.length === 0) {
      const candidates = process.platform === 'win32'
        ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
        : [path.parse(app.getPath('home')).root || '/'];
      const detected = await Promise.all(candidates.map(async (diskPath) => {
        try {
          const disk = await fs.promises.statfs(diskPath);
          const total = disk.blocks * disk.bsize; const free = disk.bavail * disk.bsize;
          return total > 0 ? { path: diskPath, total, free, used: Math.max(0, total - free) } : null;
        } catch { return null; }
      }));
      disks = detected.filter((disk): disk is NonNullable<typeof disk> => disk !== null);
    }
    const memoryTotal = os.totalmem();
    const memoryFree = os.freemem();
    return {
      disks,
      memory: { total: memoryTotal, free: memoryFree, used: Math.max(0, memoryTotal - memoryFree) },
      platform: `${os.type()} ${os.release()}`,
      hostname: os.hostname(),
    };
  });
  ipcMain.handle('disk-space:pick-root', async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = { properties: ['openDirectory'], title: '选择要分析的目录' };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const selected = result.canceled ? null : result.filePaths[0] ?? null;
    if (selected) authorizedRoots.add(fs.realpathSync(selected));
    return selected;
  });
  ipcMain.handle('disk-space:list-directory', async (_event, rootPath: string, directoryPath?: string) => {
    const { candidate } = authorizedPath(rootPath, directoryPath);
    if (!(await fs.promises.stat(candidate)).isDirectory()) throw new Error('目标不是目录');
    const entries = await fs.promises.readdir(candidate, { withFileTypes: true });
    const result = await Promise.all(entries.slice(0, 2000).filter((entry) => !entry.isSymbolicLink()).map(async (entry) => {
      const entryPath = path.join(candidate, entry.name);
      try {
        const stat = await fs.promises.stat(entryPath);
        if (!stat.isDirectory() && !stat.isFile()) return null;
        return { name: entry.name, path: entryPath, type: stat.isDirectory() ? 'directory' as const : 'file' as const, size: stat.isFile() ? stat.size : 0, modifiedAt: stat.mtimeMs, extension: stat.isFile() ? path.extname(entry.name).toLowerCase() : '' };
      } catch { return null; }
    }));
    return result.filter(Boolean).sort((a, b) => a!.type === b!.type ? a!.name.localeCompare(b!.name, 'zh-CN') : a!.type === 'directory' ? -1 : 1);
  });
  ipcMain.handle('disk-space:preview', async (_event, rootPath: string, filePath: string) => {
    const { candidate } = authorizedPath(rootPath, filePath);
    const stat = await fs.promises.stat(candidate);
    if (!stat.isFile()) throw new Error('目标不是文件');
    const extension = path.extname(candidate).toLowerCase();
    const base = { path: candidate, name: path.basename(candidate), size: stat.size, modifiedAt: stat.mtimeMs };
    if (imageMimeTypes[extension]) {
      if (stat.size > 10 * 1024 * 1024) return { ...base, kind: 'unsupported' as const, message: '图片超过 10 MB，暂不支持预览' };
      const content = await fs.promises.readFile(candidate, { encoding: 'base64' });
      return { ...base, kind: 'image' as const, mimeType: imageMimeTypes[extension], content };
    }
    if (textExtensions.has(extension) || stat.size <= 512 * 1024 && extension === '') {
      const limit = 1024 * 1024;
      const handle = await fs.promises.open(candidate, 'r');
      try {
        const length = Math.min(stat.size, limit);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, 0);
        return { ...base, kind: 'text' as const, mimeType: 'text/plain', content: buffer.toString('utf8'), truncated: stat.size > limit };
      } finally { await handle.close(); }
    }
    return { ...base, kind: 'unsupported' as const, message: `暂不支持预览 ${extension || '此类型'} 文件` };
  });
  ipcMain.handle('disk-space:probe-specialties', async () => {
    const [docker, wsl, ollama, npm, pnpm, cargo, gradle, maven, conda, adb, virtualBox, vmware] = await Promise.all([
      commandOutput('docker', ['system', 'df']), commandOutput('wsl.exe', ['--list', '--verbose']), commandOutput('ollama', ['list']),
      commandOutput('npm', ['config', 'get', 'cache']), commandOutput('pnpm', ['store', 'path']), commandOutput('cargo', ['--version']),
      commandOutput('gradle', ['--version']), commandOutput('mvn', ['--version']), commandOutput('conda', ['info']), commandOutput('adb', ['version']), commandOutput('VBoxManage', ['list', 'hdds']), commandOutput('vmrun', ['list']),
    ]);
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const [wslDisks, dockerDisks, virtualBoxDisks, vmwareDisks] = await Promise.all([
      findSpecialFiles(path.join(localAppData, 'Packages'), new Set(['.vhdx']), 3),
      findSpecialFiles(path.join(localAppData, 'Docker'), new Set(['.vhdx']), 5),
      findSpecialFiles(path.join(os.homedir(), 'VirtualBox VMs'), new Set(['.vdi']), 4),
      findSpecialFiles(path.join(os.homedir(), 'Documents', 'Virtual Machines'), new Set(['.vmdk']), 4),
    ]);
    const ollamaModels = ollama.available ? ollama.output.split(/\r?\n/).slice(1, 11).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean) : [];
    const ollamaDetails = await Promise.all(ollamaModels.map((model) => commandOutput('ollama', ['show', model])));
    const make = (id: 'docker' | 'wsl' | 'ollama' | 'node' | 'rust' | 'java' | 'python' | 'android' | 'virtualization', label: string, values: Array<{ available: boolean; output: string }>) => ({ id, label, available: values.some((value) => value.available), summary: values.some((value) => value.available) ? '已检测到，可查看详细信息' : '当前环境未检测到', details: values.filter((value) => value.output).flatMap((value) => value.output.split(/\r?\n/).slice(0, 30)) });
    const probes = [make('docker', 'Docker', [docker]), make('wsl', 'WSL 与 ext4.vhdx', [wsl]), make('ollama', 'Ollama 模型与量化', [ollama, ...ollamaDetails]), make('node', 'npm / pnpm 缓存', [npm, pnpm]), make('rust', 'Rust / Cargo', [cargo]), make('java', 'Gradle / Maven', [gradle, maven]), make('python', 'Conda / Python', [conda]), make('android', 'Android SDK', [adb]), make('virtualization', 'VMware / VirtualBox', [virtualBox, vmware])];
    probes.find((probe) => probe.id === 'wsl')?.details.push(...wslDisks, ...dockerDisks);
    probes.find((probe) => probe.id === 'virtualization')?.details.push(...virtualBoxDisks, ...vmwareDisks);
    return probes;
  });
  ipcMain.handle('disk-space:usn-info', (_event, rootPath: string) => {
    if (typeof rootPath !== 'string' || !rootPath) return { supported: false, error: '未选择扫描目录' };
    const result = spawnSync(scannerPath(), ['usn-info', rootPath], { windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    if (result.status !== 0) return { supported: false, error: result.stderr.trim() || '当前卷不支持 USN Journal' };
    try { return JSON.parse(result.stdout); } catch { return { supported: false, error: 'USN 响应格式无效' }; }
  });
  ipcMain.handle('disk-space:run-cleanup', async (_event, action: string) => {
    const allowlist: Record<string, { command: string; args: string[]; title: string; detail: string }> = {
      'docker-build-cache': { command: 'docker', args: ['builder', 'prune', '-f'], title: '清理 Docker Build Cache', detail: '将调用 docker builder prune，仅清理未使用的构建缓存。' },
      'npm-cache': { command: 'npm', args: ['cache', 'clean', '--force'], title: '清理 npm 缓存', detail: '将调用 npm 官方缓存清理命令，之后安装依赖可能需要重新下载。' },
      'pnpm-store': { command: 'pnpm', args: ['store', 'prune'], title: '整理 pnpm Store', detail: '将调用 pnpm store prune，删除未被项目引用的包。' },
    };
    const config = allowlist[action]; if (!config) throw new Error('不允许的清理动作');
    const window = BrowserWindow.getFocusedWindow(); const options: MessageBoxOptions = { type: 'warning', title: config.title, message: `确认执行“${config.title}”？`, detail: `${config.detail}\n\n命令：${config.command} ${config.args.join(' ')}`, buttons: ['取消', '确认执行'], defaultId: 0, cancelId: 0 };
    const confirmation = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options); if (confirmation.response !== 1) return { success: false, canceled: true };
    const result = await commandOutput(config.command, config.args); if (!result.available) throw new Error(result.output || '官方清理命令执行失败'); return { success: true, output: result.output };
  });
  ipcMain.handle('disk-space:start', (event, scanId: string, rootPath: string, options?: { exclusions?: string[]; skipDuplicates?: boolean; minDuplicateSize?: number }) => {
    if (!scanId || typeof rootPath !== 'string' || scans.has(scanId)) throw new Error('无效或重复的扫描任务');
    const canonicalRoot = fs.realpathSync(rootPath);
    if (!authorizedRoots.has(canonicalRoot)) throw new Error('目录未经过用户授权，请重新选择');
    const exclusions = [...new Set(options?.exclusions ?? [])];
    if (exclusions.length > 20 || exclusions.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 64 || value === '.' || value === '..' || /[\\/\0]/.test(value))) {
      throw new Error('排除目录规则无效');
    }
    const minDuplicateSize = Math.max(4_096, Math.min(1024 ** 3, Math.trunc(options?.minDuplicateSize ?? 4_096)));
    const scannerArguments = ['scan', canonicalRoot, ...exclusions.flatMap((value) => ['--exclude', value]), ...(options?.skipDuplicates ? ['--skip-duplicates'] : []), '--min-duplicate-size', String(minDuplicateSize)];
    const child = spawn(scannerPath(), scannerArguments, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (!child.stdout || !child.stderr) throw new Error('无法连接 Rust 扫描器输出');
    scans.set(scanId, child);
    scanResults.set(scanId, { root: canonicalRoot, files: new Map(), groups: new Map(), entries: new Map() });
    while (scanResults.size > 5) {
      const oldest = scanResults.keys().next().value as string | undefined;
      if (!oldest || oldest === scanId) break;
      scanResults.delete(oldest);
    }
    const sender = event.sender;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const payload = JSON.parse(line) as { type?: string; path?: string; groupId?: string; files?: AuthorizedFile[]; items?: Array<{ path?: string }> };
        const result = scanResults.get(scanId);
        // 攒批事件：files / directories 在 items 数组里展开记录到 entries，便于 trash 校验。
        if ((payload.type === 'files' || payload.type === 'directories') && Array.isArray(payload.items)) {
          const kind = payload.type === 'files' ? 'file' : 'directory';
          for (const item of payload.items) {
            if (item && typeof item.path === 'string') result?.entries.set(item.path, kind);
          }
        }
        if (payload.type === 'duplicate' && Array.isArray(payload.files)) {
          payload.files.forEach((file) => {
            result?.files.set(file.path, file);
            result?.entries.set(file.path, 'file');
          });
          if (result && payload.groupId) result.groups.set(payload.groupId, payload.files.map((file) => file.path));
        }
        if (!sender.isDestroyed()) sender.send('disk-space:event', scanId, payload);
      } catch { /* ignore malformed sidecar output */ }
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4096); });
    child.on('close', (code) => {
      scans.delete(scanId);
      if (!sender.isDestroyed()) sender.send('disk-space:exit', scanId, { code, error: code === 0 ? undefined : stderr.trim() || '扫描器异常退出' });
    });
    return { success: true };
  });
  ipcMain.handle('disk-space:cancel', (_event, scanId: string) => {
    const child = scans.get(scanId);
    if (!child) return false;
    child.kill(); scans.delete(scanId); scanResults.delete(scanId); return true;
  });
  ipcMain.handle('disk-space:pause', (_event, scanId: string) => {
    const child = scans.get(scanId); if (!child?.stdin?.writable) return false; child.stdin.write('pause\n'); return true;
  });
  ipcMain.handle('disk-space:resume', (_event, scanId: string) => {
    const child = scans.get(scanId); if (!child?.stdin?.writable) return false; child.stdin.write('resume\n'); return true;
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
  ipcMain.handle('disk-space:open', async (_event, rootPath: string, requestedPath: string) => {
    if (typeof requestedPath !== 'string') throw new Error('无效的文件路径');
    const canonical = normalizeWindowsPath(fs.realpathSync(requestedPath));
    const requestedRoot = authorizedRoots.has(rootPath) ? rootPath : [...authorizedRoots].find((root) => isWithinOrEqualRoot(root, canonical));
    if (!requestedRoot || !isWithinOrEqualRoot(requestedRoot, canonical)) throw new Error('拒绝打开授权目录之外的路径');
    const error = await shell.openPath(canonical);
    if (error) throw new Error(error);
    return { success: true };
  });
}

export function disposeDiskSpaceService(): void { for (const child of scans.values()) child.kill(); scans.clear(); scanResults.clear(); }
