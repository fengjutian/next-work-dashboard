import type { LookupHistoryItem, ReviewLogItem, WordEntry } from './types';

const STORAGE_KEY = 'nwd.english-lookup.vocabulary.v1';
const HISTORY_KEY = 'nwd.english-lookup.history.v1';
const REVIEW_LOG_KEY = 'nwd.english-lookup.review-log.v1';
const STORAGE_V2_KEY = 'nwd.english-lookup.vocabulary.v2';
const MAX_ENTRIES = 10_000;
const VALID_BOOKS = new Set(['CET-4', 'CET-6', 'IELTS', '商务', '编程']);

/** Minimal storage surface the panel needs. Maps to `window.localStorage`
 *  in browser/Electron-renderer hosts. Hosts can pass any key/value store
 *  (including in-memory maps for tests). */
export interface EnglishLookupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function validEntry(value: unknown): value is WordEntry { const item = value as Partial<WordEntry>; return Boolean(item && typeof item === 'object' && typeof item.word === 'string' && Array.isArray(item.definitions) && item.definitions.some((definition) => definition && typeof definition.meaning === 'string')); }
function backup(storage: EnglishLookupStorage, key: string, raw: string): void { try { storage.setItem(`${key}.corrupt.${Date.now()}`, raw.slice(0, 2_000_000)); } catch { /* best effort */ } }

export function loadVocabulary(storage: EnglishLookupStorage): WordEntry[] {
  const key = storage.getItem(STORAGE_V2_KEY) ? STORAGE_V2_KEY : STORAGE_KEY; const raw = storage.getItem(key) || '[]';
  try { const value: unknown = JSON.parse(raw); if (!Array.isArray(value)) throw new Error('not an array'); const entries: WordEntry[] = value.filter(validEntry).slice(0, MAX_ENTRIES).map((entry) => ({ ...entry, tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 30) : [], wordBooks: Array.isArray(entry.wordBooks) ? entry.wordBooks.filter((book): book is NonNullable<WordEntry['wordBooks']>[number] => typeof book === 'string' && VALID_BOOKS.has(book)) : [] })); if (key === STORAGE_KEY) storage.setItem(STORAGE_V2_KEY, JSON.stringify(entries)); return entries; } catch { backup(storage, key, raw); return []; }
}

export function saveVocabulary(storage: EnglishLookupStorage, entries: WordEntry[]): void { storage.setItem(STORAGE_V2_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); }

export function loadLookupHistory(storage: EnglishLookupStorage): LookupHistoryItem[] {
  try { const value = JSON.parse(storage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function saveLookupHistory(storage: EnglishLookupStorage, history: LookupHistoryItem[]): void { storage.setItem(HISTORY_KEY, JSON.stringify(history)); }

export function loadReviewLog(storage: EnglishLookupStorage): ReviewLogItem[] {
  try { const value = JSON.parse(storage.getItem(REVIEW_LOG_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function saveReviewLog(storage: EnglishLookupStorage, log: ReviewLogItem[]): void { storage.setItem(REVIEW_LOG_KEY, JSON.stringify(log.slice(-2_000))); }
