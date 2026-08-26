/**
 * @next-work/video-generation — Renderer panel
 *
 * Host-agnostic React component that:
 *  - drives the MiniMax (Hailuo / H3) async video generation flow
 *  - supports single-shot generation + multi-segment storyboard (with stitch inspection)
 *  - surfaces the local task library and the rendered video preview
 *
 * All host capabilities (Electron preload bridge, SQLite task storage, LLM provider
 * used for prompt expansion) are injected via `VideoGenerationAdapter`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Video as VideoIcon,
  AudioLines,
  X,
} from 'lucide-react';
import { notification } from 'antd';
import { Button } from './Button';
import { DEFAULT_MODEL, POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS } from '../core/api';
import { buildStoryboardRequests, createStoryboardSegment, MIN_STORYBOARD_SEGMENTS, validateStoryboard, type VideoStoryboardSegment } from '../core/storyboard';
import type { StitchMetrics } from '../core/continuity';
import { createOpenAIProvider, type ChatMessage } from '../core/llm';
import type { VideoGenerationAdapter } from './adapter';
import { createVideoLibrary } from './video-library';
import type {
  StoredVideoRecord,
  VideoGenerationMode,
  VideoGenerationRequest,
  VideoRatio,
  VideoResolution,
  VideoTaskStatus,
} from '../types';

const MINIMAX_KEY_STORAGE = 'nwd:video-generation:minimax-api-key';
const MINIMAX_BASE_URL_STORAGE = 'nwd:video-generation:minimax-base-url';
const POLL_STATE_STORAGE = 'nwd:video-generation:active-polls';
const POLL_PAUSED_STORAGE = 'nwd:video-generation:polls-paused';
const STORYBOARD_RUNS_STORAGE = 'nwd:video-generation:storyboard-runs';
const STITCH_THRESHOLD_STORAGE = 'nwd:video-generation:stitch-threshold';
const HISTORY_PAGE_SIZE = 12;
const MAX_PROMPT_LENGTH = 7000;
const POLL_STAGGER_MS = 1500; // 多个 active poll 错峰启动，避免一上线就把 MiniMax 打爆

type ReferenceKind = 'image' | 'video' | 'audio';

interface ReferenceItem {
  /** 本地唯一 key（用于 React list） */
  key: string;
  /** 原始文件名 */
  name: string;
  /** 本地 mime type */
  mimeType: string;
  /** 本地图数据 ArrayBuffer，提交后释放 */
  data: ArrayBuffer;
  /** 上传后拿到的 HTTPS URL，未上传完成时为空 */
  url: string;
  /** 上传是否失败（用于 UI 提示） */
  uploadError?: string;
  /** 用户手动填的 HTTPS URL 模式（不走上传） */
  manualUrl?: boolean;
}

const REFERENCE_ACCEPT: Record<ReferenceKind, string> = {
  image: 'image/png,image/jpeg,image/webp,image/heic,image/heif',
  video: 'video/mp4,video/quicktime',
  audio: 'audio/wav,audio/mpeg,audio/x-wav',
};
const REFERENCE_SIZE_CAP: Record<ReferenceKind, number> = {
  image: 30 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
};

const MODES: { id: VideoGenerationMode; label: string; description: string }[] = [
  { id: 'text-to-video', label: '文生视频', description: '只用文字描述生成视频。' },
  { id: 'image-to-video', label: '首帧图生视频', description: '需要 1 张首帧图，让静态图动起来。' },
  { id: 'start-end-to-video', label: '首尾帧生视频', description: '需要首帧 + 尾帧，控制起止画面。' },
  { id: 'reference-to-video', label: '参考生视频', description: '可混合参考图 / 参考视频 / 参考音频。' },
];

const RESOLUTIONS: VideoResolution[] = ['768P', '1080P', '2K'];
const RATIOS: VideoRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '2:3', '3:2', 'adaptive'];

const STATUS_LABEL: Record<VideoTaskStatus, string> = {
  queued: '排队中',
  preparing: '准备中',
  processing: '生成中',
  succeeded: '已成功',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知状态',
};

const STATUS_TONE: Record<VideoTaskStatus, string> = {
  queued: 'bg-slate-100 text-slate-700',
  preparing: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-800',
  succeeded: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-200 text-slate-700',
  unknown: 'bg-slate-100 text-slate-600',
};

interface ActivePoll {
  recordId: string;
  taskId: string;
  attempts: number;
  apiKey: string;
  baseUrl: string;
  model: string;
  storyboardRunId?: string;
  segmentIndex?: number;
}

interface StoryboardRun {
  id: string;
  requests: VideoGenerationRequest[];
  filePaths: string[];
  apiKey: string;
  baseUrl: string;
  model: string;
  status?: 'running' | 'failed';
  failedIndex?: number;
  error?: string;
  stitchScores?: number[];
  stitchReports?: Array<{ segmentIndex: number; score: number; metrics?: StitchMetrics; accepted?: boolean }>;
  pendingFilePath?: string;
}

function loadStoryboardRuns(): StoryboardRun[] {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORYBOARD_RUNS_STORAGE) || '[]') as StoryboardRun[];
    return Array.isArray(value) ? value.filter((item) => item?.id && Array.isArray(item.requests) && item.requests.length >= MIN_STORYBOARD_SEGMENTS) : [];
  } catch { return []; }
}

function loadActivePolls(): ActivePoll[] {
  try {
    const raw = globalThis.localStorage?.getItem(POLL_STATE_STORAGE);
    if (!raw) return [];
    const data = JSON.parse(raw) as ActivePoll[];
    if (!Array.isArray(data)) return [];
    return data.filter((item) => item && item.recordId && item.taskId);
  } catch { return []; }
}

function persistActivePolls(polls: ActivePoll[]): void {
  try { globalThis.localStorage?.setItem(POLL_STATE_STORAGE, JSON.stringify(polls)); } catch { /* ignore */ }
}

function readStoredApiKey(): string {
  return globalThis.localStorage?.getItem(MINIMAX_KEY_STORAGE) || '';
}

function readStoredBaseUrl(): string {
  return globalThis.localStorage?.getItem(MINIMAX_BASE_URL_STORAGE) || 'https://api.minimaxi.com';
}

function inferMode(record: StoredVideoRecord): VideoGenerationMode {
  return (record.mode as VideoGenerationMode) || 'text-to-video';
}

function inferReferenceKind(mimeType: string): ReferenceKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

function makeReferenceKey(): string {
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * AI 扩写：把用户短句扩成 MiniMax 视频生成模型能直接使用的提示词。
 * 视频 prompt 跟图片 prompt 的核心区别：时间轴 + 运动 + 镜头调度。
 * 输出要保持中文，220–500 字，覆盖主体 / 动作 / 镜头 / 光线 / 氛围。
 */
async function expandVideoPrompt(
  aiApi: VideoGenerationAdapter['ai'],
  idea: string,
  mode: VideoGenerationMode,
  onDelta: (delta: string) => void,
  chatProxy?: VideoGenerationAdapter['api']['llmChat'],
): Promise<string> {
  const provider = createOpenAIProvider({
    apiKey: aiApi.apiKey,
    baseUrl: aiApi.baseUrl,
    chatProxy: aiApi.provider === 'qwen' ? chatProxy : undefined,
  });
  const modeHint = mode === 'image-to-video' ? '这是首帧图生视频模式，重点描述首帧之后主体如何动起来、镜头怎么推。'
    : mode === 'start-end-to-video' ? '这是首尾帧生视频模式，重点描述从首帧过渡到尾帧的过程。'
    : mode === 'reference-to-video' ? '这是参考生视频模式，重点描述参考主体的特征延续 + 动作编排。'
    : '这是文生视频模式，从零构建一个完整的画面。';
  const systemPrompt = `你是专业视频导演和文生视频提示词设计师，擅长为 MiniMax 视频生成模型写提示词。${modeHint}

将用户的简短想法扩写成一段具体、生动、可直接用于视频生成的中文描述。必须保留用户主体与意图，补充：
- 主体在时间轴上的动作（开场 → 发展 → 收尾）
- 镜头调度（景别 / 推拉摇移 / 跟拍 / 升降）
- 环境与场景细节
- 光线、色调、氛围、声音线索
- 视觉风格（写实 / 电影感 / 动漫 / 纪录片等）

要求：
- 不要解释，不要标题，不要 Markdown，不要参数标签
- 不要杜撰对白、文字或水印
- 控制在 220 至 500 个中文字符
- 写完后不要再补任何总结或追问`;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `用户想法：${idea}` },
  ];
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, { model: aiApi.model, temperature: 0.8, maxTokens: 1200, stream: true })) {
    if (chunk.delta) {
      chunks.push(chunk.delta);
      onDelta(chunk.delta);
    }
  }
  return chunks.join('').trim().replace(/^```(?:text)?\s*|\s*```$/g, '').replace(/^[“"]|[”"]$/g, '');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

interface ReferenceUploaderProps {
  label: string;
  kind: ReferenceKind;
  item: ReferenceItem | null;
  onChange: (item: ReferenceItem | null) => void;
  onPick: (file: File) => void;
  manualUrl: string;
  onManualUrlChange: (value: string) => void;
  manualPlaceholder: string;
  hint?: string;
}

const ReferenceUploader: React.FC<ReferenceUploaderProps> = ({ label, kind, item, onChange, onPick, manualUrl, onManualUrlChange, manualPlaceholder, hint }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  useEffect(() => {
    if (!item) { setPreviewUrl(''); return; }
    if (item.url) { setPreviewUrl(''); return; } // 上传完后不显示本地图，避免大文件占用
    if (item.data.byteLength > 0 && item.mimeType) {
      blobToDataUrl(new Blob([item.data], { type: item.mimeType })).then(setPreviewUrl).catch(() => setPreviewUrl(''));
    } else { setPreviewUrl(''); }
    return () => { /* previewUrl 由 caller 决定是否 revoke（仅手动填 URL 时为空） */ };
  }, [item]);
  const handleFile = useCallback((file?: File) => { if (file) onPick(file); }, [onPick]);
  const onDrop = useCallback((event: React.DragEvent) => { event.preventDefault(); handleFile(event.dataTransfer.files?.[0]); }, [handleFile]);

  return (
    <div className="mb-4 rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        {item && !item.manualUrl && (
          <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-red-600" title="移除">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!item ? (
        <div>
          <input ref={inputRef} className="hidden" type="file" accept={REFERENCE_ACCEPT[kind]} onChange={(event) => handleFile(event.target.files?.[0])} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Upload className="h-4 w-4" />
            <span>点击或拖入{label}</span>
            <span className="text-[10px]">最大 {REFERENCE_SIZE_CAP[kind] / 1024 / 1024} MB，自动通过 litterbox 中转为 HTTPS</span>
          </button>
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">或手动填 HTTPS URL</summary>
            <input
              className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
              value={manualUrl}
              onChange={(event) => onManualUrlChange(event.target.value)}
              placeholder={manualPlaceholder}
            />
          </details>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border bg-card p-2">
          {previewUrl ? (
            <img src={previewUrl} className="h-14 w-14 rounded object-cover" alt={item.name} />
          ) : item.url ? (
            kind === 'image' ? <img src={item.url} className="h-14 w-14 rounded object-cover" alt={item.name} referrerPolicy="no-referrer" />
            : kind === 'video' ? <video src={item.url} className="h-14 w-14 rounded object-cover" muted preload="metadata" />
            : <div className="flex h-14 w-14 items-center justify-center rounded bg-muted"><AudioLines className="h-5 w-5 text-muted-foreground" /></div>
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded bg-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{item.name || 'manual URL'}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {item.uploadError ? <span className="text-red-600">{item.uploadError}</span>
                : item.url ? <span className="text-emerald-700">已上传 · {item.url.slice(0, 36)}…</span>
                : item.manualUrl ? <span>手动 URL 模式</span> : <span>上传中…</span>}
            </p>
          </div>
        </div>
      )}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
};

interface ReferenceListUploaderProps {
  label: string;
  kind: ReferenceKind;
  items: ReferenceItem[];
  onChange: (items: ReferenceItem[]) => void;
  onAdd: (file: File) => void;
  manualUrls: string;
  onManualUrlsChange: (value: string) => void;
  manualPlaceholder: string;
  max: number;
}

const ReferenceListUploader: React.FC<ReferenceListUploaderProps> = ({ label, kind, items, onChange, onAdd, manualUrls, onManualUrlsChange, manualPlaceholder, max }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const remove = (key: string) => onChange(items.filter((it) => it.key !== key));
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    items.forEach((item) => {
      if (item.url || item.data.byteLength === 0) return;
      const blob = new Blob([item.data], { type: item.mimeType || 'image/*' });
      next[item.key] = URL.createObjectURL(blob);
    });
    setPreviews(next);
    return () => { Object.values(next).forEach((u) => URL.revokeObjectURL(u)); };
  }, [items]);
  const onDrop = (event: React.DragEvent) => { event.preventDefault(); Array.from(event.dataTransfer.files).forEach((f) => onAdd(f)); };

  return (
    <div className="mb-4 rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{items.length}/{max}</span>
      </div>
      <input ref={inputRef} className="hidden" type="file" multiple accept={REFERENCE_ACCEPT[kind]} onChange={(event) => Array.from(event.target.files || []).forEach(onAdd)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        disabled={items.length >= max}
        className="flex h-16 w-full items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        <span>点击或拖入{label}（一次可多选）</span>
      </button>
      {!!items.length && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {items.map((item) => {
            const preview = previews[item.key] || (item.url && kind === 'image' ? item.url : '');
            return (
              <div key={item.key} className="relative overflow-hidden rounded-md border bg-card">
                {preview && kind === 'image' ? (
                  <img src={preview} className="aspect-square w-full object-cover" alt={item.name} referrerPolicy="no-referrer" />
                ) : item.url && kind === 'video' ? (
                  <video src={item.url} className="aspect-square w-full object-cover" muted preload="metadata" />
                ) : item.mimeType.startsWith('image/') ? (
                  <div className="flex aspect-square w-full items-center justify-center bg-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center bg-muted text-muted-foreground">
                    {kind === 'video' ? <VideoIcon className="h-5 w-5" /> : <AudioLines className="h-5 w-5" />}
                    <span className="mt-1 truncate px-1 text-[9px]">{item.name}</span>
                  </div>
                )}
                {item.uploadError ? (
                  <div className="absolute inset-x-0 bottom-0 bg-rose-600/90 px-1 py-0.5 text-[9px] text-white" title={item.uploadError}>上传失败</div>
                ) : !item.url && !item.uploadError ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : null}
                <button type="button" onClick={() => remove(item.key)} className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 shadow" title="移除">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-muted-foreground">或手动填 HTTPS URL（每行一个）</summary>
        <textarea
          className="mt-1 min-h-12 w-full rounded-md border bg-background p-2 text-xs"
          value={manualUrls}
          onChange={(event) => onManualUrlsChange(event.target.value)}
          placeholder={manualPlaceholder}
        />
      </details>
    </div>
  );
};

const StitchMetricsGrid: React.FC<{ metrics: StitchMetrics }> = ({ metrics }) => (
  <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
    <span>SSIM {Math.round(metrics.ssim * 100)}%</span><span>运动 {Math.round(metrics.motionDirection * 100)}%</span>
    <span>主体位置 {Math.round(metrics.subjectPosition * 100)}%</span><span>直方图 {Math.round(metrics.histogram * 100)}%</span>
    <span>曝光 {Math.round(metrics.exposure * 100)}%</span><span>色温 {Math.round(metrics.colorTemperature * 100)}%</span>
    <span>人脸 {metrics.faceIdentity === null ? '未可靠检测' : `${Math.round(metrics.faceIdentity * 100)}%（低置信度）`}</span>
  </div>
);

export interface VideoGenerationPanelProps {
  adapter: VideoGenerationAdapter;
}

export const VideoGenerationPanel: React.FC<VideoGenerationPanelProps> = ({ adapter }) => {
  const library = useMemo(() => createVideoLibrary(adapter.tasks, adapter.api), [adapter]);
  const [notifApi, contextHolder] = notification.useNotification();
  const aiApi = adapter.ai;

  const [apiKey, setApiKey] = useState<string>(() => readStoredApiKey());
  const [baseUrl, setBaseUrl] = useState<string>(() => readStoredBaseUrl());
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [prompt, setPrompt] = useState<string>('');
  const [storyboardMode, setStoryboardMode] = useState(false);
  const [storyboardDialogOpen, setStoryboardDialogOpen] = useState(false);
  const [stitchThreshold, setStitchThreshold] = useState(() => Math.max(0.4, Math.min(0.95, Number(globalThis.localStorage?.getItem(STITCH_THRESHOLD_STORAGE)) || 0.65)));
  const [continuityBible, setContinuityBible] = useState('');
  const [segments, setSegments] = useState<VideoStoryboardSegment[]>(() => Array.from({ length: MIN_STORYBOARD_SEGMENTS }, (_, index) => createStoryboardSegment(index)));
  const [mode, setMode] = useState<VideoGenerationMode>('text-to-video');
  const [duration, setDuration] = useState<number>(6);
  const [resolution, setResolution] = useState<VideoResolution>('768P');
  const [expanding, setExpanding] = useState<boolean>(false);
  const [ratio, setRatio] = useState<VideoRatio>('16:9');
  // 参考素材：本地图上传（litterbox 中转）或手动填 HTTPS URL。
  // 用 ReferenceItem 列表，提交时只取已上传 / 手动 URL 成功的项。
  const [firstFrame, setFirstFrame] = useState<ReferenceItem | null>(null);
  const [lastFrame, setLastFrame] = useState<ReferenceItem | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceItem[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<ReferenceItem[]>([]);
  const [referenceAudios, setReferenceAudios] = useState<ReferenceItem[]>([]);
  // 允许高级用户继续手填 URL：当某类素材列表为空时，仍可输入 https://... URL
  const [firstFrameManualUrl, setFirstFrameManualUrl] = useState<string>('');
  const [lastFrameManualUrl, setLastFrameManualUrl] = useState<string>('');
  const [referenceImagesManual, setReferenceImagesManual] = useState<string>('');
  const [referenceVideosManual, setReferenceVideosManual] = useState<string>('');
  const [referenceAudiosManual, setReferenceAudiosManual] = useState<string>('');

  const [tasks, setTasks] = useState<StoredVideoRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [activePolls, setActivePolls] = useState<ActivePoll[]>(() => loadActivePolls());
  const [storyboardRuns, setStoryboardRuns] = useState<StoryboardRun[]>(() => loadStoryboardRuns());
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoMeta, setVideoMeta] = useState<{ recordId: string; mimeType: string } | null>(null);
  const [pollPaused, setPollPaused] = useState<boolean>(() => globalThis.localStorage?.getItem(POLL_PAUSED_STORAGE) === '1');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activePollsRef = useRef<ActivePoll[]>([]);
  const storyboardRunsRef = useRef<StoryboardRun[]>([]);
  activePollsRef.current = activePolls;
  storyboardRunsRef.current = storyboardRuns;

  useEffect(() => { globalThis.localStorage?.setItem(MINIMAX_KEY_STORAGE, apiKey); }, [apiKey]);
  useEffect(() => { globalThis.localStorage?.setItem(MINIMAX_BASE_URL_STORAGE, baseUrl); }, [baseUrl]);
  useEffect(() => { persistActivePolls(activePolls); }, [activePolls]);
  useEffect(() => { globalThis.localStorage?.setItem(STORYBOARD_RUNS_STORAGE, JSON.stringify(storyboardRuns)); }, [storyboardRuns]);
  useEffect(() => { globalThis.localStorage?.setItem(STITCH_THRESHOLD_STORAGE, String(stitchThreshold)); }, [stitchThreshold]);
  useEffect(() => { globalThis.localStorage?.setItem(POLL_PAUSED_STORAGE, pollPaused ? '1' : '0'); }, [pollPaused]);

  const refreshLibrary = useCallback(() => {
    const next = library.listTasks(200);
    setTasks(next);
    if (next.length && !next.some((task) => task.id === selectedId)) setSelectedId(next[0].id);
  }, [selectedId, library]);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null, [tasks, selectedId]);

  const stopPolling = useCallback((recordId: string) => {
    setActivePolls((current) => current.filter((poll) => poll.recordId !== recordId));
  }, []);

  const recordError = useCallback((recordId: string, message: string) => {
    void library.updateStatus(recordId, 'failed');
    notifApi.error({ message: '视频生成失败', description: message, placement: 'bottomRight', duration: 6 });
    setActivePolls((current) => current.filter((poll) => poll.recordId !== recordId));
  }, [library, notifApi]);

  const markStoryboardFailed = useCallback((poll: ActivePoll, error: string) => {
    if (!poll.storyboardRunId) return;
    setStoryboardRuns((current) => current.map((item) => item.id === poll.storyboardRunId
      ? { ...item, status: 'failed', failedIndex: poll.segmentIndex, error } : item));
  }, []);

  const continueStoryboard = useCallback(async (poll: ActivePoll, filePath: string, acceptLowScore = false): Promise<void> => {
    if (!poll.storyboardRunId || poll.segmentIndex === undefined) return;
    const run = storyboardRunsRef.current.find((item) => item.id === poll.storyboardRunId);
    if (!run) return;
    if (run.filePaths.length && !acceptLowScore) {
      const inspection = await adapter.api.videoGeneration.inspectStitch({ previousPath: run.filePaths[run.filePaths.length - 1], nextPath: filePath, threshold: stitchThreshold });
      if (!inspection.success) throw new Error(inspection.error || '接缝质量检测失败');
      const report = { segmentIndex: poll.segmentIndex, score: inspection.score || 0, metrics: inspection.metrics };
      setStoryboardRuns((current) => current.map((item) => item.id === run.id ? { ...item, stitchScores: [...(item.stitchScores || []), inspection.score || 0], stitchReports: [...(item.stitchReports || []), report], pendingFilePath: inspection.passed ? undefined : filePath } : item));
      if (!inspection.passed) throw new Error(`第 ${poll.segmentIndex}→${poll.segmentIndex + 1} 段综合连续性 ${Math.round((inspection.score || 0) * 100)}%，低于阈值 ${Math.round(stitchThreshold * 100)}%`);
    } else if (acceptLowScore && poll.segmentIndex !== undefined) {
      setStoryboardRuns((current) => current.map((item) => item.id === run.id ? { ...item, stitchReports: (item.stitchReports || []).map((report) => report.segmentIndex === poll.segmentIndex ? { ...report, accepted: true } : report) } : item));
    }
    const completedPaths = [...run.filePaths, filePath];
    const nextIndex = poll.segmentIndex + 1;
    if (nextIndex >= run.requests.length) {
      const outputId = `storyboard-${run.id}`;
      const result = await adapter.api.videoGeneration.concat({ filePaths: completedPaths, outputId });
      if (!result.success || !result.filePath) throw new Error(result.error || '多段视频拼接失败');
      await library.createTask({ id: outputId, taskId: outputId, prompt: run.requests[0].prompt, model: run.model,
        mode: 'text-to-video', duration: run.requests.reduce((sum, item) => sum + (item.duration || 6), 0),
        resolution: run.requests[0].resolution || '768P', ratio: run.requests[0].ratio || '16:9', batchId: run.id, batchIndex: run.requests.length });
      await library.attachFile(outputId, result.fileName || '', result.filePath, result.bytes || 0);
      await library.updateStatus(outputId, 'succeeded');
      setStoryboardRuns((current) => current.filter((item) => item.id !== run.id));
      refreshLibrary();
      notifApi.success({ message: '连续视频已生成并拼接', description: `${run.requests.length} 段已合成为一个完整 MP4。`, placement: 'bottomRight' });
      return;
    }
    const frame = await adapter.api.videoGeneration.extractLastFrame({ filePath, recordId: poll.recordId });
    if (!frame.success || !frame.data || !frame.name || !frame.mimeType) throw new Error(frame.error || '无法提取上一段尾帧');
    const uploaded = await adapter.api.videoGeneration.uploadReference({ name: frame.name, mimeType: frame.mimeType, data: frame.data, ttlHours: 1 });
    if (frame.filePath) void adapter.api.videoGeneration.cleanup(frame.filePath);
    if (!uploaded.success || !uploaded.url) throw new Error(uploaded.error || '上一段尾帧上传失败');
    const payload: VideoGenerationRequest = { ...run.requests[nextIndex], mode: 'image-to-video', firstFrameUrl: uploaded.url };
    const response = await adapter.api.videoGeneration.create(payload);
    if (!response.success || !response.taskId) throw new Error(response.error || `第 ${nextIndex + 1} 段提交失败`);
    const taskId = response.taskId;
    const recordId = library.makeId();
    await library.createTask({ id: recordId, taskId: response.taskId, prompt: payload.prompt, model: payload.model || DEFAULT_MODEL,
      mode: 'image-to-video', duration: payload.duration || 6, resolution: payload.resolution || '768P', ratio: payload.ratio || '16:9',
      batchId: run.id, batchIndex: nextIndex });
    setStoryboardRuns((current) => current.map((item) => item.id === run.id ? { ...item, filePaths: completedPaths, status: 'running', error: undefined, pendingFilePath: undefined } : item));
    setActivePolls((current) => [...current, { recordId, taskId, attempts: 0, apiKey: run.apiKey,
      baseUrl: run.baseUrl, model: run.model, storyboardRunId: run.id, segmentIndex: nextIndex }]);
    refreshLibrary();
  }, [adapter, library, notifApi, refreshLibrary, stitchThreshold]);

  // 轮询单个任务直到终态。失败 / 超时 / 取消都会停。
  const pollOnce = useCallback(async (poll: ActivePoll): Promise<void> => {
    const response = await adapter.api.videoGeneration.query({ baseUrl: poll.baseUrl, apiKey: poll.apiKey, taskId: poll.taskId, model: poll.model });
    if (!response.success || !response.info) {
      // 单独一次失败不立即放弃，再试 1 次；attempts 增 1。
      if (poll.attempts + 1 >= POLL_MAX_ATTEMPTS) {
        const error = response.error || '查询任务失败';
        recordError(poll.recordId, error);
        markStoryboardFailed(poll, error);
        return;
      }
      setActivePolls((current) => current.map((item) => item.recordId === poll.recordId ? { ...item, attempts: poll.attempts + 1 } : item));
      return;
    }
    const info = response.info;
    if (info.status === 'succeeded' && info.videoUrl) {
      try {
        const dl = await adapter.api.videoGeneration.download({ taskId: poll.taskId, videoUrl: info.videoUrl, recordId: poll.recordId });
        if (!dl.success || !dl.filePath) {
          const error = dl.error || '下载成片失败';
          recordError(poll.recordId, error);
          markStoryboardFailed(poll, error);
          return;
        }
        await library.attachFile(poll.recordId, dl.fileName || '', dl.filePath, dl.bytes || 0);
        await library.updateStatus(poll.recordId, 'succeeded');
        try { await continueStoryboard(poll, dl.filePath); }
        catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          markStoryboardFailed(poll, error);
          notifApi.error({ message: '连续视频续写中断', description: error, placement: 'bottomRight', duration: 8 });
        }
        notifApi.success({ message: '视频生成完成', description: '可以预览、下载或转发到视频播放器。', placement: 'bottomRight' });
        refreshLibrary();
      } catch (err) {
        recordError(poll.recordId, err instanceof Error ? err.message : '下载成片失败');
      } finally {
        stopPolling(poll.recordId);
      }
      return;
    }
    if (info.status === 'failed' || info.status === 'cancelled') {
      await library.updateStatus(poll.recordId, info.status);
      recordError(poll.recordId, info.error || `任务${STATUS_LABEL[info.status]}`);
      markStoryboardFailed(poll, info.error || `第 ${(poll.segmentIndex || 0) + 1} 段${STATUS_LABEL[info.status]}`);
      refreshLibrary();
      return;
    }
    // 还在 processing / queued / preparing — 增加 attempts
    setActivePolls((current) => current.map((item) => item.recordId === poll.recordId ? { ...item, attempts: poll.attempts + 1 } : item));
    if (poll.attempts + 1 >= POLL_MAX_ATTEMPTS) {
      const error = `轮询超过 ${POLL_MAX_ATTEMPTS} 次仍未成功，请检查账户额度或稍后重试`;
      recordError(poll.recordId, error);
      markStoryboardFailed(poll, error);
    }
  }, [adapter, continueStoryboard, library, markStoryboardFailed, notifApi, recordError, refreshLibrary, stopPolling]);

  // 启动一个轮询（如果已经在跑就跳过）
  const startPolling = useCallback((poll: ActivePoll) => {
    setActivePolls((current) => current.some((item) => item.recordId === poll.recordId) ? current : [...current, poll]);
  }, []);

  // 轮询调度器：每 POLL_INTERVAL_MS 触发一次。
  // 多个 active 任务错峰启动（POLL_STAGGER_MS），避免上线一瞬间都打 MiniMax。
  // 暂停时整个调度停摆但 activePolls 状态保留，恢复后立即按各自的下次节奏继续。
  useEffect(() => {
    if (!activePolls.length || pollPaused) return;
    const timers: number[] = [];
    activePolls.forEach((poll, index) => {
      const delay = POLL_INTERVAL_MS + index * POLL_STAGGER_MS;
      const t = globalThis.setTimeout(() => { void pollOnce(poll); }, delay);
      timers.push(t);
    });
    return () => { timers.forEach((t) => globalThis.clearTimeout(t)); };
  }, [activePolls, pollOnce, pollPaused]);

  // 选中的任务变化时，加载对应的视频 blob URL
  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'succeeded' || !selectedTask.filePath) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl('');
      setVideoMeta(null);
      return;
    }
    if (videoMeta?.recordId === selectedTask.id) return; // 已加载
    let cancelled = false;
    (async () => {
      const result = await library.readVideoAsBlob(selectedTask.filePath);
      if (cancelled || !result.success || !result.data) {
        if (!cancelled) notifApi.warning({ message: '视频读取失败', description: result.error || '请检查文件是否还存在', placement: 'bottomRight' });
        return;
      }
      const blob = new Blob([result.data], { type: result.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(url);
      setVideoMeta({ recordId: selectedTask.id, mimeType: result.mimeType || 'video/mp4' });
    })().catch((err) => notifApi.error({ message: '读取视频出错', description: err instanceof Error ? err.message : String(err) }));
    return () => { cancelled = true; };
  }, [selectedTask, videoMeta, videoUrl, notifApi, library]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const showError = useCallback((description: string) => {
    notifApi.error({ message: '视频生成失败', description, placement: 'bottomRight', duration: 6 });
  }, [notifApi]);

  const showInfo = useCallback((message: string, description?: string) => {
    notifApi.success({ message, description, placement: 'bottomRight' });
  }, [notifApi]);

  const splitUrls = (text: string): string[] => text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

  // 通用：把本地图文件加进对应 state，再异步上传到 litterbox 拿 HTTPS URL。
  // 一个 setItems 回调负责把新项加到 list / 替换单值；上传完成后用 setItem 回填 url。
  const uploadReferenceFile = useCallback(async (file: File, kind: ReferenceKind, setItem: (item: ReferenceItem) => void): Promise<void> => {
    const inferred = inferReferenceKind(file.type);
    if (inferred !== kind) {
      showError(`${file.name} 不是${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}文件`);
      return;
    }
    if (file.size > REFERENCE_SIZE_CAP[kind]) {
      showError(`${file.name} 超过 ${(REFERENCE_SIZE_CAP[kind] / 1024 / 1024).toFixed(0)} MB 上限`);
      return;
    }
    const buffer = await file.arrayBuffer();
    const item: ReferenceItem = {
      key: makeReferenceKey(),
      name: file.name,
      mimeType: file.type,
      data: buffer,
      url: '',
    };
    setItem(item);
    const result = await adapter.api.videoGeneration.uploadReference({
      name: file.name, mimeType: file.type, data: buffer, ttlHours: 1,
    });
    if (!result.success || !result.url) {
      setItem({ ...item, uploadError: result.error || '上传失败' });
      showError(`${file.name} 上传失败：${result.error || '未知错误'}`);
      return;
    }
    setItem({ ...item, url: result.url });
  }, [adapter, showError]);

  // 高级用户手动填 HTTPS URL（不经过上传）
  const setManualUrlItem = useCallback((kind: ReferenceKind, url: string, setItem: (item: ReferenceItem) => void) => {
    if (!url.trim()) return;
    setItem({ key: makeReferenceKey(), name: url.split('/').pop() || 'manual', mimeType: '', data: new ArrayBuffer(0), url: url.trim(), manualUrl: true });
  }, []);

  const validateAndBuildPayload = useCallback((): VideoGenerationRequest | null => {
    if (!apiKey.trim()) { showError('请先填写 MiniMax API Key'); return null; }
    if (!prompt.trim()) { showError('请填写视频描述（prompt）'); return null; }
    if (prompt.length > MAX_PROMPT_LENGTH) { showError(`提示词不能超过 ${MAX_PROMPT_LENGTH} 字符`); return null; }
    const payload: VideoGenerationRequest = {
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || undefined,
      model: model.trim() || DEFAULT_MODEL,
      prompt: prompt.trim(),
      duration,
      resolution,
      ratio,
      mode,
    };

    // 解析各路素材：本地图列表 + 手动 URL
    const allReferenceItems = (primary: ReferenceItem | null, manualText: string): { urls: string[]; pending: ReferenceItem[] } => {
      const urls: string[] = [];
      if (primary) {
        if (primary.uploadError) { /* skip, user should see error inline */ }
        else if (primary.url) urls.push(primary.url);
      }
      const manualUrls = splitUrls(manualText);
      manualUrls.forEach((u) => { if (/^https?:\/\//i.test(u)) urls.push(u); });
      const pending = primary && !primary.url && !primary.uploadError ? [primary] : [];
      return { urls, pending };
    };

    if (mode === 'image-to-video') {
      const { urls, pending } = allReferenceItems(firstFrame, firstFrameManualUrl);
      if (!urls.length) { showError('首帧图生视频模式需要 1 张首帧图（请上传本地图或填 HTTPS URL）'); return null; }
      if (pending.length) { showError('首帧图正在上传，请稍候再提交'); return null; }
      payload.firstFrameUrl = urls[0];
    } else if (mode === 'start-end-to-video') {
      const f = allReferenceItems(firstFrame, firstFrameManualUrl);
      const l = allReferenceItems(lastFrame, lastFrameManualUrl);
      if (!f.urls.length || !l.urls.length) { showError('首尾帧模式需要首帧 + 尾帧两张图（请上传本地图或填 HTTPS URL）'); return null; }
      if (f.pending.length || l.pending.length) { showError('首/尾帧图正在上传，请稍候再提交'); return null; }
      payload.firstFrameUrl = f.urls[0];
      payload.lastFrameUrl = l.urls[0];
    } else if (mode === 'reference-to-video') {
      const imgUrls = referenceImages.filter((r) => r.url).map((r) => r.url).concat(splitUrls(referenceImagesManual).filter((u) => /^https?:\/\//i.test(u)));
      const vidUrls = referenceVideos.filter((r) => r.url).map((r) => r.url).concat(splitUrls(referenceVideosManual).filter((u) => /^https?:\/\//i.test(u)));
      const audUrls = referenceAudios.filter((r) => r.url).map((r) => r.url).concat(splitUrls(referenceAudiosManual).filter((u) => /^https?:\/\//i.test(u)));
      const anyPending = [...referenceImages, ...referenceVideos, ...referenceAudios].some((r) => !r.url && !r.uploadError);
      if (!imgUrls.length && !vidUrls.length && !audUrls.length) {
        showError('参考生视频模式至少需要 1 个参考图 / 参考视频 / 参考音频'); return null;
      }
      if (anyPending) { showError('部分参考素材正在上传，请稍候再提交'); return null; }
      // MiniMax 上限：图片 ≤ 9、视频 ≤ 3、音频 ≤ 3
      if (imgUrls.length > 9) { showError(`参考图片最多 9 张，当前 ${imgUrls.length}`); return null; }
      if (vidUrls.length > 3) { showError(`参考视频最多 3 段，当前 ${vidUrls.length}`); return null; }
      if (audUrls.length > 3) { showError(`参考音频最多 3 段，当前 ${audUrls.length}`); return null; }
      payload.referenceImageUrls = imgUrls;
      payload.referenceVideoUrls = vidUrls;
      payload.referenceAudioUrls = audUrls;
    }
    return payload;
  }, [apiKey, prompt, duration, resolution, ratio, mode, firstFrame, lastFrame, referenceImages, referenceVideos, referenceAudios, firstFrameManualUrl, lastFrameManualUrl, referenceImagesManual, referenceVideosManual, referenceAudiosManual, baseUrl, model, showError]);

  const handleExpand = useCallback(async () => {
    if (!prompt.trim()) { showError('请先输入一句画面想法再点扩写'); return; }
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { showError('请先在设置中配置文本 AI 服务（用于 AI 扩写）'); return; }
    setExpanding(true);
    // 先把现有 prompt 作为种子，扩写结果会覆盖（用户当前内容写到通知里兜底）
    const original = prompt;
    try {
      setPrompt(''); // 清空让流式输出从零填充
      const expanded = await expandVideoPrompt(aiApi, original, mode, (delta) => {
        setPrompt((current) => (current + delta).slice(0, MAX_PROMPT_LENGTH));
      }, adapter.api.llmChat);
      if (!expanded) {
        setPrompt(original);
        throw new Error('AI 没有返回画面描述');
      }
      setPrompt(expanded.slice(0, MAX_PROMPT_LENGTH));
      notifApi.success({ message: '视频描述已扩写', description: '可以继续微调后再提交生成。', placement: 'bottomRight' });
    } catch (err) {
      setPrompt((current) => current || original);
      showError(err instanceof Error ? err.message : 'AI 扩写失败');
    } finally {
      setExpanding(false);
    }
  }, [aiApi, mode, notifApi, prompt, showError, adapter]);

  const handleSubmit = useCallback(async () => {
    const payload = validateAndBuildPayload();
    if (!payload) return;
    setSubmitting(true);
    try {
      const response = await adapter.api.videoGeneration.create(payload);
      if (!response.success || !response.taskId) {
        showError(response.error || '提交视频生成任务失败');
        return;
      }
      const recordId = library.makeId();
      await library.createTask({
        id: recordId,
        taskId: response.taskId,
        prompt: payload.prompt,
        model: payload.model || DEFAULT_MODEL,
        mode: payload.mode || 'text-to-video',
        duration: payload.duration || 6,
        resolution: payload.resolution || '768P',
        ratio: payload.ratio || '16:9',
      });
      refreshLibrary();
      setSelectedId(recordId);
      startPolling({ recordId, taskId: response.taskId, attempts: 0, apiKey: payload.apiKey, baseUrl: payload.baseUrl || 'https://api.minimaxi.com', model: payload.model || DEFAULT_MODEL });
      showInfo('视频生成已提交', `task_id: ${response.taskId}。每 10 秒自动轮询一次。`);
      setPrompt('');
    } catch (err) {
      showError(err instanceof Error ? err.message : '提交视频生成任务失败');
    } finally { setSubmitting(false); }
  }, [adapter, library, refreshLibrary, showError, showInfo, startPolling, validateAndBuildPayload]);

  const handleStoryboardSubmit = useCallback(async () => {
    const error = validateStoryboard({ globalPrompt: prompt, continuityBible, segments });
    if (error) { showError(error); return; }
    setSubmitting(true);
    try {
      const base = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || 'https://api.minimaxi.com', model: model.trim() || DEFAULT_MODEL, duration, resolution, ratio: '16:9' as VideoRatio, mode: 'text-to-video' as VideoGenerationMode };
      const requests = buildStoryboardRequests(base, { globalPrompt: prompt, continuityBible, segments });
      const runId = `storyboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const first = requests[0];
      const response = await adapter.api.videoGeneration.create(first);
      if (!response.success || !response.taskId) { showError(response.error || '连续视频提交失败'); return; }
      const run: StoryboardRun = { id: runId, requests, filePaths: [], apiKey: base.apiKey, baseUrl: base.baseUrl, model: base.model };
      setStoryboardRuns((current) => [...current, run]);
      const recordId = library.makeId();
      await library.createTask({ id: recordId, taskId: response.taskId, prompt: first.prompt, model: run.model,
        mode: 'text-to-video', duration: first.duration || 6, resolution: first.resolution || '768P', ratio: first.ratio || '16:9',
        batchId: runId, batchIndex: 0 });
      startPolling({ recordId, taskId: response.taskId, attempts: 0, apiKey: run.apiKey, baseUrl: run.baseUrl,
        model: run.model, storyboardRunId: runId, segmentIndex: 0 });
      refreshLibrary();
      showInfo('连续视频已开始生成', `先生成第 1/${requests.length} 段，完成后将自动提取尾帧并续写下一段。`);
    } catch (err) {
      refreshLibrary();
      showError(err instanceof Error ? err.message : '连续视频提交失败');
    } finally { setSubmitting(false); }
  }, [adapter, apiKey, baseUrl, continuityBible, duration, library, model, prompt, ratio, refreshLibrary, resolution, segments, showError, showInfo, startPolling]);

  const handleDelete = useCallback(async (record: StoredVideoRecord) => {
    if (!globalThis.confirm(`确定删除这条视频记录吗？${record.fileName ? '本地视频文件会一并删除。' : ''}`)) return;
    stopPolling(record.id);
    // 还在上游队列 / 处理中的任务：先通知 MiniMax 取消，再删本地
    if (record.status === 'queued' || record.status === 'preparing' || record.status === 'processing') {
      try {
        const cancel = await adapter.api.videoGeneration.cancel({ apiKey, baseUrl, taskId: record.taskId, model: record.model });
        if (!cancel.success) {
          showError(`MiniMax 取消任务失败：${cancel.error || '未知错误'}（仍会删除本地记录）`);
        }
      } catch (err) {
        showError(`调用 MiniMax 取消接口失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      await library.deleteTask(record.id);
      refreshLibrary();
      if (selectedId === record.id) setSelectedId('');
      showInfo('视频已删除');
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }, [adapter, apiKey, baseUrl, library, refreshLibrary, selectedId, showError, showInfo, stopPolling]);

  const handleRetry = useCallback(async (record: StoredVideoRecord) => {
    if (record.status === 'succeeded') return;
    startPolling({ recordId: record.id, taskId: record.taskId, attempts: 0, apiKey, baseUrl, model });
    if (record.status === 'failed' || record.status === 'cancelled') {
      await library.updateStatus(record.id, 'processing');
      refreshLibrary();
    }
    showInfo('已重新加入轮询');
  }, [apiKey, baseUrl, library, model, refreshLibrary, showInfo, startPolling]);

  const resumeStoryboard = useCallback(async (run: StoryboardRun) => {
    const index = run.failedIndex;
    if (index === undefined) return;
    try {
      let payload: VideoGenerationRequest = run.requests[index];
      if (index > 0) {
        const previousPath = run.filePaths[index - 1];
        if (!previousPath) throw new Error('缺少上一段成片，无法从失败段续写');
        const frame = await adapter.api.videoGeneration.extractLastFrame({ filePath: previousPath, recordId: run.id });
        if (!frame.success || !frame.data || !frame.name || !frame.mimeType) throw new Error(frame.error || '提取上一段尾帧失败');
        const uploaded = await adapter.api.videoGeneration.uploadReference({ name: frame.name, mimeType: frame.mimeType, data: frame.data, ttlHours: 1 });
        if (frame.filePath) void adapter.api.videoGeneration.cleanup(frame.filePath);
        if (!uploaded.success || !uploaded.url) throw new Error(uploaded.error || '尾帧上传失败');
        payload = { ...payload, mode: 'image-to-video', firstFrameUrl: uploaded.url };
      }
      const response = await adapter.api.videoGeneration.create(payload);
      if (!response.success || !response.taskId) throw new Error(response.error || `第 ${index + 1} 段重新提交失败`);
      const recordId = library.makeId();
      await library.createTask({ id: recordId, taskId: response.taskId, prompt: payload.prompt, model: run.model, mode: payload.mode || 'text-to-video',
        duration: payload.duration || 6, resolution: payload.resolution || '768P', ratio: payload.ratio || '16:9',
        batchId: run.id, batchIndex: index });
      setStoryboardRuns((current) => current.map((item) => item.id === run.id ? { ...item, status: 'running', error: undefined } : item));
      startPolling({ recordId, taskId: response.taskId, attempts: 0, apiKey: run.apiKey, baseUrl: run.baseUrl, model: run.model,
        storyboardRunId: run.id, segmentIndex: index });
      refreshLibrary();
      showInfo('已从失败段继续', `正在重新生成第 ${index + 1}/${run.requests.length} 段，前面的成功片段会保留。`);
    } catch (err) { showError(err instanceof Error ? err.message : '恢复连续视频失败'); }
  }, [adapter, library, refreshLibrary, showError, showInfo, startPolling]);

  const acceptStoryboardStitch = useCallback(async (run: StoryboardRun) => {
    if (run.failedIndex === undefined || !run.pendingFilePath) return;
    try {
      await continueStoryboard({ recordId: run.id, taskId: run.id, attempts: 0, apiKey: run.apiKey, baseUrl: run.baseUrl,
        model: run.model, storyboardRunId: run.id, segmentIndex: run.failedIndex }, run.pendingFilePath, true);
      showInfo('已接受低分接缝', '将保留当前片段并继续生成或拼接。');
    } catch (err) { showError(err instanceof Error ? err.message : '继续故事板失败'); }
  }, [continueStoryboard, showError, showInfo]);

  const handleReveal = useCallback(async (record: StoredVideoRecord) => {
    if (!record.filePath) { showError('这条记录还没有本地文件'); return; }
    const result = await adapter.api.videoGeneration.reveal(record.filePath);
    if (!result.success) showError(result.error || '无法打开文件位置');
  }, [adapter, showError]);

  const handleOpenFolder = useCallback(async () => {
    const result = await adapter.api.videoGeneration.openFolder();
    if (!result.success) showError(result.error || '无法打开目录');
  }, [adapter, showError]);

  const handleDownload = useCallback((record: StoredVideoRecord) => {
    if (!record.filePath) return;
    const a = document.createElement('a');
    a.href = videoUrl && videoMeta?.recordId === record.id ? videoUrl : `file://${record.filePath.replace(/\\/g, '/')}`;
    a.download = record.fileName || `video-${record.id}.mp4`;
    a.click();
  }, [videoUrl, videoMeta]);

  const copyPrompt = useCallback(async (record: StoredVideoRecord) => {
    await navigator.clipboard.writeText(record.prompt);
    showInfo('提示词已复制');
  }, [showInfo]);

  const reusePrompt = useCallback((record: StoredVideoRecord) => {
    setPrompt(record.prompt.slice(0, MAX_PROMPT_LENGTH));
    setMode(inferMode(record));
    setDuration(record.duration);
    setResolution(record.resolution);
    setRatio(record.ratio);
    showInfo('已回填提示词与参数');
  }, [showInfo]);

  const isThisPolling = (id: string) => activePolls.some((poll) => poll.recordId === id);

  const totalActive = activePolls.length;
  const visibleTasks = tasks.slice(0, HISTORY_PAGE_SIZE);
  const historyGroups = useMemo(() => {
    const groups = new Map<string, { id: string; batch: boolean; items: StoredVideoRecord[] }>();
    visibleTasks.forEach((task) => {
      const key = task.batchId ? `batch:${task.batchId}` : `task:${task.id}`;
      const group = groups.get(key) || { id: key, batch: Boolean(task.batchId), items: [] };
      group.items.push(task);
      groups.set(key, group);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      items: group.batch ? group.items.sort((a, b) => (a.batchIndex ?? -1) - (b.batchIndex ?? -1)) : group.items,
    }));
  }, [visibleTasks]);

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {contextHolder}
      <section className="w-[400px] shrink-0 overflow-y-auto border-r p-5">
        <div className="mb-5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-primary" />视频生成
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            默认使用套餐支持的 Hailuo 2.3；也可切换到 MiniMax-H3 多模态视频模型。
          </p>
        </div>

        <label className="mb-2 block text-sm font-medium">MiniMax 接入域名</label>
        <input
          className="mb-3 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.minimaxi.com"
        />

        <label className="mb-2 block text-sm font-medium">MiniMax API Key</label>
        <input
          type="password"
          autoComplete="off"
          className="mb-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="在 MiniMax 开放平台创建的 API Key"
        />
        <p className="mb-4 text-[10px] text-muted-foreground">仅保存在本机 localStorage，不上传到任何服务器。</p>

        <label className="mb-2 block text-sm font-medium">生成模式</label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              disabled={storyboardMode && item.id !== 'text-to-video'}
              className={`rounded-md border px-2 py-2 text-left text-xs ${mode === item.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              <span className="block font-medium">{item.label}</span>
              <span className="mt-1 block text-[10px] text-muted-foreground">{item.description}</span>
            </button>
          ))}
        </div>

        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">视频描述</label>
          <Button type="button" size="sm" variant="outline" disabled={expanding || !prompt.trim()} onClick={() => void handleExpand()} title={!aiApi.apiKey ? '请先在设置中配置文本 AI' : '用 AI 把简短想法扩成详细的视频提示词'}>
            {expanding ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />AI 扩写中…</> : <><Sparkles className="mr-1 h-3.5 w-3.5" />AI 扩写</>}
          </Button>
        </div>
        <textarea
          className="mb-1 min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          value={prompt}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：一只橘猫在雨夜的咖啡馆窗边，温暖灯光，安静的氛围……"
        />
        <p className="mb-4 text-right text-[10px] text-muted-foreground">{prompt.length}/{MAX_PROMPT_LENGTH}</p>

        <div className="mb-4 rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <label className="flex items-center justify-between gap-3">
            <span><span className="block font-medium">多段连续视频</span><span className="text-[10px] text-muted-foreground">3 段起，可继续添加；统一角色、场景和镜头状态</span></span>
            <input type="checkbox" checked={storyboardMode} onChange={(event) => {
              setStoryboardMode(event.target.checked);
              if (event.target.checked) { setMode('text-to-video'); setStoryboardDialogOpen(true); }
            }} />
          </label>
          {storyboardMode && (
            <button type="button" className="mt-2 flex w-full items-center justify-between rounded border bg-background px-2 py-1.5 text-left hover:border-primary/50" onClick={() => setStoryboardDialogOpen(true)}>
              <span>{segments.length} 个分段 · 接缝阈值 {Math.round(stitchThreshold * 100)}%</span>
              <span className="text-primary">编辑设置</span>
            </button>
          )}
        </div>
        {storyboardMode && storyboardDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6" role="dialog" aria-modal="true" aria-labelledby="storyboard-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setStoryboardDialogOpen(false); }}>
            <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div><h2 id="storyboard-dialog-title" className="text-base font-semibold">多段连续视频设置</h2><p className="mt-0.5 text-xs text-muted-foreground">设置全局连续性与每个视频分段</p></div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setStoryboardDialogOpen(false)} aria-label="关闭"><X className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-3 overflow-y-auto p-5">
            <label className="block text-xs font-medium">接缝质量阈值：{Math.round(stitchThreshold * 100)}%
              <input type="range" min={40} max={95} step={1} value={Math.round(stitchThreshold * 100)} className="mt-1 w-full"
                onChange={(event) => setStitchThreshold(Number(event.target.value) / 100)} />
              <span className="text-[10px] font-normal text-muted-foreground">综合 SSIM、运动方向、主体位置、曝光、色温、直方图及低置信度人脸区域指标。</span>
            </label>
            <label className="block text-xs font-medium">全局连续性设定
              <textarea className="mt-1 min-h-20 w-full resize-y rounded-md border bg-background p-2 font-normal" value={continuityBible}
                onChange={(event) => setContinuityBible(event.target.value)} placeholder="人物外观、服装、场景、色调、镜头方向、持续出现的道具……" />
            </label>
            {segments.map((segment, index) => (
              <div key={segment.id} className="rounded-md border bg-muted/20 p-2">
                <div className="mb-2 flex items-center gap-2">
                  <input className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs font-medium" value={segment.title}
                    onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, title: event.target.value } : item))} />
                  <Button type="button" size="sm" variant="ghost" disabled={segments.length <= MIN_STORYBOARD_SEGMENTS}
                    onClick={() => setSegments((current) => current.filter((item) => item.id !== segment.id))} title="删除本段"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <textarea className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-xs" value={segment.prompt}
                  onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, prompt: event.target.value } : item))}
                  placeholder={`第 ${index + 1} 段发生的动作、镜头运动和情节`} />
                <input className="mt-2 h-8 w-full rounded-md border bg-background px-2 text-xs" value={segment.endState}
                  onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, endState: event.target.value } : item))}
                  placeholder={index === segments.length - 1 ? '最终收束状态（可选）' : '本段结束状态，下一段将自动承接（推荐填写）'} />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setSegments((current) => [...current, createStoryboardSegment(current.length)])}>
              <Plus className="mr-1 h-3.5 w-3.5" />添加第 {segments.length + 1} 段
            </Button>
              </div>
              <div className="flex justify-end border-t px-5 py-3"><Button type="button" onClick={() => setStoryboardDialogOpen(false)}>完成</Button></div>
            </div>
          </div>
        )}

        {mode === 'image-to-video' && (
          <ReferenceUploader
            label="首帧图片"
            kind="image"
            item={firstFrame}
            onChange={setFirstFrame}
            onPick={(file) => void uploadReferenceFile(file, 'image', setFirstFrame)}
            manualUrl={firstFrameManualUrl}
            onManualUrlChange={(v) => { setFirstFrameManualUrl(v); if (v.trim() && /^https?:\/\//i.test(v.trim())) setManualUrlItem('image', v, setFirstFrame); }}
            manualPlaceholder="https://example.com/first-frame.png"
            hint="MiniMax 视频生成会以此画面作为起始帧；支持 PNG / JPEG / WebP / HEIC，最大 30 MB。"
          />
        )}
        {mode === 'start-end-to-video' && (
          <>
            <ReferenceUploader
              label="首帧图片"
              kind="image"
              item={firstFrame}
              onChange={setFirstFrame}
              onPick={(file) => void uploadReferenceFile(file, 'image', setFirstFrame)}
              manualUrl={firstFrameManualUrl}
              onManualUrlChange={(v) => { setFirstFrameManualUrl(v); if (v.trim() && /^https?:\/\//i.test(v.trim())) setManualUrlItem('image', v, setFirstFrame); }}
              manualPlaceholder="https://example.com/first-frame.png"
            />
            <ReferenceUploader
              label="尾帧图片"
              kind="image"
              item={lastFrame}
              onChange={setLastFrame}
              onPick={(file) => void uploadReferenceFile(file, 'image', setLastFrame)}
              manualUrl={lastFrameManualUrl}
              onManualUrlChange={(v) => { setLastFrameManualUrl(v); if (v.trim() && /^https?:\/\//i.test(v.trim())) setManualUrlItem('image', v, setLastFrame); }}
              manualPlaceholder="https://example.com/last-frame.png"
              hint="视频会自然过渡到这一画面。"
            />
          </>
        )}
        {mode === 'reference-to-video' && (
          <>
            <ReferenceListUploader
              label="参考图片（角色 / 风格）"
              kind="image"
              items={referenceImages}
              onChange={setReferenceImages}
              onAdd={(file) => void uploadReferenceFile(file, 'image', (item) => setReferenceImages((cur) => [...cur, item]))}
              manualUrls={referenceImagesManual}
              onManualUrlsChange={setReferenceImagesManual}
              manualPlaceholder={'https://img1.png\nhttps://img2.png'}
              max={9}
            />
            <ReferenceListUploader
              label="参考视频（动作 / 节奏）"
              kind="video"
              items={referenceVideos}
              onChange={setReferenceVideos}
              onAdd={(file) => void uploadReferenceFile(file, 'video', (item) => setReferenceVideos((cur) => [...cur, item]))}
              manualUrls={referenceVideosManual}
              onManualUrlsChange={setReferenceVideosManual}
              manualPlaceholder="https://example.com/ref.mp4"
              max={3}
            />
            <ReferenceListUploader
              label="参考音频（声音 / 节奏）"
              kind="audio"
              items={referenceAudios}
              onChange={setReferenceAudios}
              onAdd={(file) => void uploadReferenceFile(file, 'audio', (item) => setReferenceAudios((cur) => [...cur, item]))}
              manualUrls={referenceAudiosManual}
              onManualUrlsChange={setReferenceAudiosManual}
              manualPlaceholder="https://example.com/ref.wav"
              max={3}
            />
          </>
        )}

        <div className="mb-4 grid grid-cols-3 gap-3">
          <label className="text-xs">
            时长 (秒)
            <input
              type="number"
              min={4}
              max={15}
              step={1}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2"
              value={duration}
              onChange={(event) => setDuration(Math.max(4, Math.min(15, Number(event.target.value) || 6)))}
            />
          </label>
          <label className="text-xs">
            分辨率
            <select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={resolution} onChange={(event) => setResolution(event.target.value as VideoResolution)}>
              {RESOLUTIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs">
            画幅
            <select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={ratio} onChange={(event) => setRatio(event.target.value as VideoRatio)} disabled={mode !== 'text-to-video' && ratio === 'adaptive'}>
              {RATIOS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <Button type="button" className="w-full" disabled={submitting || !apiKey.trim() || !prompt.trim()} onClick={() => void (storyboardMode ? handleStoryboardSubmit() : handleSubmit())}>
          {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />提交中…</> : <><Sparkles className="mr-1 h-4 w-4" />{storyboardMode ? '开始连续生成' : '生成视频'}</>}
        </Button>
        {totalActive > 0 && (
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>正在轮询 {totalActive} 个任务 · 每 10s 一次</span>
            <button type="button" onClick={() => setPollPaused((value) => !value)} className="flex items-center gap-1 hover:text-foreground">
              {pollPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {pollPaused ? '继续' : '暂停'}
            </button>
          </div>
        )}
      </section>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {selectedTask ? (
          <article className="m-4 overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[selectedTask.status]}`}>{STATUS_LABEL[selectedTask.status]}</span>
                <span>{selectedTask.model} · {selectedTask.resolution} · {selectedTask.ratio} · {selectedTask.duration}s</span>
              </div>
              <div className="flex items-center gap-1">
                {isThisPolling(selectedTask.id) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{new Date(selectedTask.createdAt).toLocaleString()}</span>
              </div>
            </div>
            {selectedTask.status === 'succeeded' && selectedTask.filePath ? (
              videoUrl ? (
                <div className="bg-black">
                  <video ref={videoRef} src={videoUrl} controls className="max-h-[480px] w-full" preload="metadata" />
                </div>
              ) : (
                <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">正在加载视频…</div>
              )
            ) : (
              <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
                {isThisPolling(selectedTask.id) ? <Loader2 className="h-8 w-8 animate-spin" /> : <Play className="h-10 w-10 opacity-30" />}
                <p className="text-sm">
                  {selectedTask.status === 'processing' || selectedTask.status === 'queued' || selectedTask.status === 'preparing'
                    ? '正在生成视频…每 10 秒自动轮询一次'
                    : selectedTask.status === 'failed' || selectedTask.status === 'cancelled'
                      ? '生成失败，可以重新加入轮询或调整后重新提交。'
                      : '等待生成'}
                </p>
                <p className="text-[11px]">task_id: {selectedTask.taskId}</p>
              </div>
            )}
            <div className="p-4">
              <details>
                <summary className="cursor-pointer text-xs font-medium">查看完整提示词</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{selectedTask.prompt}</p>
              </details>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyPrompt(selectedTask)}>
                  <Copy className="mr-1 h-4 w-4" />复制提示词
                </Button>
                <Button size="sm" variant="outline" onClick={() => reusePrompt(selectedTask)}>
                  <Sparkles className="mr-1 h-4 w-4" />再次使用
                </Button>
                {selectedTask.status === 'succeeded' && selectedTask.filePath && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleDownload(selectedTask)}>
                      <Download className="mr-1 h-4 w-4" />下载
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleReveal(selectedTask)}>
                      <FolderOpen className="mr-1 h-4 w-4" />打开位置
                    </Button>
                  </>
                )}
                {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled' || isThisPolling(selectedTask.id)) && (
                  <Button size="sm" variant="outline" onClick={() => void handleRetry(selectedTask)}>
                    <RefreshCw className="mr-1 h-4 w-4" />{selectedTask.status === 'failed' || selectedTask.status === 'cancelled' ? '重试' : '立即轮询'}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => void handleDelete(selectedTask)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </article>
        ) : (
          <div className="flex h-full min-h-80 flex-col items-center justify-center text-muted-foreground">
            <Play className="mb-4 h-16 w-16 opacity-20" />
            <p className="font-medium">填写左侧表单并提交任务</p>
            <p className="mt-1 text-sm">生成后的视频会保存到本地，可以预览、下载或直接打开文件夹。</p>
          </div>
        )}
        {storyboardRuns.length > 0 && (
          <section className="mx-4 mb-4 space-y-2">
            <h2 className="text-sm font-semibold">连续视频</h2>
            {storyboardRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-primary/25 bg-primary/[0.025] p-3 text-xs">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <span className="font-medium">{run.requests.length} 段连续</span>
                    <span className="ml-2 text-muted-foreground">{run.model}</span>
                  </div>
                  {run.status === 'failed' ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">中断于第 {(run.failedIndex ?? 0) + 1} 段</span> : <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">进行中</span>}
                </div>
                {run.stitchReports && run.stitchReports.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">查看接缝检测</summary>
                    <div className="mt-2 space-y-2">
                      {run.stitchReports.map((report) => (
                        <div key={report.segmentIndex} className="rounded-md border bg-card p-2">
                          <div>第 {report.segmentIndex}→{report.segmentIndex + 1} 段 · {Math.round(report.score * 100)}% {report.accepted ? '（已接受低分）' : ''}</div>
                          {report.metrics && <StitchMetricsGrid metrics={report.metrics} />}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {run.error && <p className="mt-2 text-red-600">{run.error}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  {run.status === 'failed' && run.failedIndex !== undefined && (
                    <Button size="sm" variant="outline" onClick={() => void resumeStoryboard(run)}>从失败段继续</Button>
                  )}
                  {run.status === 'failed' && run.pendingFilePath && (
                    <Button size="sm" variant="outline" onClick={() => void acceptStoryboardStitch(run)}>接受低分接缝</Button>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      <aside className="w-72 shrink-0 overflow-y-auto border-l bg-muted/10 p-4">
        <div className="sticky top-0 z-10 mb-3 bg-background/95 pb-2 backdrop-blur">
          <h2 className="text-sm font-semibold">历史任务</h2>
          <p className="text-[11px] text-muted-foreground">本地已保存 {tasks.length} 条 · 显示最近 {Math.min(visibleTasks.length, HISTORY_PAGE_SIZE)} 条</p>
        </div>
        <div className="space-y-3">
          {historyGroups.map((group) => (
            <div key={group.id} className={group.batch ? 'overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.025] p-2' : ''}>
              {group.batch && (
                <div className="mb-2 flex items-center justify-between px-1 text-[10px]">
                  <span className="font-medium text-foreground">本次连续生成</span>
                  <span className="text-muted-foreground">{group.items.length} 个视频</span>
                </div>
              )}
              <div className={group.batch ? 'space-y-2' : ''}>
              {group.items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`block w-full overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:border-primary/60 ${selectedTask?.id === item.id ? 'border-primary ring-2 ring-primary/15' : ''}`}
            >
              <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                {isThisPolling(item.id) && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <div className="aspect-video w-full bg-muted/40">
                {item.status === 'succeeded' && item.id === videoMeta?.recordId && videoUrl ? (
                  <video src={videoUrl} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground/40">
                    <Play className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="p-2">
                {group.batch && <span className="mb-1 block text-[10px] font-medium text-primary">{item.id === `storyboard-${item.batchId}` ? '完整成片' : `第 ${(item.batchIndex ?? 0) + 1} 段`}</span>}
                <span className="block truncate text-xs font-medium">{item.prompt || `任务 ${item.id}`}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">{item.model} · {item.resolution} · {item.duration}s · {item.ratio}</span>
                <span className="block text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
            </button>
              ))}
              </div>
            </div>
          ))}
        </div>
        {!visibleTasks.length && (
          <div className="grid min-h-48 place-items-center rounded-xl border border-dashed px-4 text-center text-xs text-muted-foreground">
            生成过的视频会以卡片形式显示在这里
          </div>
        )}
        <button type="button" onClick={() => void handleOpenFolder()} className="mt-3 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary">
          <FolderOpen className="h-3.5 w-3.5" />打开视频存储目录
        </button>
      </aside>
    </div>
  );
};

export default VideoGenerationPanel;
