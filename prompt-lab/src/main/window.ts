import { BrowserWindow, session } from 'electron';
import path from 'node:path';
import { setMainWindow, removeMainWindow, getTray } from './globals';
import { getWebviewCleanerPreloadPath, WORK_BROWSER_PARTITION } from './work-browser/cleaner';
import { isSafeWebNavigation } from '../core/work-browser/security/url-policy';
import { getAppIconPath } from './app-icon';

export function createWindow(preloadPath: string) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'next-work-dashboard',
    icon: getAppIconPath(),
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: true,
    },
  });

  setMainWindow(win);
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== WORK_BROWSER_PARTITION) return;
    if (!isSafeWebNavigation(params.src)) {
      event.preventDefault();
      return;
    }
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.preload = getWebviewCleanerPreloadPath();
  });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    if (guest.session === session.fromPartition(WORK_BROWSER_PARTITION)) {
      guest.setWindowOpenHandler(() => ({ action: 'deny' }));
      guest.on('will-navigate', (event, url) => {
        if (!isSafeWebNavigation(url)) event.preventDefault();
      });
    }
  });
  win.on('focus', () => setMainWindow(win));
  win.once('closed', () => removeMainWindow(win));

  const publishMaximizedState = () => {
    win.webContents.send('window-maximized-changed', win.isMaximized());
  };
  win.on('maximize', publishMaximizedState);
  win.on('unmaximize', publishMaximizedState);

  // 加载页面 — Vite/Forge 注入的全局常量
  const loadTarget = MAIN_WINDOW_VITE_DEV_SERVER_URL
    || path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).catch((error) => {
      console.error(`[window] Failed to load ${loadTarget}`, error);
      if (!win.isDestroyed()) win.show();
    });
  } else {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    ).catch((error) => {
      console.error(`[window] Failed to load ${loadTarget}`, error);
      if (!win.isDestroyed()) win.show();
    });
  }

  let shown = false;
  const showWindow = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
    win.focus();
  };
  win.once('ready-to-show', showWindow);
  win.webContents.once('did-finish-load', showWindow);
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[window] Renderer load failed (${code}): ${description} - ${validatedURL}`);
    showWindow();
  });
  const rendererCrashes: number[] = [];
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] Renderer process exited', details);
    showWindow();
    const now = Date.now();
    rendererCrashes.push(now);
    while (rendererCrashes[0] && now - rendererCrashes[0] > 60_000) rendererCrashes.shift();
    if (rendererCrashes.length <= 2 && !win.isDestroyed()) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reload();
      }, 750);
    } else {
      console.error('[window] Renderer recovery stopped after repeated crashes');
    }
  });
  win.webContents.on('unresponsive', () => {
    console.error('[window] Renderer became unresponsive');
  });
  win.webContents.on('responsive', () => {
    console.info('[window] Renderer became responsive again');
  });
  // `ready-to-show` can be skipped when the renderer fails before first paint.
  const showFallback = setTimeout(showWindow, 5_000);
  win.once('closed', () => clearTimeout(showFallback));

  // 关闭窗口时：最小化到托盘（而非退出）
  win.on('close', (event) => {
    if (getTray()) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}
