import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Form, Input, Modal, Select, Spin, message } from 'antd';
import type { VideoReaderProject } from '@/core/ai-video-reader/types';

const time = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function AiVideoReaderPanel() {
  const [projects, setProjects] = useState<VideoReaderProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [currentMs, setCurrentMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [asrOpen, setAsrOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [asrForm] = Form.useForm<{ baseUrl: string; apiKey: string; model: string; language?: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = projects.find((item) => item.id === selectedId);
  const visibleSegments = useMemo(() => selected?.segments.filter((item) => item.text.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [selected, query]);
  const refresh = async (prefer?: string) => { const result = await window.electronAPI.aiVideoReader.listProjects(); setProjects(result); setSelectedId(prefer ?? selectedId ?? result[0]?.id); setLoading(false); };
  useEffect(() => {
    void window.electronAPI.aiVideoReader.listProjects().then((result) => {
      setProjects(result); setSelectedId(result[0]?.id); setLoading(false);
    });
  }, []);
  const importVideo = async () => { const project = await window.electronAPI.aiVideoReader.importVideo(); if (project) { await refresh(project.id); message.success('视频已导入'); } };
  const importTranscript = async () => { if (!selected) return; const project = await window.electronAPI.aiVideoReader.importTranscript(selected.id); if (project) { await refresh(project.id); message.success(`已导入 ${project.segments.length} 个片段`); } };
  const transcribe = async () => {
    if (!selected) return;
    const config = await asrForm.validateFields(); setTranscribing(true);
    try { const project = await window.electronAPI.aiVideoReader.transcribe(selected.id, config); await refresh(project.id); setAsrOpen(false); message.success(`转写完成，共 ${project.segments.length} 个片段`); }
    catch (error) { message.error(error instanceof Error ? error.message : '转写失败'); }
    finally { setTranscribing(false); }
  };
  const seek = (ms: number) => { if (videoRef.current) { videoRef.current.currentTime = ms / 1000; void videoRef.current.play(); } };
  if (loading) return <div className="flex h-full items-center justify-center"><Spin /></div>;
  return <div className="flex h-full min-h-0 bg-slate-950 text-slate-100">
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/70">
      <div className="flex items-center justify-between border-b border-slate-800 p-3"><b>AI 视频阅读器</b><Button size="small" type="primary" onClick={importVideo}>导入</Button></div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{projects.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="导入视频开始阅读" /> : projects.map((project) => <button key={project.id} onClick={() => setSelectedId(project.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${project.id === selectedId ? 'bg-blue-600' : 'hover:bg-slate-800'}`}><div className="truncate text-sm font-medium">{project.name}</div><div className="mt-1 text-xs opacity-60">{project.segments.length ? `${project.segments.length} 个片段` : '等待转写'}</div></button>)}</div>
    </aside>
    {!selected ? <main className="flex flex-1 items-center justify-center"><Empty description="请选择或导入视频" /></main> : <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-2"><span className="min-w-0 flex-1 truncate font-medium">{selected.name}</span><Button size="small" type="primary" loading={transcribing} onClick={() => setAsrOpen(true)}>AI 转写</Button><Button size="small" onClick={importTranscript}>导入字幕/JSON</Button><Select<'srt' | 'vtt' | 'txt' | 'md' | 'json'> size="small" value="md" style={{ width: 120 }} options={(['srt', 'vtt', 'txt', 'md', 'json'] as const).map((value) => ({ value, label: `导出 ${value.toUpperCase()}` }))} onChange={(format) => void window.electronAPI.aiVideoReader.exportTranscript(selected.id, format)} /></header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1.1fr)_minmax(320px,0.9fr)]">
        <section className="flex min-h-0 flex-col border-r border-slate-800"><div className="bg-black p-3"><video key={selected.id} ref={videoRef} src={selected.mediaUrl} controls className="aspect-video w-full bg-black" onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)} /></div><div className="min-h-0 flex-1 overflow-auto p-5"><h2 className="mb-3 text-lg font-semibold">内容摘要</h2><p className="text-sm leading-7 text-slate-300">{selected.summary || '导入转写后，可继续生成章节、摘要和知识点。'}</p></div></section>
        <section className="flex min-h-0 flex-col"><div className="border-b border-slate-800 p-3"><Input.Search allowClear placeholder="搜索 Transcript" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="min-h-0 flex-1 overflow-auto p-3">{!selected.segments.length ? <Empty description="请导入 SRT、VTT 或带时间戳 JSON" /> : visibleSegments.map((segment) => { const active = currentMs >= segment.startMs && currentMs < segment.endMs; return <button key={segment.id} onClick={() => seek(segment.startMs)} className={`mb-1 block w-full rounded-lg p-3 text-left ${active ? 'bg-blue-600/30 ring-1 ring-blue-500' : 'hover:bg-slate-800'}`}><span className="mr-3 font-mono text-xs text-blue-400">{time(segment.startMs)}</span><span className="text-sm leading-6 text-slate-200">{segment.text}</span></button>; })}</div></section>
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
  </div>;
}
