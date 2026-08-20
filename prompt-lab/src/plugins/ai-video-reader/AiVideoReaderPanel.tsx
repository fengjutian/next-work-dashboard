import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Spin,
  message,
} from "antd";
import type {
  VideoAnswer,
  VideoReaderAsrProvider,
  VideoReaderProject,
  VideoReaderTaskProgress,
} from "@/core/ai-video-reader/types";
import {
  mergeWithNext,
  normalizeSegments,
  splitSegment,
} from "@/core/ai-video-reader/editing";
import { Trash2 } from "@/components/icons";

const time = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function AiVideoReaderPanel() {
  const [projects, setProjects] = useState<VideoReaderProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [currentMs, setCurrentMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [asrOpen, setAsrOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editText, setEditText] = useState("");
  const [editStart, setEditStart] = useState(0);
  const [editEnd, setEditEnd] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<VideoAnswer>();
  const [playbackError, setPlaybackError] = useState<string>();
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [preparingPlayback, setPreparingPlayback] = useState(false);
  const [runtime, setRuntime] = useState<{
    ffmpeg: { available: boolean; version?: string };
    ffprobe: { available: boolean };
  }>();
  const [taskProgress, setTaskProgress] = useState<VideoReaderTaskProgress>();
  const [asrForm] = Form.useForm<{
    provider: VideoReaderAsrProvider;
    baseUrl: string;
    apiKey: string;
    model: string;
    language?: string;
  }>();
  const asrProvider = Form.useWatch("provider", asrForm);
  const [analysisForm] = Form.useForm<{
    baseUrl: string;
    apiKey: string;
    model: string;
  }>();
  const [askForm] = Form.useForm<{
    question: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackAttempts = useRef(new Set<string>());
  const selected = projects.find((item) => item.id === selectedId);
  useEffect(() => {
    setPlaybackError(undefined);
    setPlaybackUrl(selected?.mediaUrl);
    setPreparingPlayback(false);
    setCurrentMs(0);
  }, [selectedId, selected?.mediaUrl]);
  const prepareCompatiblePlayback = async () => {
    if (!selected || preparingPlayback) return;
    setPreparingPlayback(true);
    setPlaybackError(undefined);
    setTaskProgress({
      projectId: selected.id,
      stage: "transcoding",
      progress: 1,
      detail: "正在准备兼容播放版本",
    });
    try {
      const url = await window.electronAPI.aiVideoReader.preparePlayback(
        selected.id,
      );
      setPlaybackUrl(url);
      setPlaybackError(undefined);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "兼容转码失败";
      setPlaybackError(
        /No handler registered.*prepare-playback/i.test(detail)
          ? "播放服务尚未加载，请完全退出应用（包括托盘）后重新启动"
          : detail,
      );
    } finally {
      setPreparingPlayback(false);
      setTaskProgress(undefined);
    }
  };
  const visibleSegments = useMemo(
    () =>
      selected?.segments.filter((item) =>
        item.text.toLowerCase().includes(query.trim().toLowerCase()),
      ) ?? [],
    [selected, query],
  );
  const refresh = async (prefer?: string) => {
    const result = await window.electronAPI.aiVideoReader.listProjects();
    setProjects(result);
    setSelectedId(prefer ?? selectedId ?? result[0]?.id);
    setLoading(false);
  };
  const selectFfmpeg = async () => {
    try {
      const directory = await window.electronAPI.aiVideoReader.selectFfmpeg();
      if (!directory) return;
      const status = await window.electronAPI.aiVideoReader.runtimeStatus();
      setRuntime(status);
      if (status.ffmpeg.available) message.success("FFmpeg 已就绪");
      else message.error("FFmpeg 无法启动，请确认所选文件与当前系统架构匹配");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "定位 FFmpeg 失败",
      );
    }
  };
  useEffect(() => {
    void window.electronAPI.aiVideoReader.listProjects().then((result) => {
      setProjects(result);
      setSelectedId(result[0]?.id);
      setLoading(false);
    });
    void window.electronAPI.aiVideoReader.runtimeStatus().then(setRuntime);
  }, []);
  useEffect(
    () =>
      window.electronAPI.aiVideoReader.onTaskProgress((progress) => {
        setTaskProgress(progress);
      }),
    [],
  );
  const importVideo = async () => {
    const project = await window.electronAPI.aiVideoReader.importVideo();
    if (project) {
      await refresh(project.id);
      message.success("视频已导入");
    }
  };
  const importTranscript = async () => {
    if (!selected) return;
    const project = await window.electronAPI.aiVideoReader.importTranscript(
      selected.id,
    );
    if (project) {
      await refresh(project.id);
      message.success(`已导入 ${project.segments.length} 个片段`);
    }
  };
  const transcribe = async () => {
    if (!selected) return;
    const config = await asrForm.validateFields();
    setTranscribing(true);
    try {
      const project = await window.electronAPI.aiVideoReader.transcribe(
        selected.id,
        config,
      );
      await refresh(project.id);
      setAsrOpen(false);
      message.success(`转写完成，共 ${project.segments.length} 个片段`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "转写失败");
    } finally {
      setTranscribing(false);
      setTaskProgress(undefined);
    }
  };
  const analyze = async () => {
    if (!selected) return;
    const config = await analysisForm.validateFields();
    setAnalyzing(true);
    try {
      const project = await window.electronAPI.aiVideoReader.analyze(
        selected.id,
        config,
      );
      await refresh(project.id);
      setAnalysisOpen(false);
      message.success("摘要和章节生成完成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "分析失败");
    } finally {
      setAnalyzing(false);
      setTaskProgress(undefined);
    }
  };
  const ask = async () => {
    if (!selected) return;
    const values = await askForm.validateFields();
    setAsking(true);
    try {
      setAnswer(
        await window.electronAPI.aiVideoReader.ask(
          selected.id,
          values.question,
          values,
        ),
      );
      setAskOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "提问失败");
    } finally {
      setAsking(false);
    }
  };
  const renameProject = async () => {
    if (!selected) return;
    try {
      const project = await window.electronAPI.aiVideoReader.renameProject(
        selected.id,
        renameValue,
      );
      await refresh(project.id);
      setRenameOpen(false);
      message.success("项目已重命名");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重命名失败");
    }
  };
  const projectAction = async (key: string) => {
    if (!selected) return;
    if (key === "rename") {
      setRenameValue(selected.name);
      setRenameOpen(true);
      return;
    }
    if (key === "relink") {
      const project = await window.electronAPI.aiVideoReader.relinkVideo(
        selected.id,
      );
      if (project) {
        await refresh(project.id);
        message.success("源视频已重新定位");
      }
      return;
    }
    if (key === "cache") {
      const info = await window.electronAPI.aiVideoReader.cacheInfo(
        selected.id,
      );
      message.info(
        `缓存：${(info.bytes / 1024 / 1024).toFixed(1)} MB，共 ${info.files} 个文件`,
      );
      return;
    }
    if (key === "clear-cache") {
      await window.electronAPI.aiVideoReader.clearCache(selected.id);
      message.success("项目缓存已清理");
      return;
    }
    if (key === "delete") {
      confirmDeleteProject(selected);
    }
  };
  const confirmDeleteProject = (project: VideoReaderProject) => {
    Modal.confirm({
      title: `删除“${project.name}”？`,
      content:
        "将删除项目记录、Transcript、索引和缓存，但不会删除原始视频文件。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electronAPI.aiVideoReader.deleteProject(project.id);
        playbackAttempts.current.delete(project.id);
        const result = await window.electronAPI.aiVideoReader.listProjects();
        setProjects(result);
        if (selectedId === project.id) setSelectedId(result[0]?.id);
        message.success("项目已删除");
      },
    });
  };
  const openEditor = (segmentId: string) => {
    const segment = selected?.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    setEditingId(segment.id);
    setEditText(segment.text);
    setEditStart(segment.startMs);
    setEditEnd(segment.endMs);
  };
  const persistSegments = async (
    segments: NonNullable<typeof selected>["segments"],
  ) => {
    if (!selected) return;
    const project = await window.electronAPI.aiVideoReader.saveTranscript(
      selected.id,
      segments,
    );
    await refresh(project.id);
    setEditingId(undefined);
    message.success("Transcript 已保存并重建索引");
  };
  const saveEditedSegment = async () => {
    if (!selected || !editingId) return;
    await persistSegments(
      normalizeSegments(
        selected.segments.map((item) =>
          item.id === editingId
            ? { ...item, startMs: editStart, endMs: editEnd, text: editText }
            : item,
        ),
      ),
    );
  };
  const splitEditedSegment = async () => {
    if (!selected || !editingId) return;
    const middleTime = Math.round((editStart + editEnd) / 2);
    const middleText = Math.max(1, Math.round(editText.length / 2));
    await persistSegments(
      splitSegment(
        selected.segments.map((item) =>
          item.id === editingId
            ? { ...item, startMs: editStart, endMs: editEnd, text: editText }
            : item,
        ),
        editingId,
        middleTime,
        editText.slice(0, middleText),
        editText.slice(middleText),
      ),
    );
  };
  const seek = (ms: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play();
    }
  };
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="flex items-center justify-between border-b border-border p-3">
          <b>AI 视频阅读器</b>
          <Button size="small" type="primary" onClick={importVideo}>
            导入
          </Button>
        </div>
        <div
          className={`mx-2 mt-2 rounded-lg border px-3 py-2 text-xs ${runtime?.ffmpeg.available ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}
          title={runtime?.ffmpeg.version}
        >
          <div className="font-medium">
            {runtime?.ffmpeg.available ? "FFmpeg 已就绪" : "FFmpeg 尚未配置"}
          </div>
          <div className="mt-0.5 text-[11px] opacity-75">
            {runtime?.ffmpeg.available
              ? runtime.ffprobe.available
                ? "转写和媒体信息解析可用"
                : "转写可用，ffprobe 未找到"
              : "配置后即可使用 AI 转写"}
          </div>
          {!runtime?.ffmpeg.available ? (
            <button
              type="button"
              className="mt-2 w-full rounded-md border border-amber-500/30 bg-background/70 px-2 py-1 text-center font-medium transition-colors hover:bg-amber-500/10"
              onClick={() => void selectFfmpeg()}
            >
              选择 ffmpeg.exe
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {projects.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="导入视频开始阅读"
            />
          ) : (
            projects.map((project) => (
              <div key={project.id} className="group relative mb-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(project.id)}
                  className={`w-full rounded-lg px-3 py-2 pr-10 text-left transition-colors ${project.id === selectedId ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <div className="truncate text-sm font-medium">
                    {project.name}
                  </div>
                  <div className="mt-1 text-xs opacity-60">
                    {project.segments.length
                      ? `${project.segments.length} 个片段`
                      : "等待转写"}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${project.name}`}
                  title="删除项目"
                  onClick={(event) => {
                    event.stopPropagation();
                    confirmDeleteProject(project);
                  }}
                  className={`absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md transition-opacity hover:bg-destructive/15 hover:text-destructive ${project.id === selectedId ? "text-primary-foreground/70 opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
      {!selected ? (
        <main className="flex flex-1 items-center justify-center">
          <Empty description="请选择或导入视频" />
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {selected.name}
            </span>
            {transcribing ? (
              <Button
                size="small"
                danger
                onClick={() =>
                  void window.electronAPI.aiVideoReader.cancelTranscription(
                    selected.id,
                  )
                }
              >
                取消转写
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                disabled={!runtime?.ffmpeg.available}
                onClick={() => setAsrOpen(true)}
              >
                AI 转写
              </Button>
            )}
            <Button
              size="small"
              loading={analyzing}
              disabled={!selected.segments.length}
              onClick={() => setAnalysisOpen(true)}
            >
              生成摘要/章节
            </Button>
            <Button
              size="small"
              disabled={!selected.segments.length}
              onClick={() => setAskOpen(true)}
            >
              询问视频
            </Button>
            <Button size="small" onClick={importTranscript}>
              导入字幕/JSON
            </Button>
            <Select<"srt" | "vtt" | "txt" | "md" | "json">
              size="small"
              value="md"
              style={{ width: 120 }}
              options={(["srt", "vtt", "txt", "md", "json"] as const).map(
                (value) => ({ value, label: `导出 ${value.toUpperCase()}` }),
              )}
              onChange={(format) =>
                void window.electronAPI.aiVideoReader.exportTranscript(
                  selected.id,
                  format,
                )
              }
            />
            <Dropdown
              menu={{
                items: [
                  { key: "rename", label: "重命名" },
                  { key: "relink", label: "重新定位视频" },
                  { key: "cache", label: "查看缓存" },
                  { key: "clear-cache", label: "清理缓存" },
                  { type: "divider" },
                  { key: "delete", label: "删除项目", danger: true },
                ],
                onClick: ({ key }) => void projectAction(key),
              }}
            >
              <Button size="small">更多</Button>
            </Dropdown>
          </header>
          {(transcribing || analyzing || preparingPlayback) &&
          taskProgress?.projectId === selected.id ? (
            <div className="flex items-center gap-3 border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
              <span className="w-44 truncate">{taskProgress.detail}</span>
              <Progress
                percent={taskProgress.progress}
                size="small"
                showInfo={false}
                className="m-0 flex-1"
              />
            </div>
          ) : null}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1.1fr)_minmax(320px,0.9fr)]">
            <section className="flex min-h-0 flex-col border-r border-border">
              <div className="bg-black p-3">
                <video
                  key={selected.id}
                  ref={videoRef}
                  src={playbackUrl || selected.mediaUrl}
                  controls
                  className="aspect-video w-full bg-black"
                  preload="metadata"
                  onLoadedMetadata={() => setPlaybackError(undefined)}
                  onError={(event) => {
                    const code = event.currentTarget.error?.code;
                    if (
                      runtime?.ffmpeg.available &&
                      !playbackAttempts.current.has(selected.id)
                    ) {
                      playbackAttempts.current.add(selected.id);
                      void prepareCompatiblePlayback();
                      return;
                    }
                    setPlaybackError(
                      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                        ? "兼容版本仍无法播放，请检查源视频是否损坏"
                        : "无法读取本地视频，请确认源文件仍然存在",
                    );
                  }}
                  onTimeUpdate={(event) =>
                    setCurrentMs(event.currentTarget.currentTime * 1000)
                  }
                />
                {playbackError ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-destructive/15 px-3 py-2 text-xs text-red-300">
                    <span>{playbackError}</span>
                    {!preparingPlayback && runtime?.ffmpeg.available ? (
                      <button
                        type="button"
                        className="shrink-0 underline"
                        onClick={() => {
                          playbackAttempts.current.delete(selected.id);
                          void prepareCompatiblePlayback();
                        }}
                      >
                        重试转码
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-2 text-xs text-white/60">
                  {selected.width && selected.height
                    ? `${selected.width}×${selected.height}`
                    : "分辨率未知"}{" "}
                  · {selected.videoCodec ?? "视频编码未知"} ·{" "}
                  {selected.audioCodec ?? "音频编码未知"} ·{" "}
                  {selected.durationMs ? time(selected.durationMs) : "时长未知"}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                {selected.chapters.length ? (
                  <>
                    <h2 className="mb-2 text-lg font-semibold">章节</h2>
                    <div className="mb-5 flex flex-wrap gap-2">
                      {selected.chapters.map((chapter) => (
                        <Button
                          key={chapter.id}
                          size="small"
                          onClick={() => seek(chapter.startMs)}
                        >
                          {time(chapter.startMs)} {chapter.title}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : null}
                <h2 className="mb-3 text-lg font-semibold">内容摘要</h2>
                <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/80">
                  {selected.summary ||
                    "导入转写后，可继续生成章节、摘要和知识点。"}
                </p>
              </div>
            </section>
            <section className="flex min-h-0 flex-col">
              {answer ? (
                <div className="border-b border-border bg-primary/5 p-4">
                  <div className="mb-2 text-sm leading-6">{answer.answer}</div>
                  <div className="flex flex-wrap gap-1">
                    {answer.citations.map((citation) => (
                      <Button
                        key={citation.id}
                        size="small"
                        type="link"
                        onClick={() => seek(citation.startMs)}
                      >
                        [{time(citation.startMs)}]
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="border-b border-border bg-background p-3">
                <Input.Search
                  allowClear
                  placeholder="搜索 Transcript；双击片段可校对"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {!selected.segments.length ? (
                  <Empty description="请导入 SRT、VTT 或带时间戳 JSON" />
                ) : (
                  visibleSegments.map((segment) => {
                    const active =
                      currentMs >= segment.startMs && currentMs < segment.endMs;
                    return (
                      <button
                        key={segment.id}
                        onClick={() => seek(segment.startMs)}
                        onDoubleClick={() => openEditor(segment.id)}
                        className={`mb-1 block w-full rounded-lg p-3 text-left transition-colors ${active ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-muted"}`}
                      >
                        <span className="mr-3 font-mono text-xs text-primary">
                          {time(segment.startMs)}
                        </span>
                        <span className="text-sm leading-6 text-foreground">
                          {segment.text}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </main>
      )}
      <Modal
        title="视频 AI 转写"
        open={asrOpen}
        confirmLoading={transcribing}
        onOk={() => void transcribe()}
        onCancel={() => !transcribing && setAsrOpen(false)}
        okText="提取音频并转写"
        destroyOnHidden={false}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {asrProvider === "siliconflow"
            ? "硅基流动返回全文；应用会按 60 秒短分片识别、清理情绪标签并生成近似时间轴。中英混合会议建议优先尝试 TeleSpeechASR。"
            : "OpenAI-compatible 模式要求服务支持 verbose_json 分段时间戳。"}
        </p>
        <Form
          form={asrForm}
          layout="vertical"
          initialValues={{
            provider: "openai-compatible",
            baseUrl: "https://api.openai.com/v1",
            model: "whisper-1",
            language: "zh",
          }}
        >
          <Form.Item
            name="provider"
            label="服务商"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                {
                  value: "openai-compatible",
                  label: "OpenAI-compatible（精确时间戳）",
                },
                {
                  value: "siliconflow",
                  label: "硅基流动（国内，粗粒度时间轴）",
                },
              ]}
              onChange={(provider: VideoReaderAsrProvider) => {
                asrForm.setFieldsValue(
                  provider === "siliconflow"
                    ? {
                        baseUrl: "https://api.siliconflow.cn/v1",
                        model: "TeleAI/TeleSpeechASR",
                        language: undefined,
                      }
                    : {
                        baseUrl: "https://api.openai.com/v1",
                        model: "whisper-1",
                        language: "zh",
                      },
                );
              }}
            />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
            <Input.Password autoComplete="off" />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true }]}>
            {asrProvider === "siliconflow" ? (
              <Select
                options={[
                  {
                    value: "TeleAI/TeleSpeechASR",
                    label: "TeleSpeechASR（中英会议推荐）",
                  },
                  {
                    value: "FunAudioLLM/SenseVoiceSmall",
                    label: "SenseVoiceSmall（快速）",
                  },
                ]}
              />
            ) : (
              <Input placeholder="whisper-1" />
            )}
          </Form.Item>
          <Form.Item
            name="language"
            label="语言（可选）"
            hidden={asrProvider === "siliconflow"}
          >
            <Input placeholder="zh" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="生成摘要与章节"
        open={analysisOpen}
        confirmLoading={analyzing}
        onOk={() => void analyze()}
        onCancel={() => !analyzing && setAnalysisOpen(false)}
        okText="开始分析"
        destroyOnHidden={false}
      >
        <Form
          form={analysisForm}
          layout="vertical"
          initialValues={{
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4o-mini",
          }}
        >
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
            <Input.Password autoComplete="off" />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="询问当前视频"
        open={askOpen}
        confirmLoading={asking}
        onOk={() => void ask()}
        onCancel={() => !asking && setAskOpen(false)}
        okText="提问"
        destroyOnHidden={false}
      >
        <Form
          form={askForm}
          layout="vertical"
          initialValues={{
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4o-mini",
          }}
        >
          <Form.Item name="question" label="问题" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
            <Input.Password autoComplete="off" />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="重命名项目"
        open={renameOpen}
        onOk={() => void renameProject()}
        onCancel={() => setRenameOpen(false)}
        okText="保存"
      >
        <Input
          value={renameValue}
          maxLength={120}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void renameProject()}
        />
      </Modal>
      <Modal
        title="校对 Transcript 片段"
        open={Boolean(editingId)}
        onOk={() => void saveEditedSegment()}
        onCancel={() => setEditingId(undefined)}
        okText="保存"
      >
        <div className="mb-3 grid grid-cols-2 gap-3">
          <Input
            type="number"
            addonBefore="开始 ms"
            value={editStart}
            onChange={(event) => setEditStart(Number(event.target.value))}
          />
          <Input
            type="number"
            addonBefore="结束 ms"
            value={editEnd}
            onChange={(event) => setEditEnd(Number(event.target.value))}
          />
        </div>
        <Input.TextArea
          value={editText}
          autoSize={{ minRows: 4, maxRows: 10 }}
          onChange={(event) => setEditText(event.target.value)}
        />
        <div className="mt-3 flex gap-2">
          <Button onClick={() => void splitEditedSegment()}>从中间拆分</Button>
          <Button
            disabled={!selected || selected.segments.at(-1)?.id === editingId}
            onClick={() =>
              selected &&
              editingId &&
              void persistSegments(mergeWithNext(selected.segments, editingId))
            }
          >
            与下一段合并
          </Button>
          <Button
            danger
            onClick={() =>
              selected &&
              editingId &&
              void persistSegments(
                normalizeSegments(
                  selected.segments.filter((item) => item.id !== editingId),
                ),
              )
            }
          >
            删除片段
          </Button>
        </div>
      </Modal>
    </div>
  );
}
