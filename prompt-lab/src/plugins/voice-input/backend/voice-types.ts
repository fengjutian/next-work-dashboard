/**
 * nwd-voice-engine sidecar types.
 *
 * Mirrors the protocol in `native/voice-engine/src/protocol.rs`. Keep these
 * in sync when adding new request/event types.
 */

export interface DaemonInfo {
  version: string;
  platform: string;
  sample_rate: number;
  channels: number;
  storage_dir: string;
  input_device: string | null;
  recording: boolean;
}

export interface AudioLevelEvent {
  rms: number;
  frames: number;
  written_frames: number;
  total_frames: number;
}

export interface RecordingStartedEvent {
  path: string;
  duration_secs: number;
  sample_rate: number;
}

export interface RecordingProgressEvent {
  written_frames: number;
  total_frames: number;
}

export interface RecordingFinishedEvent {
  path: string;
  duration_secs: number;
  elapsed_secs: number;
  sample_rate: number;
}

export interface VoiceErrorEvent {
  kind?: string;
  message: string;
  request_id?: number | null;
}

export type VoiceEvent =
  | { type: 'ready'; version: string; platform: string; sample_rate: number; channels: number }
  | { type: 'state'; info: DaemonInfo }
  | { type: 'pong'; id: number }
  | { type: 'recording.started'; payload: RecordingStartedEvent }
  | { type: 'recording.progress'; payload: RecordingProgressEvent }
  | { type: 'recording.finished'; payload: RecordingFinishedEvent }
  | { type: 'audio.level'; payload: AudioLevelEvent }
  | { type: 'error'; payload: VoiceErrorEvent };

export interface VoiceState {
  ready: boolean;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  /** True while a recording is in progress on the sidecar. */
  recording: boolean;
  /** Most recent RMS level in [0, 1] (rough scale, see VoiceInputPanel). */
  level: number;
  /** Most recent audio level event frame counter (0..1 progress). */
  levelProgress: number;
  /** Most recent finished recording path (or null). */
  lastRecordingPath: string | null;
  /** Latest DaemonInfo snapshot we received. */
  info: DaemonInfo | null;
}

export interface VoiceRecording {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface VoiceApi {
  start: () => Promise<VoiceState>;
  state: () => Promise<VoiceState>;
  ping: () => Promise<true>;
  requestState: () => Promise<DaemonInfo>;
  startRecording: (durationSecs: number) => Promise<{ duration_secs: number }>;
  listRecordings: () => Promise<VoiceRecording[]>;
  onEvent: (handler: (event: VoiceEvent) => void) => () => void;
}
