import { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
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
    title: 'PromptLab',
    show: false, // 等 ready-to-show 再显示，避免白屏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 启用 <webview> 标签
    },
  });

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
      label: '退出 PromptLab',
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

  tray.setToolTip('PromptLab');
  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
};

// ── IPC 处理器 ──

const setupIPC = () => {
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
  const autoLauncher = new AutoLaunch({ name: 'PromptLab' });
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
  const dataPath = path.join(app.getPath('userData'), 'promptlab-data.json');

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
  const shortcutsPath = path.join(app.getPath('userData'), 'promptlab-data.json');
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
