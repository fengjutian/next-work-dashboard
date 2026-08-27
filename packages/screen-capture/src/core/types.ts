export type CaptureMode = 'screenshot' | 'recording';
export type CaptureTarget = 'app' | 'screen';

export interface RecordingState {
  recording: boolean;
  paused: boolean;
  seconds: number;
}

export interface NotifyConfig {
  message: string;
  description?: string;
  /** Host-specific placement hint (e.g. "bottomRight"). */
  placement?: string;
  /** Toast duration in seconds. */
  duration?: number;
}

export interface ScreenCaptureHostElectronAPI {
  screenCapture: {
    getPrimaryScreenSourceId(): Promise<string>;
    setTarget(target: CaptureTarget, systemAudio: boolean): Promise<{ target: CaptureTarget; systemAudio: boolean }>;
    setRecordingState(state: RecordingState): void;
  };
  hide(): Promise<void>;
  show(): Promise<void>;
}

export interface ScreenCaptureHostNotify {
  success(config: NotifyConfig): void;
  error(config: NotifyConfig): void;
  info(config: NotifyConfig): void;
}
