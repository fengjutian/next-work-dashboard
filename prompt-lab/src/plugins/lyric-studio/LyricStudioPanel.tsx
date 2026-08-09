import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, History, Loader2, Pin, Plus, Save, Search, Sparkles, Star, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { analyzeLines, detectRhyme, projectToText, rhymePattern, rhymeSuggestions, scoreProject } from './analysis';
import { ACTIVE_PROJECT_KEY, duplicateProject, matchesProject, persistProjects, readProjects } from './project-store';
import { LYRIC_SYSTEM_PROMPT } from './prompt';
import { LyricToolbox } from './LyricToolbox';
import type { LineRewriteCandidate, LyricProject, LyricRevision, LyricSection, SectionKind } from './types';

const STORAGE_KEY = 'nwd:lyric-studio:project';
const HISTORY_KEY = 'nwd:lyric-studio:history';
const KINDS: SectionKind[] = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];
const initialProject: LyricProject = { id: 'summer-love', title: '未命名歌曲', theme: '', style: '华语流行', emotion: '', language: '中文', bpm: 72, location: '', time: '', story: '', coreImages: [], tags: [], favorite: false, collection: '单曲', status: 'idea', coverColor: '#7c3aed', creativePrompt: '', promptHistory: [], promptPriority: 'prompt', scratchpad: '', sections: [], updatedAt: Date.now() };

function normalizeProject(saved: Partial<LyricProject>): LyricProject {
  return { ...initialProject, ...saved, coreImages: Array.isArray(saved.coreImages) ? saved.coreImages : initialProject.coreImages, tags: Array.isArray(saved.tags) ? saved.tags : [], promptHistory: Array.isArray(saved.promptHistory) ? saved.promptHistory : [], sections: Array.isArray(saved.sections) ? saved.sections : initialProject.sections };
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

function applyLineCandidate(lyrics: string, candidate: LineRewriteCandidate): string {
  const lines = lyrics.split(/\r?\n/);
  let seen = -1;
  const rawIndex = lines.findIndex((line) => { if (!line.trim()) return false; seen += 1; return seen === candidate.lineIndex; });
  if (rawIndex < 0) return lyrics;
  if (candidate.mode === '补写上一句') lines.splice(rawIndex, 0, candidate.replacement);
  else if (candidate.mode === '补写下一句') lines.splice(rawIndex + 1, 0, candidate.replacement);
  else return replaceNonEmptyLine(lyrics, candidate.lineIndex, candidate.replacement);
  return lines.join('\n');
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的歌词结构');
  return JSON.parse(fenced.slice(start, end + 1));
}

async function withRequestTimeout<T>(request: Promise<T>, controller: AbortController, milliseconds = 180_000): Promise<T> {
  let timer = 0;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => { controller.abort(); reject(new Error(`AI 请求超过 ${Math.round(milliseconds / 1000)} 秒未完成，请检查网络、模型服务或 API 配置后重试`)); }, milliseconds);
  });
  const cancelled = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new DOMException('生成已取消', 'AbortError'));
    controller.signal.addEventListener('abort', abortHandler, { once: true });
  });
  try { return await Promise.race([request, timeout, cancelled]); } finally {
    window.clearTimeout(timer);
    if (abortHandler) controller.signal.removeEventListener('abort', abortHandler);
  }
}

interface LyricsGenerationResult {
  sections: LyricSection[];
  plan: Partial<LyricProject>;
  failedSections: string[];
  completedBatches: number;
  totalBatches: number;
}

async function generateLyricsDetailed(apiKey: string, baseUrl: string, model: string, project: LyricProject, signal?: AbortSignal, onProgress?: (stage: string) => void): Promise<{ sections: LyricSection[]; plan: Partial<LyricProject> }> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [
    { role: 'system', content: LYRIC_SYSTEM_PROMPT },
    { role: 'user', content: `创作一首完整歌词。主题：${project.theme}；风格：${project.style}；情绪：${project.emotion}；地点：${project.location}；时间：${project.time}；故事背景：${project.story}；核心意象：${project.coreImages.join('、')}；语言：${project.language}；BPM：${project.bpm}。

必须严格按照用户定义的以下 ${project.sections.length} 个段落生成，保持相同顺序、数量和 title，不得新增、删除、合并或改名。每个未锁定的 Verse、Pre-Chorus、Chorus 和 Bridge 必须在 lyrics 中生成至少 2 行非空歌词；Intro 和 Outro 如果不是纯器乐设定，也必须生成歌词：
${project.sections.map((section, index) => `${index + 1}. title=${section.title}；kind=${section.kind}；情绪=${section.emotion}；韵脚=${section.rhyme}；每行字数=${section.syllables}${section.locked ? '；该段已锁定，不需要生成内容' : ''}`).join('\n')}` },
  ];
  let raw = '';
  let received = false;
  for await (const chunk of provider.chat(messages, { model, temperature: 0.86, maxTokens: 7_000, stream: true, signal })) {
    if (!received && (chunk.delta || chunk.reasoningDelta)) { received = true; onProgress?.('已收到模型响应，正在生成歌词'); }
    raw += chunk.delta ?? '';
  }
  onProgress?.('歌词已生成，正在解析歌曲结构');
  const parsed = extractJson(raw) as { song?: { title?: string; theme?: string; emotion?: string; coreImages?: string[]; story?: string }; sections?: Array<Partial<LyricSection>> };
  if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error('生成结果缺少歌词段落');
  const sections = parsed.sections.map((section, index) => ({
    id: crypto.randomUUID(), kind: KINDS.includes(section.kind as SectionKind) ? section.kind as SectionKind : 'Verse',
    title: String(section.title || `${section.kind || 'Verse'} ${index + 1}`), lyrics: String(section.lyrics || ''),
    emotion: String(section.emotion || project.emotion), rhyme: String(section.rhyme || '自由'), syllables: String(section.syllables || '8-10'),
  }));
  const requiredSections = sections.filter((section) => !['Intro', 'Outro'].includes(section.kind));
  if (!sections.some((section) => section.lyrics.trim())) throw new Error('AI 返回了歌曲结构，但歌词内容为空。请重试或更换支持长文本输出的模型');
  if (requiredSections.some((section) => !section.lyrics.trim())) throw new Error('AI 返回的部分正文段落没有歌词，为避免写入不完整结果，本次生成已取消，请重试');
  const expected = project.sections.filter((section) => !section.locked && !['Intro', 'Outro'].includes(section.kind));
  const missing = expected.filter((section, index) => { const generated = sections.find((item) => item.title.trim().toLowerCase() === section.title.trim().toLowerCase()) ?? sections[index]; return !generated?.lyrics.trim(); });
  if (missing.length) throw new Error(`AI 未完成这些段落：${missing.map((section) => section.title).join('、')}。本次结果未写入，请重试`);
  return { sections, plan: { story: parsed.song?.story || project.story, coreImages: Array.isArray(parsed.song?.coreImages) ? parsed.song.coreImages.map(String).slice(0, 7) : project.coreImages } };
}

async function generateLyrics(apiKey: string, baseUrl: string, model: string, project: LyricProject, signal?: AbortSignal, onProgress?: (stage: string) => void, onBatch?: (sections: Array<Partial<LyricSection>>, completed: number, total: number) => void): Promise<LyricsGenerationResult> {
  const targets = project.sections.filter((section) => !section.locked); const batches: LyricSection[][] = [];
  for (let index = 0; index < targets.length; index += 3) batches.push(targets.slice(index, index + 3));
  if (!batches.length) return { sections: project.sections, plan: {}, failedSections: [], completedBatches: 0, totalBatches: 0 };
  let finished = 0;
  const results = await Promise.all(batches.map(async (batch, batchIndex) => {
    try {
    const provider = createOpenAIProvider({ apiKey, baseUrl }); let raw = '';
    const system = `你是专业华语流行歌词创作者。作品必须完全原创，不模仿或复用任何在世音乐人的具体作品与标志性表达。使用电影感场景、现代生活细节、东方意象、自然押韵和克制情绪。只输出合法 JSON：{"sections":[{"title":"必须与输入相同","lyrics":"每行用\\n分隔","emotion":"","rhyme":"","syllables":""}]}。每个 Verse、Pre-Chorus、Chorus、Bridge 至少写 2 行；不得返回空 lyrics，不得输出 Markdown。`;
    const user = `自由创作提示词：${project.creativePrompt || '未填写'}\n冲突优先级：${project.promptPriority === 'prompt' ? '自由提示词优先' : '规划卡字段优先'}\n歌曲主题：${project.theme}\n风格：${project.style}\n情绪：${project.emotion}\n地点与时间：${project.location}，${project.time}\n故事：${project.story}\n核心意象：${project.coreImages.join('、')}\n可选素材（仅在自然契合时使用）：${project.scratchpad || '无'}\nBPM：${project.bpm}\n这是第 ${batchIndex + 1}/${batches.length} 批。严格填写以下段落：\n${batch.map((section) => `- ${section.title}；类型=${section.kind}；情绪=${section.emotion}；韵脚=${section.rhyme}；字数=${section.syllables}`).join('\n')}`;
    const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
    for await (const chunk of provider.chat(messages, { model, temperature: 0.82, maxTokens: 2_000, stream: true, signal })) raw += chunk.delta ?? '';
    const parsed = extractJson(raw) as { sections?: Array<Partial<LyricSection>> }; if (!Array.isArray(parsed.sections)) throw new Error(`第 ${batchIndex + 1} 批没有返回有效歌词`);
    finished += 1; onProgress?.(`已完成 ${finished}/${batches.length} 批歌词`); onBatch?.(parsed.sections, finished, batches.length); return { sections: parsed.sections, failed: [] as string[] };
    } catch (error) {
      if (signal?.aborted) throw error;
      finished += 1;
      onProgress?.(`已完成 ${finished}/${batches.length} 批；第 ${batchIndex + 1} 批失败，可稍后重试`);
      return { sections: [] as Array<Partial<LyricSection>>, failed: batch.map((section) => section.title) };
    }
  }));
  const generated = results.flatMap((result) => result.sections);
  const failedSections = results.flatMap((result) => result.failed);
  const sections = project.sections.map((section) => { if (section.locked) return section; const item = generated.find((candidate) => String(candidate.title || '').trim().toLowerCase() === section.title.trim().toLowerCase()); return item ? { ...section, lyrics: String(item.lyrics || ''), emotion: String(item.emotion || section.emotion), rhyme: String(item.rhyme || section.rhyme), syllables: String(item.syllables || section.syllables) } : section; });
  return { sections, plan: {}, failedSections, completedBatches: results.filter((result) => !result.failed.length).length, totalBatches: batches.length };
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

async function generateSongStructure(apiKey: string, baseUrl: string, model: string, prompt: string): Promise<LyricSection[]> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [{ role: 'system', content: '你是歌曲结构策划师。根据用户的创作构想规划歌曲段落，只输出合法 JSON：{"sections":[{"kind":"Verse","title":"Verse 1","emotion":"克制","rhyme":"ing","syllables":"8-10"}]}。kind 只能是 Intro、Verse、Pre-Chorus、Chorus、Bridge、Outro。不要生成任何歌词，不要输出 Markdown。' }, { role: 'user', content: prompt }];
  let raw = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.55, maxTokens: 1_000, stream: true })) raw += chunk.delta ?? '';
  const parsed = extractJson(raw) as { sections?: Array<Partial<LyricSection>> };
  if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error('AI 没有返回有效的歌曲结构');
  return parsed.sections.slice(0, 16).map((section, index) => ({ id: crypto.randomUUID(), kind: KINDS.includes(section.kind as SectionKind) ? section.kind as SectionKind : 'Verse', title: String(section.title || `${section.kind || 'Verse'} ${index + 1}`), lyrics: '', emotion: String(section.emotion || '待定'), rhyme: String(section.rhyme || '自由'), syllables: String(section.syllables || '8-10'), locked: false, collapsed: false }));
}

const Field = ({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="grid gap-1 text-[11px] text-muted-foreground"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:border-primary" /></label>;
const scoreBand = (value: number) => value >= 85 ? '突出' : value >= 70 ? '良好' : value >= 55 ? '可优化' : '需调整';

export const LyricStudioPanel: React.FC = () => {
  const aiApi = useStore((state) => state.aiApi);
  const [projects, setProjects] = useState(() => readProjects(loadProject()).map(normalizeProject));
  const [project, setProject] = useState(() => { const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY); const all = readProjects(loadProject()).map(normalizeProject); return all.find((item) => item.id === activeId) ?? all[0]; });
  const [history, setHistory] = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [showFullLyrics, setShowFullLyrics] = useState(false);
  const [showToolbox, setShowToolbox] = useState(false);
  const [showStructureGenerator, setShowStructureGenerator] = useState(false);
  const [structurePrompt, setStructurePrompt] = useState(() => project.creativePrompt || '');
  const [structureLoading, setStructureLoading] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [generationCandidate, setGenerationCandidate] = useState<LyricsGenerationResult | null>(null);
  const [generationStage, setGenerationStage] = useState('');
  const [rightTab, setRightTab] = useState<'planning' | 'project' | 'analysis'>('planning');
  const [editorMode, setEditorMode] = useState<'section' | 'song'>('section');
  const [sectionRewriteCandidate, setSectionRewriteCandidate] = useState<string | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const [showProjects, setShowProjects] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [rewriteMode, setRewriteMode] = useState('更有画面');
  const [lineRewriteMode, setLineRewriteMode] = useState('替换这一句');
  const [selectedLine, setSelectedLine] = useState(0);
  const [lineCandidates, setLineCandidates] = useState<LineRewriteCandidate[]>([]);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
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
  useEffect(() => {
    const closeTopLayer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || loading || structureLoading) return;
      if (generationCandidate) setGenerationCandidate(null);
      else if (showOverwriteConfirm) setShowOverwriteConfirm(false);
      else if (showStructureGenerator) setShowStructureGenerator(false);
    };
    window.addEventListener('keydown', closeTopLayer);
    return () => window.removeEventListener('keydown', closeTopLayer);
  }, [generationCandidate, loading, showOverwriteConfirm, showStructureGenerator, structureLoading]);
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const nodes = focusable(); if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', trapFocus);
    return () => { dialog.removeEventListener('keydown', trapFocus); previous?.focus(); };
  }, [generationCandidate, showFullLyrics, showOverwriteConfirm, showStructureGenerator]);
  useEffect(() => {
    if (!showStructureGenerator || structurePrompt === project.creativePrompt) return;
    const timer = window.setTimeout(() => patchProject({ creativePrompt: structurePrompt }), 200);
    return () => window.clearTimeout(timer);
  }, [showStructureGenerator, structurePrompt, project.creativePrompt]);
  useEffect(() => {
    if (!structureLoading || !structurePrompt.trim() || project.promptHistory[0]?.content === structurePrompt.trim()) return;
    patchProject({ promptHistory: [{ id: crypto.randomUUID(), content: structurePrompt.trim(), createdAt: Date.now(), model: aiApi.model }, ...project.promptHistory].slice(0, 20) });
  }, [aiApi.model, project.promptHistory, structureLoading, structurePrompt]);
  const saveRevision = useCallback((label: string, value = project) => setHistory((current) => [snapshot(value, label), ...current].slice(0, 20)), [project]);
  const patchProject = (patch: Partial<LyricProject>) => setProject((current) => ({ ...current, ...patch }));
  const patchSection = (id: string, patch: Partial<LyricSection>) => setProject((current) => ({ ...current, sections: current.sections.map((section) => section.id === id ? { ...section, ...patch } : section) }));
  const addSection = () => { const id = crypto.randomUUID(); setProject((current) => ({ ...current, sections: [...current.sections, { id, kind: 'Verse', title: `Verse ${current.sections.filter((s) => s.kind === 'Verse').length + 1}`, lyrics: '', emotion: current.emotion, rhyme: '自由', syllables: '8-10' }] })); setActiveId(id); };
  const removeSection = (id: string) => setProject((current) => { const sections = current.sections.filter((section) => section.id !== id); setActiveId(sections[0]?.id ?? ''); return { ...current, sections }; });
  const duplicateSection = (section: LyricSection) => { const copy = { ...structuredClone(section), id: crypto.randomUUID(), title: `${section.title} Copy`, locked: false }; setProject((current) => { const index = current.sections.findIndex((item) => item.id === section.id); const sections = [...current.sections]; sections.splice(index + 1, 0, copy); return { ...current, sections }; }); setActiveId(copy.id); };
  const moveSection = (targetId: string) => { if (!draggedSectionId || draggedSectionId === targetId) return; setProject((current) => { const sections = [...current.sections]; const from = sections.findIndex((item) => item.id === draggedSectionId); const to = sections.findIndex((item) => item.id === targetId); if (from < 0 || to < 0) return current; const [moved] = sections.splice(from, 1); sections.splice(to, 0, moved); return { ...current, sections }; }); setDraggedSectionId(null); };
  const selectProject = (next: LyricProject) => { setProject(normalizeProject(next)); setActiveId(next.sections[0]?.id ?? ''); setLineCandidates([]); setShowProjects(false); };
  const createProject = () => { const next = normalizeProject({ ...structuredClone(initialProject), id: crypto.randomUUID(), title: '未命名歌曲', theme: '', story: '', coreImages: [], tags: [], sections: [], updatedAt: Date.now() }); setProjects((current) => [next, ...current]); selectProject(next); };
  const copyProject = () => { const next = duplicateProject(project); setProjects((current) => [next, ...current]); selectProject(next); };
  const deleteProject = () => { if (projects.length <= 1) { setMessage('至少需要保留一个歌曲项目'); return; } if (!window.confirm(`确定删除《${project.title}》吗？此操作无法从版本历史恢复。`)) return; const remaining = projects.filter((item) => item.id !== project.id); persistProjects(remaining); setProjects(remaining); selectProject(remaining[0]); };
  const handleGenerateStructure = async (continueWithLyrics = false) => { if (!structurePrompt.trim()) { setMessage('请先输入歌曲结构提示词'); return; } if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务'); return; } setStructureLoading(true); try { const sections = await generateSongStructure(aiApi.apiKey, aiApi.baseUrl, aiApi.model, structurePrompt.trim()); saveRevision('生成歌曲结构前'); if (!continueWithLyrics) { patchProject({ sections }); setActiveId(sections[0]?.id ?? ''); setShowStructureGenerator(false); setMessage(`结构生成成功：已创建 ${sections.length} 个空白段落。确认后可点击“生成整首”填入歌词`); return; } setMessage(`结构生成成功，正在为 ${sections.length} 个段落填写歌词…`); const nextProject = { ...project, sections }; const controller = new AbortController(); const result = await withRequestTimeout(generateLyrics(aiApi.apiKey, aiApi.baseUrl, aiApi.model, nextProject, controller.signal, (stage) => setMessage(stage)), controller); const filledSections = sections.map((section, index) => { const generated = result.sections.find((item) => item.title.trim().toLowerCase() === section.title.trim().toLowerCase()) ?? result.sections[index]; return generated ? { ...section, lyrics: generated.lyrics, emotion: generated.emotion || section.emotion, rhyme: generated.rhyme || section.rhyme, syllables: generated.syllables || section.syllables } : section; }); patchProject({ ...result.plan, sections: filledSections }); setActiveId(filledSections[0]?.id ?? ''); setShowStructureGenerator(false); setMessage(`生成成功：已创建结构并完成 ${filledSections.length} 个段落的歌词`); } catch (error) { setMessage(error instanceof Error ? error.message : '生成失败'); } finally { setStructureLoading(false); } };

  const handleGenerate = useCallback(async () => {
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    if (!project.sections.length) { setStructurePrompt(project.creativePrompt); setShowStructureGenerator(true); return; }
    if (project.sections.some((section) => section.lyrics.trim()) && !showOverwriteConfirm) { setShowOverwriteConfirm(true); return; }
    setShowOverwriteConfirm(false); setLoading(true); setGenerationStage('正在连接 AI 模型'); setMessage('生成任务已开始');
    const controller = new AbortController();
    generationControllerRef.current = controller;
    const startedAt = Date.now();
    let progressStage = '正在连接 AI 模型';
    const progressTimer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (seconds >= 10 && progressStage === '正在连接 AI 模型') progressStage = 'AI 正在规划结构、韵脚与 Hook';
      setGenerationStage(`${progressStage}… ${seconds} 秒`);
    }, 1_000);
    try { const result = await withRequestTimeout(generateLyrics(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project, controller.signal, (stage) => { progressStage = stage; setGenerationStage(stage); }, (batchSections, completed, total) => { setGenerationCandidate((current) => { const base = current?.sections ?? project.sections; const sections = base.map((section) => { const item = batchSections.find((candidate) => String(candidate.title || '') === section.title); return item ? { ...section, lyrics: String(item.lyrics || section.lyrics), emotion: String(item.emotion || section.emotion), rhyme: String(item.rhyme || section.rhyme), syllables: String(item.syllables || section.syllables) } : section; }); return { sections, plan: {}, failedSections: [], completedBatches: completed, totalBatches: total }; }); }), controller); setGenerationCandidate(result); setGenerationStage('候选已生成，确认后才会写入项目'); setMessage('生成完成，请比较候选结果'); }
    catch (error) { const cancelled = error instanceof DOMException && error.name === 'AbortError'; setGenerationStage(cancelled ? '生成已取消，项目未被覆盖' : error instanceof Error ? error.message : '生成失败'); setMessage(cancelled ? '生成已取消' : '生成失败'); }
    finally { window.clearInterval(progressTimer); generationControllerRef.current = null; setLoading(false); }
  }, [aiApi, project, showOverwriteConfirm]);

  const acceptGenerationCandidate = () => {
    if (!generationCandidate || loading) return;
    saveRevision('应用 AI 生成候选前');
    patchProject({ ...generationCandidate.plan, sections: generationCandidate.sections });
    setActiveId(generationCandidate.sections[0]?.id ?? '');
    setMessage(generationCandidate.failedSections.length ? `已应用成功段落；${generationCandidate.failedSections.join('、')} 保留原文` : '已应用整首歌词候选');
    setGenerationCandidate(null); setGenerationStage('');
  };
  const saveCandidateAsBranch = () => {
    if (!generationCandidate) return;
    const branchProject = { ...project, ...generationCandidate.plan, sections: generationCandidate.sections, updatedAt: Date.now() };
    setHistory((current) => [snapshot(branchProject, `AI 候选分支 ${new Date().toLocaleTimeString()}`), ...current].slice(0, 20));
    setMessage('候选已保存为版本分支，当前歌词没有改变');
  };

  const retryFailedSections = async () => {
    if (!generationCandidate?.failedSections.length || loading) return;
    const failed = new Set(generationCandidate.failedSections);
    const retryProject = { ...project, sections: generationCandidate.sections.map((section) => ({ ...section, locked: !failed.has(section.title) })) };
    const controller = new AbortController(); generationControllerRef.current = controller; setLoading(true); setGenerationStage(`正在重试 ${failed.size} 个失败段落`);
    try {
      const retried = await withRequestTimeout(generateLyrics(aiApi.apiKey, aiApi.baseUrl, aiApi.model, retryProject, controller.signal, setGenerationStage), controller);
      const sections = generationCandidate.sections.map((section) => retried.sections.find((item) => item.title === section.title) ?? section).map((section) => ({ ...section, locked: project.sections.find((item) => item.id === section.id)?.locked }));
      setGenerationCandidate({ ...retried, sections, failedSections: retried.failedSections });
      setGenerationStage(retried.failedSections.length ? '部分段落仍未成功，可再次重试' : '失败段落已全部补齐');
    } catch (error) { setGenerationStage(error instanceof Error ? error.message : '重试失败'); }
    finally { generationControllerRef.current = null; setLoading(false); }
  };

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string }>).detail;
      if (detail?.command === 'generate') void handleGenerate();
    };
    window.addEventListener('lyric-studio:command', listener);
    return () => window.removeEventListener('lyric-studio:command', listener);
  }, [handleGenerate]);

  useEffect(() => {
    if (!showFullLyrics) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowFullLyrics(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showFullLyrics]);
  useEffect(() => { if (!showFullLyrics && editorMode === 'song') setEditorMode('section'); }, [editorMode, showFullLyrics]);

  const handleRewrite = useCallback(async () => {
    if (!active || loading) return;
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    setLoading(true); setMessage(`AI 正在按“${rewriteMode}”改写 ${active.title}…`);
    try { const lyrics = await rewriteSection(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project, active, rewriteMode); setSectionRewriteCandidate(lyrics); setMessage('段落候选已生成，接受前不会覆盖原文'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '改写失败，请稍后重试'); }
    finally { setLoading(false); }
  }, [active, aiApi, loading, project, rewriteMode, saveRevision]);

  const acceptSectionRewrite = () => {
    if (!active || !sectionRewriteCandidate) return;
    saveRevision(`改写 ${active.title} 前`);
    patchSection(active.id, { lyrics: sectionRewriteCandidate });
    setSectionRewriteCandidate(null);
    setMessage('已接受段落改写候选');
  };

  const handleLineRewrite = useCallback(async () => {
    const line = lineAnalysis[selectedLine];
    if (!active || !line || loading) return;
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务、API Key 和模型'); return; }
    setLoading(true); setLineCandidates([]); setMessage(`AI 正在生成第 ${selectedLine + 1} 行的三个候选…`);
    try { setLineCandidates(await rewriteLine(aiApi.apiKey, aiApi.baseUrl, aiApi.model, project, active, line.line, selectedLine, lineRewriteMode)); setMessage('候选已生成，接受前不会覆盖原句'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '行级改写失败'); }
    finally { setLoading(false); }
  }, [active, aiApi, lineAnalysis, lineRewriteMode, loading, project, selectedLine]);

  const acceptLineCandidate = (candidate: LineRewriteCandidate) => { if (!active) return; saveRevision(`编辑 ${active.title} 第 ${candidate.lineIndex + 1} 行前`); patchSection(active.id, { lyrics: applyLineCandidate(active.lyrics, candidate) }); setLineCandidates([]); setMessage('已接受候选，并保存编辑前版本'); };

  const restoreRevision = (revision: LyricRevision) => { saveRevision('恢复版本前'); const restored = normalizeProject(structuredClone(revision.project)); setProject(restored); setActiveId(restored.sections[0]?.id ?? ''); setShowHistory(false); setMessage(`已恢复：${revision.label}`); };

  const exportText = () => { const url = URL.createObjectURL(new Blob([projectToText(project)], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `${project.title.replace(/[\\/:*?"<>|]/g, '-') || 'lyrics'}.txt`; a.click(); URL.revokeObjectURL(url); setMessage('歌词已导出为 TXT'); };

  return <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><button onClick={() => setShowProjects((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm" style={{ backgroundColor: project.coverColor }} title="歌曲项目"><span className="text-xs font-bold">{project.title.slice(0, 1) || '歌'}</span></button><div className="min-w-0"><input aria-label="项目名称" value={project.title} onChange={(e) => patchProject({ title: e.target.value })} className="w-full bg-transparent text-sm font-semibold outline-none" /><p className="text-[11px] text-muted-foreground">{project.collection || '单曲'} · Lyric Studio</p></div><button onClick={() => patchProject({ favorite: !project.favorite })} className={`rounded p-1.5 ${project.favorite ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`} title="收藏"><Star className="h-4 w-4" /></button><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowHistory((value) => !value)}><History className="mr-1 h-3.5 w-3.5" />历史 {history.length || ''}</Button><Button variant="outline" size="sm" onClick={exportText}><Download className="mr-1 h-3.5 w-3.5" />导出</Button><Button size="sm" disabled={loading} onClick={() => void handleGenerate()}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}生成整首</Button></div></header>
    {showProjects && <div className="absolute left-3 top-14 z-30 w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"><div className="flex gap-1"><div className="relative flex-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><input autoFocus value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="搜索歌名、标签、专辑…" className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none" /></div><button onClick={createProject} className="rounded-md border px-2 text-xs hover:bg-accent" title="新建歌曲"><Plus className="h-3.5 w-3.5" /></button></div><div className="mt-2 max-h-72 overflow-auto">{visibleProjects.map((item) => <button key={item.id} onClick={() => selectProject(item)} className={`flex w-full items-center gap-2 rounded-md p-2 text-left ${item.id === project.id ? 'bg-accent' : 'hover:bg-accent/60'}`}><span className="grid h-8 w-8 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: item.coverColor }}>{item.title.slice(0, 1) || '歌'}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-xs font-medium">{item.title}{item.favorite && <Star className="h-3 w-3 text-amber-500" />}</span><span className="block truncate text-[10px] text-muted-foreground">{item.collection} · {item.tags.join(' / ') || '无标签'}</span></span><span className="text-[9px] text-muted-foreground">{{ idea: '灵感', draft: '初稿', revising: '修改中', done: '完成' }[item.status]}</span></button>)}</div><div className="mt-2 flex gap-1 border-t pt-2"><Button variant="outline" size="sm" className="flex-1" onClick={copyProject}><Copy className="mr-1 h-3 w-3" />复制当前</Button><Button variant="outline" size="sm" className="flex-1 text-destructive" onClick={deleteProject}><Trash2 className="mr-1 h-3 w-3" />删除当前</Button></div></div>}
    {showHistory && <div className="absolute right-4 top-14 z-30 w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"><div className="flex items-center justify-between px-2 py-1"><strong className="text-xs">版本历史</strong><button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setShowHistory(false)}>关闭</button></div><div className="max-h-72 overflow-auto">{history.length ? history.map((revision) => <button key={revision.id} onClick={() => restoreRevision(revision)} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-accent"><span className="text-xs">{revision.label}</span><span className="text-[10px] text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span></button>) : <p className="px-2 py-6 text-center text-xs text-muted-foreground">生成或改写后会自动留下版本</p>}</div></div>}
    {showStructureGenerator && <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !structureLoading) setShowStructureGenerator(false); }}><div role="dialog" aria-modal="true" aria-label="AI 生成歌曲结构" className="w-full max-w-2xl rounded-2xl border bg-background p-6 shadow-2xl"><h2 className="text-base font-semibold">从创作提示开始</h2><p className="mt-1 text-xs text-muted-foreground">描述主题、风格、情绪和故事。可以只规划结构，也可以一次完成结构与歌词。</p><textarea autoFocus value={structurePrompt} onChange={(event) => setStructurePrompt(event.target.value)} placeholder="例如：一首三分钟的华语流行情歌。写少年在夏末车站告别，主歌克制，副歌出现两次，Bridge 时间跳跃，结尾留白。不要模仿或复用任何已有歌词。" className="mt-4 min-h-36 w-full resize-y rounded-xl border bg-card p-4 text-sm leading-6 outline-none focus:border-violet-500" /><div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">“仅生成结构”会创建空白段落；“结构并生成歌词”会自动完成第二步。两种方式都可以继续手动调整。</div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={structureLoading} onClick={() => setShowStructureGenerator(false)}>取消</Button><Button variant="outline" disabled={structureLoading || !structurePrompt.trim()} onClick={() => void handleGenerateStructure(false)}>仅生成结构</Button><Button disabled={structureLoading || !structurePrompt.trim()} onClick={() => void handleGenerateStructure(true)}>{structureLoading ? <Loader2 className="mr-1 h-4 w-4" /> : <Sparkles className="mr-1 h-4 w-4" />}结构并生成歌词</Button></div></div></div>}
    {showOverwriteConfirm && <div className="absolute inset-0 z-[80] grid place-items-center bg-black/40 p-6"><div role="alertdialog" aria-modal="true" aria-labelledby="overwrite-title" className="w-full max-w-lg rounded-2xl border bg-background p-6 shadow-2xl"><h2 id="overwrite-title" className="font-semibold">现有歌词将被生成候选替换</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">将重新生成 {project.sections.filter((section) => !section.locked).length} 个未锁定段落；锁定段落保持不变。生成结束后先预览，确认后才写入。</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowOverwriteConfirm(false)}>取消</Button><Button onClick={() => void handleGenerate()}>继续生成</Button></div></div></div>}
    {generationCandidate && <div className="absolute inset-0 z-[85] grid place-items-center bg-black/40 p-6"><div role="dialog" aria-modal="true" aria-labelledby="candidate-title" className="flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"><div className="border-b p-5"><h2 id="candidate-title" className="font-semibold">整首歌词候选</h2><p className="mt-1 text-xs text-muted-foreground">候选不会自动覆盖项目；失败段落保留原文。</p></div><div className="min-h-0 flex-1 overflow-auto p-5"><div className="grid gap-4 md:grid-cols-2">{generationCandidate.sections.map((section) => <section key={section.id} className="rounded-lg border p-3"><h3 className="mb-2 text-xs font-semibold">{section.title}{generationCandidate.failedSections.includes(section.title) && <span className="ml-2 text-amber-600">生成失败，保留原文</span>}</h3><pre className="whitespace-pre-wrap font-sans text-xs leading-6">{section.lyrics || '（空白）'}</pre></section>)}</div></div><div className="flex justify-end gap-2 border-t p-4"><Button variant="outline" onClick={() => setGenerationCandidate(null)}>拒绝</Button><Button onClick={acceptGenerationCandidate}>应用候选</Button></div></div></div>}
    {generationCandidate && loading && <Button className="absolute bottom-[calc(8vh+16px)] left-[calc(50%-430px)] z-[90]" variant="outline" onClick={() => generationControllerRef.current?.abort()}>取消当前生成</Button>}
    {generationCandidate && !loading && <Button className="absolute bottom-[calc(8vh+16px)] left-[calc(50%-250px)] z-[90]" variant="outline" onClick={saveCandidateAsBranch}>保存为版本分支</Button>}
    {generationCandidate?.failedSections.length && !loading ? <Button className="absolute bottom-[calc(8vh+16px)] left-[calc(50%-430px)] z-[90]" variant="outline" onClick={() => void retryFailedSections()}><Sparkles className="mr-1 h-3.5 w-3.5" />仅重试失败段落（{generationCandidate.failedSections.length}）</Button> : null}
    {showToolbox && <LyricToolbox project={project} aiApi={aiApi} onPatchProject={patchProject} onPatchSection={patchSection} onClose={() => setShowToolbox(false)} />}
    {showFullLyrics && <style>{`[role="dialog"][aria-label="整首歌词"]{width:80%;height:84%;max-width:980px;max-height:860px}`}</style>}
    {showFullLyrics && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowFullLyrics(false); }}><div role="dialog" aria-modal="true" aria-label="整首歌词" className="flex h-[min(860px,calc(100%-24px))] w-[min(980px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"><div className="flex h-16 shrink-0 items-center border-b px-6"><div><h2 className="text-base font-semibold">{project.title}</h2><p className="text-[11px] text-muted-foreground">整首歌词 · {project.sections.length} 个段落 · 按 Esc 关闭</p></div><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={exportText}><Download className="mr-1 h-3.5 w-3.5" />导出</Button><Button size="sm" onClick={() => setShowFullLyrics(false)}>完成</Button></div></div><div className="min-h-0 flex-1 overflow-y-auto px-8 py-7"><div className="mx-auto max-w-3xl space-y-8">{project.sections.map((section) => <section key={section.id} className="group"><div className="mb-2 flex items-center gap-3"><button onClick={() => { setActiveId(section.id); setShowFullLyrics(false); }} className="text-sm font-semibold text-violet-600 hover:underline">[{section.title}]</button><span className="text-[10px] text-muted-foreground">{section.emotion} · {section.rhyme} · {section.syllables} 字</span></div><textarea aria-label={`${section.title} 歌词`} value={section.lyrics} rows={Math.max(3, section.lyrics.split(/\r?\n/).length)} onChange={(event) => patchSection(section.id, { lyrics: event.target.value })} className="w-full resize-none rounded-lg border bg-card px-5 py-4 font-serif text-lg leading-9 outline-none focus:border-violet-500" placeholder={`${section.title} 暂无歌词`} /></section>)}</div></div><footer className="flex h-9 shrink-0 items-center border-t px-6 text-[10px] text-muted-foreground"><Save className="mr-1.5 h-3 w-3" />弹层中的修改也会自动保存<span className="ml-auto">{project.sections.reduce((sum, section) => sum + section.lyrics.split(/\r?\n/).filter(Boolean).length, 0)} 行</span></footer></div></div>}
    {generationStage && <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-3 border-b bg-violet-500/5 px-4 py-2 text-xs"><Loader2 className={`h-3.5 w-3.5 text-violet-600 ${loading ? 'animate-spin' : ''}`} /><span className="flex-1">{generationStage}</span>{loading && <Button size="sm" variant="outline" onClick={() => generationControllerRef.current?.abort()}>取消生成</Button>}{!loading && !generationCandidate && <button className="text-muted-foreground" onClick={() => setGenerationStage('')}>关闭</button>}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(360px,1fr)_280px]">
      <aside className="flex min-h-0 flex-col border-r bg-muted/20"><div className="border-b p-3"><div className="flex items-center justify-between"><span className="text-xs font-medium">歌曲结构</span><button onClick={addSection} className="rounded p-1 hover:bg-accent" title="手动添加段落"><Plus className="h-3.5 w-3.5" /></button></div><Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => { setStructurePrompt(project.creativePrompt); setShowStructureGenerator(true); }}><Sparkles className="mr-1 h-3.5 w-3.5" />用提示词规划结构</Button></div><div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">{project.sections.length ? project.sections.map((section, index) => <div key={section.id} draggable onDragStart={() => setDraggedSectionId(section.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveSection(section.id)} className={`flex items-center gap-1 rounded-md pr-1 ${activeId === section.id ? 'bg-violet-500/15 text-violet-600' : 'hover:bg-accent'}`}><button onClick={() => { setActiveId(section.id); setEditorMode('section'); }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs"><span className="w-5 cursor-grab text-center text-[10px] text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate">{section.title}</span>{section.locked && <Pin className="h-3 w-3" />}<span className="text-[9px] uppercase text-muted-foreground">{section.rhyme}</span></button><button onClick={() => patchSection(section.id, { locked: !section.locked })} title={section.locked ? '解锁段落' : '锁定段落'} className="rounded p-1 text-muted-foreground hover:bg-accent"><Pin className="h-3 w-3" /></button><button onClick={() => duplicateSection(section)} title="复制段落" className="rounded p-1 text-muted-foreground hover:bg-accent"><Copy className="h-3 w-3" /></button></div>) : <button onClick={() => setShowStructureGenerator(true)} className="m-2 grid min-h-40 w-[calc(100%-16px)] place-items-center rounded-lg border border-dashed px-4 text-center text-xs text-muted-foreground hover:border-violet-500 hover:text-violet-600">输入提示词<br />生成歌曲结构</button>}</div><div className="border-t p-3 text-[10px] leading-4 text-muted-foreground">拖动调整顺序；锁定段落不会被整首生成覆盖。</div></aside>
      <main className="min-h-0 overflow-y-auto overflow-x-hidden p-5">{active ? <div className="w-full"><div className="sticky top-0 z-10 mb-3 flex items-center justify-between bg-background/95 py-1 backdrop-blur"><div className="flex rounded-lg border p-1"><button onClick={() => setEditorMode('section')} className={`rounded px-3 py-1 text-xs ${editorMode === 'section' ? 'bg-violet-500/15 text-violet-700' : 'text-muted-foreground'}`}>单段编辑</button><button onClick={() => { setEditorMode('song'); setShowFullLyrics(true); }} className={`rounded px-3 py-1 text-xs ${editorMode === 'song' ? 'bg-violet-500/15 text-violet-700' : 'text-muted-foreground'}`}>整首预览</button></div><Button type="button" variant="outline" size="sm" onClick={() => setShowToolbox(true)}><Sparkles className="mr-1 h-3.5 w-3.5" />工具</Button></div>
        <div className="mb-4 flex items-center gap-2"><select value={active.kind} disabled={active.locked} onChange={(e) => patchSection(active.id, { kind: e.target.value as SectionKind })} className="h-8 rounded-md border bg-background px-2 text-xs">{KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select><input value={active.title} disabled={active.locked} onChange={(e) => patchSection(active.id, { title: e.target.value })} className="h-8 flex-1 border-b bg-transparent text-lg font-semibold outline-none focus:border-violet-500 disabled:opacity-60" /><button title={active.locked ? '解锁段落' : '锁定段落'} onClick={() => patchSection(active.id, { locked: !active.locked })} className={`rounded p-2 ${active.locked ? 'bg-violet-500/15 text-violet-600' : 'text-muted-foreground hover:bg-accent'}`}><Pin className="h-4 w-4" /></button><button title="复制段落" onClick={() => duplicateSection(active)} className="rounded p-2 text-muted-foreground hover:bg-accent"><Copy className="h-4 w-4" /></button><button title="删除段落" disabled={active.locked} onClick={() => removeSection(active.id)} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
        <div className="mb-4 grid grid-cols-3 gap-3"><Field label="情绪" value={active.emotion} onChange={(value) => patchSection(active.id, { emotion: value })} /><Field label="目标韵脚" value={active.rhyme} onChange={(value) => patchSection(active.id, { rhyme: value })} /><Field label="每行字数" value={active.syllables} onChange={(value) => patchSection(active.id, { syllables: value })} /></div>
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-2"><Sparkles className="h-3.5 w-3.5 text-violet-500" /><select aria-label="AI 改写模式" value={rewriteMode} onChange={(event) => setRewriteMode(event.target.value)} className="h-7 flex-1 rounded border bg-background px-2 text-xs"><option>替换这一句</option><option>保持含义重新押韵</option><option>补写上一句</option><option>补写下一句</option><option>更有画面</option><option>更口语易唱</option><option>加强少年感</option><option>增加电影感</option><option>统一自然押韵</option><option>精简字数</option><option>加强副歌 Hook</option><option>延续意象链</option><option>调整到指定字数</option></select><Button size="sm" variant="outline" disabled={loading || !active.lyrics.trim()} onClick={() => void handleRewrite()}>{loading ? <Loader2 className="mr-1 h-3 w-3" /> : null}改写本段</Button></div>
        <textarea aria-label="歌词编辑器" value={active.lyrics} disabled={active.locked} onChange={(e) => { patchSection(active.id, { lyrics: e.target.value }); setLineCandidates([]); }} placeholder="在这里写下歌词，每行一句…" className="min-h-[360px] w-full resize-none rounded-xl border bg-card p-5 font-serif text-lg leading-9 outline-none focus:border-violet-500 disabled:opacity-60" />
        {sectionRewriteCandidate && <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium">段落改写候选 · 尚未写入</span><button onClick={() => setSectionRewriteCandidate(null)} className="text-[10px] text-muted-foreground">拒绝</button></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded border bg-background p-3"><p className="mb-2 text-[10px] text-muted-foreground">原段落</p><pre className="whitespace-pre-wrap font-sans text-xs leading-6">{active.lyrics}</pre></div><div className="rounded border border-emerald-500/30 bg-background p-3"><p className="mb-2 text-[10px] text-emerald-600">AI 候选</p><pre className="whitespace-pre-wrap font-sans text-xs leading-6">{sectionRewriteCandidate}</pre></div></div><div className="mt-3 flex justify-end"><Button size="sm" onClick={acceptSectionRewrite}>应用此候选</Button></div></div>}
        <div className="mt-3 overflow-hidden rounded-lg border"><div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><span className="mr-auto text-[11px] font-medium">字数、节奏与韵脚 · 押韵模式 {rhymePattern(active.lyrics) || '—'}</span><select aria-label="选中行改写方式" value={lineRewriteMode} onChange={(event) => setLineRewriteMode(event.target.value)} className="h-7 rounded border bg-background px-2 text-[10px]"><option>替换这一句</option><option>保持含义重新押韵</option><option>补写上一句</option><option>补写下一句</option><option>调整到指定字数</option></select><Button size="sm" variant="ghost" disabled={loading || !lineAnalysis.length} onClick={() => void handleLineRewrite()}><Sparkles className="mr-1 h-3 w-3" />改写第 {selectedLine + 1} 行</Button></div><div className="divide-y">{lineAnalysis.map((item, index) => <button key={`${item.line}-${index}`} onClick={() => { setSelectedLine(index); setLineCandidates([]); }} className={`grid w-full grid-cols-[28px_1fr_42px_52px_72px] items-center gap-2 px-3 py-2 text-left text-[10px] ${selectedLine === index ? 'bg-violet-500/10' : 'hover:bg-accent/50'}`}><span className="text-muted-foreground">{index + 1}</span><span className="truncate text-xs">{item.line}</span><span className={Math.abs(item.deviation) > 2 ? 'text-amber-600' : 'text-muted-foreground'}>{item.hanCount} 字</span><span className="font-mono text-violet-600">{item.rhyme}</span><span className="text-muted-foreground">≈ {item.durationSeconds}s</span></button>)}</div></div>
        {lineAnalysis[selectedLine] && <div className="mt-2 rounded-md bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground"><p>第 {selectedLine + 1} 行：{lineAnalysis[selectedLine].breathing} · 句长偏差 {lineAnalysis[selectedLine].deviation > 0 ? '+' : ''}{lineAnalysis[selectedLine].deviation} 字 · 声调 {lineAnalysis[selectedLine].tonePattern}</p>{lineAnalysis[selectedLine].singabilityIssues.map((issue) => <p key={issue} className="mt-1 text-amber-600">• {issue}</p>)}</div>}
        {lineCandidates.length > 0 && <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium">行级改写 Diff</span><button onClick={() => setLineCandidates([])} className="text-[10px] text-muted-foreground">全部拒绝</button></div><p className="mb-2 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"><span className="mr-2 text-[10px]">原句</span>{lineCandidates[0].original}</p><div className="space-y-2">{lineCandidates.map((candidate) => <div key={candidate.id} className="flex items-center gap-2 rounded bg-background px-2 py-1.5"><span className="min-w-0 flex-1 text-xs"><span className="mr-2 text-[10px] text-emerald-600">候选</span>{candidate.replacement}</span><button onClick={() => acceptLineCandidate(candidate)} className="rounded bg-violet-600 px-2 py-1 text-[10px] text-white">接受</button></div>)}</div></div>}
        <div className="mt-3 flex flex-wrap gap-2">{rhymeSuggestions(active.rhyme).map((word) => <button key={word} onClick={() => void navigator.clipboard.writeText(word)} title="复制同韵候选词" className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground hover:border-violet-500 hover:text-violet-600">{word}</button>)}</div>
      </div> : <div className="grid h-full place-items-center text-sm text-muted-foreground">添加一个段落开始创作</div>}</main>
      <aside className="flex min-h-0 flex-col border-l bg-muted/10"><div className="shrink-0 border-b bg-background p-3"><div className="flex rounded-lg border p-1">{([['planning', '规划'], ['project', '项目'], ['analysis', '分析']] as const).map(([id, label]) => <button key={id} onClick={() => setRightTab(id)} className={`flex-1 rounded px-2 py-1 text-[10px] ${rightTab === id ? 'bg-violet-500/15 text-violet-700' : 'text-muted-foreground'}`}>{label}</button>)}</div></div><div className="min-h-0 flex-1 overflow-y-auto p-4">
        {rightTab === 'planning' && <div className="grid gap-3"><label className="grid gap-1 text-[11px] text-muted-foreground"><span>自由创作提示词</span><textarea value={project.creativePrompt} onChange={(event) => { patchProject({ creativePrompt: event.target.value }); setStructurePrompt(event.target.value); }} className="min-h-24 resize-y rounded-md border bg-background p-2 text-xs text-foreground" placeholder="描述主题、故事、结构和希望避免的表达…" /></label><label className="grid gap-1 text-[11px] text-muted-foreground"><span>信息冲突时优先采用</span><select value={project.promptPriority} onChange={(event) => patchProject({ promptPriority: event.target.value as LyricProject['promptPriority'] })} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="prompt">自由提示词</option><option value="planning">规划卡字段</option></select></label>{project.creativePrompt.trim() && (project.theme.trim() || project.story.trim()) && <p className="rounded-md bg-amber-500/10 p-2 text-[10px] leading-4 text-amber-700">自由提示词与规划卡同时存在；生成时按上方优先级处理冲突。</p>}<Field label="主题" value={project.theme} onChange={(value) => patchProject({ theme: value })} /><Field label="风格" value={project.style} onChange={(value) => patchProject({ style: value })} /><Field label="整体情绪" value={project.emotion} onChange={(value) => patchProject({ emotion: value })} /><div className="grid grid-cols-2 gap-2"><Field label="地点" value={project.location} onChange={(value) => patchProject({ location: value })} /><Field label="时间" value={project.time} onChange={(value) => patchProject({ time: value })} /></div><Field label="故事背景" value={project.story} onChange={(value) => patchProject({ story: value })} /><Field label="核心意象（用、分隔）" value={project.coreImages.join('、')} onChange={(value) => patchProject({ coreImages: value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 7) })} /></div>}
        {rightTab === 'project' && <div className="grid gap-3"><Field label="标签（用、分隔）" value={project.tags.join('、')} onChange={(value) => patchProject({ tags: value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} /><Field label="专辑 / EP" value={project.collection} onChange={(value) => patchProject({ collection: value })} /><label className="grid gap-1 text-[11px] text-muted-foreground"><span>创作状态</span><select value={project.status} onChange={(event) => patchProject({ status: event.target.value as LyricProject['status'] })} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"><option value="idea">灵感</option><option value="draft">初稿</option><option value="revising">修改中</option><option value="done">完成</option></select></label><div className="grid grid-cols-2 gap-2"><Field label="语言" value={project.language} onChange={(value) => patchProject({ language: value })} /><Field label="BPM" type="number" value={project.bpm} onChange={(value) => patchProject({ bpm: Math.max(40, Math.min(240, Number(value) || 72)) })} /></div><label className="flex items-center justify-between text-[11px] text-muted-foreground"><span>项目封面颜色</span><input type="color" value={project.coverColor} onChange={(event) => patchProject({ coverColor: event.target.value })} className="h-7 w-12 cursor-pointer rounded border bg-transparent" /></label><div className="rounded-lg border p-3"><p className="text-[11px] font-medium">已保存提示词</p><p className="mt-1 text-[10px] text-muted-foreground">当前提示词会随项目自动保存，不再随弹层关闭丢失。</p></div></div>}
        {rightTab === 'project' && <label className="mt-4 grid gap-1 text-[11px] text-muted-foreground"><span>创作素材板</span><textarea value={project.scratchpad} onChange={(event) => patchProject({ scratchpad: event.target.value })} className="min-h-40 resize-y rounded-md border bg-background p-3 text-xs leading-6 text-foreground" placeholder="保存零散句子、标题候选、生活细节、押韵词和未采用的 AI 候选…" /><span className="text-[10px]">随项目自动保存，可作为后续生成素材。</span></label>}
        {rightTab === 'analysis' && <div><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-semibold">歌曲潜力</p><p className="text-[10px] text-muted-foreground">启发式区间，不代表客观概率</p></div><strong className="text-lg text-violet-500">{scoreBand(score.overall)}</strong></div><div className="space-y-3">{([['旋律适配', score.rhythm], ['情绪表达', score.emotion], ['Hook 强度', score.hook], ['押韵统一', score.rhyme]] as const).map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-[10px]"><span>{label}</span><span>{scoreBand(value)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(value / 10) * 10}%` }} /></div></div>)}</div><div className="mt-5 rounded-lg border bg-card p-3"><p className="mb-2 text-[11px] font-medium">编辑建议</p>{score.notes.map((note) => <p key={note} className="mb-2 text-[10px] leading-4 text-muted-foreground">• {note}</p>)}</div></div>}
      </div></aside>
    </div>{message && message !== '所有修改会自动保存在本机' && <div role="status" aria-live="polite" className="pointer-events-none absolute bottom-10 right-4 z-20 max-w-md rounded-lg border bg-popover px-3 py-2 text-[11px] text-popover-foreground shadow-lg">{message}</div>}<footer className="flex h-8 shrink-0 items-center border-t px-4 text-[10px] text-muted-foreground"><Save className="mr-1.5 h-3 w-3" />已自动保存<span className="ml-auto">{project.sections.length} 个段落 · {project.sections.reduce((sum, section) => sum + section.lyrics.split(/\r?\n/).filter(Boolean).length, 0)} 行</span></footer>
  </div>;
};
