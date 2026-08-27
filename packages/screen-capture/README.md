# @next-work-dashboard/screen-capture

Reusable screen capture panel — screenshot via `getDisplayMedia` + `canvas`, and WebM video recording via `MediaRecorder` with optional system-audio / microphone mixing.

## Layers

- `core/` — Types + pure helpers (`timeLabel`, recorder MIME picker).
- `react/` — `<ScreenCapturePanel />` with adapter contract for `electronAPI` (get primary screen source, set target, hide/show window) and `notify` (toast).
- `styles.css` — CSS variables; utility classes come from the host's Tailwind config.

## Adapter contract

```ts
interface ScreenCaptureAdapter {
  electronAPI: {
    screenCapture: {
      getPrimaryScreenSourceId(): Promise<string>;
      setTarget(target: 'app' | 'screen', systemAudio: boolean): Promise<{ target: 'app' | 'screen'; systemAudio: boolean }>;
      setRecordingState(state: { recording: boolean; paused: boolean; seconds: number }): void;
    };
    hide(): Promise<void>;
    show(): Promise<void>;
  };
  notify: {
    success(config: { message: string; description?: string; placement?: string; duration?: number }): void;
    error(config: { message: string; description?: string }): void;
    info(config: { message: string; description?: string; placement?: string; duration?: number }): void;
  };
}
```

## Quick start (prompt-lab host)

```tsx
import { ScreenCapturePanel, ScreenCaptureProvider, createAntdNotify, createElectronScreenCapture } from "@next-work-dashboard/screen-capture/react";
import { notification } from "antd";
import "@next-work-dashboard/screen-capture/styles.css";

const adapter = {
  electronAPI: {
    screenCapture: {
      getPrimaryScreenSourceId: () => window.electronAPI.screenCapture.getPrimaryScreenSourceId(),
      setTarget: (t, a) => window.electronAPI.screenCapture.setTarget(t, a),
      setRecordingState: (s) => window.electronAPI.screenCapture.setRecordingState(s),
    },
    hide: () => window.electronAPI.hide(),
    show: () => window.electronAPI.show(),
  },
  notify: createAntdNotify(notification),
};

<ScreenCaptureProvider adapter={adapter}>
  <ScreenCapturePanel />
</ScreenCaptureProvider>
```

## License

MIT
