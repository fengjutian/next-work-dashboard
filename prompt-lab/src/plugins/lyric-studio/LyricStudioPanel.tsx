import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Download, History, Loader2, Plus, Save, Search, Sparkles, Star, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { analyzeLines, detectRhyme, projectToText, rhymePattern, rhymeSuggestions, scoreProject } from './analysis';
import { ACTIVE_PROJECT_KEY, duplicateProject, matchesProject, persistProjects, readProjects } from './project-store';
import { LYRIC_SYSTEM_PROMPT } from './prompt';
import type { LineRewriteCandidate, LyricProject, LyricRevision, LyricSection, SectionKind } from './types';

const STORAGE_KEY = 'nwd:lyric-studio:project';
const HISTORY_KEY = 'nwd:lyric-studio:history';
const KINDS: SectionKind[] = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];
const starterSections: LyricSection[] = [
  { id: 'verse-1', kind: 'Verse', title: 'Verse 1', lyrics: '晚风绕过旧街的霓虹\n把你的名字吹进夜空', emotion: '克制', rhyme: 'ong', syllables: '8-10' },
  { id: 'chorus-1', kind: 'Chorus', title: 'Chorus', lyrics: '如果那个夏天没有走远\n我们会不会还站在海边', emotion: '释放', rhyme: 'an', syllables: '9-11' },
  { id: 'bridge-1', kind: 'Bridge', title: 'Bridge', lyrics: '', emotion: '转折', rhyme: '自由', syllables: '自由' },
];
const initialProject: LyricProject = { id: 'summer-love', title: '未完成的夏天', theme: '失恋后的夏天', style: '华语流行', emotion: '遗憾、温柔', language: '中文', bpm: 72, location: '雨后的旧车站', time: '夏末黄昏', story: '一次没能好好说完的告别', coreImages: ['旧车票', '街灯', '没寄出的信'], tags: ['青春', '夏天'], favorite: false, collection: '单曲', status: 'draft', coverColor: '#7c3aed', sections: starterSections, updatedAt: Date.now() };

function normalizeProject(saved: Partial<LyricProject>): LyricProject {
  return { ...initialProject, ...saved, coreImages: Array.isArray(saved.coreImages) ? saved.coreImages : initialProject.coreImages, tags: Array.isArray(saved.tags) ? saved.tags : [], sections: Array.isArray(saved.sections) ? saved.sections : initialProject.sections };
}

function loadProject(): LyricProject {
  try { return normalizeProject(JSON.parse(localStorage.getItem(STORAGE_KEY) || '') as Partial<LyricProject>); } catch { return initialProject; }
}

function loadHistory(): LyricRevision[] {
  try { const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as LyricRevision[]; return Array.isArray(value) ? value.filter((item) => item?.project).slice(0, 20).map((item) => ({ ...item, project: normalizeProject(item.project) })) : []; } catch { return []; }
}

function snapshot(project: LyricProject, label: string): LyricRevision {
  return { id: crypto.randomUUID(), label, createdAt: Date.now(), project: structuredClone(project) };
}

function replaceNonEmptyLine(lyrics: string, lineIndex: number, replacement: string): string {
  let seen = -1;
  return lyrics.split(/\r?\n/).map((line) => { if (!line.trim()) return line; seen += 1; return seen === lineIndex ? replacement : line; }).join('\n');
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的歌词结构');
  return JSON.parse(fenced.slice(start, end + 1));
}

async function generateLyrics(apiKey: string, baseUrl: string, model: string, project: LyricProject): Promise<{ sections: LyricSection[]; plan: Partial<LyricProject> }> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [
    { role: 'system', content: LYRIC_SYSTEM_PROMPT },
    { role: 'user', content: `创作一首完整歌词。主题：${project.theme}；风格：${project.style}；情绪：${project.emotion}；地点：${project.location}；时间：${project.time}；故事背景：${project.story}；核心意象：${project.coreImages.join('、')}；语言：${project.language}；BPM：${project.bpm}；结构：${project.sections.map((s) => s.kind).join(' + ')}。` },
  ];
  let raw = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.86, maxTokens: 3_000, stream: true })) raw += chunk.delta ?? '';
  const parsed = extractJson(raw) as { song?: { title?: string; theme?: string; emotion?: string; coreImages?: string[]; story?: string }; sections?: Array<Partial<LyricSection>> };
  if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error('生成结果缺少歌词段落');
  const sections = parsed.sections.map((section, index) => ({
    id: crypto.randomUUID(), kind: KINDS.includes(section.kind as SectionKind) ? section.kind as SectionKind : 'Verse',
    title: String(section.title || `${section.kind || 'Verse'} ${index + 1}`), lyrics: String(section.lyrics || ''),
    emotion: String(section.emotion || project.emotion), rhyme: String(section.rhyme || '自由'), syllables: String(section.syllables || '8-10'),
  }));
  return { sections, plan: { title: parsed.song?.title || project.title, theme: parsed.song?.theme || project.theme, emotion: parsed.song?.emotion || project.emotion, story: parsed.song?.story || project.story, coreImages: Array.isArray(parsed.song?.coreImages) ? parsed.song.coreImages.map(String).slice(0, 7) : project.coreImages } };
}

async function rewriteSection(apiKey: string, baseUrl: string, model: string, project: LyricProject, section: LyricSection, mode: string): Promise<string> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [{ role: 'system', content: `${LYRIC_SYSTEM_PROMPT}\n\n这是局部改写任务。只输出 JSON：{"lyrics":"改写后的歌词，每行用\\n分隔"}。保持原段落叙事作用，不添加解释。` }, { role: 'user', content: `改写模式：${mode}\n歌曲主题：${project.theme}\n地点与时间：${project.location}，${project.time}\n段落：${section.title}\n情绪：${section.emotion}\n目标韵脚：${section.rhyme}\n字数：${section.syllables}\n原歌词：\n${section.lyrics}` }];
  let raw = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.78, maxTokens: 1_200, stream: true })) raw += chunk.delta ?? '';
  const parsed = extractJson(raw) as { lyrics?: string };
  if (!parsed.lyrics?.trim()) throw new Error('模型没有返回改写歌词');
  return parsed.lyrics.trim();
}

async function rewriteLine(apiKey: string, baseUrl: string, model: string, project: LyricProject, section: LyricSection, line: string, lineIndex: number, mode: string): Promise<LineRewriteCandidate[]> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [{ role: 'system', content: `${LYRIC_SYSTEM_PROMPT}\n\n这是单行歌词改写。只输出 JSON：{"candidates":["候选1","候选2","候选3"]}。三句必须完全原创、保持原意和当前叙事视角，不添加解释。` }, { role: 'user', content: `模式：${mode}\n主题：${project.theme}\n意象链：${project.coreImages.join(' → ')}\n段落：${section.title}\n目标韵脚：${section.rhyme}\n目标字数：${section.syllables}\n上下文：\n${section.lyrics}\n待改写行：${line}` }];
  let raw = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.84, maxTokens: 700, stream: true })) raw += chunk.delta ?? '';
  const parsed = extractJson(raw) as { candidates?: unknown[] };
  if (!Array.isArray(parsed.candidates) || !parsed.candidates.length) throw new Error('模型没有返回行级改写候选');
  return parsed.candidates.map(String).filter(Boolean).slice(0, 3).map((replacement) => ({ id: crypto.randomUUID(), original: line, replacement, lineIndex, mode }));
}

const Field = ({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="grid gap-1 text-[11px] text-muted-foreground"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:border-primary" /></label>;

export const LyricStudioPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [projects, setProjects] = useState(() => readProjects(loadProject()).map(normalizeProject));
  const [project, setProject] = useState(() => { const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY); const all = readProjects(loadProject()).map(normalizeProject); return all.find((item) => item.id === activeId) ?? all[0]; });
  const [history, setHistory] = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [rewriteMode, setRewriteMode] = useState('更有画面');
  const [selectedLine, setSelectedLine] = useState(0);
  const [lineCandidates, setLineCandidates] = useState<LineRewriteCandidate[]>([]);
  const [activeId, setActiveId] = useState(project.sections[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('所有修改会自动保存在本机');
  const active = project.sections.find((section) => section.id === activeId) ?? project.sections[0];
  const score = useMemo(() => scoreProject(project), [project]);
  const lineAnalysis = useMemo(() => analyzeLines(active?.lyrics ?? '', project.bpm), [active?.lyrics, project.bpm]);
  const visibleProjects = useMemo(() => projects.filter((item) => matchesProject(item, projectQuery)).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt), [projectQuery, projects]);

  useEffect(() => { const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() })), 250); return () => window.clearTimeout(timer); }, [project]);
  useEffect(() => { const timer = window.setTimeout(() => setProjects((current) => { const nextProject = { ...project, updatedAt: Date.now() }; const exists = current.some((item) => item.id === project.id); const next = exists ? current.map((item) => item.id === project.id ? nextProject : item) : [nextProject, ...current]; persistProjects(next); localStorage.setItem(ACTIVE_PROJECT_KEY, project.id); return next; }), 300); return () => window.clearTimeout(timer); }, [project]);
  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20))); }, [history]);
  const saveRevision = useCallback((label: string, value = project) => setHistory((current) => [snapshot(value, label), ...current].slice(0, 20)), [project]);
  const patchProject = (patch: Partial<LyricProject>) => setProject((current) => ({ ...current, ...patch }));
  const patchSection = (id: string, patch: Partial<LyricSection>) => setProject((current) => ({ ...current, sections: current.sections.map((section) => section.id === id ? { ...section, ...patch } : section) }));
  const addSection = () => { const id = crypto.randomUUID(); setProject((current) => ({ ...current, sections: [...current.sections, { id, kind: 'Verse', title: `Verse ${current.sections.filter((s) => s.kind === 'Verse').length + 1}`, lyrics: '', emotion: current.emotion, rhyme: '自由', syllables: '8-10' }] })); setActiveId(id); };
  const removeSection = (id: string) => setProject((current) => { const sections = current.sections.filter((section) => section.id !== id); setActiveId(sections[0]?.id ?? ''); return { ...current, sections }; });
  const selectProject = (next: LyricProject) => { setProject(normalizeProject(next)); setActiveId(next.sections[0]?.id ?? ''); setLineCandidates([]); setShowProjects(false); };
  const createProject = () => { const next = normalizeProject({ ...structuredClone(initialProject), id: crypto.randomUUID(), title: '未命名歌曲', theme: '', story: '', coreImages: [], tags: [], sections: starterSections.map((section) => ({ ...section, id: crypto.randomUUID(), lyrics: '' })), updatedAt: Date.now() }); setProjects((current) => [next, ...current]); selectProject(next); };
  const copyProject = () => { const next = duplicateProject(project); setProjects((current) => [next, ...current]); selectProject(next); };
  const deleteProject = () => { if (projects.length <= 1) { setMessage('至少需要保留一个歌曲项目'); return; } const remaining = projects.filter((item) => item.id !== project.id); persistProjects(remaining); setProjects(remaining); selectProject(remaining[0]); };

  const handleGenerate = useCallback(async () => {
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    setLoading(true); setMessage('AI 正在规划结构、韵脚与 Hook…');
    try { saveRevision('生成整首前'); const result = await generateLyrics(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project); patchProject({ ...result.plan, sections: result.sections }); setActiveId(result.sections[0].id); setMessage('已生成完整初稿，并保存了生成前版本'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '生成失败，请稍后重试'); }
    finally { setLoading(false); }
  }, [aiApi, project, saveRevision]);

  const handleRewrite = useCallback(async () => {
    if (!active || loading) return;
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    setLoading(true); setMessage(`AI 正在按“${rewriteMode}”改写 ${active.title}…`);
    try { saveRevision(`改写 ${active.title} 前`); const lyrics = await rewriteSection(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project, active, rewriteMode); patchSection(active.id, { lyrics }); setMessage('段落已改写，可从版本历史恢复'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '改写失败，请稍后重试'); }
    finally { setLoading(false); }
  }, [active, aiApi, loading, project, rewriteMode, saveRevision]);

  const handleLineRewrite = useCallback(async () => {
    const line = lineAnalysis[selectedLine];
    if (!active || !line || loading) return;
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    setLoading(true); setLineCandidates([]); setMessage(`AI 正在生成第 ${selectedLine + 1} 行的三个候选…`);
    try { setLineCandidates(await rewriteLine(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project, active, line.line, selectedLine, rewriteMode)); setMessage('候选已生成，接受前不会覆盖原句'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '行级改写失败'); }
    finally { setLoading(false); }
  }, [active, aiApi, lineAnalysis, loading, project, rewriteMode, selectedLine]);

  const acceptLineCandidate = (candidate: LineRewriteCandidate) => { if (!active) return; saveRevision(`替换 ${active.title} 第 ${candidate.lineIndex + 1} 行前`); patchSection(active.id, { lyrics: replaceNonEmptyLine(active.lyrics, candidate.lineIndex, candidate.replacement) }); setLineCandidates([]); setMessage('已接受候选，并保存替换前版本'); };

  const restoreRevision = (revision: LyricRevision) => { saveRevision('恢复版本前'); const restored = normalizeProject(structuredClone(revision.project)); setProject(restored); setActiveId(restored.sections[0]?.id ?? ''); setShowHistory(false); setMessage(`已恢复：${revision.label}`); };

  const exportText = () => { const url = URL.createObjectURL(new Blob([projectToText(project)], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `${project.title.replace(/[\\/:*?"<>|]/g, '-') || 'lyrics'}.txt`; a.click(); URL.revokeObjectURL(url); setMessage('歌词已导出为 TXT'); };

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><button onClick={() => setShowProjects((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm" style={{ backgroundColor: project.coverColor }} title="歌曲项目"><span className="text-xs font-bold">{project.title.slice(0, 1) || '歌'}</span></button><div className="min-w-0"><input aria-label="项目名称" value={project.title} onChange={(e) => patchProject({ title: e.target.value })} className="w-full bg-transparent text-sm font-semibold outline-none" /><p className="text-[11px] text-muted-foreground">{project.collection || '单曲'} · Lyric Studio</p></div><button onClick={() => patchProject({ favorite: !project.favorite })} className={`rounded p-1.5 ${project.favorite ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`} title="收藏"><Star className="h-4 w-4" /></button><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowHistory((value) => !value)}><History className="mr-1 h-3.5 w-3.5" />历史 {history.length || ''}</Button><Button variant="outline" size="sm" onClick={exportText}><Download className="mr-1 h-3.5 w-3.5" />导出</Button><Button size="sm" disabled={loading} onClick={() => void handleGenerate()}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}生成整首</Button></div></header>
    {showProjects && <div className="absolute left-3 top-14 z-30 w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"><div className="flex gap-1"><div className="relative flex-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><input autoFocus value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="搜索歌名、标签、专辑…" className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none" /></div><button onClick={createProject} className="rounded-md border px-2 text-xs hover:bg-accent" title="新建歌曲"><Plus className="h-3.5 w-3.5" /></button></div><div className="mt-2 max-h-72 overflow-auto">{visibleProjects.map((item) => <button key={item.id} onClick={() => selectProject(item)} className={`flex w-full items-center gap-2 rounded-md p-2 text-left ${item.id === project.id ? 'bg-accent' : 'hover:bg-accent/60'}`}><span className="grid h-8 w-8 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: item.coverColor }}>{item.title.slice(0, 1) || '歌'}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-xs font-medium">{item.title}{item.favorite && <Star className="h-3 w-3 text-amber-500" />}</span><span className="block truncate text-[10px] text-muted-foreground">{item.collection} · {item.tags.join(' / ') || '无标签'}</span></span><span className="text-[9px] text-muted-foreground">{{ idea: '灵感', draft: '初稿', revising: '修改中', done: '完成' }[item.status]}</span></button>)}</div><div className="mt-2 flex gap-1 border-t pt-2"><Button variant="outline" size="sm" className="flex-1" onClick={copyProject}><Copy className="mr-1 h-3 w-3" />复制当前</Button><Button variant="outline" size="sm" className="flex-1 text-destructive" onClick={deleteProject}><Trash2 className="mr-1 h-3 w-3" />删除当前</Button></div></div>}
    {showHistory && <div className="absolute right-4 top-14 z-30 w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"><div className="flex items-center justify-between px-2 py-1"><strong className="text-xs">版本历史</strong><button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setShowHistory(false)}>关闭</button></div><div className="max-h-72 overflow-auto">{history.length ? history.map((revision) => <button key={revision.id} onClick={() => restoreRevision(revision)} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-accent"><span className="text-xs">{revision.label}</span><span className="text-[10px] text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span></button>) : <p className="px-2 py-6 text-center text-xs text-muted-foreground">生成或改写后会自动留下版本</p>}</div></div>}
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(360px,1fr)_280px]">
      <aside className="flex min-h-0 flex-col border-r bg-muted/20"><div className="flex items-center justify-between border-b px-3 py-2"><span className="text-xs font-medium">歌曲结构</span><button onClick={addSection} className="rounded p-1 hover:bg-accent" title="添加段落"><Plus className="h-3.5 w-3.5" /></button></div><div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">{project.sections.map((section, index) => <button key={section.id} onClick={() => setActiveId(section.id)} className={`group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${activeId === section.id ? 'bg-violet-500/15 text-violet-600' : 'hover:bg-accent'}`}><span className="w-5 text-center text-[10px] text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate">{section.title}</span><span className="text-[9px] uppercase text-muted-foreground">{section.rhyme}</span></button>)}</div><div className="border-t p-3 text-[10px] leading-4 text-muted-foreground">拖动排序将在下一版加入；当前可自由增删段落。</div></aside>
      <main className="min-h-0 overflow-auto p-5">{active ? <div className="mx-auto max-w-3xl"><div className="mb-4 flex items-center gap-2"><select value={active.kind} onChange={(e) => patchSection(active.id, { kind: e.target.value as SectionKind })} className="h-8 rounded-md border bg-background px-2 text-xs">{KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select><input value={active.title} onChange={(e) => patchSection(active.id, { title: e.target.value })} className="h-8 flex-1 border-b bg-transparent text-lg font-semibold outline-none focus:border-violet-500" /><button title="删除段落" onClick={() => removeSection(active.id)} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div><div className="mb-4 grid grid-cols-3 gap-3"><Field label="情绪" value={active.emotion} onChange={(value) => patchSection(active.id, { emotion: value })} /><Field label="目标韵脚" value={active.rhyme} onChange={(value) => patchSection(active.id, { rhyme: value })} /><Field label="每行字数" value={active.syllables} onChange={(value) => patchSection(active.id, { syllables: value })} /></div><div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-2"><Sparkles className="h-3.5 w-3.5 text-violet-500" /><select aria-label="AI 改写模式" value={rewriteMode} onChange={(event) => setRewriteMode(event.target.value)} className="h-7 flex-1 rounded border bg-background px-2 text-xs"><option>更有画面</option><option>更口语易唱</option><option>加强少年感</option><option>增加电影感</option><option>统一自然押韵</option><option>精简字数</option><option>加强副歌 Hook</option></select><Button size="sm" variant="outline" disabled={loading || !active.lyrics.trim()} onClick={() => void handleRewrite()}>{loading ? <Loader2 className="mr-1 h-3 w-3" /> : null}改写本段</Button></div><textarea aria-label="歌词编辑器" value={active.lyrics} onChange={(e) => patchSection(active.id, { lyrics: e.target.value })} placeholder="在这里写下歌词，每行一句…" className="min-h-[420px] w-full resize-none rounded-xl border bg-card p-5 font-serif text-lg leading-9 outline-none focus:border-violet-500" /><div className="mt-3 flex flex-wrap gap-2">{active.lyrics.split(/\r?\n/).filter(Boolean).map((line, index) => <span key={`${line}-${index}`} className={`rounded-full border px-2 py-1 text-[10px] ${active.rhyme !== '自由' && detectRhyme(line) !== active.rhyme ? 'border-amber-500/40 bg-amber-500/10 text-amber-600' : 'text-muted-foreground'}`}>第 {index + 1} 行 · {detectRhyme(line)}</span>)}</div></div> : <div className="grid h-full place-items-center text-sm text-muted-foreground">添加一个段落开始创作</div>}</main>
      <aside className="min-h-0 overflow-auto border-l bg-muted/10 p-4"><h3 className="mb-3 text-xs font-semibold">创作规划卡</h3><div className="grid gap-3"><Field label="主题" value={project.theme} onChange={(value) => patchProject({ theme: value })} /><Field label="风格" value={project.style} onChange={(value) => patchProject({ style: value })} /><Field label="整体情绪" value={project.emotion} onChange={(value) => patchProject({ emotion: value })} /><div className="grid grid-cols-2 gap-2"><Field label="地点" value={project.location} onChange={(value) => patchProject({ location: value })} /><Field label="时间" value={project.time} onChange={(value) => patchProject({ time: value })} /></div><Field label="故事背景" value={project.story} onChange={(value) => patchProject({ story: value })} /><Field label="核心意象（用、分隔）" value={project.coreImages.join('、')} onChange={(value) => patchProject({ coreImages: value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 7) })} /><div className="grid grid-cols-2 gap-2"><Field label="语言" value={project.language} onChange={(value) => patchProject({ language: value })} /><Field label="BPM" type="number" value={project.bpm} onChange={(value) => patchProject({ bpm: Math.max(40, Math.min(240, Number(value) || 72)) })} /></div></div><div className="my-5 border-t" /><div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-semibold">歌曲潜力</p><p className="text-[10px] text-muted-foreground">启发式分析，可随编辑实时更新</p></div><strong className="text-2xl text-violet-500">{score.overall}</strong></div><div className="space-y-3">{([['旋律适配', score.rhythm], ['情绪表达', score.emotion], ['Hook 强度', score.hook], ['押韵统一', score.rhyme]] as const).map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-[10px]"><span>{label}</span><span>{value}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${value}%` }} /></div></div>)}</div><div className="mt-5 rounded-lg border bg-card p-3"><p className="mb-2 text-[11px] font-medium">AI 编辑建议</p>{score.notes.map((note) => <p key={note} className="mb-2 text-[10px] leading-4 text-muted-foreground">• {note}</p>)}</div></aside>
    </div><footer className="flex h-8 shrink-0 items-center border-t px-4 text-[10px] text-muted-foreground"><Save className="mr-1.5 h-3 w-3" />{message}<span className="ml-auto">{project.sections.length} 个段落 · {project.sections.reduce((sum, section) => sum + section.lyrics.split(/\r?\n/).filter(Boolean).length, 0)} 行</span></footer>
  </div>;
};
