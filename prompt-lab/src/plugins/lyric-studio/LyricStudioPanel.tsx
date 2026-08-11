import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, History, Info, Loader2, Pin, Plus, Save, Search, ShieldAlert, ShieldCheck, Sparkles, Star, Trash2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createOpenAIProvider, type ChatMessage } from '@/core/llm';
import { useStore } from '@/store/store';
import { analyzeLines, detectRhyme, gateQuality, projectToText, rhymePattern, rhymeSuggestions, scoreProject, type QualityIssue } from './analysis';
import { ACTIVE_PROJECT_KEY, duplicateProject, matchesProject, persistProjects, readProjects } from './project-store';
import { analyzeAudioFile, buildSunoPrompt, copySunoPrompt } from './music-tools';
import { LYRIC_SYSTEM_PROMPT } from './prompt';
import { LyricToolbox } from './LyricToolbox';
import type { AudioAnalysis, LineRewriteCandidate, LyricProject, LyricRevision, LyricSection, SectionKind } from './types';

const STORAGE_KEY = 'nwd:lyric-studio:project';
const HISTORY_KEY = 'nwd:lyric-studio:history';
const KINDS: SectionKind[] = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];
const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  Intro: '前奏（Intro）',
  Verse: '主歌（Verse）',
  'Pre-Chorus': '预副歌（Pre-Chorus）',
  Chorus: '副歌（Chorus）',
  Bridge: '桥段（Bridge）',
  Outro: '尾声（Outro）',
};

const MUSIC_STYLE_GROUPS = [
  { label: '流行 Pop', styles: [
    ['华语流行', '华语流行（Mandopop）'], ['粤语流行', '粤语流行（Cantopop）'], ['流行', '流行（Pop）'],
    ['流行摇滚', '流行摇滚（Pop Rock）'], ['流行舞曲', '流行舞曲（Dance Pop）'], ['独立流行', '独立流行（Indie Pop）'],
    ['合成器流行', '合成器流行（Synth-pop）'], ['梦幻流行', '梦幻流行（Dream Pop）'], ['城市流行', '城市流行（City Pop）'],
    ['艺术流行', '艺术流行（Art Pop）'], ['卧室流行', '卧室流行（Bedroom Pop）'], ['青少年流行', '青少年流行（Teen Pop）'],
    ['韩国流行', '韩国流行（K-Pop）'], ['日本流行', '日本流行（J-Pop）'], ['拉丁流行', '拉丁流行（Latin Pop）'],
  ] },
  { label: '摇滚与金属 Rock & Metal', styles: [
    ['摇滚', '摇滚（Rock）'], ['经典摇滚', '经典摇滚（Classic Rock）'], ['独立摇滚', '独立摇滚（Indie Rock）'],
    ['另类摇滚', '另类摇滚（Alternative Rock）'], ['民谣摇滚', '民谣摇滚（Folk Rock）'], ['软摇滚', '软摇滚（Soft Rock）'],
    ['硬摇滚', '硬摇滚（Hard Rock）'], ['华丽摇滚', '华丽摇滚（Glam Rock）'], ['迷幻摇滚', '迷幻摇滚（Psychedelic Rock）'],
    ['前卫摇滚', '前卫摇滚（Progressive Rock）'], ['后摇滚', '后摇滚（Post-Rock）'], ['冲浪摇滚', '冲浪摇滚（Surf Rock）'],
    ['车库摇滚', '车库摇滚（Garage Rock）'], ['朋克', '朋克（Punk）'], ['流行朋克', '流行朋克（Pop Punk）'],
    ['后朋克', '后朋克（Post-Punk）'], ['情绪摇滚', '情绪摇滚（Emo）'], ['新金属', '新金属（Nu Metal）'],
    ['重金属', '重金属（Heavy Metal）'], ['另类金属', '另类金属（Alternative Metal）'], ['金属核', '金属核（Metalcore）'],
  ] },
  { label: '民谣与乡村 Folk & Country', styles: [
    ['民谣', '民谣（Folk）'], ['独立民谣', '独立民谣（Indie Folk）'], ['当代民谣', '当代民谣（Contemporary Folk）'],
    ['民谣流行', '民谣流行（Folk Pop）'], ['唱作人', '唱作人（Singer-Songwriter）'], ['乡村', '乡村（Country）'],
    ['乡村流行', '乡村流行（Country Pop）'], ['另类乡村', '另类乡村（Alt-Country）'], ['蓝草', '蓝草（Bluegrass）'],
    ['美式根源', '美式根源（Americana）'], ['凯尔特民谣', '凯尔特民谣（Celtic Folk）'],
  ] },
  { label: '节奏蓝调与灵魂 R&B & Soul', styles: [
    ['节奏蓝调', '节奏蓝调（R&B）'], ['当代节奏蓝调', '当代节奏蓝调（Contemporary R&B）'], ['另类节奏蓝调', '另类节奏蓝调（Alternative R&B）'],
    ['灵魂乐', '灵魂乐（Soul）'], ['新灵魂乐', '新灵魂乐（Neo Soul）'], ['放克', '放克（Funk）'],
    ['迪斯科', '迪斯科（Disco）'], ['福音', '福音（Gospel）'], ['摩城', '摩城（Motown）'],
  ] },
  { label: '说唱与都市 Hip-Hop & Urban', styles: [
    ['嘻哈', '嘻哈（Hip-Hop）'], ['说唱', '说唱（Rap）'], ['流行说唱', '流行说唱（Pop Rap）'],
    ['陷阱说唱', '陷阱说唱（Trap）'], ['爵士说唱', '爵士说唱（Jazz Rap）'], ['意识说唱', '意识说唱（Conscious Hip-Hop）'],
    ['老派嘻哈', '老派嘻哈（Old School Hip-Hop）'], ['另类嘻哈', '另类嘻哈（Alternative Hip-Hop）'], ['低保真嘻哈', '低保真嘻哈（Lo-fi Hip-Hop）'],
    ['鼓打贝斯说唱', '鼓打贝斯说唱（Grime）'], ['雷鬼说唱', '雷鬼说唱（Reggaeton）'],
  ] },
  { label: '电子 Electronic', styles: [
    ['电子', '电子（Electronic）'], ['电子舞曲', '电子舞曲（EDM）'], ['浩室', '浩室（House）'],
    ['深浩室', '深浩室（Deep House）'], ['未来贝斯', '未来贝斯（Future Bass）'], ['科技舞曲', '科技舞曲（Techno）'],
    ['迷幻舞曲', '迷幻舞曲（Trance）'], ['回响贝斯', '回响贝斯（Dubstep）'], ['鼓打贝斯', '鼓打贝斯（Drum & Bass）'],
    ['车库舞曲', '车库舞曲（UK Garage）'], ['电音流行', '电音流行（Electropop）'], ['合成器浪潮', '合成器浪潮（Synthwave）'],
    ['蒸汽波', '蒸汽波（Vaporwave）'], ['寒潮', '寒潮（Chillwave）'], ['低保真', '低保真（Lo-fi）'],
    ['氛围电子', '氛围电子（Ambient Electronic）'], ['实验电子', '实验电子（Experimental Electronic）'], ['工业', '工业（Industrial）'],
  ] },
  { label: '爵士与蓝调 Jazz & Blues', styles: [
    ['爵士', '爵士（Jazz）'], ['流行爵士', '流行爵士（Jazz Pop）'], ['顺滑爵士', '顺滑爵士（Smooth Jazz）'],
    ['融合爵士', '融合爵士（Jazz Fusion）'], ['波萨诺瓦', '波萨诺瓦（Bossa Nova）'], ['摇摆乐', '摇摆乐（Swing）'],
    ['蓝调', '蓝调（Blues）'], ['节奏布鲁斯', '节奏布鲁斯（Rhythm & Blues）'], ['布鲁斯摇滚', '布鲁斯摇滚（Blues Rock）'],
  ] },
  { label: '古典与器乐 Classical & Instrumental', styles: [
    ['古典', '古典（Classical）'], ['新古典', '新古典（Neoclassical）'], ['现代古典', '现代古典（Contemporary Classical）'],
    ['极简主义', '极简主义（Minimalism）'], ['钢琴独奏', '钢琴独奏（Solo Piano）'], ['原声器乐', '原声器乐（Acoustic Instrumental）'],
    ['管弦乐', '管弦乐（Orchestral）'], ['室内乐', '室内乐（Chamber Music）'], ['交响乐', '交响乐（Symphonic）'],
  ] },
  { label: '中国与世界音乐 Chinese & World', styles: [
    ['国风', '国风（Chinese Style）'], ['古风', '古风（Ancient Chinese Style）'], ['中国民乐', '中国民乐（Chinese Traditional）'],
    ['民族流行', '民族流行（Ethnic Pop）'], ['世界音乐', '世界音乐（World Music）'], ['雷鬼', '雷鬼（Reggae）'],
    ['斯卡', '斯卡（Ska）'], ['非洲节拍', '非洲节拍（Afrobeats）'], ['拉丁', '拉丁（Latin）'],
    ['桑巴', '桑巴（Samba）'], ['弗拉门戈', '弗拉门戈（Flamenco）'], ['印度流行', '印度流行（Indian Pop）'],
  ] },
  { label: '氛围与功能音乐 Mood & Functional', styles: [
    ['抒情', '抒情（Ballad）'], ['情歌', '情歌（Love Song）'], ['氛围', '氛围（Ambient）'],
    ['新世纪', '新世纪（New Age）'], ['影视原声', '影视原声（Soundtrack）'], ['电影配乐', '电影配乐（Cinematic）'],
    ['史诗音乐', '史诗音乐（Epic Music）'], ['游戏音乐', '游戏音乐（Game Music）'], ['音乐剧', '音乐剧（Musical Theatre）'],
    ['儿歌', '儿歌（Children’s Music）'], ['治愈系', '治愈系（Healing）'], ['冥想音乐', '冥想音乐（Meditation）'],
    ['实验音乐', '实验音乐（Experimental）'], ['无伴奏人声', '无伴奏人声（A Cappella）'],
  ] },
] as const;

const MUSIC_STYLE_VALUES: ReadonlySet<string> = new Set<string>(MUSIC_STYLE_GROUPS.flatMap((group) => group.styles.map(([value]) => value)));

const bilingualSectionTitle = (section: LyricSection): string => {
  const suffix = section.title.toLowerCase().startsWith(section.kind.toLowerCase())
    ? section.title.slice(section.kind.length).trim()
    : '';
  return suffix ? `${SECTION_KIND_LABELS[section.kind]} ${suffix}` : SECTION_KIND_LABELS[section.kind];
};

const audioStructureGuidance = (audio: AudioAnalysis): string => {
  const sections = audio.segments.map((segment, index) => {
    const kind = segment.kind === 'Unknown' ? '待判断' : SECTION_KIND_LABELS[segment.kind];
    return `${index + 1}. ${kind}，${segment.start.toFixed(1)}-${segment.end.toFixed(1)} 秒，约 ${segment.bars} 小节，${segment.emotion}`;
  }).join('\n');
  return `参考音频结构约束（只参考结构、时长和情绪走势，不模仿旋律或原歌词）：\n文件：${audio.name}\n时长：${audio.duration.toFixed(1)} 秒\n估算 BPM：${audio.bpm}\n估算调性：${audio.key}\n候选段落：\n${sections}`;
};
const initialProject: LyricProject = { id: 'summer-love', title: '未命名歌曲', theme: '', style: '华语流行', emotion: '', language: '中文', bpm: 72, location: '', time: '', story: '', coreImages: [], tags: [], favorite: false, collection: '单曲', status: 'idea', coverColor: '#7c3aed', creativePrompt: '', promptHistory: [], promptPriority: 'prompt', scratchpad: '', beatMarks: {}, favoriteLines: [], sections: [], updatedAt: Date.now() };

function normalizeProject(saved: Partial<LyricProject>): LyricProject {
  return { ...initialProject, ...saved, coreImages: Array.isArray(saved.coreImages) ? saved.coreImages : initialProject.coreImages, tags: Array.isArray(saved.tags) ? saved.tags : [], promptHistory: Array.isArray(saved.promptHistory) ? saved.promptHistory : [], beatMarks: saved.beatMarks && typeof saved.beatMarks === 'object' ? saved.beatMarks : {}, favoriteLines: Array.isArray(saved.favoriteLines) ? saved.favoriteLines : [], sections: Array.isArray(saved.sections) ? saved.sections : initialProject.sections };
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

async function generateSongStructure(apiKey: string, baseUrl: string, model: string, prompt: string): Promise<{ title: string; sections: LyricSection[] }> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [{ role: 'system', content: '你是歌曲结构策划师。根据用户的创作构想拟定一个简洁、原创、贴合主题的中文歌名，并规划歌曲段落。只输出合法 JSON：{"title":"歌曲名","sections":[{"kind":"Verse","title":"Verse 1","emotion":"克制","rhyme":"ing","syllables":"8-10"}]}。title 不要带书名号；kind 只能是 Intro、Verse、Pre-Chorus、Chorus、Bridge、Outro。不要生成任何歌词，不要输出 Markdown。' }, { role: 'user', content: prompt }];
  let raw = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.55, maxTokens: 1_000, stream: true })) raw += chunk.delta ?? '';
  const parsed = extractJson(raw) as { title?: string; sections?: Array<Partial<LyricSection>> };
  if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error('AI 没有返回有效的歌曲结构');
  const title = String(parsed.title || '').replace(/^[《“"]|[》”"]$/g, '').trim();
  const sections = parsed.sections.slice(0, 16).map((section, index) => ({ id: crypto.randomUUID(), kind: KINDS.includes(section.kind as SectionKind) ? section.kind as SectionKind : 'Verse', title: String(section.title || `${section.kind || 'Verse'} ${index + 1}`), lyrics: '', emotion: String(section.emotion || '待定'), rhyme: String(section.rhyme || '自由'), syllables: String(section.syllables || '8-10'), locked: false, collapsed: false }));
  return { title, sections };
}

async function optimizeCreativePrompt(apiKey: string, baseUrl: string, model: string, prompt: string): Promise<string> {
  const provider = createOpenAIProvider({ apiKey, baseUrl });
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是华语歌曲创作策划助手。请把用户的零散构想整理成清晰、可直接用于规划歌曲结构和创作歌词的提示词。保留用户原意与明确限制，不虚构歌手、作品或用户没有要求的情节；可以补足结构、情绪推进、叙事视角、核心意象和演唱表达等创作维度。使用简洁自然的中文，只输出优化后的提示词正文，不要标题、解释、Markdown 或引号。' },
    { role: 'user', content: prompt },
  ];
  let optimized = '';
  for await (const chunk of provider.chat(messages, { model, temperature: 0.48, maxTokens: 900, stream: true })) optimized += chunk.delta ?? '';
  if (!optimized.trim()) throw new Error('AI 没有返回优化后的提示词');
  return optimized.trim();
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
  const [promptOptimizing, setPromptOptimizing] = useState(false);
  const [referenceAudio, setReferenceAudio] = useState<AudioAnalysis | null>(null);
  const [referenceAudioLoading, setReferenceAudioLoading] = useState(false);
  const [referenceAudioError, setReferenceAudioError] = useState('');
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
  const projectHistory = useMemo(() => history.filter((revision) => revision.project.id === project.id), [history, project.id]);
  const candidateQuality = useMemo(() => generationCandidate ? gateQuality(generationCandidate.sections, project.bpm) : null, [generationCandidate, project.bpm]);
  const candidateIssuesByLine = useMemo(() => {
    const map = new Map<string, QualityIssue[]>();
    candidateQuality?.issues.forEach((issue) => {
      const key = `${issue.sectionId}:${issue.lineIndex}`;
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    });
    return map;
  }, [candidateQuality]);
  const copyCandidateSunoPrompt = useCallback(async () => {
    if (!generationCandidate) return;
    const candidate = { ...project, ...generationCandidate.plan, sections: generationCandidate.sections };
    const ok = await copySunoPrompt(candidate);
    setMessage(ok ? 'Suno 风格 prompt 已复制到剪贴板' : '浏览器不允许写入剪贴板，已下载为 txt');
  }, [generationCandidate, project]);

  useEffect(() => { const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() })), 250); return () => window.clearTimeout(timer); }, [project]);
  useEffect(() => { const timer = window.setTimeout(() => setProjects((current) => { const nextProject = { ...project, updatedAt: Date.now() }; const exists = current.some((item) => item.id === project.id); const next = exists ? current.map((item) => item.id === project.id ? nextProject : item) : [nextProject, ...current]; persistProjects(next); localStorage.setItem(ACTIVE_PROJECT_KEY, project.id); return next; }), 300); return () => window.clearTimeout(timer); }, [project]);
  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20))); }, [history]);
  useEffect(() => {
    const closeTopLayer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || loading || structureLoading || promptOptimizing || referenceAudioLoading) return;
      if (generationCandidate) setGenerationCandidate(null);
      else if (showOverwriteConfirm) setShowOverwriteConfirm(false);
      else if (showStructureGenerator) setShowStructureGenerator(false);
    };
    window.addEventListener('keydown', closeTopLayer);
    return () => window.removeEventListener('keydown', closeTopLayer);
  }, [generationCandidate, loading, promptOptimizing, referenceAudioLoading, showOverwriteConfirm, showStructureGenerator, structureLoading]);
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
  const openGeneratedSong = (patch: Partial<LyricProject>) => {
    if (!project.sections.length) { patchProject(patch); return; }
    const next = normalizeProject({ ...project, ...patch, id: crypto.randomUUID(), favorite: false, updatedAt: Date.now() });
    setProjects((current) => [next, ...current]);
    selectProject(next);
  };
  const copyProject = () => { const next = duplicateProject(project); setProjects((current) => [next, ...current]); selectProject(next); };
  const deleteProject = () => { if (projects.length <= 1) { setMessage('至少需要保留一个歌曲项目'); return; } if (!window.confirm(`确定删除《${project.title}》吗？此操作无法从版本历史恢复。`)) return; const remaining = projects.filter((item) => item.id !== project.id); persistProjects(remaining); setProjects(remaining); selectProject(remaining[0]); };
  const handleOptimizePrompt = async () => {
    const prompt = structurePrompt.trim();
    if (!prompt) { setMessage('请先输入创作提示词'); return; }
    if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务'); return; }
    setPromptOptimizing(true);
    try {
      const optimized = await optimizeCreativePrompt(aiApi.apiKey, aiApi.baseUrl, aiApi.model, prompt);
      setStructurePrompt(optimized);
      patchProject({ creativePrompt: optimized, promptHistory: [{ id: crypto.randomUUID(), content: prompt, createdAt: Date.now(), model: aiApi.model }, ...project.promptHistory].slice(0, 20) });
      setMessage('提示词已优化，你仍可以继续编辑后再生成');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setPromptOptimizing(false);
    }
  };
  const handleReferenceAudio = async (file?: File) => {
    if (!file) return;
    setReferenceAudioLoading(true); setReferenceAudioError('');
    try {
      const { analysis } = await analyzeAudioFile(file);
      setReferenceAudio(analysis);
      patchProject({ bpm: analysis.bpm });
      setMessage(`已在本机分析参考音频：${analysis.segments.length} 个候选段落`);
    } catch (error) {
      setReferenceAudio(null);
      setReferenceAudioError(error instanceof Error ? error.message : '音频分析失败');
    } finally {
      setReferenceAudioLoading(false);
    }
  };
  const handleGenerateStructure = async (continueWithLyrics = false) => { if (!structurePrompt.trim() && !referenceAudio) { setMessage('请输入创作提示或上传参考音频'); return; } if (!aiApi.apiKey || !aiApi.baseUrl || !aiApi.model) { setMessage('请先在设置中配置 AI 服务'); return; } setStructureLoading(true); try { const effectivePrompt = [structurePrompt.trim() || '请根据参考音频规划一首原创歌曲', referenceAudio ? audioStructureGuidance(referenceAudio) : ''].filter(Boolean).join('\n\n'); const generatedStructure = await generateSongStructure(aiApi.apiKey, aiApi.baseUrl, aiApi.model, effectivePrompt); const { sections } = generatedStructure; const generatedTitle = generatedStructure.title || project.title; saveRevision('生成歌曲结构前'); if (!continueWithLyrics) { openGeneratedSong({ title: generatedTitle, bpm: referenceAudio?.bpm ?? project.bpm, sections }); setActiveId(sections[0]?.id ?? ''); setShowStructureGenerator(false); setMessage(`已创建《${generatedTitle}》的 ${sections.length} 个空白段落；原歌曲已保留在历史中`); return; } setMessage(`结构生成成功，正在为《${generatedTitle}》的 ${sections.length} 个段落填写歌词…`); const nextProject = { ...project, title: generatedTitle, bpm: referenceAudio?.bpm ?? project.bpm, sections }; const controller = new AbortController(); const result = await withRequestTimeout(generateLyrics(aiApi.apiKey, aiApi.baseUrl, aiApi.model, nextProject, controller.signal, (stage) => setMessage(stage)), controller); const filledSections = sections.map((section, index) => { const generated = result.sections.find((item) => item.title.trim().toLowerCase() === section.title.trim().toLowerCase()) ?? result.sections[index]; return generated ? { ...section, lyrics: generated.lyrics, emotion: generated.emotion || section.emotion, rhyme: generated.rhyme || section.rhyme, syllables: generated.syllables || section.syllables } : section; }); openGeneratedSong({ ...result.plan, title: generatedTitle, bpm: referenceAudio?.bpm ?? project.bpm, sections: filledSections }); setActiveId(filledSections[0]?.id ?? ''); setShowStructureGenerator(false); setMessage(`《${generatedTitle}》生成成功；原歌曲已保留，可从历史中查看`); } catch (error) { setMessage(error instanceof Error ? error.message : '生成失败'); } finally { setStructureLoading(false); } };

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
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><button onClick={() => setShowProjects((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm" style={{ backgroundColor: project.coverColor }} title="歌曲项目"><span className="text-xs font-bold">{project.title.slice(0, 1) || '歌'}</span></button><div className="min-w-0"><input aria-label="歌曲名称" title="点击修改歌曲名称" value={project.title} onChange={(e) => patchProject({ title: e.target.value })} className="w-full rounded border border-transparent bg-transparent px-1 text-sm font-semibold outline-none hover:border-border focus:border-violet-500" /><p className="px-1 text-[11px] text-muted-foreground">{project.collection || '单曲'} · Lyric Studio</p></div><button onClick={() => patchProject({ favorite: !project.favorite })} className={`rounded p-1.5 ${project.favorite ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`} title="收藏"><Star className="h-4 w-4" /></button><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowHistory((value) => !value)}><History className="mr-1 h-3.5 w-3.5" />历史 {projects.length}</Button><Button variant="outline" size="sm" onClick={exportText}><Download className="mr-1 h-3.5 w-3.5" />导出</Button><Button size="sm" disabled={loading} onClick={() => void handleGenerate()}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}生成整首</Button></div></header>
    {showProjects && <div className="absolute left-3 top-14 z-30 w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"><div className="flex gap-1"><div className="relative flex-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><input autoFocus value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="搜索歌名、标签、专辑…" className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none" /></div><button onClick={createProject} className="rounded-md border px-2 text-xs hover:bg-accent" title="新建歌曲"><Plus className="h-3.5 w-3.5" /></button></div><div className="mt-2 max-h-72 overflow-auto">{visibleProjects.map((item) => <button key={item.id} onClick={() => selectProject(item)} className={`flex w-full items-center gap-2 rounded-md p-2 text-left ${item.id === project.id ? 'bg-accent' : 'hover:bg-accent/60'}`}><span className="grid h-8 w-8 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: item.coverColor }}>{item.title.slice(0, 1) || '歌'}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-xs font-medium">{item.title}{item.favorite && <Star className="h-3 w-3 text-amber-500" />}</span><span className="block truncate text-[10px] text-muted-foreground">{item.collection} · {item.tags.join(' / ') || '无标签'}</span></span><span className="text-[9px] text-muted-foreground">{{ idea: '灵感', draft: '初稿', revising: '修改中', done: '完成' }[item.status]}</span></button>)}</div><div className="mt-2 flex gap-1 border-t pt-2"><Button variant="outline" size="sm" className="flex-1" onClick={copyProject}><Copy className="mr-1 h-3 w-3" />复制当前</Button><Button variant="outline" size="sm" className="flex-1 text-destructive" onClick={deleteProject}><Trash2 className="mr-1 h-3 w-3" />删除当前</Button></div></div>}
    {showHistory && <div className="absolute right-4 top-14 z-30 w-96 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"><div className="flex items-center justify-between px-2 py-1"><strong className="text-xs">歌曲历史</strong><button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setShowHistory(false)}>关闭</button></div><div className="max-h-56 overflow-auto">{[...projects].sort((a, b) => b.updatedAt - a.updatedAt).map((item) => <button key={item.id} onClick={() => { selectProject(item); setShowHistory(false); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${item.id === project.id ? 'bg-accent' : 'hover:bg-accent/60'}`}><span className="grid h-7 w-7 shrink-0 place-items-center rounded text-[10px] font-bold text-white" style={{ backgroundColor: item.coverColor }}>{item.title.slice(0, 1) || '歌'}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.title || '未命名歌曲'}</span><span className="block text-[10px] text-muted-foreground">{new Date(item.updatedAt).toLocaleString()} · {item.sections.length} 个段落</span></span>{item.id === project.id && <span className="text-[10px] text-violet-600">当前</span>}</button>)}</div><div className="mt-2 border-t px-2 pt-2"><strong className="text-[11px]">当前歌曲的版本记录</strong><div className="mt-1 max-h-40 overflow-auto">{projectHistory.length ? projectHistory.map((revision) => <button key={revision.id} onClick={() => restoreRevision(revision)} className="flex w-full items-center justify-between rounded-md px-1 py-2 text-left hover:bg-accent"><span className="truncate text-[11px]">{revision.label}</span><span className="ml-2 shrink-0 text-[9px] text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</span></button>) : <p className="py-3 text-center text-[10px] text-muted-foreground">生成或改写后会自动留下版本</p>}</div></div></div>}
    {showStructureGenerator && <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !structureLoading && !promptOptimizing && !referenceAudioLoading) setShowStructureGenerator(false); }}><div role="dialog" aria-modal="true" aria-label="AI 生成歌曲结构" className="max-h-[90%] w-full max-w-3xl overflow-y-auto rounded-2xl border bg-background p-6 shadow-2xl"><h2 className="text-base font-semibold">从创作提示开始</h2><p className="mt-1 text-xs text-muted-foreground">描述主题、风格、情绪和故事，也可以上传参考音频约束歌曲结构。</p><textarea autoFocus value={structurePrompt} disabled={promptOptimizing} onChange={(event) => setStructurePrompt(event.target.value)} placeholder="例如：一首三分钟的华语流行情歌。写少年在夏末车站告别，主歌克制，副歌出现两次，Bridge 时间跳跃，结尾留白。不要模仿或复用任何已有歌词。" className="mt-4 min-h-32 w-full resize-y rounded-xl border bg-card p-4 text-sm leading-6 outline-none focus:border-violet-500 disabled:opacity-60" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">AI 会保留原意，补全结构、情绪推进与创作约束。</span><Button variant="outline" size="sm" disabled={structureLoading || promptOptimizing || !structurePrompt.trim()} onClick={() => void handleOptimizePrompt()}>{promptOptimizing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}{promptOptimizing ? '优化中…' : 'AI 优化'}</Button></div><section className="mt-4 rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><h3 className="text-xs font-semibold">参考音频（可选）</h3><p className="mt-1 text-[10px] text-muted-foreground">音频仅在本机解码；AI 只接收结构特征摘要，不接收原始音频。</p></div><label className={`cursor-pointer rounded-md border bg-background px-3 py-2 text-xs hover:bg-accent ${referenceAudioLoading ? 'pointer-events-none opacity-60' : ''}`}>{referenceAudioLoading ? '正在分析…' : referenceAudio ? '更换音频' : '选择 MP3 / WAV / FLAC'}<input type="file" className="sr-only" accept="audio/mp3,audio/wav,audio/mpeg,audio/x-wav,audio/flac" disabled={referenceAudioLoading || structureLoading} onChange={(event) => void handleReferenceAudio(event.target.files?.[0])} /></label>{referenceAudio && <button type="button" onClick={() => { setReferenceAudio(null); setReferenceAudioError(''); }} className="text-[10px] text-muted-foreground hover:text-destructive">移除</button>}</div>{referenceAudioLoading && <div className="mt-3 flex items-center gap-2 text-xs text-violet-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在提取节拍、能量、音色和候选段落…</div>}{referenceAudioError && <p className="mt-3 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">{referenceAudioError}</p>}{referenceAudio && <div className="mt-3"><div className="flex flex-wrap gap-2 text-[10px]"><span className="rounded-full bg-background px-2 py-1">{referenceAudio.name}</span><span className="rounded-full bg-background px-2 py-1">{referenceAudio.duration.toFixed(1)} 秒</span><span className="rounded-full bg-background px-2 py-1">约 {referenceAudio.bpm} BPM</span><span className="rounded-full bg-background px-2 py-1">{referenceAudio.key}</span><span className="rounded-full bg-background px-2 py-1">{referenceAudio.segments.length} 个候选段落</span></div><div className="mt-3 flex flex-wrap items-center gap-1.5">{referenceAudio.segments.map((segment, index) => <React.Fragment key={segment.id}><span className="rounded border bg-background px-2 py-1 text-[10px]">{segment.kind === 'Unknown' ? `候选段 ${index + 1}` : SECTION_KIND_LABELS[segment.kind]}</span>{index < referenceAudio.segments.length - 1 && <span className="text-[10px] text-muted-foreground">→</span>}</React.Fragment>)}</div><p className="mt-2 text-[10px] text-muted-foreground">文字决定主题与故事；参考音频约束段落顺序、时长、BPM 和情绪走势。</p></div>}</section><div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">“仅生成结构”会创建空白段落；“结构并生成歌词”会自动完成第二步。两种方式都可以继续手动调整。</div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={structureLoading || promptOptimizing || referenceAudioLoading} onClick={() => setShowStructureGenerator(false)}>取消</Button><Button variant="outline" disabled={structureLoading || promptOptimizing || referenceAudioLoading || (!structurePrompt.trim() && !referenceAudio)} onClick={() => void handleGenerateStructure(false)}>仅生成结构</Button><Button disabled={structureLoading || promptOptimizing || referenceAudioLoading || (!structurePrompt.trim() && !referenceAudio)} onClick={() => void handleGenerateStructure(true)}>{structureLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}结构并生成歌词</Button></div></div></div>}
    {showOverwriteConfirm && <div className="absolute inset-0 z-[80] grid place-items-center bg-black/40 p-6"><div role="alertdialog" aria-modal="true" aria-labelledby="overwrite-title" className="w-full max-w-lg rounded-2xl border bg-background p-6 shadow-2xl"><h2 id="overwrite-title" className="font-semibold">现有歌词将被生成候选替换</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">将重新生成 {project.sections.filter((section) => !section.locked).length} 个未锁定段落；锁定段落保持不变。生成结束后先预览，确认后才写入。</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowOverwriteConfirm(false)}>取消</Button><Button onClick={() => void handleGenerate()}>继续生成</Button></div></div></div>}
    {generationCandidate && (() => {
      const candidateSections = generationCandidate.sections;
      const failedSet = new Set(generationCandidate.failedSections);
      const sectionLineIndex = (section: LyricSection) => {
        let count = -1;
        return section.lyrics.split(/\r?\n/).map((line) => { if (line.trim()) count += 1; return count; });
      };
      const qualityBadge = (value: number) => value >= 85 ? 'bg-emerald-500/15 text-emerald-700' : value >= 70 ? 'bg-violet-500/15 text-violet-700' : value >= 55 ? 'bg-amber-500/15 text-amber-700' : 'bg-rose-500/15 text-rose-700';
      return <div className="absolute inset-0 z-[85] grid place-items-center bg-black/40 p-6"><div role="dialog" aria-modal="true" aria-labelledby="candidate-title" className="flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"><div className="border-b p-5"><div className="flex flex-wrap items-start gap-3"><h2 id="candidate-title" className="font-semibold">整首歌词候选</h2>{candidateQuality && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${qualityBadge(candidateQuality.overall)}`} title="综合质量分">综合 {candidateQuality.overall}</span>}{candidateQuality && candidateQuality.flaggedLines > 0 && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-700">{candidateQuality.flaggedLines} 行需要打磨</span>}<span className="ml-auto text-[10px] text-muted-foreground">候选不会自动覆盖项目；失败段落保留原文。</span></div>{candidateQuality && <ul className="mt-3 space-y-1">{candidateQuality.summary.map((note, index) => <li key={index} className="flex items-start gap-2 text-[11px] text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" />{note}</li>)}{candidateQuality.issues.some((issue) => issue.severity === 'critical') && <li className="flex items-start gap-2 text-[11px] text-rose-700"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />检测到关键问题，建议重试或人工修改后再写入。</li>}</ul>}</div><div className="min-h-0 flex-1 overflow-auto p-5"><div className="grid gap-4 md:grid-cols-2">{candidateSections.map((section) => {
        const lineIndices = sectionLineIndex(section);
        const lines = section.lyrics.split(/\r?\n/);
        return <section key={section.id} className="rounded-lg border p-3"><h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">{section.title}{failedSet.has(section.title) && <span className="text-amber-600">生成失败，保留原文</span>}</h3><div className="space-y-1.5 font-sans text-xs leading-6">{lines.length === 0 || (lines.length === 1 && !lines[0].trim()) ? <p className="text-muted-foreground">（空白）</p> : lines.map((rawLine, lineIdx) => {
          const idx = lineIndices[lineIdx];
          if (idx < 0) return <p key={lineIdx} className="h-4" />;
          const issues = candidateIssuesByLine.get(`${section.id}:${idx}`) ?? [];
          const hasCritical = issues.some((issue) => issue.severity === 'critical');
          const hasWarning = issues.some((issue) => issue.severity === 'warning');
          const dotClass = hasCritical ? 'bg-rose-500' : hasWarning ? 'bg-amber-500' : 'bg-emerald-500';
          const issueTitle = issues.map((issue) => `[${issue.category}] ${issue.message}`).join('\n');
          return <p key={lineIdx} className={hasCritical ? 'rounded bg-rose-500/10 px-1.5' : hasWarning ? 'rounded bg-amber-500/5 px-1.5' : ''}><span title={issueTitle || '无问题'} className={`mr-2 inline-block h-2 w-2 translate-y-[-1px] rounded-full align-middle ${dotClass}`} />{rawLine || ' '}</p>;
        })}</div></section>;
      })}</div></div><div className="flex flex-wrap items-center justify-end gap-2 border-t p-4"><span className="mr-auto text-[10px] text-muted-foreground">buildSunoPrompt 已根据候选段落生成；点击复制会按当前项目元数据 + 歌词结构拼装。</span><Button variant="outline" onClick={() => void copyCandidateSunoPrompt()}><Copy className="mr-1 h-3.5 w-3.5" />复制 Suno 风格 prompt</Button><Button variant="outline" onClick={() => setGenerationCandidate(null)}>拒绝</Button><Button onClick={acceptGenerationCandidate}>{candidateQuality && candidateQuality.flaggedLines > 0 && <ShieldCheck className="mr-1 h-3.5 w-3.5" />}应用候选</Button></div></div></div>;
    })()}
    {generationCandidate && loading && <Button className="absolute bottom-[calc(8vh+16px)] left-[calc(50%-430px)] z-[90]" variant="outline" onClick={() => generationControllerRef.current?.abort()}>取消当前生成</Button>}
    {generationCandidate && !loading && <Button className="absolute bottom-[calc(8vh+16px)] left-[calc(50%-250px)] z-[90]" variant="outline" onClick={saveCandidateAsBranch}>保存为版本分支</Button>}
    {generationCandidate?.failedSections.length && !loading ? <Button className="absolute bottom-[calc(8vh+16px)] left-[calc(50%-430px)] z-[90]" variant="outline" onClick={() => void retryFailedSections()}><Sparkles className="mr-1 h-3.5 w-3.5" />仅重试失败段落（{generationCandidate.failedSections.length}）</Button> : null}
    {showToolbox && <LyricToolbox project={project} aiApi={aiApi} onPatchProject={patchProject} onPatchSection={patchSection} onSelectSection={(id) => { setActiveId(id); setEditorMode('section'); }} onClose={() => setShowToolbox(false)} />}
    {showFullLyrics && <style>{`[role="dialog"][aria-label="整首歌词"]{width:80%;height:84%;max-width:980px;max-height:860px}`}</style>}
    {showFullLyrics && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowFullLyrics(false); }}><div role="dialog" aria-modal="true" aria-label="整首歌词" className="flex h-[min(860px,calc(100%-24px))] w-[min(980px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"><div className="flex h-16 shrink-0 items-center border-b px-6"><div><h2 className="text-base font-semibold">{project.title}</h2><p className="text-[11px] text-muted-foreground">整首歌词 · {project.sections.length} 个段落 · 按 Esc 关闭</p></div><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={exportText}><Download className="mr-1 h-3.5 w-3.5" />导出</Button><Button size="sm" onClick={() => setShowFullLyrics(false)}>完成</Button></div></div><div className="min-h-0 flex-1 overflow-y-auto px-8 py-7"><div className="mx-auto max-w-3xl space-y-8">{project.sections.map((section) => <section key={section.id} className="group"><div className="mb-2 flex items-center gap-3"><button onClick={() => { setActiveId(section.id); setShowFullLyrics(false); }} className="text-sm font-semibold text-violet-600 hover:underline">[{bilingualSectionTitle(section)}]</button><span className="text-[10px] text-muted-foreground">{section.emotion} · {section.rhyme} · {section.syllables} 字</span></div><textarea aria-label={`${section.title} 歌词`} value={section.lyrics} rows={Math.max(3, section.lyrics.split(/\r?\n/).length)} onChange={(event) => patchSection(section.id, { lyrics: event.target.value })} className="w-full resize-none rounded-lg border bg-card px-5 py-4 font-serif text-lg leading-9 outline-none focus:border-violet-500" placeholder={`${bilingualSectionTitle(section)} 暂无歌词`} /></section>)}</div></div><footer className="flex h-9 shrink-0 items-center border-t px-6 text-[10px] text-muted-foreground"><Save className="mr-1.5 h-3 w-3" />弹层中的修改也会自动保存<span className="ml-auto">{project.sections.reduce((sum, section) => sum + section.lyrics.split(/\r?\n/).filter(Boolean).length, 0)} 行</span></footer></div></div>}
    {generationStage && <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-3 border-b bg-violet-500/5 px-4 py-2 text-xs"><Loader2 className={`h-3.5 w-3.5 text-violet-600 ${loading ? 'animate-spin' : ''}`} /><span className="flex-1">{generationStage}</span>{loading && <Button size="sm" variant="outline" onClick={() => generationControllerRef.current?.abort()}>取消生成</Button>}{!loading && !generationCandidate && <button className="text-muted-foreground" onClick={() => setGenerationStage('')}>关闭</button>}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(360px,1fr)_280px]">
      <aside className="flex min-h-0 flex-col border-r bg-muted/20"><div className="border-b p-3"><div className="flex items-center justify-between"><span className="text-xs font-medium">歌曲段落（Song Sections）</span><button onClick={addSection} className="rounded p-1 hover:bg-accent" title="手动添加段落"><Plus className="h-3.5 w-3.5" /></button></div><Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => { setStructurePrompt(project.creativePrompt); setShowStructureGenerator(true); }}><Sparkles className="mr-1 h-3.5 w-3.5" />用提示词规划结构</Button></div><div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">{project.sections.length ? project.sections.map((section, index) => <div key={section.id} draggable onDragStart={() => setDraggedSectionId(section.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveSection(section.id)} className={`flex items-center gap-1 rounded-md pr-1 ${activeId === section.id ? 'bg-violet-500/15 text-violet-600' : 'hover:bg-accent'}`}><button onClick={() => { setActiveId(section.id); setEditorMode('section'); }} title={section.title} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs"><span className="w-5 cursor-grab text-center text-[10px] text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate">{bilingualSectionTitle(section)}</span>{section.locked && <Pin className="h-3 w-3" />}<span className="text-[9px] uppercase text-muted-foreground">{section.rhyme}</span></button><button onClick={() => patchSection(section.id, { locked: !section.locked })} title={section.locked ? '解锁段落' : '锁定段落'} className="rounded p-1 text-muted-foreground hover:bg-accent"><Pin className="h-3 w-3" /></button><button onClick={() => duplicateSection(section)} title="复制段落" className="rounded p-1 text-muted-foreground hover:bg-accent"><Copy className="h-3 w-3" /></button></div>) : <button onClick={() => setShowStructureGenerator(true)} className="m-2 grid min-h-40 w-[calc(100%-16px)] place-items-center rounded-lg border border-dashed px-4 text-center text-xs text-muted-foreground hover:border-violet-500 hover:text-violet-600">输入提示词<br />生成歌曲结构</button>}</div><div className="border-t p-3 text-[10px] leading-4 text-muted-foreground">拖动调整顺序；锁定段落不会被整首生成覆盖。</div></aside>
      <main className="flex min-h-0 flex-col overflow-hidden">{active ? <><div className="z-10 flex shrink-0 items-center justify-between border-b bg-background px-5 py-2"><div className="flex rounded-lg border p-1"><button onClick={() => setEditorMode('section')} className={`rounded px-3 py-1 text-xs ${editorMode === 'section' ? 'bg-violet-500/15 text-violet-700' : 'text-muted-foreground'}`}>单段编辑</button><button onClick={() => { setEditorMode('song'); setShowFullLyrics(true); }} className={`rounded px-3 py-1 text-xs ${editorMode === 'song' ? 'bg-violet-500/15 text-violet-700' : 'text-muted-foreground'}`}>整首预览</button></div><Button type="button" variant="outline" size="sm" onClick={() => setShowToolbox(true)}><Sparkles className="mr-1 h-3.5 w-3.5" />工具</Button></div><div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5"><div className="w-full">
        <div className="mb-4 flex items-center gap-2"><select aria-label="段落类型" value={active.kind} disabled={active.locked} onChange={(e) => patchSection(active.id, { kind: e.target.value as SectionKind })} className="h-8 rounded-md border bg-background px-2 text-xs">{KINDS.map((kind) => <option key={kind} value={kind}>{SECTION_KIND_LABELS[kind]}</option>)}</select><input aria-label="段落标题" value={active.title} disabled={active.locked} onChange={(e) => patchSection(active.id, { title: e.target.value })} className="h-8 flex-1 border-b bg-transparent text-lg font-semibold outline-none focus:border-violet-500 disabled:opacity-60" /><button title={active.locked ? '解锁段落' : '锁定段落'} onClick={() => patchSection(active.id, { locked: !active.locked })} className={`rounded p-2 ${active.locked ? 'bg-violet-500/15 text-violet-600' : 'text-muted-foreground hover:bg-accent'}`}><Pin className="h-4 w-4" /></button><button title="复制段落" onClick={() => duplicateSection(active)} className="rounded p-2 text-muted-foreground hover:bg-accent"><Copy className="h-4 w-4" /></button><button title="删除段落" disabled={active.locked} onClick={() => removeSection(active.id)} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
        <div className="mb-4 grid grid-cols-3 gap-3"><Field label="情绪" value={active.emotion} onChange={(value) => patchSection(active.id, { emotion: value })} /><Field label="目标韵脚" value={active.rhyme} onChange={(value) => patchSection(active.id, { rhyme: value })} /><Field label="每行字数" value={active.syllables} onChange={(value) => patchSection(active.id, { syllables: value })} /></div>
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-2"><Sparkles className="h-3.5 w-3.5 text-violet-500" /><select aria-label="AI 改写模式" value={rewriteMode} onChange={(event) => setRewriteMode(event.target.value)} className="h-7 flex-1 rounded border bg-background px-2 text-xs"><option>替换这一句</option><option>保持含义重新押韵</option><option>补写上一句</option><option>补写下一句</option><option>更有画面</option><option>更口语易唱</option><option>加强少年感</option><option>增加电影感</option><option>统一自然押韵</option><option>精简字数</option><option>加强副歌 Hook</option><option>延续意象链</option><option>调整到指定字数</option></select><Button size="sm" variant="outline" disabled={loading || !active.lyrics.trim()} onClick={() => void handleRewrite()}>{loading ? <Loader2 className="mr-1 h-3 w-3" /> : null}改写本段</Button></div>
        <textarea aria-label="歌词编辑器" value={active.lyrics} disabled={active.locked} onChange={(e) => { patchSection(active.id, { lyrics: e.target.value }); setLineCandidates([]); }} placeholder="在这里写下歌词，每行一句…" className="min-h-[360px] w-full resize-none rounded-xl border bg-card p-5 font-serif text-lg leading-9 outline-none focus:border-violet-500 disabled:opacity-60" />
        {sectionRewriteCandidate && <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium">段落改写候选 · 尚未写入</span><button onClick={() => setSectionRewriteCandidate(null)} className="text-[10px] text-muted-foreground">拒绝</button></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded border bg-background p-3"><p className="mb-2 text-[10px] text-muted-foreground">原段落</p><pre className="whitespace-pre-wrap font-sans text-xs leading-6">{active.lyrics}</pre></div><div className="rounded border border-emerald-500/30 bg-background p-3"><p className="mb-2 text-[10px] text-emerald-600">AI 候选</p><pre className="whitespace-pre-wrap font-sans text-xs leading-6">{sectionRewriteCandidate}</pre></div></div><div className="mt-3 flex justify-end"><Button size="sm" onClick={acceptSectionRewrite}>应用此候选</Button></div></div>}
        <div className="mt-3 overflow-hidden rounded-lg border"><div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><span className="mr-auto text-[11px] font-medium">字数、节奏与韵脚 · 押韵模式 {rhymePattern(active.lyrics) || '—'}</span><select aria-label="选中行改写方式" value={lineRewriteMode} onChange={(event) => setLineRewriteMode(event.target.value)} className="h-7 rounded border bg-background px-2 text-[10px]"><option>替换这一句</option><option>保持含义重新押韵</option><option>补写上一句</option><option>补写下一句</option><option>调整到指定字数</option></select><Button size="sm" variant="ghost" disabled={loading || !lineAnalysis.length} onClick={() => void handleLineRewrite()}><Sparkles className="mr-1 h-3 w-3" />改写第 {selectedLine + 1} 行</Button></div><div className="divide-y">{lineAnalysis.map((item, index) => <button key={`${item.line}-${index}`} onClick={() => { setSelectedLine(index); setLineCandidates([]); }} className={`grid w-full grid-cols-[28px_1fr_42px_52px_72px] items-center gap-2 px-3 py-2 text-left text-[10px] ${selectedLine === index ? 'bg-violet-500/10' : 'hover:bg-accent/50'}`}><span className="text-muted-foreground">{index + 1}</span><span className="truncate text-xs">{item.line}</span><span className={Math.abs(item.deviation) > 2 ? 'text-amber-600' : 'text-muted-foreground'}>{item.hanCount} 字</span><span className="font-mono text-violet-600">{item.rhyme}</span><span className="text-muted-foreground">≈ {item.durationSeconds}s</span></button>)}</div></div>
        {lineAnalysis[selectedLine] && <div className="mt-2 rounded-md bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground"><p>第 {selectedLine + 1} 行：{lineAnalysis[selectedLine].breathing} · 句长偏差 {lineAnalysis[selectedLine].deviation > 0 ? '+' : ''}{lineAnalysis[selectedLine].deviation} 字 · 声调 {lineAnalysis[selectedLine].tonePattern}</p>{lineAnalysis[selectedLine].singabilityIssues.map((issue) => <p key={issue} className="mt-1 text-amber-600">• {issue}</p>)}</div>}
        {lineCandidates.length > 0 && <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium">行级改写 Diff</span><button onClick={() => setLineCandidates([])} className="text-[10px] text-muted-foreground">全部拒绝</button></div><p className="mb-2 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"><span className="mr-2 text-[10px]">原句</span>{lineCandidates[0].original}</p><div className="space-y-2">{lineCandidates.map((candidate) => <div key={candidate.id} className="flex items-center gap-2 rounded bg-background px-2 py-1.5"><span className="min-w-0 flex-1 text-xs"><span className="mr-2 text-[10px] text-emerald-600">候选</span>{candidate.replacement}</span><button onClick={() => acceptLineCandidate(candidate)} className="rounded bg-violet-600 px-2 py-1 text-[10px] text-white">接受</button></div>)}</div></div>}
        <div className="mt-3 flex flex-wrap gap-2">{rhymeSuggestions(active.rhyme).map((word) => <button key={word} onClick={() => void navigator.clipboard.writeText(word)} title="复制同韵候选词" className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground hover:border-violet-500 hover:text-violet-600">{word}</button>)}</div>
      </div></div></> : <div className="grid h-full place-items-center text-sm text-muted-foreground">添加一个段落开始创作</div>}</main>
      <aside className="flex min-h-0 flex-col border-l bg-muted/10"><div className="shrink-0 border-b bg-background p-3"><div className="flex rounded-lg border p-1">{([['planning', '规划'], ['project', '项目'], ['analysis', '分析']] as const).map(([id, label]) => <button key={id} onClick={() => setRightTab(id)} className={`flex-1 rounded px-2 py-1 text-[10px] ${rightTab === id ? 'bg-violet-500/15 text-violet-700' : 'text-muted-foreground'}`}>{label}</button>)}</div></div><div className="min-h-0 flex-1 overflow-y-auto p-4">
        {rightTab === 'planning' && <div className="grid gap-3"><label className="grid gap-1 text-[11px] text-muted-foreground"><span>自由创作提示词</span><textarea value={project.creativePrompt} onChange={(event) => { patchProject({ creativePrompt: event.target.value }); setStructurePrompt(event.target.value); }} className="min-h-24 resize-y rounded-md border bg-background p-2 text-xs text-foreground" placeholder="描述主题、故事、结构和希望避免的表达…" /></label><label className="grid gap-1 text-[11px] text-muted-foreground"><span>信息冲突时优先采用</span><select value={project.promptPriority} onChange={(event) => patchProject({ promptPriority: event.target.value as LyricProject['promptPriority'] })} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="prompt">自由提示词</option><option value="planning">规划卡字段</option></select></label>{project.creativePrompt.trim() && (project.theme.trim() || project.story.trim()) && <p className="rounded-md bg-amber-500/10 p-2 text-[10px] leading-4 text-amber-700">自由提示词与规划卡同时存在；生成时按上方优先级处理冲突。</p>}<Field label="主题" value={project.theme} onChange={(value) => patchProject({ theme: value })} /><label className="grid gap-1 text-[11px] text-muted-foreground"><span>歌曲风格</span><select aria-label="歌曲风格" value={project.style} onChange={(event) => patchProject({ style: event.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500">{project.style && !MUSIC_STYLE_VALUES.has(project.style) && <option value={project.style}>当前自定义：{project.style}</option>}{MUSIC_STYLE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup>)}</select></label><Field label="整体情绪" value={project.emotion} onChange={(value) => patchProject({ emotion: value })} /><div className="grid grid-cols-2 gap-2"><Field label="地点" value={project.location} onChange={(value) => patchProject({ location: value })} /><Field label="时间" value={project.time} onChange={(value) => patchProject({ time: value })} /></div><Field label="故事背景" value={project.story} onChange={(value) => patchProject({ story: value })} /><Field label="核心意象（用、分隔）" value={project.coreImages.join('、')} onChange={(value) => patchProject({ coreImages: value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 7) })} /></div>}
        {rightTab === 'project' && <div className="grid gap-3"><Field label="标签（用、分隔）" value={project.tags.join('、')} onChange={(value) => patchProject({ tags: value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} /><Field label="专辑 / EP" value={project.collection} onChange={(value) => patchProject({ collection: value })} /><label className="grid gap-1 text-[11px] text-muted-foreground"><span>创作状态</span><select value={project.status} onChange={(event) => patchProject({ status: event.target.value as LyricProject['status'] })} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"><option value="idea">灵感</option><option value="draft">初稿</option><option value="revising">修改中</option><option value="done">完成</option></select></label><div className="grid grid-cols-2 gap-2"><Field label="语言" value={project.language} onChange={(value) => patchProject({ language: value })} /><Field label="BPM" type="number" value={project.bpm} onChange={(value) => patchProject({ bpm: Math.max(40, Math.min(240, Number(value) || 72)) })} /></div><label className="flex items-center justify-between text-[11px] text-muted-foreground"><span>项目封面颜色</span><input type="color" value={project.coverColor} onChange={(event) => patchProject({ coverColor: event.target.value })} className="h-7 w-12 cursor-pointer rounded border bg-transparent" /></label><div className="rounded-lg border p-3"><p className="text-[11px] font-medium">已保存提示词</p><p className="mt-1 text-[10px] text-muted-foreground">当前提示词会随项目自动保存，不再随弹层关闭丢失。</p></div></div>}
        {rightTab === 'project' && <label className="mt-4 grid gap-1 text-[11px] text-muted-foreground"><span>创作素材板</span><textarea value={project.scratchpad} onChange={(event) => patchProject({ scratchpad: event.target.value })} className="min-h-40 resize-y rounded-md border bg-background p-3 text-xs leading-6 text-foreground" placeholder="保存零散句子、标题候选、生活细节、押韵词和未采用的 AI 候选…" /><span className="text-[10px]">随项目自动保存，可作为后续生成素材。</span></label>}
        {rightTab === 'analysis' && <div><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-semibold">歌曲潜力</p><p className="text-[10px] text-muted-foreground">启发式区间，不代表客观概率</p></div><strong className="text-lg text-violet-500">{scoreBand(score.overall)}</strong></div><div className="space-y-3">{([['旋律适配', score.rhythm], ['情绪表达', score.emotion], ['Hook 强度', score.hook], ['押韵统一', score.rhyme]] as const).map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-[10px]"><span>{label}</span><span>{scoreBand(value)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(value / 10) * 10}%` }} /></div></div>)}</div><div className="mt-5 rounded-lg border bg-card p-3"><p className="mb-2 text-[11px] font-medium">编辑建议</p>{score.notes.map((note) => <p key={note} className="mb-2 text-[10px] leading-4 text-muted-foreground">• {note}</p>)}</div></div>}
      </div></aside>
    </div>{message && message !== '所有修改会自动保存在本机' && <div role="status" aria-live="polite" className="pointer-events-none absolute bottom-10 right-4 z-20 max-w-md rounded-lg border bg-popover px-3 py-2 text-[11px] text-popover-foreground shadow-lg">{message}</div>}<footer className="flex h-8 shrink-0 items-center border-t px-4 text-[10px] text-muted-foreground"><Save className="mr-1.5 h-3 w-3" />已自动保存<span className="ml-auto">{project.sections.length} 个段落 · {project.sections.reduce((sum, section) => sum + section.lyrics.split(/\r?\n/).filter(Boolean).length, 0)} 行</span></footer>
  </div>;
};
