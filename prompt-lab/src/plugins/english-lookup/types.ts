export interface WordRelation { word: string; type: 'synonym' | 'antonym' | 'related' | 'word-family' }

export interface WordEntry {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definitions: Array<{ meaning: string; example: string; translation: string }>;
  collocations: string[];
  topics: string[];
  relations: WordRelation[];
  memoryTip: string;
  query?: string;
  context?: string;
  familiarity?: 'new' | 'learning' | 'mastered';
  reviewCount?: number;
  nextReviewAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface LookupHistoryItem {
  query: string;
  word: string;
  lookedUpAt: number;
}

export interface VocabularyGraph {
  nodes: Array<{ id: string; name: string; category: number; symbolSize: number; saved: boolean }>;
  links: Array<{ source: string; target: string; value: string }>;
}
