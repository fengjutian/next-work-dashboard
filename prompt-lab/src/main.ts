import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { createWindow } from './main/window';
import { createTray, setTrayRecordingState } from './main/tray';
import { setupIPC } from './main/ipc-handlers';
import { registerShortcuts } from './main/shortcuts';
import { destroyAll } from './plugins/terminal/backend/terminal-manager';
import { mcpManager } from './main/mcp/mcp-manager';
import { disposeOfficeService } from './plugins/office-studio/backend/office-service';
import { disposeDiskSpaceService, setupDiskSpaceIPC } from './plugins/disk-space/backend/disk-service';
import { setupNetProbeIPC, shutdownDaemon } from './plugins/network-observatory/backend/net-probe-service';
import { setupRagWorkerIPC } from './main/rag-worker-ipc';
import { ragWorkerClient } from './main/rag-worker-client';
import { startRagIndexCoordinator, stopRagIndexCoordinator } from './main/rag-index-coordinator';
import { setupVideoPlayerIPC, videoPlayerService } from './plugins/video-player/backend/video-service';
import { setupWorkBrowserIPC } from './main/work-browser';

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
    if (!app.isReady()) return;
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
    else showMainWindow();
  });

  // 应用生命周期
  app.whenReady().then(() => {
    const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');

    let captureTarget: 'app' | 'screen' = 'screen';
    let captureSystemAudio = false;
    ipcMain.handle('screen-capture:set-target', (_event, options: { target: 'app' | 'screen'; systemAudio: boolean }) => {
      captureTarget = options.target === 'app' ? 'app' : 'screen'; captureSystemAudio = Boolean(options.systemAudio);
      return { target: captureTarget, systemAudio: captureSystemAudio };
    });
    ipcMain.handle('screen-capture:primary-source', async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const primaryScreen = sources.find((source) => source.id.startsWith('screen:')) ?? sources[0];
      if (!primaryScreen) throw new Error('没有找到可捕获的屏幕');
      return primaryScreen.id;
    });
    ipcMain.on('screen-capture:recording-state', (_event, state: { recording: boolean; paused: boolean; seconds: number }) => setTrayRecordingState(state));

    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (captureTarget === 'app' && request.frame) {
        callback({ video: request.frame, audio: captureSystemAudio ? request.frame : undefined, enableLocalEcho: true });
        return;
      }
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const primaryScreen = sources.find((source) => source.id.startsWith('screen:')) ?? sources[0];
      callback({ video: primaryScreen, audio: captureSystemAudio ? 'loopback' : undefined });
    }, { useSystemPicker: false });

    openMainWindow();
    // setupIPC configures the existing window and observes future windows.
    setupIPC(webviewPreloadPath);
    setupDiskSpaceIPC();
    setupNetProbeIPC();
    setupRagWorkerIPC();
    setupVideoPlayerIPC();
    setupWorkBrowserIPC();
    startRagIndexCoordinator();
    createTray();
    configureWindowsJumpList();
    registerShortcuts();
  });

  app.on('window-all-closed', () => {
    // 有托盘时不退出。
  });

  app.on('before-quit', () => {
    void shutdownDaemon();
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
    void disposeOfficeService();
    disposeDiskSpaceService();
    stopRagIndexCoordinator();
    ragWorkerClient.dispose();
    void videoPlayerService.shutdown();
  });
}
