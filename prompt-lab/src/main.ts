import { app, BrowserWindow, globalShortcut } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { createWindow } from './main/window';
import { createTray } from './main/tray';
import { setupIPC } from './main/ipc-handlers';
import { registerShortcuts } from './main/shortcuts';
import { destroyAll } from './terminal/terminal-manager';

if (started) app.quit();

// ── 应用生命周期 ──

app.whenReady().then(() => {
  const preloadPath = path.join(__dirname, 'preload.js');
  const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');

  createWindow(preloadPath, webviewPreloadPath);
  createTray();
  setupIPC(webviewPreloadPath);
  registerShortcuts();
});

app.on('window-all-closed', () => {
  // 有托盘时不退出
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const preloadPath = path.join(__dirname, 'preload.js');
    const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');
    createWindow(preloadPath, webviewPreloadPath);
  } else {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyAll();
});
