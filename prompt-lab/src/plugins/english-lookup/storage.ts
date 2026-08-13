import type { WordEntry } from './types';

const STORAGE_KEY = 'nwd.english-lookup.vocabulary.v1';

export function loadVocabulary(): WordEntry[] {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function saveVocabulary(entries: WordEntry[]): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
