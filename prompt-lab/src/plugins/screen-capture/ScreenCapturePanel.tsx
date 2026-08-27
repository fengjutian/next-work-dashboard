/**
 * prompt-lab wrapper for @next-work-dashboard/screen-capture.
 *
 * The package is host-agnostic. This file wires it to prompt-lab's:
 *  - `window.electronAPI.screenCapture.*` (Electron main-process bridge)
 *  - `window.electronAPI.hide()` / `show()` (window control)
 *  - `notification` from antd (toast)
 *
 * Keep this file thin.
 */

import React, { useMemo } from "react";
import { notification } from "antd";
import { ScreenCapturePanel as PublishedScreenCapturePanel, ScreenCaptureProvider, createAntdNotify, type ScreenCaptureAdapter } from "@next-work-dashboard/screen-capture/react";
import type { CaptureMode } from "@next-work-dashboard/screen-capture/core";
import "@next-work-dashboard/screen-capture/styles.css";

function createPromptLabAdapter(): ScreenCaptureAdapter {
  return {
    electronAPI: {
      screenCapture: {
        getPrimaryScreenSourceId: () => window.electronAPI.screenCapture.getPrimaryScreenSourceId(),
        setTarget: (target, systemAudio) => window.electronAPI.screenCapture.setTarget(target, systemAudio),
        setRecordingState: (state) => window.electronAPI.screenCapture.setRecordingState(state),
      },
      hide: () => window.electronAPI.hide(),
      show: () => window.electronAPI.show(),
    },
    // The static `notification` is fine for the immutable adapter skeleton.
    // The live `notice` from `useNotification` is plugged in below so
    // toasts share the React lifecycle (so unmounting the panel cleans up
    // the open toasts).
    notify: createAntdNotify(notification as unknown as Parameters<typeof createAntdNotify>[0]),
  };
}

export const ScreenCapturePanel: React.FC<{ initialMode?: CaptureMode | null }> = ({ initialMode = "screenshot" }) => {
  const [api, contextHolder] = notification.useNotification();
  const baseAdapter = useMemo(() => createPromptLabAdapter(), []);
  // Replace the static notify factory with the live API from
  // useNotification so toasts survive React's lifecycle (the static
  // `notification` is a singleton and can leak toasts across mounts).
  const liveAdapter: ScreenCaptureAdapter = useMemo(
    () => ({
      ...baseAdapter,
      notify: createAntdNotify(api as unknown as Parameters<typeof createAntdNotify>[0]),
    }),
    [baseAdapter, api],
  );
  return (
    <>
      {contextHolder}
      <ScreenCaptureProvider adapter={liveAdapter}>
        <PublishedScreenCapturePanel initialMode={initialMode} />
      </ScreenCaptureProvider>
    </>
  );
};
