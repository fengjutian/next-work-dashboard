/**
 * Voice plugin store.
 *
 * Holds the latest snapshot of the nwd-voice-engine sidecar and a rolling
 * history of segments. Subscribes to `voice:event` IPC events from preload.
 * The store intentionally keeps a small, self-contained shape so the panel
 * can render before the renderer-side store slices are ready.
 *
 * W3 surface: STT config (baseUrl / apiKey / model) and a transcripts map
 * keyed by per-segment WAV path. When a `speech.end` event arrives with
 * a valid STT config, the store fires a transcribe request against the
 * user's OpenAI-compatible STT endpoint and stores the result.
 */
import { create } from 'zustand';
import { dbGetSetting, dbSetSetting, flushDbToDisk, isDbReady } from '@/db';

import type {
  DaemonInfo,
  TranscriptFinalEvent,
  TranscribeRequest,
  TranscribeResult,
  VoiceEvent,
  VoiceState,
} from './backend/voice-types';

interface RecordingSummary {
  path: string;
  mtimeMs: number;
  size: number;
}

/** STT config — kept separate from the chat LLM config because the model
 * names rarely overlap (`whisper-1` vs `gpt-4` etc.). */
export interface SttConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** ISO-639-1 code (`zh`, `en`, ...) — leave empty for auto-detect. */
  language: string;
}

const STT_CONFIG_KEY = 'voice.sttConfig';
const DEFAULT_STT_CONFIG: SttConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'whisper-1',
  language: '',
};

function loadSttConfig(): SttConfig {
  if (!isDbReady()) return { ...DEFAULT_STT_CONFIG };
  try {
    const raw = dbGetSetting(STT_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_STT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SttConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_STT_CONFIG.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_STT_CONFIG.model,
      language: typeof parsed.language === 'string' ? parsed.language : '',
    };
  } catch {
    return { ...DEFAULT_STT_CONFIG };
  }
}

function saveSttConfig(config: SttConfig): void {
  if (!isDbReady()) return;
  try {
    dbSetSetting(STT_CONFIG_KEY, JSON.stringify(config));
    flushDbToDisk();
  } catch {
    /* ignore — settings are best-effort */
  }
}

interface VoiceStore extends VoiceState {
  recordings: RecordingSummary[];
  sttConfig: SttConfig;
  setSttConfig: (patch: Partial<SttConfig>) => void;
  startSidecar: () => Promise<void>;
  refreshState: () => Promise<void>;
  refreshRecordings: () => Promise<void>;
  startRecording: (durationSecs: number) => Promise<void>;
  transcribe: (audioPath: string) => Promise<void>;
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
  transcribe: (payload: TranscribeRequest) => Promise<TranscribeResult>;
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

/** Module-level cache of in-flight transcribe requests keyed by audio path
 * so a rapid burst of `speech.end` events doesn't double-fire. */
const inFlightTranscribes = new Map<string, Promise<void>>();

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  ...empty,
  recordings: [],
  sttConfig: loadSttConfig(),

  setSttConfig: (patch) => {
    const next: SttConfig = { ...get().sttConfig, ...patch };
    saveSttConfig(next);
    set({ sttConfig: next });
  },

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

  transcribe: async (audioPath: string) => {
    const bridge = getNwdVoice();
    const { sttConfig } = get();
    if (!sttConfig.apiKey || !sttConfig.baseUrl || !sttConfig.model) {
      // Silently skip — the panel will surface the missing-config state.
      return;
    }
    if (inFlightTranscribes.has(audioPath)) {
      return inFlightTranscribes.get(audioPath);
    }
    const promise = (async () => {
      const req: TranscribeRequest = {
        audioPath,
        baseUrl: sttConfig.baseUrl,
        apiKey: sttConfig.apiKey,
        model: sttConfig.model,
        language: sttConfig.language || undefined,
      };
      try {
        const result = await bridge.transcribe(req);
        if (result.ok === true) {
          const finalEvent: TranscriptFinalEvent = {
            path: audioPath,
            text: result.text,
            language: result.language,
            finished_at: Date.now(),
            model: sttConfig.model,
          };
          get().applyEvent({ type: 'transcript.final', payload: finalEvent });
        } else {
          get().applyEvent({
            type: 'transcript.error',
            payload: { path: audioPath, message: `[${result.status}] ${result.error}` },
          });
        }
      } catch (err) {
        get().applyEvent({
          type: 'transcript.error',
          payload: { path: audioPath, message: (err as Error).message ?? 'transcribe failed' },
        });
      } finally {
        inFlightTranscribes.delete(audioPath);
      }
    })();
    inFlightTranscribes.set(audioPath, promise);
    return promise;
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
        queueMicrotask(() => {
          get().refreshRecordings().catch(() => undefined);
        });
        // Fire-and-forget: the actual transcript arrives as a
        // `transcript.final` or `transcript.error` event.
        queueMicrotask(() => {
          get().transcribe(event.payload.path).catch(() => undefined);
        });
        return;
      case 'transcript.final':
        set((s) => {
          const segments = s.segments.map((seg) =>
            seg.path === event.payload.path
              ? { ...seg, transcript: event.payload }
              : seg,
          );
          return { ...s, segments };
        });
        return;
      case 'transcript.error':
        set((s) => {
          const segments = s.segments.map((seg) =>
            seg.path === event.payload.path
              ? { ...seg, transcriptError: event.payload.message }
              : seg,
          );
          return { ...s, segments };
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
    set({ ...empty, recordings: get().recordings, sttConfig: get().sttConfig });
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
