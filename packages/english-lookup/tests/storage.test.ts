import { describe, expect, it } from 'vitest';
import {
  loadLookupHistory,
  loadReviewLog,
  loadVocabulary,
  saveLookupHistory,
  saveReviewLog,
  saveVocabulary,
  type EnglishLookupStorage,
} from '../src/core/storage';
import type { WordEntry } from '../src/core/types';

class MemoryStorage implements EnglishLookupStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

const NOW = 1_700_000_000_000;
const sampleEntry: WordEntry = {
  id: 'run',
  word: 'run',
  phonetic: '/rʌn/',
  partOfSpeech: 'verb',
  definitions: [{ meaning: '跑', example: 'I run.', translation: '我跑。' }],
  collocations: ['run fast'],
  topics: ['sports'],
  relations: [],
  memoryTip: 'tip',
  createdAt: NOW,
  updatedAt: NOW,
};

describe('english-lookup core/storage', () => {
  it('round-trips vocabulary through v2 key', () => {
    const storage = new MemoryStorage();
    saveVocabulary(storage, [sampleEntry]);
    expect(storage.getItem('nwd.english-lookup.vocabulary.v2')).toBeTruthy();
    const loaded = loadVocabulary(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].word).toBe('run');
  });

  it('migrates v1 vocabulary to v2 on load', () => {
    const storage = new MemoryStorage();
    storage.setItem('nwd.english-lookup.vocabulary.v1', JSON.stringify([sampleEntry]));
    const loaded = loadVocabulary(storage);
    expect(loaded).toHaveLength(1);
    expect(storage.getItem('nwd.english-lookup.vocabulary.v2')).toBeTruthy();
  });

  it('returns [] for corrupted JSON and writes a backup', () => {
    const storage = new MemoryStorage();
    storage.setItem('nwd.english-lookup.vocabulary.v2', '{not json');
    expect(loadVocabulary(storage)).toEqual([]);
    const keys = [...storage.map.keys()] as string[];
    expect(keys.some((k) => k.includes('.corrupt.'))).toBe(true);
  });

  it('filters invalid entries on load', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'nwd.english-lookup.vocabulary.v2',
      JSON.stringify([{ word: 'bad', /* no definitions */ }, sampleEntry]),
    );
    const loaded = loadVocabulary(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].word).toBe('run');
  });

  it('caps saved vocabulary at 10 000 entries', () => {
    const storage = new MemoryStorage();
    const many = Array.from({ length: 10_001 }, (_, i) => ({ ...sampleEntry, id: `w${i}`, word: `w${i}` }));
    saveVocabulary(storage, many);
    const loaded = loadVocabulary(storage);
    expect(loaded.length).toBe(10_000);
  });

  it('round-trips lookup history', () => {
    const storage = new MemoryStorage();
    const history = [{ query: 'run', word: 'run', lookedUpAt: NOW }];
    saveLookupHistory(storage, history);
    expect(loadLookupHistory(storage)).toEqual(history);
  });

  it('returns [] for non-array history', () => {
    const storage = new MemoryStorage();
    storage.setItem('nwd.english-lookup.history.v1', 'null');
    expect(loadLookupHistory(storage)).toEqual([]);
  });

  it('caps review log at the last 2 000 entries', () => {
    const storage = new MemoryStorage();
    const log = Array.from({ length: 2_500 }, (_, i) => ({ word: `w${i}`, rating: 'known' as const, reviewedAt: NOW + i }));
    saveReviewLog(storage, log);
    const loaded = loadReviewLog(storage);
    expect(loaded.length).toBe(2_000);
  });
});
