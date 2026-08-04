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
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

if (started) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  configureSessionDataPath();

  app.on('second-instance', showMainWindow);

  // 应用生命周期
  app.whenReady().then(() => {
    const preloadPath = path.join(__dirname, 'preload.js');
    const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');

    createWindow(preloadPath);
    // createWindow synchronously publishes the BrowserWindow through globals;
    // setupIPC depends on that window and must run afterwards.
    setupIPC(webviewPreloadPath);
    createTray();
    registerShortcuts();
  });

  app.on('window-all-closed', () => {
    // 有托盘时不退出。
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const preloadPath = path.join(__dirname, 'preload.js');
      createWindow(preloadPath);
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
