/**
 * Cleaner — 净化服务
 *
 * 提供：
 *  - getCleanerPayload(): 返回 { css, js, blockedDomains } 给渲染端
 *  - getWebviewCleanerPayload(): 同上，给 webview-cleaner-preload 用
 *  - setupWorkBrowserSession(): 注册 session.webRequest.onBeforeRequest 拦截广告/跟踪器域名
 *
 * work-browser 用专属 session partition: "persist:work-browser"，净化只对 work-browser 的 webview 生效。
 */
import path from 'node:path';
import { session as electronSession, type Session } from 'electron';
import { app } from 'electron';
import { htmlClean } from '../../core/work-browser/parser';
import { DEFAULT_CLEAN_OPTIONS, type CleanOptions } from '../../core/work-browser/types';
import { isSafeWebNavigation } from '../../core/work-browser/security/url-policy';

export const WORK_BROWSER_PARTITION = 'persist:work-browser';
let _session: Session | null = null;
let _sessionInitPromise: Promise<Session> | null = null;

export function getCleanerPayload(options: Partial<CleanOptions> = {}): { css: string; js: string; blockedDomains: string[] } {
  const merged: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  return htmlClean(merged);
}

/**
 * work-browser 专属 session；惰性初始化
 */
export function getWorkBrowserSession(): Session {
  if (_session) return _session;
  _session = electronSession.fromPartition(WORK_BROWSER_PARTITION);
  return _session;
}

/**
 * 注册网络层净化（广告/跟踪器拦截）
 * 应用启动时调用一次即可（idempotent）
 */
export function setupWorkBrowserSession(): Session {
  if (_sessionInitPromise) return _session as Session;
  const sess = getWorkBrowserSession();
  _sessionInitPromise = Promise.resolve(sess).then((s) => {
    s.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    s.setPermissionCheckHandler(() => false);
    s.setDevicePermissionHandler(() => false);
    s.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    s.on('will-download', (event) => event.preventDefault());
    s.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (!isSafeWebNavigation(details.url)) {
        callback({ cancel: true });
        return;
      }
      try {
        const host = new URL(details.url).host;
        const { blockedDomains } = getCleanerPayload();
        callback({ cancel: blockedDomains.some((d) => host === d || host.endsWith('.' + d)) });
      } catch {
        callback({ cancel: true });
      }
    });
    const { blockedDomains } = getCleanerPayload();
    if (blockedDomains.length) {
      console.log(`[work-browser] session network cleaner: blocked ${blockedDomains.length} domains`);
    }
    return s;
  });
  return sess;
}

/**
 * webview-cleaner-preload 的路径
 */
export function getWebviewCleanerPreloadPath(): string {
  return path.join(app.getAppPath(), '.vite', 'build', 'webview-cleaner-preload.js');
}
