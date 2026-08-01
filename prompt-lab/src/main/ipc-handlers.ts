import { BrowserWindow, app, ipcMain, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import AutoLaunch from 'electron-auto-launch';
import { getMainWindow } from './globals';
import { fetchSiteFavicon } from './favicon';
import { saveToken, getToken, deleteToken, listServices, clearAll, isEncryptionAvailable } from '../auth/token-store';
import { createSession, write, resize, destroySession } from '../terminal/terminal-manager';
import { resolveNewWorkspacePath, resolveWorkspacePath, authorizeWorkspace } from './workspace-path';
import { decodeWorkspaceText, encodeWorkspaceText, fileWasModified } from './workspace-text';
import { applyWorkspaceTextEdits, type WorkspaceTextEdit } from './workspace-transaction';
import { redactGitSecrets } from './git-security';

const WORKSPACE_IGNORED_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]);
const MAX_EDITOR_FILE_SIZE = 5 * 1024 * 1024;
const MAX_READ_ONLY_FILE_SIZE = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);

// --- Git operation queue (per-workspace serial + cancellation) ---
const gitQueues = new Map<string, Promise<void>>();
const gitControllers = new Map<string, AbortController>();
const GIT_NETWORK_TIMEOUT_MS = 120_000;
const GIT_LOCAL_TIMEOUT_MS = 30_000;
const networkOps = new Set(['fetch', 'pull', 'push', 'sync']);

function enqueueGitOp(root: string, fn: () => Promise<unknown>): Promise<unknown> {
  const previous = gitQueues.get(root) ?? Promise.resolve();
  let resolveOp!: (v: unknown) => void;
  const promise = new Promise<unknown>((res) => { resolveOp = res; });
  const next = previous
    .then(() => fn(), () => undefined)
    .then(resolveOp, resolveOp);
  gitQueues.set(root, next.then(() => undefined, () => undefined));
  return promise;
}

function cancelGitOp(_root: string, operationId: string): boolean {
  const ctrl = gitControllers.get(operationId);
  if (!ctrl) return false;
  ctrl.abort();
  gitControllers.delete(operationId);
  return true;
}

function validateGitRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.startsWith('-') || !/^[\w./-]+$/.test(ref) || ref.includes('..')) throw new Error('INVALID_GIT_REF');
  return ref;
}

async function runGit(root: string, args: string[], maxBuffer = 10 * 1024 * 1024, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('GIT_CANCELLED');
  const result = await execFileAsync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    signal,
  });
  return redactGitSecrets(result.stdout.trim());
}

async function applyGitPatch(root: string, patchText: string): Promise<string> {
  if (!patchText || patchText.length > 5 * 1024 * 1024) throw new Error('INVALID_GIT_PATCH');
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply', '--cached', '--unidiff-zero', '-'], {
      cwd: root, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `git apply exited with ${code}`)));
    child.stdin.end(patchText);
  });
}

export function setupIPC(webviewPreloadPath: string) {
  const mw = getMainWindow();
  if (!mw) return;
  let workspaceWatcher: fs.FSWatcher | null = null;

  // 暴露 webview preload 路径给渲染进程
  ipcMain.handle('get-webview-preload-path', () => {
    return webviewPreloadPath;
  });

  // WebView 右键菜单 (B05)
  mw.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate([
      {
        label: '注入选中提示词',
        enabled: !!params,
        click: () => {
          mw.webContents.send('inject-from-context-menu');
        },
      },
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
    ]).popup();
  });

  // ── 提示词注入 ──
  ipcMain.handle('inject-prompt', async (_event, payload: {
    webviewId: number;
    text: string;
    inputSelector: string;
    submitSelector?: string;
    autoSubmit: boolean;
  }) => {
    const webview = mw.webContents;
    if (!webview) return { success: false, error: 'NO_WINDOW' };

    try {
      await webview.executeJavaScript(`
        (function() {
          const input = document.querySelector('${payload.inputSelector}');
          if (!input) return { success: false, error: 'INPUT_NOT_FOUND' };

          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          )?.set;

          if (nativeSetter) {
            nativeSetter.call(input, ${JSON.stringify(payload.text)});
          } else {
            input.value = ${JSON.stringify(payload.text)};
          }

          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));

          ${
            payload.autoSubmit && payload.submitSelector
              ? `const btn = document.querySelector('${payload.submitSelector}');
                 btn?.click();`
              : ''
          }

          return { success: true };
        })();
      `);

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 窗口控制 ──
  ipcMain.handle('window-minimize', () => mw.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mw.isMaximized()) mw.unmaximize();
    else mw.maximize();
  });
  ipcMain.handle('window-close', () => mw.close());

  // ── 窗口置顶 ──
  ipcMain.handle('window-toggle-always-on-top', () => {
    const ontop = !mw.isAlwaysOnTop();
    mw.setAlwaysOnTop(ontop);
    return ontop;
  });

  // ── 开机启动 ──
  const autoLauncher = new AutoLaunch({ name: 'next-work-dashboard' });
  ipcMain.handle('auto-launch-get', async () => {
    try { return await autoLauncher.isEnabled(); } catch { return false; }
  });
  ipcMain.handle('auto-launch-set', async (_e, enabled: boolean) => {
    if (enabled) await autoLauncher.enable();
    else await autoLauncher.disable();
    return enabled;
  });

  // ── 数据持久化路径 ──
  const dataPath = path.join(app.getPath('userData'), 'next-work-dashboard-data.json');
  const dbPath = path.join(app.getPath('userData'), 'next-work-dashboard.db');
  const exportDir = path.join(app.getPath('documents'), 'next-work-dashboard', 'conversations');

  // ── favicon ──
  ipcMain.handle('fetch-favicon', async (_event, siteUrl: string) => {
    return await fetchSiteFavicon(siteUrl);
  });

  // ── 通用 HTTP fetch（绕过 CORS，供 AI 工具使用） ──
  ipcMain.handle('fetch-url', async (_event, url: string, options?: { headers?: Record<string, string> }) => {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...options?.headers,
        },
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text, contentType: resp.headers.get('content-type') || '' };
    } catch (err: any) {
      return { ok: false, status: 0, text: '', error: err.message };
    }
  });

  // ── JSON 存储 ──
  ipcMain.handle('store-save', async (_event, data: string) => {
    try {
      fs.writeFileSync(dataPath, data, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('store-load', async () => {
    try {
      if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, 'utf-8');
        return JSON.parse(raw);
      }
      return null;
    } catch {
      return null;
    }
  });

  // ── SQLite 数据库持久化 ──
  ipcMain.handle('db:load', async () => {
    try {
      if (fs.existsSync(dbPath)) {
        const buf = fs.readFileSync(dbPath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      return null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('db:save', async (_event, buffer: ArrayBuffer) => {
    try {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dbPath, Buffer.from(buffer));
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 对话捕获存储 ──
  ipcMain.handle('store-conversation', async (_event, payload: {
    site: string;
    timestamp: number;
    requestBody: unknown;
    responseContent: string;
    title?: string;
    notes?: string;
    createNew?: boolean;
  }) => {
    try {
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const date = new Date(payload.timestamp).toISOString().split('T')[0];
      const time = new Date(payload.timestamp).toLocaleTimeString('zh-CN');

      const isNewFile = payload.createNew || !!payload.title;
      const fileName = isNewFile
        ? `${payload.site}-${date}-${payload.timestamp}.md`
        : `${payload.site}-${date}.md`;
      const filePath = path.join(exportDir, fileName);

      let userMsg = '(无法解析)';
      try {
        const body = payload.requestBody as Record<string, unknown>;
        if (body?.messages && Array.isArray(body.messages)) {
          const lastUser = [...body.messages].reverse().find(
            (m: Record<string, unknown>) => m.role === 'user'
          ) as Record<string, unknown> | undefined;
          if (lastUser?.content) {
            userMsg = typeof lastUser.content === 'string'
              ? lastUser.content
              : JSON.stringify(lastUser.content);
          }
        } else if (body?.prompt) {
          userMsg = String(body.prompt);
        } else if (body?.query) {
          userMsg = String(body.query);
        }
      } catch { /* keep default */ }

      const entryParts: string[] = [];

      if (isNewFile && payload.title) {
        entryParts.push(`# ${payload.title}`);
        entryParts.push('');
        if (payload.notes) {
          entryParts.push(`> ${payload.notes}`);
          entryParts.push('');
        }
      }

      entryParts.push('', `---`, `### 🧑 用户 — ${time}`, '', userMsg, '', `### 🤖 AI — ${time}`, '', payload.responseContent, '');

      const entry = entryParts.join('\n');

      if (isNewFile) {
        fs.writeFileSync(filePath, entry, 'utf-8');
      } else {
        fs.appendFileSync(filePath, entry, 'utf-8');
      }

      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 对话历史管理 ──
  ipcMain.handle('list-conversations', async () => {
    try {
      if (!fs.existsSync(exportDir)) return [];

      const list: Array<{
        site: string;
        date: string;
        fileName: string;
        path: string;
        size: number;
        title?: string;
        notes?: string;
      }> = [];

      const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const match = file.match(/^(.+)-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md$/);
        const stat = fs.statSync(path.join(exportDir, file));
        const filePath = path.join(exportDir, file);

        let title: string | undefined;
        let notes: string | undefined;
        try {
          const head = fs.readFileSync(filePath, 'utf-8').slice(0, 1024);
          const titleMatch = head.match(/^# (.+)$/m);
          if (titleMatch) title = titleMatch[1].trim();
          const notesMatch = head.match(/^> (.+)$/m);
          if (notesMatch) notes = notesMatch[1].trim();
        } catch { /* keep undefined */ }

        list.push({
          site: match?.[1] || 'unknown',
          date: match?.[2] || '',
          fileName: file,
          path: filePath,
          size: stat.size,
          title,
          notes,
        });
      }

      list.sort((a, b) => b.date.localeCompare(a.date) || a.site.localeCompare(b.site));
      return list;
    } catch {
      return [];
    }
  });

  ipcMain.handle('read-conversation', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(exportDir))) {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'NOT_FOUND' };
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('delete-conversation', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(exportDir))) {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 按路径读取文件（供 AI 工具使用） ──
  ipcMain.handle('dialog:readFileBuffer', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: '文件不存在' };
      }
      const buf = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
      };
      return {
        success: true,
        data: buf.toString('base64'),
        mimeType: mimeMap[ext] ?? 'application/octet-stream',
        name: path.basename(resolved),
        size: buf.length,
      };
    } catch (err: any) {
      return { success: false, error: String(err?.message ?? err) };
    }
  });

  // ── 文件对话框 ──
  ipcMain.handle('dialog:pickFile', async (_event, options?: { accept?: string; multiple?: boolean }) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const filters = options?.accept
        ? [{ name: '文件', extensions: options.accept.split(',').map((e) => e.replace(/^\./, '')) }]
        : [];
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        filters: filters.length > 0 ? filters : undefined,
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const buf = fs.readFileSync(filePath);
          const name = path.basename(filePath);
          const ext = path.extname(name).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.xls': 'application/vnd.ms-excel',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.pdf': 'application/pdf',
            '.json': 'application/json',
            '.csv': 'text/csv',
            '.txt': 'text/plain',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
          };
          return {
            path: filePath,
            name,
            size: buf.length,
            content: buf.toString('base64'),
            mimeType: mimeMap[ext] ?? 'application/octet-stream',
          };
        }),
      );
      return files.length === 1 ? files[0] : files;
    } catch {
      return null;
    }
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const rootPath = result.filePaths[0];
      const files: Array<{ path: string; name: string; size: number }> = [];
      const visit = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            visit(fullPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            files.push({
              path: fullPath,
              name: path.relative(rootPath, fullPath),
              size: stat.size,
            });
          }
        }
      };
      visit(rootPath);
      return { path: rootPath, name: path.basename(rootPath), files };
    } catch (err) {
      return { error: String(err), files: [] };
    }
  });

  // ── 代码编辑器工作区（目录按需读取，不递归扫描） ──
  ipcMain.handle('workspace:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = path.resolve(result.filePaths[0]);
    authorizeWorkspace(rootPath);
    return { path: rootPath, name: path.basename(rootPath) };
  });

  ipcMain.handle('workspace:reauthorize', async (_event, rootPath: string) => {
    authorizeWorkspace(rootPath);
    return { success: true };
  });

  ipcMain.handle('workspace:listDirectory', async (
    _event,
    rootPath: string,
    relativePath = '',
  ) => {
    try {
      const directory = resolveWorkspacePath(rootPath, relativePath);
      const stat = fs.statSync(directory);
      if (!stat.isDirectory()) return { success: false, error: 'NOT_A_DIRECTORY' };

      const entries = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => !WORKSPACE_IGNORED_NAMES.has(entry.name))
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => {
          const entryRelativePath = path.join(relativePath, entry.name);
          if (entry.isDirectory()) {
            return { name: entry.name, path: entryRelativePath, type: 'directory' as const };
          }
          return {
            name: entry.name,
            path: entryRelativePath,
            type: 'file' as const,
            size: fs.statSync(resolveWorkspacePath(rootPath, entryRelativePath)).size,
          };
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:readTextFile', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const filePath = resolveWorkspacePath(rootPath, relativePath);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, error: 'NOT_A_FILE' };
      if (stat.size > MAX_READ_ONLY_FILE_SIZE) return { success: false, error: 'FILE_TOO_LARGE' };
      const buffer = fs.readFileSync(filePath);
      const decoded = decodeWorkspaceText(buffer);
      return {
        success: true,
        data: {
          ...decoded,
          size: buffer.length,
          modifiedAt: stat.mtimeMs,
          readOnly: stat.size > MAX_EDITOR_FILE_SIZE || (stat.mode & 0o200) === 0,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:writeTextFile', async (
    _event,
    rootPath: string,
    relativePath: string,
    content: string,
    options?: {
      encoding?: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk';
      lineEnding?: 'LF' | 'CRLF';
      expectedModifiedAt?: number;
      force?: boolean;
    },
  ) => {
    try {
      const filePath = resolveWorkspacePath(rootPath, relativePath);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, error: 'NOT_A_FILE' };
      if ((stat.mode & 0o200) === 0) return { success: false, error: 'FILE_READ_ONLY' };
      if (
        !options?.force
        && fileWasModified(stat.mtimeMs, options?.expectedModifiedAt)
      ) {
        return { success: false, error: 'FILE_MODIFIED_EXTERNALLY' };
      }
      const buffer = encodeWorkspaceText(content, options);
      fs.writeFileSync(filePath, buffer);
      const modifiedAt = fs.statSync(filePath).mtimeMs;
      return { success: true, data: { size: buffer.length, modifiedAt } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:writeTextFiles', async (
    _event,
    rootPath: string,
    edits: WorkspaceTextEdit[],
  ) => {
    try {
      return { success: true, data: applyWorkspaceTextEdits(rootPath, edits) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:createFile', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const filePath = resolveNewWorkspacePath(rootPath, relativePath);
      if (fs.existsSync(filePath)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.writeFileSync(filePath, '', { encoding: 'utf-8', flag: 'wx' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:createDirectory', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const directory = resolveNewWorkspacePath(rootPath, relativePath);
      if (fs.existsSync(directory)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.mkdirSync(directory);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:renameEntry', async (
    _event,
    rootPath: string,
    relativePath: string,
    nextRelativePath: string,
  ) => {
    try {
      const source = resolveWorkspacePath(rootPath, relativePath);
      const target = resolveNewWorkspacePath(rootPath, nextRelativePath);
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.renameSync(source, target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:deleteEntry', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      if (path.relative(fs.realpathSync(rootPath), target) === '') {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true });
      else fs.unlinkSync(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:trashEntry', async (
    _event,
    rootPath: string,
    relativePath: string,
  ) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      if (path.relative(fs.realpathSync(rootPath), target) === '') {
        return { success: false, error: 'ACCESS_DENIED' };
      }
      await shell.trashItem(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:copyEntry', async (
    _event,
    rootPath: string,
    sourcePath: string,
    targetPath: string,
  ) => {
    try {
      const source = resolveWorkspacePath(rootPath, sourcePath);
      const target = resolveNewWorkspacePath(rootPath, targetPath);
      if (fs.existsSync(target)) return { success: false, error: 'ALREADY_EXISTS' };
      fs.cpSync(source, target, { recursive: true, errorOnExist: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:revealEntry', async (_event, rootPath: string, relativePath: string) => {
    try {
      const target = resolveWorkspacePath(rootPath, relativePath);
      shell.showItemInFolder(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:listTasks', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const tasks: Array<{ name: string; command: string; detail: string }> = [];
      // package.json scripts
      const packagePath = path.join(root, 'package.json');
      if (fs.existsSync(packagePath)) {
        const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
        for (const [name, command] of Object.entries(parsed.scripts ?? {})) tasks.push({ name: `npm: ${name}`, command: `npm run ${name}`, detail: command });
      }
      // .vscode/tasks.json
      const tasksPath = path.join(root, '.vscode', 'tasks.json');
      if (fs.existsSync(tasksPath)) {
        const parsed = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as { tasks?: Array<{ label?: string; type?: string; command?: string; args?: string[] }> };
        for (const task of parsed.tasks ?? []) {
          if (task.label && task.command) tasks.push({ name: task.label, command: `${task.command} ${(task.args ?? []).join(' ')}`, detail: task.type ?? 'shell' });
        }
      }
      return { success: true, data: tasks };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:listFiles', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const files: Array<{ name: string; path: string; type: 'file' }> = [];
      const visit = (directory: string) => {
        if (files.length >= 5000) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(fullPath);
          else if (entry.isFile()) {
            files.push({
              name: entry.name,
              path: path.relative(root, fullPath),
              type: 'file',
            });
          }
          if (files.length >= 5000) break;
        }
      };
      visit(root);
      return { success: true, data: files };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:search', async (
    _event,
    rootPath: string,
    query: string,
    options?: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; include?: string; exclude?: string },
  ) => {
    try {
      if (!query || query.length > 500) return { success: true, data: [] };
      const root = resolveWorkspacePath(rootPath);
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = options?.useRegex ? query : escapeRegExp(query);
      const matcher = new RegExp(options?.wholeWord ? `\\b(?:${source})\\b` : source, options?.caseSensitive ? 'g' : 'gi');
      const globMatches = (relativePath: string, pattern: string) => {
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const normalizedPattern = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '/**');
        if (!normalizedPattern) return false;
        const marker = '__DOUBLE_STAR__';
        const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, marker).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replaceAll(marker, '.*');
        return new RegExp(normalizedPattern.includes('/') ? `^${escaped}$` : `(?:^|/)${escaped}(?:$|/)`, 'i').test(normalizedPath);
      };
      const pathMatches = (relativePath: string, filter?: string) => {
        if (!filter?.trim()) return true;
        return filter.split(',').some((part) => globMatches(relativePath, part));
      };
      const ignorePatterns = ['.gitignore', '.ignore'].flatMap((name) => {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) return [];
        return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
      });
      const isIgnored = (relativePath: string, extraPatterns: string[] = []) =>
        [...ignorePatterns, ...extraPatterns].some((pattern) => globMatches(relativePath, pattern));
      const results: Array<{ path: string; line: number; column: number; preview: string }> = [];
      const visit = (directory: string, parentPatterns: string[] = []) => {
        if (results.length >= 500) return;
        // Load .gitignore from current directory
        const dirPatterns: string[] = [];
        for (const name of ['.gitignore', '.ignore']) {
          const file = path.join(directory, name);
          if (directory === root) continue; // already loaded
          if (fs.existsSync(file)) {
            dirPatterns.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!')));
          }
        }
        const mergedPatterns = [...parentPatterns, ...dirPatterns];
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
          const fullPath = path.join(directory, entry.name);
          const relativePath = path.relative(root, fullPath);
          if (isIgnored(relativePath, mergedPatterns)) continue;
          if (entry.isDirectory()) {
            visit(fullPath, mergedPatterns);
          } else if (entry.isFile()) {
            if (!pathMatches(relativePath, options?.include) || (options?.exclude && pathMatches(relativePath, options.exclude))) continue;
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue;
            let decoded;
            try {
              decoded = decodeWorkspaceText(fs.readFileSync(fullPath));
            } catch {
              continue;
            }
            const lines = decoded.content.split(/\r?\n/);
            for (let index = 0; index < lines.length && results.length < 500; index += 1) {
              matcher.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = matcher.exec(lines[index])) && results.length < 500) {
                results.push({ path: relativePath, line: index + 1, column: match.index + 1, preview: lines[index].trim().slice(0, 240) });
                if (match[0].length === 0) matcher.lastIndex += 1;
              }
            }
          }
          if (results.length >= 500) break;
        }
      };
      visit(root);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitStatus', async (_event, rootPath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      });
      const entries = output.split('\0').filter(Boolean).map((record) => ({
        status: record.slice(0, 2),
        path: record.slice(3).replace(/^.* -> /, ''),
      }));
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitShowHead', async (_event, rootPath: string, relativePath: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const absolutePath = resolveWorkspacePath(rootPath, relativePath);
      const safeRelativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      const content = execFileSync('git', ['show', `HEAD:${safeRelativePath}`], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024,
      });
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitStage', async (_event, rootPath: string, relativePaths: string[]) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const paths = relativePaths.map((relativePath) => path.relative(root, resolveWorkspacePath(rootPath, relativePath)));
      if (paths.length === 0) return { success: true };
      execFileSync('git', ['add', '--', ...paths], { cwd: root, windowsHide: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitUnstage', async (_event, rootPath: string, relativePaths: string[]) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const paths = relativePaths.map((relativePath) => path.relative(root, resolveWorkspacePath(rootPath, relativePath)));
      if (paths.length === 0) return { success: true };
      execFileSync('git', ['restore', '--staged', '--', ...paths], { cwd: root, windowsHide: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:gitCommit', async (_event, rootPath: string, message: string) => {
    try {
      const root = resolveWorkspacePath(rootPath);
      const normalizedMessage = message.trim();
      if (!normalizedMessage || normalizedMessage.length > 5000) return { success: false, error: 'INVALID_COMMIT_MESSAGE' };
      const output = execFileSync('git', ['commit', '-m', normalizedMessage], {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      });
      return { success: true, data: output.trim() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:cancelGitOperation', async (_event, rootPath: string, operationId: string) => {
    return { success: cancelGitOp(rootPath, operationId) };
  });

  ipcMain.handle('workspace:gitOperation', async (
    _event,
    rootPath: string,
    operation: string,
    payload: Record<string, unknown> = {},
  ) => {
    const root = resolveWorkspacePath(rootPath);
    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const progress = (state: 'started' | 'completed' | 'failed' | 'cancelled', message: string) => {
      mw.webContents.send('workspace:gitProgress', { operationId, operation, state, message });
    };

    const timeoutMs = networkOps.has(operation) ? GIT_NETWORK_TIMEOUT_MS : GIT_LOCAL_TIMEOUT_MS;
    const controller = new AbortController();
    gitControllers.set(operationId, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    return enqueueGitOp(root, async () => {
      const signal = controller.signal;
      progress('started', `正在执行 ${operation}`);
      try {
        if (signal.aborted) throw new Error('GIT_CANCELLED');
        let data: unknown;
        if (operation === 'overview') {
          const [branchResult, branches, remotes, tags, ab] = await Promise.all([
            runGit(root, ['branch', '--show-current'], 2 * 1024 * 1024, signal),
            runGit(root, ['branch', '--format=%(refname:short)%09%(HEAD)'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['remote', '-v'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['tag', '--sort=-creatordate'], 2 * 1024 * 1024, signal).catch(() => ''),
            runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], 2 * 1024 * 1024, signal).catch(() => ''),
          ]);
          const branch = branchResult;
          const [ahead, behind] = ab.split('\t').map(Number);
          data = {
            branch,
            ahead: Number.isFinite(ahead) ? ahead : 0,
            behind: Number.isFinite(behind) ? behind : 0,
            branches: branches.split(/\r?\n/).filter(Boolean).map((line) => {
              const [name, head] = line.split('\t'); return { name, current: head === '*' };
            }),
            remotes: remotes.split(/\r?\n/).filter(Boolean),
            tags: tags.split(/\r?\n/).filter(Boolean),
          };
        } else if (operation === 'createBranch') {
          data = await runGit(root, ['switch', '-c', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else if (operation === 'deleteBranch') {
          const name = validateGitRef(String(payload.name ?? ''));
          data = await runGit(root, ['branch', '-d', name], 2 * 1024 * 1024, signal);
        } else if (operation === 'renameBranch') {
          const from = validateGitRef(String(payload.from ?? ''));
          const to = validateGitRef(String(payload.to ?? ''));
          data = await runGit(root, ['branch', '-m', from, to], 2 * 1024 * 1024, signal);
        } else if (operation === 'switchBranch') {
          data = await runGit(root, ['switch', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else if (operation === 'fetch') {
          data = await runGit(root, ['fetch', '--all', '--prune'], 20 * 1024 * 1024, signal);
        } else if (operation === 'pull') {
          const strategy = (['ff-only', 'merge', 'rebase'] as const).includes(payload.strategy as 'ff-only') ? payload.strategy : 'ff-only';
          const args = strategy === 'rebase' ? ['pull', '--rebase'] : strategy === 'merge' ? ['pull', '--no-ff'] : ['pull', '--ff-only'];
          data = await runGit(root, args, 20 * 1024 * 1024, signal);
        } else if (operation === 'push') {
          const args = payload.setUpstream ? ['push', '--set-upstream', 'origin', 'HEAD'] : ['push'];
          data = await runGit(root, args, 20 * 1024 * 1024, signal);
        } else if (operation === 'sync') {
          const strategy = (['ff-only', 'merge', 'rebase'] as const).includes(payload.strategy as 'ff-only') ? payload.strategy : 'ff-only';
          const pullArgs = strategy === 'rebase' ? ['pull', '--rebase'] : strategy === 'merge' ? ['pull', '--no-ff'] : ['pull', '--ff-only'];
          const pull = await runGit(root, pullArgs, 20 * 1024 * 1024, signal);
          const push = await runGit(root, ['push'], 20 * 1024 * 1024, signal);
          data = `${pull}\n${push}`.trim();
        } else if (operation === 'log') {
          const limit = Math.max(1, Math.min(500, Number(payload.limit) || 100));
          const args = ['log', `-${limit}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e'];
          if (payload.path) args.push('--', path.relative(root, resolveWorkspacePath(rootPath, String(payload.path))));
          const output = await runGit(root, args, 20 * 1024 * 1024, signal);
          data = output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
            const [hash, shortHash, author, date, subject] = record.split('\x1f');
            return { hash, shortHash, author, date, subject };
          });
        } else if (operation === 'showCommit') {
          const hash = validateGitRef(String(payload.hash ?? ''));
          data = await runGit(root, ['show', '--format=fuller', '--stat', '--patch', hash], 30 * 1024 * 1024, signal);
        } else if (operation === 'fileDiff') {
          const relativePath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.path ?? '')));
          const staged = payload.staged ? ['--cached'] : [];
          data = await runGit(root, ['diff', '--no-ext-diff', '--unified=3', ...staged, '--', relativePath], 20 * 1024 * 1024, signal);
        } else if (operation === 'stagePatch') {
          data = await applyGitPatch(root, String(payload.patch ?? ''));
        } else if (operation === 'conflictVersions') {
          const relativePath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.path ?? ''))).replace(/\\/g, '/');
          const readStage = (stage: number) => runGit(root, ['show', `:${stage}:${relativePath}`], 20 * 1024 * 1024, signal).catch(() => '');
          const [base, ours, theirs] = await Promise.all([readStage(1), readStage(2), readStage(3)]);
          data = { base, ours, theirs };
        } else if (operation === 'resolveConflict') {
          const relativePath = path.relative(root, resolveWorkspacePath(rootPath, String(payload.path ?? '')));
          const strategy = payload.strategy === 'theirs' ? '--theirs' : '--ours';
          await runGit(root, ['checkout', strategy, '--', relativePath], 2 * 1024 * 1024, signal);
          data = await runGit(root, ['add', '--', relativePath], 2 * 1024 * 1024, signal);
        } else if (operation === 'stashList') {
          const output = await runGit(root, ['stash', 'list', '--format=%gd%x1f%H%x1f%cr%x1f%s'], 2 * 1024 * 1024, signal);
          data = output.split(/\r?\n/).filter(Boolean).map((line) => {
            const [ref, hash, date, subject] = line.split('\x1f'); return { ref, hash, date, subject };
          });
        } else if (operation === 'stashShow') {
          const ref = String(payload.ref ?? 'stash@{0}').trim();
          data = await runGit(root, ['stash', 'show', '-p', ref], 20 * 1024 * 1024, signal);
        } else if (operation === 'stashPush') {
          const message = String(payload.message ?? '').trim();
          data = await runGit(root, message ? ['stash', 'push', '-u', '-m', message] : ['stash', 'push', '-u'], 2 * 1024 * 1024, signal);
        } else if (operation === 'stashApply' || operation === 'stashPop' || operation === 'stashDrop') {
          const ref = String(payload.ref ?? 'stash@{0}').trim();
          if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('INVALID_STASH_REF');
          data = await runGit(root, ['stash', operation.slice(5).toLowerCase(), ref], 2 * 1024 * 1024, signal);
        } else if (operation === 'createTag') {
          const name = validateGitRef(String(payload.name ?? ''));
          const message = String(payload.message ?? '').trim();
          data = await runGit(root, message ? ['tag', '-a', name, '-m', message] : ['tag', name], 2 * 1024 * 1024, signal);
        } else if (operation === 'deleteTag') {
          data = await runGit(root, ['tag', '-d', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else if (operation === 'addRemote') {
          const name = validateGitRef(String(payload.name ?? ''));
          const url = String(payload.url ?? '').trim();
          if (!url || /[\r\n]/.test(url)) throw new Error('INVALID_REMOTE_URL');
          data = await runGit(root, ['remote', 'add', name, url], 2 * 1024 * 1024, signal);
        } else if (operation === 'removeRemote') {
          data = await runGit(root, ['remote', 'remove', validateGitRef(String(payload.name ?? ''))], 2 * 1024 * 1024, signal);
        } else {
          throw new Error('UNSUPPORTED_GIT_OPERATION');
        }
        progress('completed', `${operation} 执行完成`);
        return { success: true, data };
      } catch (error) {
        const raw = redactGitSecrets(error instanceof Error ? error.message : String(error));
        if (timedOut) {
          progress('failed', '操作超时');
          return { success: false, error: 'GIT_TIMEOUT' };
        }
        if (raw === 'GIT_CANCELLED' || raw.includes('abort') || raw.includes('cancel')) {
          progress('cancelled', '操作已取消');
          return { success: false, error: 'GIT_CANCELLED' };
        }
        const message = /Authentication failed|could not read Username|terminal prompts disabled/i.test(raw)
          ? 'GIT_AUTH_REQUIRED'
          : /conflict|CONFLICT/i.test(raw) ? 'GIT_CONFLICT' : raw;
        progress('failed', message);
        return { success: false, error: message };
      } finally {
        clearTimeout(timeout);
        gitControllers.delete(operationId);
      }
    });
  });

  ipcMain.handle('workspace:watch', async (_event, rootPath: string) => {
    try {
      workspaceWatcher?.close();
      const root = resolveWorkspacePath(rootPath);
      workspaceWatcher = fs.watch(root, { recursive: true }, (eventType, fileName) => {
        if (!fileName) return;
        const relativePath = String(fileName);
        if (relativePath.split(/[\\/]/).some((part) => WORKSPACE_IGNORED_NAMES.has(part))) return;
        mw.webContents.send('workspace:fileChanged', {
          path: relativePath,
          type: eventType === 'rename' ? 'rename' : 'change',
        });
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace:unwatch', () => {
    workspaceWatcher?.close();
    workspaceWatcher = null;
  });
  mw.webContents.once('destroyed', () => workspaceWatcher?.close());

  ipcMain.handle('dialog:saveFile', async (_event, content: string, defaultName?: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName ?? 'untitled.txt',
      });
      if (result.canceled || !result.filePath) return { success: false };
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('dialog:writeTextFile', async (_event, filePath: string, content: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return { success: false, error: 'FILE_NOT_FOUND' };
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true, path: resolved };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 打开对话文件夹 ──
  ipcMain.handle('open-conversation-folder', async () => {
    try {
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      const shellError = await shell.openPath(exportDir);
      if (shellError) {
        const { exec } = await import('node:child_process');
        const platform = process.platform;
        const cmd = platform === 'win32'
          ? `explorer "${exportDir}"`
          : platform === 'darwin'
            ? `open "${exportDir}"`
            : `xdg-open "${exportDir}"`;
        await new Promise<void>((resolve, reject) => {
          exec(cmd, (err) => (err ? reject(err) : resolve()));
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── Token 安全存储 ──
  ipcMain.handle('auth:is-available', async () => isEncryptionAvailable());
  ipcMain.handle('auth:save-token', async (_event, service: string, token: string, label?: string) => {
    return saveToken(service, token, label);
  });
  ipcMain.handle('auth:get-token', async (_event, service: string) => {
    return getToken(service);
  });
  ipcMain.handle('auth:delete-token', async (_event, service: string) => {
    return deleteToken(service);
  });
  ipcMain.handle('auth:list-services', async () => listServices());
  ipcMain.handle('auth:clear-all', async () => clearAll());

  // ── 终端 ──
  ipcMain.handle('terminal:create', async (_event, id: string, cwd?: string, profile?: { name: string; shell: string; args?: string[]; env?: Record<string, string> }) => {
    try {
      const session = createSession(id, cwd, profile);
      session.pty.onData((data: string) => {
        mw.webContents.send(`terminal:data:${id}`, data);
      });
      session.pty.onExit(({ exitCode }) => {
        mw.webContents.send(`terminal:exit:${id}`, exitCode);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('terminal:write', async (_event, id: string, data: string) => {
    try { write(id, data); return { success: true }; } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('terminal:resize', async (_event, id: string, cols: number, rows: number) => {
    try { resize(id, cols, rows); return { success: true }; } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('terminal:destroy', async (_event, id: string) => {
    try { destroySession(id); return { success: true }; } catch (err) { return { success: false, error: String(err) }; }
  });

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });
}
