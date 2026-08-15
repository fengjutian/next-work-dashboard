import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FolderOpen, Loader2, Play, Plus, RefreshCw, Sparkles, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { notification } from 'antd';
import type {
  StoredVideoRecord,
  VideoGenerationMode,
  VideoGenerationRequest,
  VideoRatio,
  VideoResolution,
  VideoTaskStatus,
} from './types';
import { POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS } from './core/api';
import {
  attachFile,
  createTask,
  deleteTask,
  listTasks,
  makeId,
  readVideoAsBlob,
  updateStatus,
} from './video-library';

const MINIMAX_KEY_STORAGE = 'nwd:video-generation:minimax-api-key';
const MINIMAX_BASE_URL_STORAGE = 'nwd:video-generation:minimax-base-url';
const POLL_STATE_STORAGE = 'nwd:video-generation:active-polls';
const HISTORY_PAGE_SIZE = 12;
const MAX_PROMPT_LENGTH = 7000;

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
}

function loadActivePolls(): ActivePoll[] {
  try {
    const raw = localStorage.getItem(POLL_STATE_STORAGE);
    if (!raw) return [];
    const data = JSON.parse(raw) as ActivePoll[];
    if (!Array.isArray(data)) return [];
    return data.filter((item) => item && item.recordId && item.taskId);
  } catch { return []; }
}

function persistActivePolls(polls: ActivePoll[]): void {
  try { localStorage.setItem(POLL_STATE_STORAGE, JSON.stringify(polls)); } catch { /* ignore */ }
}

function readStoredApiKey(): string {
  return localStorage.getItem(MINIMAX_KEY_STORAGE) || '';
}

function readStoredBaseUrl(): string {
  return localStorage.getItem(MINIMAX_BASE_URL_STORAGE) || 'https://api.minimaxi.com';
}

function inferMode(record: StoredVideoRecord): VideoGenerationMode {
  return (record.mode as VideoGenerationMode) || 'text-to-video';
}

export const VideoGenerationPanel: React.FC = () => {
  const [notifApi, contextHolder] = notification.useNotification();

  const [apiKey, setApiKey] = useState<string>(() => readStoredApiKey());
  const [baseUrl, setBaseUrl] = useState<string>(() => readStoredBaseUrl());
  const [model, setModel] = useState<string>('MiniMax-H3');
  const [prompt, setPrompt] = useState<string>('');
  const [mode, setMode] = useState<VideoGenerationMode>('text-to-video');
  const [duration, setDuration] = useState<number>(6);
  const [resolution, setResolution] = useState<VideoResolution>('768P');
  const [ratio, setRatio] = useState<VideoRatio>('16:9');
  const [firstFrameUrl, setFirstFrameUrl] = useState<string>('');
  const [lastFrameUrl, setLastFrameUrl] = useState<string>('');
  const [referenceImageUrls, setReferenceImageUrls] = useState<string>('');
  const [referenceVideoUrls, setReferenceVideoUrls] = useState<string>('');
  const [referenceAudioUrls, setReferenceAudioUrls] = useState<string>('');

  const [tasks, setTasks] = useState<StoredVideoRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [activePolls, setActivePolls] = useState<ActivePoll[]>(() => loadActivePolls());
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoMeta, setVideoMeta] = useState<{ recordId: string; mimeType: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activePollsRef = useRef<ActivePoll[]>([]);
  activePollsRef.current = activePolls;

  useEffect(() => { localStorage.setItem(MINIMAX_KEY_STORAGE, apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem(MINIMAX_BASE_URL_STORAGE, baseUrl); }, [baseUrl]);
  useEffect(() => { persistActivePolls(activePolls); }, [activePolls]);

  const refreshLibrary = useCallback(() => {
    const next = listTasks(200);
    setTasks(next);
    if (next.length && !next.some((task) => task.id === selectedId)) setSelectedId(next[0].id);
  }, [selectedId]);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null, [tasks, selectedId]);

  const stopPolling = useCallback((recordId: string) => {
    setActivePolls((current) => current.filter((poll) => poll.recordId !== recordId));
  }, []);

  const recordError = useCallback((recordId: string, message: string) => {
    void updateStatus(recordId, 'failed');
    notifApi.error({ message: '视频生成失败', description: message, placement: 'bottomRight', duration: 6 });
    setActivePolls((current) => current.filter((poll) => poll.recordId !== recordId));
  }, [notifApi]);

  // 轮询单个任务直到终态。失败 / 超时 / 取消都会停。
  const pollOnce = useCallback(async (poll: ActivePoll): Promise<void> => {
    const response = await window.electronAPI.videoGeneration.query({ baseUrl: poll.baseUrl, apiKey: poll.apiKey, taskId: poll.taskId });
    if (!response.success || !response.info) {
      // 单独一次失败不立即放弃，再试 1 次；attempts 增 1。
      if (poll.attempts + 1 >= POLL_MAX_ATTEMPTS) {
        recordError(poll.recordId, response.error || '查询任务失败');
        return;
      }
      setActivePolls((current) => current.map((item) => item.recordId === poll.recordId ? { ...item, attempts: poll.attempts + 1 } : item));
      return;
    }
    const info = response.info;
    if (info.status === 'succeeded' && info.videoUrl) {
      try {
        const dl = await window.electronAPI.videoGeneration.download({ taskId: poll.taskId, videoUrl: info.videoUrl, recordId: poll.recordId });
        if (!dl.success || !dl.filePath) {
          recordError(poll.recordId, dl.error || '下载成片失败');
          return;
        }
        await attachFile(poll.recordId, dl.fileName || '', dl.filePath, dl.bytes || 0);
        await updateStatus(poll.recordId, 'succeeded');
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
      await updateStatus(poll.recordId, info.status);
      recordError(poll.recordId, info.error || `任务${STATUS_LABEL[info.status]}`);
      refreshLibrary();
      return;
    }
    // 还在 processing / queued / preparing — 增加 attempts
    setActivePolls((current) => current.map((item) => item.recordId === poll.recordId ? { ...item, attempts: poll.attempts + 1 } : item));
    if (poll.attempts + 1 >= POLL_MAX_ATTEMPTS) {
      recordError(poll.recordId, `轮询超过 ${POLL_MAX_ATTEMPTS} 次仍未成功，请检查账户额度或稍后重试`);
    }
  }, [notifApi, recordError, refreshLibrary, stopPolling]);

  // 启动一个轮询（如果已经在跑就跳过）
  const startPolling = useCallback((poll: ActivePoll) => {
    setActivePolls((current) => current.some((item) => item.recordId === poll.recordId) ? current : [...current, poll]);
  }, []);

  // 轮询调度器：每 POLL_INTERVAL_MS 触发一次
  useEffect(() => {
    if (!activePolls.length) return;
    const timer = window.setTimeout(() => {
      const current = activePollsRef.current;
      current.forEach((poll) => { void pollOnce(poll); });
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activePolls, pollOnce]);

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
      const result = await readVideoAsBlob(selectedTask.filePath);
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
  }, [selectedTask, videoMeta, videoUrl, notifApi]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const showError = useCallback((description: string) => {
    notifApi.error({ message: '视频生成失败', description, placement: 'bottomRight', duration: 6 });
  }, [notifApi]);

  const showInfo = useCallback((message: string, description?: string) => {
    notifApi.success({ message, description, placement: 'bottomRight' });
  }, [notifApi]);

  const splitUrls = (text: string): string[] => text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

  const validateAndBuildPayload = useCallback((): VideoGenerationRequest | null => {
    if (!apiKey.trim()) { showError('请先填写 MiniMax API Key'); return null; }
    if (!prompt.trim()) { showError('请填写视频描述（prompt）'); return null; }
    if (prompt.length > MAX_PROMPT_LENGTH) { showError(`提示词不能超过 ${MAX_PROMPT_LENGTH} 字符`); return null; }
    const payload: VideoGenerationRequest = {
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || undefined,
      model: model.trim() || 'MiniMax-H3',
      prompt: prompt.trim(),
      duration,
      resolution,
      ratio,
      mode,
    };
    const firstFrame = firstFrameUrl.trim();
    const lastFrame = lastFrameUrl.trim();
    const refImages = splitUrls(referenceImageUrls);
    const refVideos = splitUrls(referenceVideoUrls);
    const refAudios = splitUrls(referenceAudioUrls);

    if (mode === 'image-to-video') {
      if (!firstFrame) { showError('首帧图生视频模式需要 1 张首帧图 URL'); return null; }
      if (!/^https?:\/\//i.test(firstFrame)) { showError('首帧图 URL 必须是 http(s) 链接'); return null; }
      payload.firstFrameUrl = firstFrame;
    } else if (mode === 'start-end-to-video') {
      if (!firstFrame || !lastFrame) { showError('首尾帧模式需要首帧 + 尾帧两张图 URL'); return null; }
      if (!/^https?:\/\//i.test(firstFrame) || !/^https?:\/\//i.test(lastFrame)) { showError('首/尾帧 URL 必须是 http(s) 链接'); return null; }
      payload.firstFrameUrl = firstFrame;
      payload.lastFrameUrl = lastFrame;
    } else if (mode === 'reference-to-video') {
      if (!refImages.length && !refVideos.length && !refAudios.length) {
        showError('参考生视频模式至少需要 1 个参考图 / 参考视频 / 参考音频 URL'); return null;
      }
      const allUrls = [...refImages, ...refVideos, ...refAudios];
      if (allUrls.some((url) => !/^https?:\/\//i.test(url))) { showError('参考素材 URL 必须是 http(s) 链接'); return null; }
      payload.referenceImageUrls = refImages;
      payload.referenceVideoUrls = refVideos;
      payload.referenceAudioUrls = refAudios;
    }
    return payload;
  }, [apiKey, prompt, duration, resolution, ratio, mode, firstFrameUrl, lastFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, baseUrl, model, showError]);

  const handleSubmit = useCallback(async () => {
    const payload = validateAndBuildPayload();
    if (!payload) return;
    setSubmitting(true);
    try {
      const response = await window.electronAPI.videoGeneration.create(payload);
      if (!response.success || !response.taskId) {
        showError(response.error || '提交视频生成任务失败');
        return;
      }
      const recordId = makeId();
      await createTask({
        id: recordId,
        taskId: response.taskId,
        prompt: payload.prompt,
        model: payload.model || 'MiniMax-H3',
        mode: payload.mode || 'text-to-video',
        duration: payload.duration || 6,
        resolution: payload.resolution || '768P',
        ratio: payload.ratio || '16:9',
      });
      refreshLibrary();
      setSelectedId(recordId);
      startPolling({
        recordId,
        taskId: response.taskId,
        attempts: 0,
        apiKey: payload.apiKey,
        baseUrl: payload.baseUrl || baseUrl,
        model: payload.model || 'MiniMax-H3',
      });
      showInfo('视频生成任务已提交', `MiniMax task_id: ${response.taskId}，每 ${POLL_INTERVAL_MS / 1000} 秒轮询一次。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '提交任务失败';
      const needsRestart = /No handler registered for ['"]video-generation:create['"]/i.test(message);
      const staleSchema = /table|video_generation_tasks/i.test(message);
      showError(needsRestart
        ? '视频生成主进程未注册。请完全退出应用（包括托盘进程）后重新启动；仅刷新页面不会更新 IPC。'
        : (staleSchema ? '数据库表 video_generation_tasks 尚未创建。请完全退出应用后重启以执行 schema 初始化。' : message));
    } finally {
      setSubmitting(false);
    }
  }, [validateAndBuildPayload, baseUrl, refreshLibrary, startPolling, showError, showInfo]);

  const handleDelete = useCallback(async (record: StoredVideoRecord) => {
    if (!window.confirm(`确定删除这条视频记录吗？${record.fileName ? '本地视频文件会一并删除。' : ''}`)) return;
    stopPolling(record.id);
    try {
      await deleteTask(record.id);
      refreshLibrary();
      if (selectedId === record.id) setSelectedId('');
      showInfo('视频已删除');
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }, [refreshLibrary, selectedId, showError, showInfo, stopPolling]);

  const handleRetry = useCallback(async (record: StoredVideoRecord) => {
    if (record.status === 'succeeded') return;
    startPolling({ recordId: record.id, taskId: record.taskId, attempts: 0, apiKey, baseUrl, model });
    if (record.status === 'failed' || record.status === 'cancelled') {
      await updateStatus(record.id, 'processing');
      refreshLibrary();
    }
    showInfo('已重新加入轮询');
  }, [apiKey, baseUrl, model, refreshLibrary, showInfo, startPolling]);

  const handleReveal = useCallback(async (record: StoredVideoRecord) => {
    if (!record.filePath) { showError('这条记录还没有本地文件'); return; }
    const result = await window.electronAPI.videoGeneration.reveal(record.filePath);
    if (!result.success) showError(result.error || '无法打开文件位置');
  }, [showError]);

  const handleOpenFolder = useCallback(async () => {
    const result = await window.electronAPI.videoGeneration.openFolder();
    if (!result.success) showError(result.error || '无法打开目录');
  }, [showError]);

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

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {contextHolder}
      <section className="w-[400px] shrink-0 overflow-y-auto border-r p-5">
        <div className="mb-5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-primary" />视频生成
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            基于 MiniMax-H3 多模态视频模型，支持文生视频、首/尾帧、参考生视频。
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
              className={`rounded-md border px-2 py-2 text-left text-xs ${mode === item.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              <span className="block font-medium">{item.label}</span>
              <span className="mt-1 block text-[10px] text-muted-foreground">{item.description}</span>
            </button>
          ))}
        </div>

        <label className="mb-2 block text-sm font-medium">视频描述</label>
        <textarea
          className="mb-1 min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          value={prompt}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：一只橘猫在雨夜的咖啡馆窗边，温暖灯光，安静的氛围……"
        />
        <p className="mb-4 text-right text-[10px] text-muted-foreground">{prompt.length}/{MAX_PROMPT_LENGTH}</p>

        {mode === 'image-to-video' && (
          <label className="mb-4 grid gap-1 text-xs">
            <span>首帧图片 URL（https://）</span>
            <input className="h-9 rounded-md border bg-background px-3" value={firstFrameUrl} onChange={(event) => setFirstFrameUrl(event.target.value)} placeholder="https://..." />
          </label>
        )}
        {mode === 'start-end-to-video' && (
          <>
            <label className="mb-3 grid gap-1 text-xs">
              <span>首帧图片 URL（https://）</span>
              <input className="h-9 rounded-md border bg-background px-3" value={firstFrameUrl} onChange={(event) => setFirstFrameUrl(event.target.value)} placeholder="https://..." />
            </label>
            <label className="mb-4 grid gap-1 text-xs">
              <span>尾帧图片 URL（https://）</span>
              <input className="h-9 rounded-md border bg-background px-3" value={lastFrameUrl} onChange={(event) => setLastFrameUrl(event.target.value)} placeholder="https://..." />
            </label>
          </>
        )}
        {mode === 'reference-to-video' && (
          <>
            <label className="mb-3 grid gap-1 text-xs">
              <span>参考图片 URL（每行一个）</span>
              <textarea className="min-h-16 rounded-md border bg-background p-2" value={referenceImageUrls} onChange={(event) => setReferenceImageUrls(event.target.value)} placeholder={'https://img1.png\nhttps://img2.png'} />
            </label>
            <label className="mb-3 grid gap-1 text-xs">
              <span>参考视频 URL（每行一个，最多 3 段）</span>
              <textarea className="min-h-16 rounded-md border bg-background p-2" value={referenceVideoUrls} onChange={(event) => setReferenceVideoUrls(event.target.value)} placeholder={'https://ref1.mp4'} />
            </label>
            <label className="mb-4 grid gap-1 text-xs">
              <span>参考音频 URL（每行一个）</span>
              <textarea className="min-h-16 rounded-md border bg-background p-2" value={referenceAudioUrls} onChange={(event) => setReferenceAudioUrls(event.target.value)} placeholder={'https://audio1.wav'} />
            </label>
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

        <label className="mb-4 grid gap-1 text-xs">
          模型
          <input className="h-9 rounded-md border bg-background px-3" value={model} onChange={(event) => setModel(event.target.value)} placeholder="MiniMax-H3" />
        </label>

        <Button className="w-full" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4" />正在提交</> : <><Plus className="mr-2 h-4 w-4" />提交视频生成任务</>}
        </Button>

        {totalActive > 0 && (
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            当前有 {totalActive} 个任务正在轮询（每 {POLL_INTERVAL_MS / 1000} 秒一次）
          </p>
        )}
      </section>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {selectedTask ? (
          <article className="mx-auto max-w-4xl overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
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
      </main>

      <aside className="w-72 shrink-0 overflow-y-auto border-l bg-muted/10 p-4">
        <div className="sticky top-0 z-10 mb-3 bg-background/95 pb-2 backdrop-blur">
          <h2 className="text-sm font-semibold">历史任务</h2>
          <p className="text-[11px] text-muted-foreground">本地已保存 {tasks.length} 条 · 显示最近 {Math.min(visibleTasks.length, HISTORY_PAGE_SIZE)} 条</p>
        </div>
        <div className="space-y-3">
          {visibleTasks.map((item) => (
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
                <span className="block truncate text-xs font-medium">{item.prompt || `任务 ${item.id}`}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">{item.model} · {item.resolution} · {item.duration}s · {item.ratio}</span>
                <span className="block text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
            </button>
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
