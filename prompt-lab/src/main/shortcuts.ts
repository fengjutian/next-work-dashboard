import { app, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getMainWindow } from './globals';

export function registerShortcuts() {
  // Ctrl+Shift+Space 唤起主窗口 + 浮动搜索
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    const win = getMainWindow();
    if (win?.isVisible()) {
      win.focus();
    } else {
      win?.show();
      win?.focus();
    }
    win?.webContents.send('toggle-search-panel');
  });

  // 从持久化数据加载自定义快捷键
  const shortcutsPath = path.join(app.getPath('userData'), 'next-work-dashboard-data.json');
  try {
    if (fs.existsSync(shortcutsPath)) {
      const data = JSON.parse(fs.readFileSync(shortcutsPath, 'utf-8'));
      if (data.shortcuts) {
        globalShortcut.unregister('CommandOrControl+Shift+Space');
        const searchShortcut = data.shortcuts['toggle-search'] || 'CommandOrControl+Shift+Space';
        try {
          globalShortcut.register(searchShortcut, () => {
            const win = getMainWindow();
            if (win?.isVisible()) {
              win.focus();
            } else {
              win?.show();
              win?.focus();
            }
            win?.webContents.send('toggle-search-panel');
          });
        } catch { /* shortcut registration failed, use default */ }
      }
    }
  } catch { /* ignore load errors */ }
}
