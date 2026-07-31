import { BrowserWindow, app, ipcMain, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import AutoLaunch from 'electron-auto-launch';
import { getMainWindow } from './globals';
import { fetchSiteFavicon } from './favicon';
import { saveToken, getToken, deleteToken, listServices, clearAll, isEncryptionAvailable } from '../auth/token-store';
import { createSession, write, resize, destroySession } from '../terminal/terminal-manager';

export function setupIPC(webviewPreloadPath: string) {
  const mw = getMainWindow();
  if (!mw) return;

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
