import type { ScreenCaptureHostElectronAPI, ScreenCaptureHostNotify } from '../core/types';

export interface ScreenCaptureAdapter {
  electronAPI: ScreenCaptureHostElectronAPI;
  notify: ScreenCaptureHostNotify;
}

/**
 * Adapt an antd `notification` instance (the static `notification` global
 * or the API returned by `notification.useNotification()`) to the package's
 * `ScreenCaptureHostNotify` shape.
 *
 * The input type is intentionally loose: antd's overloaded signatures for
 * static vs hook APIs differ, and hosts may pass either. We only use three
 * call sites so the structural subset is what matters at runtime.
 */
export function createAntdNotify(notificationInstance: {
  success: (config: { message: string; description?: string; placement?: string; duration?: number }) => void;
  error: (config: { message: string; description?: string }) => void;
  info: (config: { message: string; description?: string; placement?: string; duration?: number }) => void;
}): ScreenCaptureHostNotify {
  return {
    success: (config) => notificationInstance.success(config),
    error: (config) => notificationInstance.error(config),
    info: (config) => notificationInstance.info(config),
  };
}
