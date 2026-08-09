import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Plus, Save, Sparkles, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { detectRhyme, projectToText, scoreProject } from './analysis';
import { LYRIC_SYSTEM_PROMPT } from './prompt';
import type { LyricProject, LyricSection, SectionKind } from './types';

const STORAGE_KEY = 'nwd:lyric-studio:project';
const KINDS: SectionKind[] = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];
const starterSections: LyricSection[] = [
  { id: 'verse-1', kind: 'Verse', title: 'Verse 1', lyrics: '晚风绕过旧街的霓虹\n把你的名字吹进夜空', emotion: '克制', rhyme: 'ong', syllables: '8-10' },
  { id: 'chorus-1', kind: 'Chorus', title: 'Chorus', lyrics: '如果那个夏天没有走远\n我们会不会还站在海边', emotion: '释放', rhyme: 'an', syllables: '9-11' },
  { id: 'bridge-1', kind: 'Bridge', title: 'Bridge', lyrics: '', emotion: '转折', rhyme: '自由', syllables: '自由' },
];
const initialProject: LyricProject = { id: 'summer-love', title: '未完成的夏天', theme: '失恋后的夏天', style: '华语流行', emotion: '遗憾、温柔', language: '中文', bpm: 72, sections: starterSections, updatedAt: Date.now() };

function loadProject(): LyricProject {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '') as LyricProject; } catch { return initialProject; }
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的歌词结构');
  return JSON.parse(fenced.slice(start, end + 1));
}

async function generateLyrics(apiKey: string, baseUrl: string, model: string, project: LyricProject): Promise<LyricSection[]> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [
    { role: 'system', content: LYRIC_SYSTEM_PROMPT },
    { role: 'user', content: `创作一首完整歌词。主题：${project.theme}；风格：${project.style}；情绪：${project.emotion}；语言：${project.language}；BPM：${project.bpm}；结构：${project.sections.map((s) => s.kind).join(' + ')}。` },
  ];
  let raw = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.86, maxTokens: 3_000, stream: true })) raw += chunk.delta ?? '';
  const parsed = extractJson(raw) as { sections?: Array<Partial<LyricSection>> };
  if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error('生成结果缺少歌词段落');
  return parsed.sections.map((section, index) => ({
    id: crypto.randomUUID(), kind: KINDS.includes(section.kind as SectionKind) ? section.kind as SectionKind : 'Verse',
    title: String(section.title || `${section.kind || 'Verse'} ${index + 1}`), lyrics: String(section.lyrics || ''),
    emotion: String(section.emotion || project.emotion), rhyme: String(section.rhyme || '自由'), syllables: String(section.syllables || '8-10'),
  }));
}

const Field = ({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="grid gap-1 text-[11px] text-muted-foreground"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:border-primary" /></label>;

export const LyricStudioPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [project, setProject] = useState(loadProject);
  const [activeId, setActiveId] = useState(project.sections[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('所有修改会自动保存在本机');
  const active = project.sections.find((section) => section.id === activeId) ?? project.sections[0];
  const score = useMemo(() => scoreProject(project), [project]);

  useEffect(() => { const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() })), 250); return () => window.clearTimeout(timer); }, [project]);
  const patchProject = (patch: Partial<LyricProject>) => setProject((current) => ({ ...current, ...patch }));
  const patchSection = (id: string, patch: Partial<LyricSection>) => setProject((current) => ({ ...current, sections: current.sections.map((section) => section.id === id ? { ...section, ...patch } : section) }));
  const addSection = () => { const id = crypto.randomUUID(); setProject((current) => ({ ...current, sections: [...current.sections, { id, kind: 'Verse', title: `Verse ${current.sections.filter((s) => s.kind === 'Verse').length + 1}`, lyrics: '', emotion: current.emotion, rhyme: '自由', syllables: '8-10' }] })); setActiveId(id); };
  const removeSection = (id: string) => setProject((current) => { const sections = current.sections.filter((section) => section.id !== id); setActiveId(sections[0]?.id ?? ''); return { ...current, sections }; });

  const handleGenerate = useCallback(async () => {
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    setLoading(true); setMessage('AI 正在规划结构、韵脚与 Hook…');
    try { const sections = await generateLyrics(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project); patchProject({ sections }); setActiveId(sections[0].id); setMessage('已生成完整初稿，可以逐段精修'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '生成失败，请稍后重试'); }
    finally { setLoading(false); }
  }, [aiApi, project]);

  const exportText = () => { const url = URL.createObjectURL(new Blob([projectToText(project)], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `${project.title.replace(/[\\/:*?"<>|]/g, '-') || 'lyrics'}.txt`; a.click(); URL.revokeObjectURL(url); setMessage('歌词已导出为 TXT'); };

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500"><Sparkles className="h-4 w-4" /></div><div className="min-w-0"><input aria-label="项目名称" value={project.title} onChange={(e) => patchProject({ title: e.target.value })} className="w-full bg-transparent text-sm font-semibold outline-none" /><p className="text-[11px] text-muted-foreground">Lyric Studio · AI 音乐创作工作台</p></div><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={exportText}><Download className="mr-1 h-3.5 w-3.5" />导出</Button><Button size="sm" disabled={loading} onClick={() => void handleGenerate()}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}生成整首</Button></div></header>
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(360px,1fr)_280px]">
      <aside className="flex min-h-0 flex-col border-r bg-muted/20"><div className="flex items-center justify-between border-b px-3 py-2"><span className="text-xs font-medium">歌曲结构</span><button onClick={addSection} className="rounded p-1 hover:bg-accent" title="添加段落"><Plus className="h-3.5 w-3.5" /></button></div><div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">{project.sections.map((section, index) => <button key={section.id} onClick={() => setActiveId(section.id)} className={`group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${activeId === section.id ? 'bg-violet-500/15 text-violet-600' : 'hover:bg-accent'}`}><span className="w-5 text-center text-[10px] text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate">{section.title}</span><span className="text-[9px] uppercase text-muted-foreground">{section.rhyme}</span></button>)}</div><div className="border-t p-3 text-[10px] leading-4 text-muted-foreground">拖动排序将在下一版加入；当前可自由增删段落。</div></aside>
      <main className="min-h-0 overflow-auto p-5">{active ? <div className="mx-auto max-w-3xl"><div className="mb-4 flex items-center gap-2"><select value={active.kind} onChange={(e) => patchSection(active.id, { kind: e.target.value as SectionKind })} className="h-8 rounded-md border bg-background px-2 text-xs">{KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select><input value={active.title} onChange={(e) => patchSection(active.id, { title: e.target.value })} className="h-8 flex-1 border-b bg-transparent text-lg font-semibold outline-none focus:border-violet-500" /><button title="删除段落" onClick={() => removeSection(active.id)} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div><div className="mb-4 grid grid-cols-3 gap-3"><Field label="情绪" value={active.emotion} onChange={(value) => patchSection(active.id, { emotion: value })} /><Field label="目标韵脚" value={active.rhyme} onChange={(value) => patchSection(active.id, { rhyme: value })} /><Field label="每行字数" value={active.syllables} onChange={(value) => patchSection(active.id, { syllables: value })} /></div><textarea aria-label="歌词编辑器" value={active.lyrics} onChange={(e) => patchSection(active.id, { lyrics: e.target.value })} placeholder="在这里写下歌词，每行一句…" className="min-h-[420px] w-full resize-none rounded-xl border bg-card p-5 font-serif text-lg leading-9 outline-none focus:border-violet-500" /><div className="mt-3 flex flex-wrap gap-2">{active.lyrics.split(/\r?\n/).filter(Boolean).map((line, index) => <span key={`${line}-${index}`} className={`rounded-full border px-2 py-1 text-[10px] ${active.rhyme !== '自由' && detectRhyme(line) !== active.rhyme ? 'border-amber-500/40 bg-amber-500/10 text-amber-600' : 'text-muted-foreground'}`}>第 {index + 1} 行 · {detectRhyme(line)}</span>)}</div></div> : <div className="grid h-full place-items-center text-sm text-muted-foreground">添加一个段落开始创作</div>}</main>
      <aside className="min-h-0 overflow-auto border-l bg-muted/10 p-4"><h3 className="mb-3 text-xs font-semibold">创作设定</h3><div className="grid gap-3"><Field label="主题" value={project.theme} onChange={(value) => patchProject({ theme: value })} /><Field label="风格" value={project.style} onChange={(value) => patchProject({ style: value })} /><Field label="整体情绪" value={project.emotion} onChange={(value) => patchProject({ emotion: value })} /><div className="grid grid-cols-2 gap-2"><Field label="语言" value={project.language} onChange={(value) => patchProject({ language: value })} /><Field label="BPM" type="number" value={project.bpm} onChange={(value) => patchProject({ bpm: Math.max(40, Math.min(240, Number(value) || 72)) })} /></div></div><div className="my-5 border-t" /><div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-semibold">歌曲潜力</p><p className="text-[10px] text-muted-foreground">启发式分析，可随编辑实时更新</p></div><strong className="text-2xl text-violet-500">{score.overall}</strong></div><div className="space-y-3">{([['旋律适配', score.rhythm], ['情绪表达', score.emotion], ['Hook 强度', score.hook], ['押韵统一', score.rhyme]] as const).map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-[10px]"><span>{label}</span><span>{value}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${value}%` }} /></div></div>)}</div><div className="mt-5 rounded-lg border bg-card p-3"><p className="mb-2 text-[11px] font-medium">AI 编辑建议</p>{score.notes.map((note) => <p key={note} className="mb-2 text-[10px] leading-4 text-muted-foreground">• {note}</p>)}</div></aside>
    </div><footer className="flex h-8 shrink-0 items-center border-t px-4 text-[10px] text-muted-foreground"><Save className="mr-1.5 h-3 w-3" />{message}<span className="ml-auto">{project.sections.length} 个段落 · {project.sections.reduce((sum, section) => sum + section.lyrics.split(/\r?\n/).filter(Boolean).length, 0)} 行</span></footer>
  </div>;
};
