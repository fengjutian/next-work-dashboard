/**
 * Host capabilities consumed by the WeRead panel.
 */

import type {
  WereadAction,
  WereadCachedBook,
  WereadExportState,
  WereadNoteSearchMatch,
  WereadReviewState,
  WereadSyncSummary,
} from '../core/types';

export interface WereadAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface WereadAiSummaryRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  books: Array<{ bookId: string; title: string; author: string; highlights: string[]; reviews: string[] }>;
}

export interface WereadAiRecommendRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  books: Array<{ title: string; author: string; highlights: string[]; reviews: string[] }>;
}

export interface WereadRecommendItem {
  type: 'same_author' | 'similar' | 'opposite';
  title: string;
  author: string;
  reason: string;
}

export interface WereadSummaryItem {
  bookId: string;
  summary: string;
  tags: string[];
}

export interface WereadHostApi {
  wereadRequest(apiKey: string, payload: Record<string, unknown>): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
  wereadAiSummary(payload: WereadAiSummaryRequest): Promise<{ success: boolean; summaries?: WereadSummaryItem[]; error?: string }>;
  wereadAiRecommend(payload: WereadAiRecommendRequest): Promise<{ success: boolean; recommendations?: WereadRecommendItem[]; error?: string }>;
}

export interface WereadSaveFileResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface WereadHostServices {
  getToken(service: string): Promise<string | null>;
  saveToken(service: string, token: string, label?: string): Promise<void>;
  saveFile(content: string, defaultName: string): Promise<WereadSaveFileResult>;
  openExternal(url: string): Promise<void>;
}

export interface WereadReaderConfig {
  /** Electron embeds a webview; web embeds an iframe; external opens the site outside the panel. */
  mode: 'electron' | 'iframe' | 'external';
  url?: string;
}

/** Renderer-side task repository. Backed by SQLite in the prompt-lab host. */
export interface WereadTaskRepository {
  loadCache(query?: string): WereadCachedBook[];
  replaceCache(books: Array<Omit<WereadCachedBook, 'cachedAt'>>): WereadSyncSummary;
  loadExportStates(): WereadExportState[];
  markExported(states: Array<{ bookId: string; fingerprint: string }>): void;
  searchNotes(query: string, limit?: number): WereadNoteSearchMatch[];
  loadReviewStates(): WereadReviewState[];
  markReviewed(bookId: string, intervalDays: number): WereadReviewState;
  loadActions(): WereadAction[];
  saveAction(action: WereadAction): void;
  loadSyncHistory(): WereadSyncSummary[];
  /** Persist the current in-memory db state to disk. The prompt-lab host already
   *  has a Drizzle-backed write path; this is only used by the panel for explicit
   *  commit points. */
  flush(): Promise<void>;
  /** Whether the host's database is initialized and ready. */
  isReady(): boolean;
}

export interface WereadAdapter {
  api: WereadHostApi;
  ai: WereadAiConfig;
  tasks: WereadTaskRepository;
  host?: WereadHostServices;
  reader?: WereadReaderConfig;
}
