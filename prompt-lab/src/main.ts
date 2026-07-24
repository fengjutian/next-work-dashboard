import { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import started from 'electron-squirrel-startup';
import AutoLaunch from 'electron-auto-launch';

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ── 窗口创建 ──

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'next-work-dashboard',
    show: false, // 等 ready-to-show 再显示，避免白屏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 启用 <webview> 标签
    },
  });

  // 注入 webview preload 路径到渲染进程（在页面脚本运行前执行）
  const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');
  mainWindow.webContents.executeJavaScript(`
    window.__WEBVIEW_PRELOAD_PATH__ = ${JSON.stringify(`file://${webviewPreloadPath}`)};
  `);

  // 加载页面
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // 页面准备好后再显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 关闭窗口时：最小化到托盘（而非退出）
  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
};

// ── 托盘 ──

const createTray = () => {
  // 用 16×16 空白图标作为占位（后期替换为应用图标）
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '退出 next-work-dashboard',
      click: () => {
        // 退出前触发保存
        mainWindow?.webContents.send('save-before-quit');
        setTimeout(() => {
          tray?.destroy();
          tray = null;
          app.quit();
        }, 500); // 给 500ms 让渲染进程保存
      },
    },
  ]);

  tray.setToolTip('next-work-dashboard');
  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
};

// ── IPC 处理器 ──

// favicon 缓存：host → base64 data URL
const faviconCache = new Map<string, string>();

// 用 Node.js HTTP 发起 GET 请求，返回 body 字符串
function httpGet(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      urlStr,
      { timeout: 5000, headers: { 'User-Agent': 'next-work-dashboard/1.0' } },
      (res) => {
        // 跟随重定向
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          httpGet(redirectUrl).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// 获取原始二进制数据
function httpGetBuffer(urlStr: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      urlStr,
      { timeout: 5000, headers: { 'User-Agent': 'next-work-dashboard/1.0' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          httpGetBuffer(redirectUrl).then(resolve).catch(reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// 从 HTML 中解析 favicon 链接
function parseFaviconLink(html: string, baseUrl: string): string | null {
  // 匹配 <link rel="icon" ...> 或 <link rel="shortcut icon" ...>
  const re = /<link\b[^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i
    || /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*>/i;
  const match = html.match(re);
  if (match) {
    return new URL(match[1], baseUrl).toString();
  }
  return null;
}

// 获取站点 favicon，返回 base64 data URL
async function fetchSiteFavicon(siteUrl: string): Promise<string | null> {
  try {
    const u = new URL(siteUrl);
    const host = u.hostname;
    const cacheKey = host;

    if (faviconCache.has(cacheKey)) return faviconCache.get(cacheKey)!;

    // 1. 解析 HTML 中的 <link rel="icon">
    const html = await httpGet(siteUrl);
    let iconUrl = parseFaviconLink(html, siteUrl);

    // 2. 回退到 /favicon.ico
    if (!iconUrl) {
      iconUrl = `${u.origin}/favicon.ico`;
    }

    // 3. 下载图标
    const buf = await httpGetBuffer(iconUrl);

    // 4. 转 base64 data URL
    const ext = iconUrl.split('.').pop()?.split('?')[0] || 'ico';
    const mime = { png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'image/x-icon';
    const b64 = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    faviconCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

const setupIPC = () => {
  // 暴露 webview preload 路径给渲染进程
  ipcMain.handle('get-webview-preload-path', () => {
    return path.join(__dirname, 'webview-preload.js');
  });

  // WebView 右键菜单 (B05)
  mainWindow?.webContents.on('context-menu', (_event, params) => {
    // 仅在 webview 内触发
    Menu.buildFromTemplate([
      {
        label: '注入选中提示词',
        enabled: !!params,
        click: () => {
          mainWindow?.webContents.send('inject-from-context-menu');
        },
      },
      { type: 'separator' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
    ]).popup();
  });

  // 提示词注入：由渲染进程发起，在主进程中执行
  ipcMain.handle('inject-prompt', async (_event, payload: {
    webviewId: number;
    text: string;
    inputSelector: string;
    submitSelector?: string;
    autoSubmit: boolean;
  }) => {
    // 找到目标 WebView 的 webContents
    const webview = mainWindow?.webContents;
    if (!webview) return { success: false, error: 'NO_WINDOW' };

    try {
      // 在 WebView 中执行注入脚本
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

  // 基础 IPC：窗口控制
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window-close', () => mainWindow?.close());

  // ── 窗口置顶 (S13) ──
  ipcMain.handle('window-toggle-always-on-top', () => {
    const ontop = !mainWindow?.isAlwaysOnTop();
    mainWindow?.setAlwaysOnTop(ontop);
    return ontop;
  });

  // ── 开机启动 (S14) ──
  const autoLauncher = new AutoLaunch({ name: 'next-work-dashboard' });
  ipcMain.handle('auto-launch-get', async () => {
    try { return await autoLauncher.isEnabled(); } catch { return false; }
  });
  ipcMain.handle('auto-launch-set', async (_e, enabled: boolean) => {
    if (enabled) {
      await autoLauncher.enable();
    } else {
      await autoLauncher.disable();
    }
    return enabled;
  });

  // ── 数据持久化 ──
  const dataPath = path.join(app.getPath('userData'), 'next-work-dashboard-data.json');
  const exportDir = path.join(app.getPath('documents'), 'next-work-dashboard', 'conversations');

  // ── favicon 获取（主进程 HTTP，绕过浏览器限制）──
  ipcMain.handle('fetch-favicon', async (_event, siteUrl: string) => {
    return await fetchSiteFavicon(siteUrl);
  });

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

      // 标注保存 / 有标题 → 独立新文件；快速保存 → 追加到按日汇总文件
      const isNewFile = payload.createNew || !!payload.title;
      console.log('[store-conversation] isNewFile:', isNewFile, 'title:', payload.title, 'createNew:', payload.createNew, 'site:', payload.site);
      const fileName = isNewFile
        ? `${payload.site}-${date}-${payload.timestamp}.md`
        : `${payload.site}-${date}.md`;
      const filePath = path.join(exportDir, fileName);

      // 提取用户消息内容
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

      // 新文件模式时写入标题和备注
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

      // 新文件：覆写；旧行为：追加
      if (isNewFile) {
        fs.writeFileSync(filePath, entry, 'utf-8');
      } else {
        fs.appendFileSync(filePath, entry, 'utf-8');
      }
      console.log('[PromptLab] Conversation saved to:', filePath);

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

        // 尝试从文件首行解析标题 (# Title)
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

      // 按日期降序排列
      list.sort((a, b) => b.date.localeCompare(a.date) || a.site.localeCompare(b.site));
      return list;
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('read-conversation', async (_event, filePath: string) => {
    try {
      // 安全检查：只允许读取 exportDir 下的文件
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
};

// ── 全局快捷键 ──

const registerShortcuts = () => {
  // Ctrl+Shift+Space 唤起主窗口 + 浮动搜索
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
    // 通知渲染进程打开浮动搜索面板
    mainWindow?.webContents.send('toggle-search-panel');
  });

  // 从持久化数据加载自定义快捷键
  const shortcutsPath = path.join(app.getPath('userData'), 'next-work-dashboard-data.json');
  try {
    if (fs.existsSync(shortcutsPath)) {
      const data = JSON.parse(fs.readFileSync(shortcutsPath, 'utf-8'));
      if (data.shortcuts) {
        // Apply custom shortcuts (simplified: just load saved)
        globalShortcut.unregister('CommandOrControl+Shift+Space');
        const searchShortcut = data.shortcuts['toggle-search'] || 'CommandOrControl+Shift+Space';
        try {
          globalShortcut.register(searchShortcut, () => {
            if (mainWindow?.isVisible()) {
              mainWindow.focus();
            } else {
              mainWindow?.show();
              mainWindow?.focus();
            }
            mainWindow?.webContents.send('toggle-search-panel');
          });
        } catch { /* shortcut registration failed, use default */ }
      }
    }
  } catch { /* ignore load errors */ }
};

// ── 应用生命周期 ──

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupIPC();
  registerShortcuts();
});

app.on('window-all-closed', () => {
  // 有托盘时不退出
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
