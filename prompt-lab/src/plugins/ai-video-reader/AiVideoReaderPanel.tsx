import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Form, Input, Modal, Progress, Select, Spin, message } from 'antd';
import type { VideoAnswer, VideoReaderProject, VideoReaderTaskProgress } from '@/core/ai-video-reader/types';

const time = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function AiVideoReaderPanel() {
  const [projects, setProjects] = useState<VideoReaderProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [currentMs, setCurrentMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [asrOpen, setAsrOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<VideoAnswer>();
  const [runtime, setRuntime] = useState<{ ffmpeg: { available: boolean; version?: string }; ffprobe: { available: boolean } }>();
  const [taskProgress, setTaskProgress] = useState<VideoReaderTaskProgress>();
  const [asrForm] = Form.useForm<{ baseUrl: string; apiKey: string; model: string; language?: string }>();
  const [analysisForm] = Form.useForm<{ baseUrl: string; apiKey: string; model: string }>();
  const [askForm] = Form.useForm<{ question: string; baseUrl: string; apiKey: string; model: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = projects.find((item) => item.id === selectedId);
  const visibleSegments = useMemo(() => selected?.segments.filter((item) => item.text.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [selected, query]);
  const refresh = async (prefer?: string) => { const result = await window.electronAPI.aiVideoReader.listProjects(); setProjects(result); setSelectedId(prefer ?? selectedId ?? result[0]?.id); setLoading(false); };
  useEffect(() => {
    void window.electronAPI.aiVideoReader.listProjects().then((result) => {
      setProjects(result); setSelectedId(result[0]?.id); setLoading(false);
    });
    void window.electronAPI.aiVideoReader.runtimeStatus().then(setRuntime);
  }, []);
  useEffect(() => window.electronAPI.aiVideoReader.onTaskProgress((progress) => {
    setTaskProgress(progress);
  }), []);
  const importVideo = async () => { const project = await window.electronAPI.aiVideoReader.importVideo(); if (project) { await refresh(project.id); message.success('视频已导入'); } };
  const importTranscript = async () => { if (!selected) return; const project = await window.electronAPI.aiVideoReader.importTranscript(selected.id); if (project) { await refresh(project.id); message.success(`已导入 ${project.segments.length} 个片段`); } };
  const transcribe = async () => {
    if (!selected) return;
    const config = await asrForm.validateFields(); setTranscribing(true);
    try { const project = await window.electronAPI.aiVideoReader.transcribe(selected.id, config); await refresh(project.id); setAsrOpen(false); message.success(`转写完成，共 ${project.segments.length} 个片段`); }
    catch (error) { message.error(error instanceof Error ? error.message : '转写失败'); }
    finally { setTranscribing(false); setTaskProgress(undefined); }
  };
  const analyze = async () => {
    if (!selected) return;
    const config = await analysisForm.validateFields(); setAnalyzing(true);
    try { const project = await window.electronAPI.aiVideoReader.analyze(selected.id, config); await refresh(project.id); setAnalysisOpen(false); message.success('摘要和章节生成完成'); }
    catch (error) { message.error(error instanceof Error ? error.message : '分析失败'); }
    finally { setAnalyzing(false); setTaskProgress(undefined); }
  };
  const ask = async () => {
    if (!selected) return;
    const values = await askForm.validateFields(); setAsking(true);
    try { setAnswer(await window.electronAPI.aiVideoReader.ask(selected.id, values.question, values)); setAskOpen(false); }
    catch (error) { message.error(error instanceof Error ? error.message : '提问失败'); }
    finally { setAsking(false); }
  };
  const renameProject = async () => {
    if (!selected) return;
    try { const project = await window.electronAPI.aiVideoReader.renameProject(selected.id, renameValue); await refresh(project.id); setRenameOpen(false); message.success('项目已重命名'); }
    catch (error) { message.error(error instanceof Error ? error.message : '重命名失败'); }
  };
  const projectAction = async (key: string) => {
    if (!selected) return;
    if (key === 'rename') { setRenameValue(selected.name); setRenameOpen(true); return; }
    if (key === 'relink') { const project = await window.electronAPI.aiVideoReader.relinkVideo(selected.id); if (project) { await refresh(project.id); message.success('源视频已重新定位'); } return; }
    if (key === 'cache') { const info = await window.electronAPI.aiVideoReader.cacheInfo(selected.id); message.info(`缓存：${(info.bytes / 1024 / 1024).toFixed(1)} MB，共 ${info.files} 个文件`); return; }
    if (key === 'clear-cache') { await window.electronAPI.aiVideoReader.clearCache(selected.id); message.success('项目缓存已清理'); return; }
    if (key === 'delete') {
      Modal.confirm({ title: '删除项目？', content: '会删除 Transcript、索引和缓存，但不会删除原视频。', okButtonProps: { danger: true }, onOk: async () => { await window.electronAPI.aiVideoReader.deleteProject(selected.id); const result = await window.electronAPI.aiVideoReader.listProjects(); setProjects(result); setSelectedId(result[0]?.id); } });
    }
  };
  const seek = (ms: number) => { if (videoRef.current) { videoRef.current.currentTime = ms / 1000; void videoRef.current.play(); } };
  if (loading) return <div className="flex h-full items-center justify-center"><Spin /></div>;
  return <div className="flex h-full min-h-0 bg-slate-950 text-slate-100">
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/70">
      <div className="flex items-center justify-between border-b border-slate-800 p-3"><b>AI 视频阅读器</b><Button size="small" type="primary" onClick={importVideo}>导入</Button></div>
      <div className={`mx-2 mt-2 rounded-md px-2 py-1 text-xs ${runtime?.ffmpeg.available ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`} title={runtime?.ffmpeg.version}>{runtime?.ffmpeg.available ? `FFmpeg 就绪${runtime.ffprobe.available ? ' · ffprobe 就绪' : ''}` : '未检测到 FFmpeg，AI 转写不可用'}</div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{projects.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="导入视频开始阅读" /> : projects.map((project) => <button key={project.id} onClick={() => setSelectedId(project.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${project.id === selectedId ? 'bg-blue-600' : 'hover:bg-slate-800'}`}><div className="truncate text-sm font-medium">{project.name}</div><div className="mt-1 text-xs opacity-60">{project.segments.length ? `${project.segments.length} 个片段` : '等待转写'}</div></button>)}</div>
    </aside>
    {!selected ? <main className="flex flex-1 items-center justify-center"><Empty description="请选择或导入视频" /></main> : <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-2"><span className="min-w-0 flex-1 truncate font-medium">{selected.name}</span>{transcribing ? <Button size="small" danger onClick={() => void window.electronAPI.aiVideoReader.cancelTranscription(selected.id)}>取消转写</Button> : <Button size="small" type="primary" disabled={!runtime?.ffmpeg.available} onClick={() => setAsrOpen(true)}>AI 转写</Button>}<Button size="small" loading={analyzing} disabled={!selected.segments.length} onClick={() => setAnalysisOpen(true)}>生成摘要/章节</Button><Button size="small" disabled={!selected.segments.length} onClick={() => setAskOpen(true)}>询问视频</Button><Button size="small" onClick={importTranscript}>导入字幕/JSON</Button><Select<'srt' | 'vtt' | 'txt' | 'md' | 'json'> size="small" value="md" style={{ width: 120 }} options={(['srt', 'vtt', 'txt', 'md', 'json'] as const).map((value) => ({ value, label: `导出 ${value.toUpperCase()}` }))} onChange={(format) => void window.electronAPI.aiVideoReader.exportTranscript(selected.id, format)} /><Dropdown menu={{ items: [{ key: 'rename', label: '重命名' }, { key: 'relink', label: '重新定位视频' }, { key: 'cache', label: '查看缓存' }, { key: 'clear-cache', label: '清理缓存' }, { type: 'divider' }, { key: 'delete', label: '删除项目', danger: true }], onClick: ({ key }) => void projectAction(key) }}><Button size="small">更多</Button></Dropdown></header>
      {(transcribing || analyzing) && taskProgress?.projectId === selected.id ? <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-2 text-xs text-slate-400"><span className="w-44 truncate">{taskProgress.detail}</span><Progress percent={taskProgress.progress} size="small" showInfo={false} className="m-0 flex-1" /></div> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1.1fr)_minmax(320px,0.9fr)]">
        <section className="flex min-h-0 flex-col border-r border-slate-800"><div className="bg-black p-3"><video key={selected.id} ref={videoRef} src={selected.mediaUrl} controls className="aspect-video w-full bg-black" onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)} /><div className="mt-2 text-xs text-slate-500">{selected.width && selected.height ? `${selected.width}×${selected.height}` : '分辨率未知'} · {selected.videoCodec ?? '视频编码未知'} · {selected.audioCodec ?? '音频编码未知'} · {selected.durationMs ? time(selected.durationMs) : '时长未知'}</div></div><div className="min-h-0 flex-1 overflow-auto p-5">{selected.chapters.length ? <><h2 className="mb-2 text-lg font-semibold">章节</h2><div className="mb-5 flex flex-wrap gap-2">{selected.chapters.map((chapter) => <Button key={chapter.id} size="small" onClick={() => seek(chapter.startMs)}>{time(chapter.startMs)} {chapter.title}</Button>)}</div></> : null}<h2 className="mb-3 text-lg font-semibold">内容摘要</h2><p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{selected.summary || '导入转写后，可继续生成章节、摘要和知识点。'}</p></div></section>
        <section className="flex min-h-0 flex-col">{answer ? <div className="border-b border-slate-800 bg-blue-500/5 p-4"><div className="mb-2 text-sm leading-6">{answer.answer}</div><div className="flex flex-wrap gap-1">{answer.citations.map((citation) => <Button key={citation.id} size="small" type="link" onClick={() => seek(citation.startMs)}>[{time(citation.startMs)}]</Button>)}</div></div> : null}<div className="border-b border-slate-800 p-3"><Input.Search allowClear placeholder="搜索 Transcript" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="min-h-0 flex-1 overflow-auto p-3">{!selected.segments.length ? <Empty description="请导入 SRT、VTT 或带时间戳 JSON" /> : visibleSegments.map((segment) => { const active = currentMs >= segment.startMs && currentMs < segment.endMs; return <button key={segment.id} onClick={() => seek(segment.startMs)} className={`mb-1 block w-full rounded-lg p-3 text-left ${active ? 'bg-blue-600/30 ring-1 ring-blue-500' : 'hover:bg-slate-800'}`}><span className="mr-3 font-mono text-xs text-blue-400">{time(segment.startMs)}</span><span className="text-sm leading-6 text-slate-200">{segment.text}</span></button>; })}</div></section>
      </div>
    </main>}
    <Modal title="视频 AI 转写" open={asrOpen} confirmLoading={transcribing} onOk={() => void transcribe()} onCancel={() => !transcribing && setAsrOpen(false)} okText="提取音频并转写" destroyOnClose={false}>
      <p className="mb-4 text-sm text-slate-500">需要本机可用的 FFmpeg，以及支持 verbose_json 时间戳的 OpenAI-compatible ASR。</p>
      <Form form={asrForm} layout="vertical" initialValues={{ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', language: 'zh' }}>
        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}><Input placeholder="https://api.openai.com/v1" /></Form.Item>
        <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}><Input.Password autoComplete="off" /></Form.Item>
        <Form.Item name="model" label="模型" rules={[{ required: true }]}><Input placeholder="whisper-1" /></Form.Item>
        <Form.Item name="language" label="语言（可选）"><Input placeholder="zh" /></Form.Item>
      </Form>
    </Modal>
    <Modal title="生成摘要与章节" open={analysisOpen} confirmLoading={analyzing} onOk={() => void analyze()} onCancel={() => !analyzing && setAnalysisOpen(false)} okText="开始分析" destroyOnClose={false}>
      <Form form={analysisForm} layout="vertical" initialValues={{ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }}>
        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}><Input.Password autoComplete="off" /></Form.Item>
        <Form.Item name="model" label="模型" rules={[{ required: true }]}><Input /></Form.Item>
      </Form>
    </Modal>
    <Modal title="询问当前视频" open={askOpen} confirmLoading={asking} onOk={() => void ask()} onCancel={() => !asking && setAskOpen(false)} okText="提问" destroyOnClose={false}>
      <Form form={askForm} layout="vertical" initialValues={{ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }}>
        <Form.Item name="question" label="问题" rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}><Input.Password autoComplete="off" /></Form.Item>
        <Form.Item name="model" label="模型" rules={[{ required: true }]}><Input /></Form.Item>
      </Form>
    </Modal>
    <Modal title="重命名项目" open={renameOpen} onOk={() => void renameProject()} onCancel={() => setRenameOpen(false)} okText="保存"><Input value={renameValue} maxLength={120} onChange={(event) => setRenameValue(event.target.value)} onPressEnter={() => void renameProject()} /></Modal>
  </div>;
}
