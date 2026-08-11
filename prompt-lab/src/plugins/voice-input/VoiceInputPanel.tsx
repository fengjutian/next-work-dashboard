/**
 * Voice Input panel — W2 VAD preview.
 *
 * Talks to the nwd-voice-engine sidecar via the `voice.*` preload bridge.
 * What the user sees here is the VAD in action:
 *   - A live audio level meter + speech-probability bar.
 *   - A "speech" badge that turns green while we're inside a detected
 *     segment.
 *   - A list of segments captured so far, each with the per-segment WAV
 *     path, start time, and duration.
 *
 * The actual recording is driven by `recording.start`, which kicks off
 * the cpal stream + the VAD state machine. Each `speech.end` event from
 * the sidecar pushes a new row into the segment list.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  CircleStop,
  Info,
  Mic,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  AudioWaveform,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useVoiceStore } from './voice-store';

const RECORD_DURATIONS = [2, 5, 10] as const;

const VoiceInputPanel: React.FC = () => {
  const {
    ready,
    recording,
    inSpeech,
    level,
    speechProb,
    levelProgress,
    lastError,
    lastRecordingPath,
    info,
    models,
    segments,
    recordings,
    startSidecar,
    refreshState,
    refreshRecordings,
    startRecording,
    applyEvent,
  } = useVoiceStore();

  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState<number>(RECORD_DURATIONS[1]);

  // Subscribe to the preload bridge event stream.
  useEffect(() => {
    const bridge = window.nwd?.voice;
    if (!bridge) return undefined;
    const off = bridge.onEvent(applyEvent);
    // Pull the current snapshot so the UI reflects whatever the main
    // process already has when the panel mounts.
    refreshState().catch(() => undefined);
    refreshRecordings().catch(() => undefined);
    return () => {
      off();
    };
  }, [applyEvent, refreshState, refreshRecordings]);

  const handleStart = useCallback(async () => {
    if (busy || recording) return;
    setBusy(true);
    try {
      if (!ready) await startSidecar();
      await startRecording(duration);
    } catch (error) {
      // The store's `lastError` will be populated via the `error` event.
      // eslint-disable-next-line no-console
      console.warn('[voice] start failed', error);
    } finally {
      setBusy(false);
    }
  }, [busy, recording, ready, startSidecar, startRecording, duration]);

  const handleRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all([refreshState(), refreshRecordings()]);
    } finally {
      setBusy(false);
    }
  }, [refreshState, refreshRecordings]);

  const levelPct = Math.round(level * 100);
  const speechPct = Math.round(speechProb * 100);
  const progressPct = Math.round(levelProgress * 100);

  const status = useMemo(() => {
    if (lastError && !ready) {
      return { tone: 'error' as const, label: `未连接:${lastError}` };
    }
    if (recording) {
      return inSpeech
        ? { tone: 'active' as const, label: '正在说话…' }
        : { tone: 'active' as const, label: '录音中(静音)' };
    }
    if (ready) {
      return { tone: 'ready' as const, label: '已就绪' };
    }
    return { tone: 'idle' as const, label: '未启动' };
  }, [lastError, ready, recording, inSpeech]);

  const vadReady = models?.vad?.ready ?? false;

  return (
    <div className="flex h-full flex-col bg-card text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AudioLines className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold">语音输入 · W2 VAD 预览</h1>
        </div>
        <StatusBadge tone={status.tone} label={status.label} />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <section className="rounded-md border border-border bg-background p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            <span>
              W2 范围:Silero VAD 实时切片,每段说话独立存为{' '}
              <code className="font-mono text-foreground/80">speech-*.wav</code>。
              最大录音时长作为兜底,实际由 VAD 决定何时停。
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">录音时长上限</span>
            {RECORD_DURATIONS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={d === duration ? 'default' : 'outline'}
                onClick={() => setDuration(d)}
                disabled={recording || busy}
              >
                {d}s
              </Button>
            ))}
            <span
              className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                vadReady
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              }`}
              title={models?.vad?.path ?? 'VAD model path unknown'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${vadReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
              />
              {vadReady ? 'VAD 模型就绪' : 'VAD 模型缺失'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="lg"
              onClick={handleStart}
              disabled={busy || recording || !vadReady}
              className="min-w-[160px]"
              title={!vadReady ? '需要先放置 silero_vad.onnx 到模型目录' : undefined}
            >
              {recording ? (
                <>
                  <CircleStop className="h-4 w-4" />
                  录音中…
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  开始录音
                </>
              )}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleRefresh}
              disabled={busy}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
            {recording ? (
              <span className="text-xs text-muted-foreground">
                电平 {levelPct}% · VAD {speechPct}% · {inSpeech ? '说话中' : '静音'}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                最近一段:{lastRecordingPath ? shortPath(lastRecordingPath) : '—'}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-[width] duration-75 ${recording ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-[width] duration-75 ${
                  inSpeech ? 'bg-emerald-500' : 'bg-emerald-500/30'
                }`}
                style={{ width: `${speechPct}%` }}
              />
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-sky-500/70 transition-[width] duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              上:实时电平 (RMS×4) · 中:VAD 说话概率 (绿=检测到语音) · 下:本次录音进度
            </p>
          </div>
        </section>

        <section className="rounded-md border border-border bg-background p-4 space-y-2">
          <h2 className="text-sm font-semibold">VAD 切出的语音段</h2>
          {segments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有。开启录音后,检测到一段说话就会出现在这里。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {segments.map((seg) => (
                <li
                  key={`${seg.path}-${seg.start_ms}`}
                  className="flex items-center justify-between rounded border border-border bg-card px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <AudioWaveform className="h-3.5 w-3.5 text-emerald-500" />
                    <code
                      className="truncate font-mono text-foreground/80"
                      title={seg.path}
                    >
                      {shortPath(seg.path)}
                    </code>
                  </div>
                  <span className="text-muted-foreground">
                    {seg.start_ms}ms · {seg.duration_ms}ms · {seg.sample_rate}Hz
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-border bg-background p-4 space-y-2">
          <h2 className="text-sm font-semibold">Sidecar 状态</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <Row label="version" value={info?.version} />
            <Row label="platform" value={info?.platform} />
            <Row label="recording" value={info ? String(info.recording) : null} />
            <Row label="device" value={info?.input_device ?? '—'} />
            <Row label="sample_rate" value={info ? `${info.sample_rate} Hz` : '—'} />
            <Row label="channels" value={info ? String(info.channels) : '—'} />
            <Row label="vad_model" value={models?.vad?.path ?? info?.vad_model_path ?? null} />
            <Row label="vad_ready" value={vadReady ? 'yes' : 'no'} />
          </dl>
        </section>

        <section className="rounded-md border border-border bg-background p-4 space-y-2">
          <h2 className="text-sm font-semibold">磁盘上的录音文件</h2>
          {recordings.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有。</p>
          ) : (
            <ul className="space-y-1.5">
              {recordings.map((r) => (
                <li
                  key={r.path}
                  className="flex items-center justify-between rounded border border-border bg-card px-3 py-2 text-xs"
                >
                  <code className="truncate font-mono text-foreground/80" title={r.path}>
                    {shortPath(r.path)}
                  </code>
                  <span className="text-muted-foreground">
                    {(r.size / 1024).toFixed(1)} KB · {new Date(r.mtimeMs).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {lastError ? (
          <section className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {lastError}
          </section>
        ) : null}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string | null | undefined }> = ({ label, value }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="truncate font-mono text-foreground/80" title={value ?? ''}>
      {value ?? '—'}
    </dd>
  </>
);

const StatusBadge: React.FC<{ tone: 'ready' | 'active' | 'idle' | 'error'; label: string }> = ({ tone, label }) => {
  const cls =
    tone === 'active'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : tone === 'ready'
        ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
        : tone === 'error'
          ? 'bg-destructive/15 text-destructive'
          : 'bg-muted text-muted-foreground';
  const Icon = tone === 'active' || tone === 'ready' ? ShieldCheck : ShieldAlert;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
};

function shortPath(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/');
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

export default VoiceInputPanel;
// re-export so the icon import is not tree-shaken
export { AudioWaveform };
