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

/** Build the host half of the adapter (everything except `notify`,
 *  which needs a live React-aware API). */
function createPromptLabHost(): ScreenCaptureAdapter["electronAPI"] {
  return {
    screenCapture: {
      getPrimaryScreenSourceId: () => window.electronAPI.screenCapture.getPrimaryScreenSourceId(),
      setTarget: (target, systemAudio) => window.electronAPI.screenCapture.setTarget(target, systemAudio),
      setRecordingState: (state) => window.electronAPI.screenCapture.setRecordingState(state),
    },
    hide: () => window.electronAPI.hide(),
    show: () => window.electronAPI.show(),
  };
}

export const ScreenCapturePanel: React.FC<{ initialMode?: CaptureMode | null }> = ({ initialMode = "screenshot" }) => {
  // useNotification returns [api, contextHolder]. We mount the holder as a
  // sibling so the toasts share the React lifecycle — the static
  // `notification` global is a singleton and would leak toasts across
  // panel remounts.
  const [api, contextHolder] = notification.useNotification();
  const electronAPI = useMemo(() => createPromptLabHost(), []);
  const adapter: ScreenCaptureAdapter = useMemo(
    () => ({
      electronAPI,
      notify: createAntdNotify(api as unknown as Parameters<typeof createAntdNotify>[0]),
    }),
    [electronAPI, api],
  );
  return (
    <>
      {contextHolder}
      <ScreenCaptureProvider adapter={adapter}>
        <PublishedScreenCapturePanel initialMode={initialMode} />
      </ScreenCaptureProvider>
    </>
  );
};
