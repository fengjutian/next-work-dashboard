import { app } from 'electron';
import path from 'node:path';

const APP_ICON_FILENAME = 'next-work-dashboard-app-icon-v2-colorful.png';
const WINDOWS_APP_ICON_FILENAME = 'next-work-dashboard-app-icon-v2-colorful.ico';

function getIconsDirectory(): string {
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');

  return path.join(resourcesRoot, 'icons');
}

export function getAppIconPath(): string {
  return path.join(getIconsDirectory(), APP_ICON_FILENAME);
}

export function getWindowsAppIconPath(): string {
  return path.join(getIconsDirectory(), WINDOWS_APP_ICON_FILENAME);
}
