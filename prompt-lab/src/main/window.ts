import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { setMainWindow, getTray } from './globals';

export function createWindow(preloadPath: string, webviewPreloadPath: string) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'next-work-dashboard',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  setMainWindow(win);

  // 注入 webview preload 路径到渲染进程
  win.webContents.executeJavaScript(`
    window.__WEBVIEW_PRELOAD_PATH__ = ${JSON.stringify(`file://${webviewPreloadPath}`)};
  `);

  // 加载页面 — Vite/Forge 注入的全局常量
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // 关闭窗口时：最小化到托盘（而非退出）
  win.on('close', (event) => {
    if (getTray()) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}
