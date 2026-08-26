import { indexedWereadNotes } from '../core/analysis';
import type { WereadAction, WereadCachedBook, WereadExportState, WereadNoteSearchMatch, WereadReviewState, WereadSyncSummary } from '../core/types';
import type { WereadTaskRepository } from '../react/adapter';

type PersistedState = {
  books: WereadCachedBook[];
  exports: WereadExportState[];
  reviews: WereadReviewState[];
  actions: WereadAction[];
  syncHistory: WereadSyncSummary[];
};

const EMPTY_STATE: PersistedState = { books: [], exports: [], reviews: [], actions: [], syncHistory: [] };

export interface WereadStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalStorageRepositoryOptions {
  storage?: WereadStorageLike;
  key?: string;
}

function defaultStorage(): WereadStorageLike {
  if (typeof globalThis.localStorage === 'undefined') {
    let value: string | null = null;
    return { getItem: () => value, setItem: (_key, next) => { value = next; } };
  }
  return globalThis.localStorage;
}

export function createLocalStorageWereadRepository(options: LocalStorageRepositoryOptions = {}): WereadTaskRepository {
  const storage = options.storage ?? defaultStorage();
  const key = options.key ?? 'next-work-dashboard.weread.repository.v1';
  const read = (): PersistedState => {
    try { return { ...EMPTY_STATE, ...JSON.parse(storage.getItem(key) ?? '{}') } as PersistedState; }
    catch { return { ...EMPTY_STATE }; }
  };
  const write = (state: PersistedState) => storage.setItem(key, JSON.stringify(state));

  return {
    loadCache(query = '') {
      const books = read().books;
      const term = query.trim().toLocaleLowerCase();
      if (!term) return books;
      return books.filter((book) => `${book.title} ${book.author}`.toLocaleLowerCase().includes(term)
        || indexedWereadNotes(book).some((note) => note.content.toLocaleLowerCase().includes(term)));
    },
    replaceCache(books) {
      const state = read();
      const previous = new Map(state.books.map((book) => [book.bookId, book]));
      const now = Date.now();
      const next = books.map((book) => ({ ...book, cachedAt: now }));
      const nextIds = new Set(next.map((book) => book.bookId));
      const addedBooks = next.filter((book) => !previous.has(book.bookId)).length;
      const updatedBooks = next.filter((book) => previous.has(book.bookId)
        && JSON.stringify(previous.get(book.bookId)) !== JSON.stringify({ ...book, cachedAt: previous.get(book.bookId)?.cachedAt })).length;
      const previousNotes = state.books.reduce((sum, book) => sum + book.highlights.length + book.reviews.length, 0);
      const totalNotes = next.reduce((sum, book) => sum + book.highlights.length + book.reviews.length, 0);
      const summary: WereadSyncSummary = {
        id: `sync-${now}`,
        syncedAt: now,
        addedBooks,
        updatedBooks,
        deletedBooks: state.books.filter((book) => !nextIds.has(book.bookId)).length,
        addedNotes: Math.max(0, totalNotes - previousNotes),
        deletedNotes: Math.max(0, previousNotes - totalNotes),
        totalBooks: next.length,
        totalNotes,
      };
      write({ ...state, books: next, syncHistory: [summary, ...state.syncHistory].slice(0, 100) });
      return summary;
    },
    loadExportStates: () => read().exports,
    markExported(entries) {
      const state = read();
      const byBook = new Map(state.exports.map((entry) => [entry.bookId, entry]));
      const exportedAt = Date.now();
      for (const entry of entries) byBook.set(entry.bookId, { ...entry, exportedAt });
      write({ ...state, exports: [...byBook.values()] });
    },
    searchNotes(query, limit = 100) {
      const term = query.trim().toLocaleLowerCase();
      if (!term) return [];
      const matches: WereadNoteSearchMatch[] = [];
      for (const book of read().books) for (const note of indexedWereadNotes(book)) {
        const index = note.content.toLocaleLowerCase().indexOf(term);
        if (index < 0) continue;
        matches.push({ ...note, snippet: note.content.slice(Math.max(0, index - 40), index + term.length + 80) });
        if (matches.length >= limit) return matches;
      }
      return matches;
    },
    loadReviewStates: () => read().reviews,
    markReviewed(bookId, intervalDays) {
      const state = read();
      const previous = state.reviews.find((entry) => entry.bookId === bookId);
      const lastReviewedAt = Date.now();
      const entry: WereadReviewState = { bookId, lastReviewedAt, nextReviewAt: lastReviewedAt + intervalDays * 86_400_000, reviewCount: (previous?.reviewCount ?? 0) + 1 };
      write({ ...state, reviews: [entry, ...state.reviews.filter((item) => item.bookId !== bookId)] });
      return entry;
    },
    loadActions: () => read().actions,
    saveAction(action) {
      const state = read();
      write({ ...state, actions: [action, ...state.actions.filter((item) => item.id !== action.id)] });
    },
    loadSyncHistory: () => read().syncHistory,
    flush: async () => undefined,
    isReady: () => true,
  };
}
