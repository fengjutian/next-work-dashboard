import path from 'node:path';

/**
 * Development and packaged builds intentionally share one stable application
 * profile. Besides keeping settings and credentials available in both modes,
 * Electron uses userData as part of the single-instance identity, so this also
 * prevents a development build and an installed build from running as separate
 * applications.
 *
 * Keep the existing production directory name to preserve packaged users' data.
 */
export function resolveUserDataPath(appDataPath: string, appName: string, _isPackaged: boolean): string {
  return path.join(appDataPath, `${appName}-production`);
}
