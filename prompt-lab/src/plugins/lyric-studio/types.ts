export type SectionKind = 'Intro' | 'Verse' | 'Pre-Chorus' | 'Chorus' | 'Bridge' | 'Outro';

export interface LyricSection {
  id: string;
  kind: SectionKind;
  title: string;
  lyrics: string;
  emotion: string;
  rhyme: string;
  syllables: string;
  locked?: boolean;
  collapsed?: boolean;
}

export interface LyricProject {
  id: string;
  title: string;
  theme: string;
  style: string;
  emotion: string;
  language: string;
  bpm: number;
  location: string;
  time: string;
  story: string;
  coreImages: string[];
  tags: string[];
  favorite: boolean;
  collection: string;
  status: 'idea' | 'draft' | 'revising' | 'done';
  coverColor: string;
  sections: LyricSection[];
  updatedAt: number;
}

export interface LineRewriteCandidate {
  id: string;
  original: string;
  replacement: string;
  lineIndex: number;
  mode: string;
}

export interface LyricLineAnalysis {
  line: string;
  hanCount: number;
  rhyme: string;
  durationSeconds: number;
  breathing: string;
  lengthKind: 'short' | 'medium' | 'long';
  deviation: number;
}

export interface HookCandidate {
  id: string;
  text: string;
  memorability: number;
  singability: number;
  imagery: number;
}

export interface ReviewIssue {
  id: string;
  sectionTitle: string;
  line: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  suggestion: string;
}

export interface AudioAnalysis {
  name: string;
  duration: number;
  bpm: number;
  sampleRate: number;
  channels: number;
  key: string;
  waveform: number[];
}

export interface LrcLine {
  id: string;
  time: number;
  text: string;
}

export interface MelodyNote {
  pitch: number;
  beats: number;
  lyric: string;
}

export interface LyricRevision {
  id: string;
  label: string;
  createdAt: number;
  project: LyricProject;
}

export interface LyricScore {
  overall: number;
  rhythm: number;
  emotion: number;
  hook: number;
  rhyme: number;
  notes: string[];
}
