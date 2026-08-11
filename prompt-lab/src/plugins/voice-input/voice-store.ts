/**
 * Voice plugin store.
 *
 * Holds the latest snapshot of the nwd-voice-engine sidecar and a rolling
 * history of segments. Subscribes to `voice:event` IPC events from preload.
 * The store intentionally keeps a small, self-contained shape so the panel
 * can render before the renderer-side store slices are ready.
 *
 * W2 surface: tracks `speechProb` and `inSpeech` from the streaming
 * `audio.level` events, plus a per-segment list sourced from `speech.end`.
 */
import { create } from 'zustand';

import type { DaemonInfo, VoiceEvent, VoiceState } from './backend/voice-types';

interface RecordingSummary {
  path: string;
  mtimeMs: number;
  size: number;
}

interface VoiceStore extends VoiceState {
  recordings: RecordingSummary[];
  startSidecar: () => Promise<void>;
  refreshState: () => Promise<void>;
  refreshRecordings: () => Promise<void>;
  startRecording: (durationSecs: number) => Promise<void>;
  applyEvent: (event: VoiceEvent) => void;
  reset: () => void;
}

const empty: VoiceState = {
  ready: false,
  pid: null,
  startedAt: null,
  lastError: null,
  recording: false,
  inSpeech: false,
  level: 0,
  speechProb: 0,
  levelProgress: 0,
  lastRecordingPath: null,
  segments: [],
  info: null,
  models: null,
};

interface NwdVoice {
  start: () => Promise<VoiceState>;
  state: () => Promise<VoiceState>;
  requestState: () => Promise<unknown>;
  requestModels: () => Promise<unknown>;
  startRecording: (durationSecs: number) => Promise<{ duration_secs: number }>;
  listRecordings: () => Promise<RecordingSummary[]>;
  onEvent: (handler: (event: VoiceEvent) => void) => () => void;
}

declare global {
  interface Window {
    nwd?: {
      voice?: NwdVoice;
    };
  }
}

function getNwdVoice(): NwdVoice {
  const v = typeof window !== 'undefined' ? window.nwd?.voice : undefined;
  if (!v) {
    throw new Error('voice bridge unavailable: preload did not expose window.nwd.voice');
  }
  return v;
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  ...empty,
  recordings: [],

  startSidecar: async () => {
    const bridge = getNwdVoice();
    const snapshot = await bridge.start();
    set({ ...snapshot });
  },

  refreshState: async () => {
    const bridge = getNwdVoice();
    const snapshot = await bridge.state();
    set({ ...snapshot });
  },

  refreshRecordings: async () => {
    const bridge = getNwdVoice();
    const items = await bridge.listRecordings();
    set({ recordings: items });
  },

  startRecording: async (durationSecs) => {
    const bridge = getNwdVoice();
    await bridge.startRecording(durationSecs);
  },

  applyEvent: (event) => {
    switch (event.type) {
      case 'ready':
        set((s) => ({
          ...s,
          ready: true,
          info: mergeInfo(s.info, {
            version: event.version,
            platform: event.platform,
            sample_rate: event.sample_rate,
            channels: event.channels,
            storage_dir: s.info?.storage_dir ?? '',
            input_device: s.info?.input_device ?? null,
            recording: false,
            vad_model_path: event.vad_model_path ?? null,
          }),
        }));
        return;
      case 'state':
        set((s) => ({ ...s, info: event.info, recording: event.info.recording }));
        return;
      case 'models':
        set((s) => ({
          ...s,
          models: event.payload,
          info: s.info
            ? { ...s.info, vad_model_path: event.payload?.vad?.path ?? s.info.vad_model_path ?? null }
            : s.info,
        }));
        return;
      case 'recording.started':
        set((s) => ({ ...s, recording: true, levelProgress: 0, inSpeech: false }));
        return;
      case 'recording.finished':
        set((s) => ({
          ...s,
          recording: false,
          level: 0,
          speechProb: 0,
          levelProgress: 0,
          inSpeech: false,
          lastRecordingPath: event.payload.path,
        }));
        // Refresh the recordings list shortly after the file is finalized.
        queueMicrotask(() => {
          get().refreshRecordings().catch(() => undefined);
        });
        return;
      case 'recording.progress':
        set((s) => ({
          ...s,
          levelProgress:
            event.payload.total_frames > 0
              ? event.payload.written_frames / event.payload.total_frames
              : 0,
        }));
        return;
      case 'audio.level': {
        const { rms, speech_prob, in_speech, written_frames } = event.payload;
        // 30 s soft budget for the level meter progress. The recorder
        // doesn't tell us the hard cap here — that's fine for a meter.
        const levelProgress = clampUnit(written_frames / (16_000 * 30));
        set((s) => ({
          ...s,
          level: clampUnit(rms),
          speechProb: clampUnit(speech_prob),
          inSpeech: Boolean(in_speech),
          levelProgress,
        }));
        return;
      }
      case 'speech.start':
        set((s) => ({ ...s, inSpeech: true }));
        return;
      case 'speech.end':
        set((s) => ({
          ...s,
          inSpeech: false,
          lastRecordingPath: event.payload.path,
          segments: [event.payload, ...s.segments].slice(0, 20),
        }));
        // Refresh the recordings list so the file appears in the
        // W1-style recordings list as well as the segment stream.
        queueMicrotask(() => {
          get().refreshRecordings().catch(() => undefined);
        });
        return;
      case 'error':
        set((s) => ({ ...s, lastError: event.payload.message }));
        return;
      case 'pong':
        return;
      default:
        return;
    }
  },

  reset: () => {
    set({ ...empty, recordings: get().recordings });
  },
}));

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v * 4));
}

function mergeInfo(prev: DaemonInfo | null, patch: DaemonInfo): DaemonInfo {
  if (!prev) return patch;
  return { ...prev, ...patch };
}
