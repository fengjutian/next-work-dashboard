export type SectionKind = 'Intro' | 'Verse' | 'Pre-Chorus' | 'Chorus' | 'Bridge' | 'Outro';

export interface LyricSection {
  id: string;
  kind: SectionKind;
  title: string;
  lyrics: string;
  emotion: string;
  rhyme: string;
  syllables: string;
}

export interface LyricProject {
  id: string;
  title: string;
  theme: string;
  style: string;
  emotion: string;
  language: string;
  bpm: number;
  sections: LyricSection[];
  updatedAt: number;
}

export interface LyricScore {
  overall: number;
  rhythm: number;
  emotion: number;
  hook: number;
  rhyme: number;
  notes: string[];
}
