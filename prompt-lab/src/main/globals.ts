import { BrowserWindow, Tray } from 'electron';

const mainWindows: BrowserWindow[] = [];
let tray: Tray | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  if (!win) return;
  const existingIndex = mainWindows.indexOf(win);
  if (existingIndex >= 0) mainWindows.splice(existingIndex, 1);
  mainWindows.push(win);
}

export function removeMainWindow(win: BrowserWindow) {
  const index = mainWindows.indexOf(win);
  if (index >= 0) mainWindows.splice(index, 1);
}

export function getMainWindow(): BrowserWindow | null {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && mainWindows.includes(focusedWindow)) return focusedWindow;
  return [...mainWindows].reverse().find((win) => !win.isDestroyed()) ?? null;
}

export function getMainWindows(): BrowserWindow[] {
  return mainWindows.filter((win) => !win.isDestroyed());
}

export function setTray(t: Tray | null) {
  tray = t;
}

export function getTray(): Tray | null {
  return tray;
}
