import { app, dialog, ipcMain, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import type { TranscriptSegment, VideoChapter, VideoReaderProject } from '../../core/ai-video-reader/types';
import { exportTranscript, parseTranscript } from '../../core/ai-video-reader/transcript';
import { normalizeSegments } from '../../core/ai-video-reader/editing';
import { indexVideoProject, projectContext, removeVideoProject, searchVideoSegments } from './database';

const projectFile = () => path.join(app.getPath('userData'), 'ai-video-reader', 'projects.json');
const activeTranscriptions = new Map<string, { controller: AbortController; child?: ReturnType<typeof spawn> }>();
interface ChunkResult { duration: number; language?: string; segments: Array<{ start: number; end: number; text: string }> }
interface TranscriptionCheckpoint { sourceMtime: number; model: string; chunks: Record<string, ChunkResult> }

function load(): VideoReaderProject[] {
  try { return JSON.parse(fs.readFileSync(projectFile(), 'utf8')) as VideoReaderProject[]; } catch { return []; }
}
function save(projects: VideoReaderProject[]): void {
  fs.mkdirSync(path.dirname(projectFile()), { recursive: true });
  fs.writeFileSync(projectFile(), JSON.stringify(projects, null, 2), 'utf8');
}
function hydrate(project: VideoReaderProject): VideoReaderProject {
  return { ...project, mediaUrl: pathToFileURL(project.sourcePath).href };
}

function projectCacheDirectory(projectId: string): string {
  if (!/^video-[a-z0-9]+$/i.test(projectId)) throw new Error('无效项目 ID');
  return path.join(app.getPath('userData'), 'ai-video-reader', 'cache', projectId);
}

function directoryStats(directory: string): { bytes: number; files: number } {
  if (!fs.existsSync(directory)) return { bytes: 0, files: 0 };
  let bytes = 0; let files = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { const nested = directoryStats(target); bytes += nested.bytes; files += nested.files; }
    else if (entry.isFile()) { bytes += fs.statSync(target).size; files += 1; }
  }
  return { bytes, files };
}

const mediaRuntimeConfigFile = () => path.join(app.getPath('userData'), 'ai-video-reader', 'runtime.json');

function configuredMediaDirectory(): string | undefined {
  try {
    const value = (JSON.parse(fs.readFileSync(mediaRuntimeConfigFile(), 'utf8')) as { directory?: unknown }).directory;
    return typeof value === 'string' && path.isAbsolute(value) ? value : undefined;
  } catch { return undefined; }
}

function mediaBinaryCandidates(executable: string, platformDirectory: string): string[] {
  const configured = configuredMediaDirectory();
  const resourceRoots = [process.resourcesPath, app.getAppPath()];
  const candidates = resourceRoots.flatMap((root) => [
    path.join(root, 'ffmpeg', platformDirectory, executable),
    path.join(root, 'ffmpeg', process.platform === 'win32' ? `win-${process.arch}` : `${platformDirectory}-${process.arch}`, executable),
    path.join(root, 'ffmpeg', 'bin', executable),
    path.join(root, 'ffmpeg', executable),
  ]);
  if (configured) candidates.unshift(path.join(configured, executable), path.join(configured, 'bin', executable));
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) candidates.push(path.join(localAppData, 'Programs', 'ffmpeg', 'bin', executable));
    candidates.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', executable));
  }
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(directory, executable));
  return [...new Set(candidates)];
}

function findMediaBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const platformDirectory = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  return mediaBinaryCandidates(executable, platformDirectory).find((candidate) => fs.existsSync(candidate)) ?? null;
}

function runBinary(binary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true }); let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); }); child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${path.basename(binary)} exited with ${code}`)));
  });
}

async function probeMedia(sourcePath: string): Promise<Partial<VideoReaderProject>> {
  const binary = findMediaBinary('ffprobe'); if (!binary) return {};
  const { stdout } = await runBinary(binary, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', sourcePath]);
  const result = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number }> };
  const video = result.streams?.find((item) => item.codec_type === 'video'); const audio = result.streams?.find((item) => item.codec_type === 'audio');
  return { durationMs: Math.round(Number(result.format?.duration ?? 0) * 1000), width: video?.width, height: video?.height, videoCodec: video?.codec_name, audioCodec: audio?.codec_name };
}

function extractAudioChunks(projectId: string, sourcePath: string, outputPattern: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = findMediaBinary('ffmpeg');
    if (!binary) { reject(new Error('未找到 FFmpeg。请安装到系统 PATH，或放入 resources/ffmpeg/<platform>/')); return; }
    const task = activeTranscriptions.get(projectId);
    const child = spawn(binary, ['-y', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', outputPattern], { windowsHide: true });
    if (task) task.child = child;
    let diagnostics = '';
    child.stderr.on('data', (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-4000); });
    child.on('error', (error) => reject(new Error(`无法启动 FFmpeg：${error.message}`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg 音频提取失败（${code}）：${diagnostics}`)));
  });
}

async function transcribeAudio(audioPath: string, config: { baseUrl: string; apiKey: string; model: string; language?: string }, signal: AbortSignal) {
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(audioPath)], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', config.model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (config.language?.trim()) form.append('language', config.language.trim());
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: form, signal });
  const body = await response.text();
  if (!response.ok) throw new Error(`ASR 请求失败（${response.status}）：${body.slice(0, 600)}`);
  const parsed = JSON.parse(body) as { language?: string; duration?: number; segments?: Array<{ start: number; end: number; text: string }> };
  if (!parsed.segments?.length) throw new Error('ASR Provider 未返回 segment timestamps；请确认支持 verbose_json');
  return parsed;
}

async function transcribeWithRetry(audioPath: string, config: { baseUrl: string; apiKey: string; model: string; language?: string }, signal: AbortSignal): Promise<ChunkResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await transcribeAudio(audioPath, config, signal);
      return { duration: result.duration ?? 600, language: result.language, segments: result.segments ?? [] };
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

function transcriptChunks(segments: TranscriptSegment[], maxCharacters = 10000): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = []; let current: TranscriptSegment[] = []; let size = 0;
  for (const segment of segments) {
    if (current.length && size + segment.text.length > maxCharacters) { chunks.push(current); current = []; size = 0; }
    current.push(segment); size += segment.text.length;
  }
  if (current.length) chunks.push(current); return chunks;
}

function parseJsonObject(content: string): Record<string, unknown> {
  return JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) as Record<string, unknown>;
}

async function chatCompletion(config: { baseUrl: string; apiKey: string; model: string }, messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model, messages, temperature: 0.2, response_format: { type: 'json_object' } }) });
  const text = await response.text(); if (!response.ok) throw new Error(`LLM 请求失败（${response.status}）：${text.slice(0, 600)}`);
  const result = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> }; const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 没有返回内容'); return content;
}

export function setupAiVideoReaderIPC(): void {
  ipcMain.handle('ai-video-reader:runtime-status', async () => {
    const ffmpeg = findMediaBinary('ffmpeg'); const ffprobe = findMediaBinary('ffprobe');
    let version: string | undefined;
    if (ffmpeg) { try { const result = await runBinary(ffmpeg, ['-version']); version = result.stdout.split(/\r?\n/)[0]; } catch { /* reported as unavailable below */ } }
    return { ffmpeg: { available: Boolean(ffmpeg && version), path: ffmpeg ?? undefined, version }, ffprobe: { available: Boolean(ffprobe), path: ffprobe ?? undefined } };
  });
  ipcMain.handle('ai-video-reader:select-ffmpeg', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择 FFmpeg 所在目录',
      properties: ['openDirectory'],
      message: '请选择同时包含 ffmpeg 和 ffprobe 的目录（也可以选择它们的上级目录）',
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const directory = picked.filePaths[0];
    const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const direct = path.join(directory, executable);
    const nested = path.join(directory, 'bin', executable);
    if (!fs.existsSync(direct) && !fs.existsSync(nested)) throw new Error('所选目录中未找到 ffmpeg；请选择包含 ffmpeg 的目录或其上级目录');
    fs.mkdirSync(path.dirname(mediaRuntimeConfigFile()), { recursive: true });
    fs.writeFileSync(mediaRuntimeConfigFile(), JSON.stringify({ directory }, null, 2), 'utf8');
    return directory;
  });
  ipcMain.handle('ai-video-reader:list-projects', () => {
    const projects = load(); for (const project of projects) if (project.segments.length) indexVideoProject(project);
    return projects.map(hydrate);
  });
  ipcMain.handle('ai-video-reader:import-video', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi'] }] });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const sourcePath = picked.filePaths[0];
    const stat = fs.statSync(sourcePath);
    const projects = load();
    const existing = projects.find((item) => item.sourcePath === sourcePath && item.sourceMtime === stat.mtimeMs);
    if (existing) return hydrate(existing);
    const now = Date.now();
    let mediaInfo: Partial<VideoReaderProject> = {}; try { mediaInfo = await probeMedia(sourcePath); } catch { /* importing remains available without ffprobe */ }
    const project: VideoReaderProject = { id: `video-${now.toString(36)}`, name: path.basename(sourcePath, path.extname(sourcePath)), sourcePath, mediaUrl: '', sourceSize: stat.size, sourceMtime: stat.mtimeMs, durationMs: 0, ...mediaInfo, status: 'ready', segments: [], chapters: [], createdAt: now, updatedAt: now };
    projects.unshift(project); save(projects); return hydrate(project);
  });
  ipcMain.handle('ai-video-reader:import-transcript', async (_event, projectId: string) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '字幕或转写', extensions: ['srt', 'vtt', 'json'] }] });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const projects = load(); const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error('视频项目不存在');
    const transcriptPath = picked.filePaths[0];
    const result = parseTranscript(fs.readFileSync(transcriptPath, 'utf8'), path.extname(transcriptPath));
    project.segments = result.segments; project.language = result.language; project.status = 'complete'; project.updatedAt = Date.now();
    save(projects); indexVideoProject(project); return hydrate(project);
  });
  ipcMain.handle('ai-video-reader:delete-project', (_event, projectId: string) => { const projects = load(); const next = projects.filter((item) => item.id !== projectId); save(next); removeVideoProject(projectId); const cache = projectCacheDirectory(projectId); if (fs.existsSync(cache)) fs.rmSync(cache, { recursive: true, force: true }); return next.length !== projects.length; });
  ipcMain.handle('ai-video-reader:export-transcript', async (_event, projectId: string, format: 'srt' | 'vtt' | 'txt' | 'md' | 'json') => {
    const project = load().find((item) => item.id === projectId); if (!project) throw new Error('视频项目不存在');
    const picked = await dialog.showSaveDialog({ defaultPath: `${project.name}.${format}` }); if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, exportTranscript(project.segments, format), 'utf8'); return picked.filePath;
  });
  ipcMain.handle('ai-video-reader:transcribe', async (_event, projectId: string, config: { baseUrl: string; apiKey: string; model: string; language?: string }) => {
    if (!config.baseUrl || !config.apiKey || !config.model) throw new Error('请完整填写 ASR Base URL、API Key 和模型');
    const projects = load(); const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error('视频项目不存在');
    project.status = 'transcribing'; project.updatedAt = Date.now(); save(projects);
    const workDirectory = path.join(app.getPath('userData'), 'ai-video-reader', 'cache', project.id);
    const chunkPattern = path.join(workDirectory, 'chunk-%05d.wav');
    const checkpointPath = path.join(workDirectory, 'checkpoint.json');
    fs.mkdirSync(workDirectory, { recursive: true });
    let checkpoint: TranscriptionCheckpoint = { sourceMtime: project.sourceMtime, model: config.model, chunks: {} };
    try {
      const stored = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as TranscriptionCheckpoint;
      if (stored.sourceMtime === project.sourceMtime && stored.model === config.model) checkpoint = stored;
    } catch { /* no reusable checkpoint */ }
    const controller = new AbortController(); activeTranscriptions.set(projectId, { controller });
    const sendProgress = (target: WebContents, stage: 'extracting' | 'transcribing' | 'saving', progress: number, detail: string) => target.send('ai-video-reader:task-progress', { projectId, stage, progress, detail });
    let completed = false;
    try {
      let chunks = fs.readdirSync(workDirectory).filter((file) => /^chunk-\d+\.wav$/.test(file)).sort();
      if (!chunks.length) {
        checkpoint = { sourceMtime: project.sourceMtime, model: config.model, chunks: {} };
        sendProgress(_event.sender, 'extracting', 5, '正在提取并切分音频');
        await extractAudioChunks(projectId, project.sourcePath, chunkPattern);
        chunks = fs.readdirSync(workDirectory).filter((file) => /^chunk-\d+\.wav$/.test(file)).sort();
      } else {
        sendProgress(_event.sender, 'extracting', 8, `发现断点，复用 ${chunks.length} 个音频分片`);
      }
      if (controller.signal.aborted) throw new Error('转写已取消');
      if (!chunks.length) throw new Error('FFmpeg 没有生成音频分片');
      const merged: Array<{ start: number; end: number; text: string }> = []; let offsetSeconds = 0;
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        if (controller.signal.aborted) throw new Error('转写已取消');
        const cached = checkpoint.chunks[chunks[chunkIndex]];
        sendProgress(_event.sender, 'transcribing', 10 + Math.round(chunkIndex / chunks.length * 85), cached ? `复用第 ${chunkIndex + 1}/${chunks.length} 片结果` : `正在转写第 ${chunkIndex + 1}/${chunks.length} 片`);
        const chunkPath = path.join(workDirectory, chunks[chunkIndex]);
        const result = cached ?? await transcribeWithRetry(chunkPath, config, controller.signal);
        if (!cached) { checkpoint.chunks[chunks[chunkIndex]] = result; fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint), 'utf8'); }
        project.language ??= result.language;
        for (const segment of result.segments ?? []) merged.push({ start: segment.start + offsetSeconds, end: segment.end + offsetSeconds, text: segment.text });
        offsetSeconds += result.duration ?? 600;
      }
      sendProgress(_event.sender, 'saving', 98, '正在保存时间轴');
      project.durationMs ||= Math.round(offsetSeconds * 1000);
      project.segments = merged.map((segment, index) => ({ id: `segment-${index + 1}`, index, startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000), text: segment.text.trim() }));
      project.status = 'complete'; project.updatedAt = Date.now(); save(projects); indexVideoProject(project); completed = true; return hydrate(project);
    } catch (error) {
      project.status = controller.signal.aborted ? 'cancelled' : 'error'; project.updatedAt = Date.now(); save(projects); throw error;
    } finally {
      activeTranscriptions.delete(projectId);
      if (completed) {
        for (const file of fs.readdirSync(workDirectory)) if (/^chunk-\d+\.wav$/.test(file)) { try { fs.unlinkSync(path.join(workDirectory, file)); } catch { /* best effort */ } }
        try { fs.unlinkSync(checkpointPath); } catch { /* best effort */ }
      }
    }
  });
  ipcMain.handle('ai-video-reader:cancel-transcription', (_event, projectId: string) => {
    const task = activeTranscriptions.get(projectId); if (!task) return false;
    task.controller.abort(); task.child?.kill(); return true;
  });
  ipcMain.handle('ai-video-reader:analyze', async (event, projectId: string, config: { baseUrl: string; apiKey: string; model: string }) => {
    if (!config.baseUrl || !config.apiKey || !config.model) throw new Error('请完整填写 LLM 配置');
    const projects = load(); const project = projects.find((item) => item.id === projectId);
    if (!project?.segments.length) throw new Error('请先生成或导入 Transcript');
    const timelineEnd = project.durationMs || project.segments.at(-1)?.endMs || 0;
    const chunks = transcriptChunks(project.segments); const summaries: string[] = []; const chapters: VideoChapter[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      event.sender.send('ai-video-reader:task-progress', { projectId, stage: 'analyzing', progress: Math.round(index / chunks.length * 80), detail: `正在理解第 ${index + 1}/${chunks.length} 块` });
      const source = chunks[index].map((segment) => `[${segment.startMs}-${segment.endMs}] ${segment.text}`).join('\n');
      const content = await chatCompletion(config, [{ role: 'system', content: '你是视频内容分析器。仅依据转写内容回答，输出 JSON：{"summary":"本块摘要","chapters":[{"title":"章节标题","startMs":整数,"endMs":整数}]}。时间必须来自输入。' }, { role: 'user', content: source }]);
      const parsed = parseJsonObject(content); if (typeof parsed.summary === 'string') summaries.push(parsed.summary);
      if (Array.isArray(parsed.chapters)) for (const item of parsed.chapters as Array<Record<string, unknown>>) {
        const startMs = Number(item.startMs); const endMs = Number(item.endMs); const title = String(item.title ?? '').trim();
        if (title && Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs > startMs && endMs <= timelineEnd + 1000) chapters.push({ id: `chapter-${chapters.length + 1}`, title, startMs, endMs });
      }
    }
    event.sender.send('ai-video-reader:task-progress', { projectId, stage: 'analyzing', progress: 85, detail: '正在合并全局摘要' });
    const reduced = await chatCompletion(config, [{ role: 'system', content: '将分块摘要合并为结构清晰、忠于原文的中文视频摘要。输出 JSON：{"summary":"..."}。不要添加原文没有的信息。' }, { role: 'user', content: summaries.join('\n\n') }]);
    const finalResult = parseJsonObject(reduced); project.summary = typeof finalResult.summary === 'string' ? finalResult.summary : summaries.join('\n\n');
    project.chapters = chapters.sort((a, b) => a.startMs - b.startMs); project.updatedAt = Date.now(); save(projects);
    event.sender.send('ai-video-reader:task-progress', { projectId, stage: 'saving', progress: 100, detail: '分析完成' }); return hydrate(project);
  });
  ipcMain.handle('ai-video-reader:search', (_event, query: string, projectId?: string) => searchVideoSegments(query, projectId));
  ipcMain.handle('ai-video-reader:ask', async (_event, projectId: string, question: string, config: { baseUrl: string; apiKey: string; model: string }) => {
    if (!question.trim()) throw new Error('问题不能为空');
    const project = load().find((item) => item.id === projectId); if (!project?.segments.length) throw new Error('请先生成 Transcript');
    indexVideoProject(project); const context = projectContext(project, question);
    const source = context.map((segment) => `[${segment.id}] ${segment.startMs}-${segment.endMs}: ${segment.text}`).join('\n');
    const content = await chatCompletion(config, [{ role: 'system', content: '你只能依据提供的视频片段回答。输出 JSON：{"answer":"回答","citationIds":["segment-id"]}。citationIds 只能使用上下文方括号中的 ID。如果上下文不足，明确说明无法从当前视频确定。' }, { role: 'user', content: `问题：${question}\n\n上下文：\n${source}` }]);
    const parsed = parseJsonObject(content); const ids = Array.isArray(parsed.citationIds) ? parsed.citationIds.map(String) : [];
    return { answer: typeof parsed.answer === 'string' ? parsed.answer : '无法从当前视频确定。', citations: context.filter((segment) => ids.includes(segment.id)) };
  });
  ipcMain.handle('ai-video-reader:rename-project', (_event, projectId: string, name: string) => {
    const normalized = name.trim(); if (!normalized) throw new Error('项目名称不能为空');
    const projects = load(); const project = projects.find((item) => item.id === projectId); if (!project) throw new Error('视频项目不存在');
    project.name = normalized.slice(0, 120); project.updatedAt = Date.now(); save(projects); if (project.segments.length) indexVideoProject(project); return hydrate(project);
  });
  ipcMain.handle('ai-video-reader:relink-video', async (_event, projectId: string) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi'] }] });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const projects = load(); const project = projects.find((item) => item.id === projectId); if (!project) throw new Error('视频项目不存在');
    const sourcePath = picked.filePaths[0]; const stat = fs.statSync(sourcePath); let mediaInfo: Partial<VideoReaderProject> = {};
    try { mediaInfo = await probeMedia(sourcePath); } catch { /* relinking still succeeds */ }
    Object.assign(project, mediaInfo, { sourcePath, sourceSize: stat.size, sourceMtime: stat.mtimeMs, updatedAt: Date.now() }); save(projects); return hydrate(project);
  });
  ipcMain.handle('ai-video-reader:cache-info', (_event, projectId: string) => directoryStats(projectCacheDirectory(projectId)));
  ipcMain.handle('ai-video-reader:clear-cache', (_event, projectId: string) => {
    if (activeTranscriptions.has(projectId)) throw new Error('转写进行中，不能清理缓存');
    const directory = projectCacheDirectory(projectId); if (!fs.existsSync(directory)) return false;
    fs.rmSync(directory, { recursive: true, force: true }); return true;
  });
  ipcMain.handle('ai-video-reader:save-transcript', (_event, projectId: string, segments: TranscriptSegment[]) => {
    const projects = load(); const project = projects.find((item) => item.id === projectId); if (!project) throw new Error('视频项目不存在');
    project.segments = normalizeSegments(segments); project.updatedAt = Date.now(); save(projects); indexVideoProject(project); return hydrate(project);
  });
}
