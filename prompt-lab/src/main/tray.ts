import { Tray, Menu, Notification, app, nativeImage } from 'electron';
import { getMainWindow, getMainWindows, setTray, getTray } from './globals';
import { getAppIconPath } from './app-icon';

let idleIcon = nativeImage.createEmpty();

export function createTray() {
  idleIcon = nativeImage.createFromPath(getAppIconPath()).resize({ width: 16, height: 16 });
  const t = new Tray(idleIcon.resize({ width: 16, height: 16 }));
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

const recordingIcon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#ef4444"/><circle cx="8" cy="8" r="3" fill="white"/></svg>').toString('base64')}`);
let recordingNoticeShown = false;

export function setTrayRecordingState(state: { recording: boolean; paused: boolean; seconds: number }): void {
  const tray = getTray();
  if (!tray) return;
  if (!state.recording) {
    tray.setImage(idleIcon);
    tray.setToolTip('next-work-dashboard');
    recordingNoticeShown = false;
    return;
  }
  tray.setImage(recordingIcon);
  const time = `${String(Math.floor(state.seconds / 60)).padStart(2, '0')}:${String(state.seconds % 60).padStart(2, '0')}`;
  tray.setToolTip(`${state.paused ? '录屏已暂停' : '正在录屏'} · ${time} · 双击返回`);
  if (!recordingNoticeShown && Notification.isSupported()) {
    new Notification({ title: '正在录屏', body: '应用隐藏后仍会继续录制。双击托盘图标可返回控制界面。', silent: true }).show();
    recordingNoticeShown = true;
  }
}
