/**
 * Host capabilities consumed by the RSS reader panel.
 *
 * Concrete hosts (prompt-lab, future web / mobile shells) wire this adapter to their
 * own Electron preload bridge.
 */

import type {
  RssArticle,
  RssFeed,
  RssKeywordRule,
  RssState,
  RssSubscription,
} from '../core/types';

export interface RssExtractedContent {
  text: string;
  markdown: string;
  wordCount: number;
}

export interface RssPickedFile {
  /** Absolute path of the picked file, or null when the user cancelled. */
  path: string | null;
  /** Optional text contents for inline ingestion. */
  text?: string;
}

export interface RssHostApi {
  rss: {
    fetch(rawUrl: string): Promise<RssFeed>;
    loadState(): Promise<RssState>;
    saveState(state: RssState): Promise<void>;
    refreshAll(): Promise<RssState>;
    setRefreshMinutes(minutes: number): Promise<void>;
    setRetentionDays(days: number): Promise<number>;
    setNotificationsEnabled(enabled: boolean): Promise<void>;
    extractArticle(feedId: string, articleId: string, rawUrl: string): Promise<RssExtractedContent>;
    search(query: string): Promise<Array<{ feedId: string; articleId: string }>>;
    listRules(): Promise<RssKeywordRule[]>;
    saveRule(rule: RssKeywordRule): Promise<void>;
    deleteRule(id: string): Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  copyText(text: string): void;
  pickFile(options: { accept?: string }): Promise<RssPickedFile | RssPickedFile[] | null>;
  saveFile(options: { defaultName?: string; content: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ success: boolean; path?: string; error?: string }>;
}

export interface RssReaderAdapter {
  api: RssHostApi;
}
