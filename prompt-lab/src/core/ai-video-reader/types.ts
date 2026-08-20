export type VideoProjectStatus = 'ready' | 'transcribing' | 'complete' | 'error';

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

export interface VideoReaderProject {
  id: string;
  name: string;
  sourcePath: string;
  mediaUrl: string;
  sourceSize: number;
  sourceMtime: number;
  durationMs: number;
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

export interface VideoReaderApi {
  listProjects(): Promise<VideoReaderProject[]>;
  importVideo(): Promise<VideoReaderProject | null>;
  importTranscript(projectId: string): Promise<VideoReaderProject | null>;
  deleteProject(projectId: string): Promise<boolean>;
  exportTranscript(projectId: string, format: 'srt' | 'vtt' | 'txt' | 'md' | 'json'): Promise<string | null>;
  transcribe(projectId: string, config: { baseUrl: string; apiKey: string; model: string; language?: string }): Promise<VideoReaderProject>;
}
