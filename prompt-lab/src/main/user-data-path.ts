import path from 'node:path';

/**
 * Development and packaged builds must never share persistent application data.
 * Otherwise a locally packaged QA build can expose databases, recent workspaces,
 * credentials and Chromium localStorage created while developing the app.
 */
export function resolveUserDataPath(appDataPath: string, appName: string, isPackaged: boolean): string {
  const directoryName = `${appName}-${isPackaged ? 'production' : 'development'}`;
  return path.join(appDataPath, directoryName);
}
