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
  /** Path to the on-disk Silero VAD model, if known. */
  vad_model_path?: string | null;
}

export interface VadModelInfo {
  path: string;
  exists: boolean;
  ready: boolean;
}

export interface ModelsEvent {
  vad: VadModelInfo;
}

/** Streaming audio level — emitted ~every 50 ms while a recording is live. */
export interface AudioLevelEvent {
  /** RMS amplitude of the last window in [0, 1] (rough scale). */
  rms: number;
  /** Silero VAD speech probability in [0, 1] for the most recent window. */
  speech_prob: number;
  /** True while we are inside a detected speech segment. */
  in_speech: boolean;
  /** Total mono frames written to the per-segment WAV so far. */
  written_frames: number;
}

/** Fired when the VAD flips from silence to speech. */
export interface SpeechStartEvent {
  /** Sample index (at TARGET_SAMPLE_RATE) where the segment started. */
  sample: number;
  /** Speech probability that triggered the transition. */
  probability: number;
}

/** Fired when the VAD closes out a segment after the silence timeout. */
export interface SpeechEndEvent {
  path: string;
  start_ms: number;
  duration_ms: number;
  sample_rate: number;
}

/** Fired when `recording.start` accepts and the cpal stream is open. */
export interface RecordingStartedEvent {
  mode: 'raw' | 'vad';
  sample_rate: number;
  duration_secs?: number;
  path?: string;
}

/** W1 raw recorder only — kept for the debug `recording.raw` request. */
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
  | { type: 'ready'; version: string; platform: string; sample_rate: number; channels: number; vad_model_path?: string | null }
  | { type: 'state'; info: DaemonInfo }
  | { type: 'pong'; id: number }
  | { type: 'models'; payload: ModelsEvent }
  | { type: 'recording.started'; payload: RecordingStartedEvent }
  | { type: 'recording.progress'; payload: RecordingProgressEvent }
  | { type: 'recording.finished'; payload: RecordingFinishedEvent }
  | { type: 'audio.level'; payload: AudioLevelEvent }
  | { type: 'speech.start'; payload: SpeechStartEvent }
  | { type: 'speech.end'; payload: SpeechEndEvent }
  | { type: 'error'; payload: VoiceErrorEvent };

export interface VoiceState {
  ready: boolean;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  /** True while a recording is in progress on the sidecar. */
  recording: boolean;
  /** True while we are inside a VAD-detected speech segment. */
  inSpeech: boolean;
  /** Most recent RMS level in [0, 1] (rough scale, see VoiceInputPanel). */
  level: number;
  /** Most recent VAD speech probability in [0, 1]. */
  speechProb: number;
  /** Most recent audio level event frame counter (0..1 progress). */
  levelProgress: number;
  /** Most recent finished recording path (or null). */
  lastRecordingPath: string | null;
  /** Per-segment capture list — newest first. */
  segments: SpeechEndEvent[];
  /** Latest DaemonInfo snapshot we received. */
  info: DaemonInfo | null;
  /** Latest models snapshot (vad model path/exists/ready). */
  models: ModelsEvent | null;
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
  requestModels: () => Promise<ModelsEvent>;
  startRecording: (durationSecs: number) => Promise<{ duration_secs: number }>;
  listRecordings: () => Promise<VoiceRecording[]>;
  onEvent: (handler: (event: VoiceEvent) => void) => () => void;
}
