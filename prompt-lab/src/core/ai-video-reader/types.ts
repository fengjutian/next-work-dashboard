export type VideoProjectStatus = 'ready' | 'transcribing' | 'complete' | 'error' | 'cancelled';

export interface TranscriptSegment {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface VideoChapter {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
}

export interface VideoSearchResult extends TranscriptSegment { projectId: string; projectName: string }
export interface VideoAnswer { answer: string; citations: TranscriptSegment[] }

export interface VideoReaderProject {
  id: string;
  name: string;
  sourcePath: string;
  mediaUrl: string;
  sourceSize: number;
  sourceMtime: number;
  durationMs: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  status: VideoProjectStatus;
  language?: string;
  summary?: string;
  segments: TranscriptSegment[];
  chapters: VideoChapter[];
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptImportResult {
  segments: TranscriptSegment[];
  language?: string;
}

export interface VideoReaderTaskProgress {
  projectId: string;
  stage: 'extracting' | 'transcribing' | 'analyzing' | 'saving';
  progress: number;
  detail: string;
}

export interface VideoReaderApi {
  runtimeStatus(): Promise<{ ffmpeg: { available: boolean; path?: string; version?: string }; ffprobe: { available: boolean; path?: string } }>;
  listProjects(): Promise<VideoReaderProject[]>;
  importVideo(): Promise<VideoReaderProject | null>;
  importTranscript(projectId: string): Promise<VideoReaderProject | null>;
  deleteProject(projectId: string): Promise<boolean>;
  exportTranscript(projectId: string, format: 'srt' | 'vtt' | 'txt' | 'md' | 'json'): Promise<string | null>;
  transcribe(projectId: string, config: { baseUrl: string; apiKey: string; model: string; language?: string }): Promise<VideoReaderProject>;
  cancelTranscription(projectId: string): Promise<boolean>;
  onTaskProgress(handler: (progress: VideoReaderTaskProgress) => void): () => void;
  analyze(projectId: string, config: { baseUrl: string; apiKey: string; model: string }): Promise<VideoReaderProject>;
  search(query: string, projectId?: string): Promise<VideoSearchResult[]>;
  ask(projectId: string, question: string, config: { baseUrl: string; apiKey: string; model: string }): Promise<VideoAnswer>;
  renameProject(projectId: string, name: string): Promise<VideoReaderProject>;
  relinkVideo(projectId: string): Promise<VideoReaderProject | null>;
  cacheInfo(projectId: string): Promise<{ bytes: number; files: number }>;
  clearCache(projectId: string): Promise<boolean>;
}
