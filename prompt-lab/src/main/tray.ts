import { Tray, Menu, app, nativeImage } from 'electron';
import { getMainWindow, getMainWindows, setTray, getTray } from './globals';

export function createTray() {
  const icon = nativeImage.createEmpty();
  const t = new Tray(icon.resize({ width: 16, height: 16 }));
  setTray(t);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        getMainWindow()?.show();
        getMainWindow()?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '退出 next-work-dashboard',
      click: () => {
        getMainWindows().forEach((win) => win.webContents.send('save-before-quit'));
        setTimeout(() => {
          t.destroy();
          setTray(null);
          app.quit();
        }, 500);
      },
    },
  ]);

  t.setToolTip('next-work-dashboard');
  t.setContextMenu(contextMenu);

  t.on('double-click', () => {
    getMainWindow()?.show();
    getMainWindow()?.focus();
  });

  return t;
}
