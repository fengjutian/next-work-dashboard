import { app } from 'electron';
import path from 'node:path';

const APP_ICON_FILENAME = 'next-work-dashboard-app-icon-v2-colorful.png';

export function getAppIconPath(): string {
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');

  return path.join(resourcesRoot, 'icons', APP_ICON_FILENAME);
}
