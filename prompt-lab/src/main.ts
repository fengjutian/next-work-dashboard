import { app, BrowserWindow, globalShortcut } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { createWindow } from './main/window';
import { createTray } from './main/tray';
import { setupIPC } from './main/ipc-handlers';
import { registerShortcuts } from './main/shortcuts';
import { destroyAll } from './plugins/terminal/backend/terminal-manager';
import { mcpManager } from './main/mcp/mcp-manager';

function configureSessionDataPath(): void {
  const preferredPath = path.join(app.getPath('userData'), 'chromium-session-v1');

  try {
    fs.mkdirSync(preferredPath, { recursive: true });
    app.setPath('sessionData', preferredPath);
  } catch (error) {
    const fallbackPath = path.join(
      app.getPath('temp'),
      `${app.getName()}-chromium-session-${process.pid}`,
    );
    fs.mkdirSync(fallbackPath, { recursive: true });
    app.setPath('sessionData', fallbackPath);
    console.warn(
      `[startup] Unable to use persistent Chromium session data at ${preferredPath}; using ${fallbackPath}.`,
      error,
    );
  }
}

function showMainWindow(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function configureWindowsJumpList(): void {
  if (process.platform !== 'win32') return;

  const arguments_ = app.isPackaged
    ? '--new-window'
    : `"${app.getAppPath().replace(/"/g, '\\"')}" --new-window`;

  app.setUserTasks([
    {
      program: process.execPath,
      arguments: arguments_,
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'New Window',
      description: 'Open a new next-work-dashboard window',
    },
  ]);
}

if (started) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  configureSessionDataPath();

  const openMainWindow = () => createWindow(path.join(__dirname, 'preload.js'));

  app.on('second-instance', () => {
    if (app.isReady()) openMainWindow();
  });

  // 应用生命周期
  app.whenReady().then(() => {
    const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');

    openMainWindow();
    // setupIPC configures the existing window and observes future windows.
    setupIPC(webviewPreloadPath);
    createTray();
    configureWindowsJumpList();
    registerShortcuts();
  });

  app.on('window-all-closed', () => {
    // 有托盘时不退出。
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    } else {
      showMainWindow();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    destroyAll();
    void mcpManager.closeAll();
  });
}
