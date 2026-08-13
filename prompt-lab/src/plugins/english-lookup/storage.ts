import type { LookupHistoryItem, ReviewLogItem, WordEntry } from './types';

const STORAGE_KEY = 'nwd.english-lookup.vocabulary.v1';
const HISTORY_KEY = 'nwd.english-lookup.history.v1';
const REVIEW_LOG_KEY = 'nwd.english-lookup.review-log.v1';

export function loadVocabulary(): WordEntry[] {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function saveVocabulary(entries: WordEntry[]): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }

export function loadLookupHistory(): LookupHistoryItem[] {
  try { const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function saveLookupHistory(history: LookupHistoryItem[]): void { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }

export function loadReviewLog(): ReviewLogItem[] {
  try { const value = JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function saveReviewLog(log: ReviewLogItem[]): void { localStorage.setItem(REVIEW_LOG_KEY, JSON.stringify(log.slice(-2_000))); }
