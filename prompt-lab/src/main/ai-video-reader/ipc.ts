import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VideoReaderProject } from '../../core/ai-video-reader/types';
import { exportTranscript, parseTranscript } from '../../core/ai-video-reader/transcript';

const projectFile = () => path.join(app.getPath('userData'), 'ai-video-reader', 'projects.json');

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

export function setupAiVideoReaderIPC(): void {
  ipcMain.handle('ai-video-reader:list-projects', () => load().map(hydrate));
  ipcMain.handle('ai-video-reader:import-video', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi'] }] });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const sourcePath = picked.filePaths[0];
    const stat = fs.statSync(sourcePath);
    const projects = load();
    const existing = projects.find((item) => item.sourcePath === sourcePath && item.sourceMtime === stat.mtimeMs);
    if (existing) return hydrate(existing);
    const now = Date.now();
    const project: VideoReaderProject = { id: `video-${now.toString(36)}`, name: path.basename(sourcePath, path.extname(sourcePath)), sourcePath, mediaUrl: '', sourceSize: stat.size, sourceMtime: stat.mtimeMs, durationMs: 0, status: 'ready', segments: [], chapters: [], createdAt: now, updatedAt: now };
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
    save(projects); return hydrate(project);
  });
  ipcMain.handle('ai-video-reader:delete-project', (_event, projectId: string) => { const projects = load(); const next = projects.filter((item) => item.id !== projectId); save(next); return next.length !== projects.length; });
  ipcMain.handle('ai-video-reader:export-transcript', async (_event, projectId: string, format: 'srt' | 'vtt' | 'txt' | 'md' | 'json') => {
    const project = load().find((item) => item.id === projectId); if (!project) throw new Error('视频项目不存在');
    const picked = await dialog.showSaveDialog({ defaultPath: `${project.name}.${format}` }); if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, exportTranscript(project.segments, format), 'utf8'); return picked.filePath;
  });
}
