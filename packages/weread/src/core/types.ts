export type JsonObject = Record<string, unknown>;

export interface WereadCachedBook {
  bookId: string;
  title: string;
  author: string;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
  highlights: Array<JsonObject>;
  reviews: Array<JsonObject>;
  cachedAt: number;
}

export interface WereadIndexedNote {
  noteId: string;
  bookId: string;
  bookTitle: string;
  author: string;
  noteType: 'highlight' | 'review';
  chapter: string;
  content: string;
  createdAt: number;
}

export interface WereadNoteSearchMatch extends WereadIndexedNote {
  snippet: string;
}

export interface WereadSyncSummary {
  id: string;
  syncedAt: number;
  addedBooks: number;
  updatedBooks: number;
  deletedBooks: number;
  addedNotes: number;
  deletedNotes: number;
  totalBooks: number;
  totalNotes: number;
}

export interface WereadExportState {
  bookId: string;
  fingerprint: string;
  exportedAt: number;
}

export interface WereadReviewState {
  bookId: string;
  lastReviewedAt: number;
  nextReviewAt: number;
  reviewCount: number;
}

export interface WereadAction {
  id: string;
  bookId: string;
  sourceNoteId: string;
  content: string;
  status: 'todo' | 'doing' | 'done';
  createdAt: number;
  updatedAt: number;
}
