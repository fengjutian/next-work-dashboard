/**
 * Work Browser — 核心类型
 *
 * 设计原则：
 * 1. 所有 ID 用 branded string，便于追踪。
 * 2. 时间戳统一 Unix ms。
 * 3. 数据模型尽量扁平，便于 SQLite 持久化。
 * 4. 资源归属 Workspace，删除 Workspace 级联清理。
 */

export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type TabId = string & { readonly __brand: 'TabId' };
export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type DocumentVersionId = string & { readonly __brand: 'DocumentVersionId' };
export type NoteId = string & { readonly __brand: 'NoteId' };
export type AnnotationId = string & { readonly __brand: 'AnnotationId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type TaskStepId = string & { readonly __brand: 'TaskStepId' };
export type ConversationId = string & { readonly __brand: 'ConversationId' };
export type MessageId = string & { readonly __brand: 'MessageId' };
export type SearchQueryId = string & { readonly __brand: 'SearchQueryId' };

export const newId = <T extends string>(): T =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` as T;

export const now = (): number => Date.now();

// ── Workspace ──

export type PrivacyMode = 'normal' | 'local-only';

export interface Workspace {
  id: WorkspaceId;
  name: string;
  description: string;
  icon: string;
  color: string;
  storagePath: string;
  privacyMode: PrivacyMode;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

// ── Tab ──

export type TabStatus = 'loading' | 'loaded' | 'error' | 'crashed';

export interface Tab {
  id: TabId;
  workspaceId: WorkspaceId;
  url: string;
  title: string;
  favicon: string | null;
  /** Electron WebContents id，用于主进程控制。空值表示未实例化（如离线归档）。 */
  webContentsId: number | null;
  isPinned: boolean;
  isMuted: boolean;
  position: number;
  status: TabStatus;
  /** 最近一次激活时间。 */
  lastActivatedAt: number;
  createdAt: number;
  /** 累积在前台的时间（ms），用于热力图。 */
  activeTimeMs: number;
}

// ── Document ──

export type DocumentSourceType = 'web' | 'pdf' | 'docx' | 'markdown' | 'note' | 'code';

export interface Document {
  id: DocumentId;
  workspaceId: WorkspaceId;
  title: string;
  url: string;
  sourceType: DocumentSourceType;
  /** Markdown 规范化内容（用于检索 / RAG）。 */
  contentPath: string;
  /** 原始 HTML / 二进制路径（用于归档回看）。 */
  rawPath: string;
  /** 截图快照，用于离线快速回看。 */
  screenshotPath: string | null;
  contentHash: string;
  author: string | null;
  publishedAt: number | null;
  capturedAt: number;
  wordCount: number;
  summary: string | null;
  /** 关联的 Tab id（保存时回填，便于反查）。 */
  originTabId: TabId | null;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentVersion {
  id: DocumentVersionId;
  documentId: DocumentId;
  contentHash: string;
  rawPath: string;
  diffSummary: string | null;
  capturedAt: number;
  /** 距上一版本的 word 差值。 */
  wordDelta: number;
}

// ── Note ──

export interface Note {
  id: NoteId;
  workspaceId: WorkspaceId;
  documentId: DocumentId | null;
  tabId: TabId | null;
  taskId: TaskId | null;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ── Annotation ──

export type AnnotationColor = 'yellow' | 'green' | 'red' | 'blue' | 'purple';

export interface Annotation {
  id: AnnotationId;
  documentId: DocumentId;
  /** 用于在重新渲染时定位。 */
  selector: string;
  rangeText: string;
  note: string;
  color: AnnotationColor;
  createdAt: number;
  updatedAt: number;
}

// ── Task ──

export type TaskStatus = 'todo' | 'investigating' | 'testing' | 'resolved' | 'blocked';
export type TaskStepStatus = 'pending' | 'in-progress' | 'done' | 'failed' | 'skipped';

export interface TaskStep {
  id: TaskStepId;
  title: string;
  description: string;
  status: TaskStepStatus;
  evidence: string;
  result: string | null;
}

export interface Task {
  id: TaskId;
  workspaceId: WorkspaceId;
  title: string;
  description: string;
  status: TaskStatus;
  relatedDocumentIds: DocumentId[];
  relatedTabIds: TabId[];
  relatedNoteIds: NoteId[];
  steps: TaskStep[];
  aiGenerated: boolean;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

// ── AI ──

export type AIMessageRole = 'user' | 'assistant' | 'system';

export interface Citation {
  documentId: DocumentId | null;
  url: string;
  title: string;
  excerpt: string;
}

export interface AIMessage {
  id: MessageId;
  role: AIMessageRole;
  content: string;
  citations: Citation[];
  model: string | null;
  createdAt: number;
}

export type AIContextScope = 'current-page' | 'current-workspace' | 'all-library' | 'specific-documents';

export interface AIContext {
  scope: AIContextScope;
  documentIds: DocumentId[];
  noteIds: NoteId[];
  taskId: TaskId | null;
}

export interface AIConversation {
  id: ConversationId;
  workspaceId: WorkspaceId;
  title: string;
  messages: AIMessage[];
  context: AIContext;
  createdAt: number;
  updatedAt: number;
}

// ── Search ──

export type SearchTimeRange = 'day' | 'week' | 'month' | 'year' | 'all';

export interface SearchQuery {
  text: string;
  locale: string;
  safeSearch: boolean;
  timeRange: SearchTimeRange;
  page: number;
  perPage: number;
}

export interface SearchResult {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  snippet: string;
  domain: string;
  source: string;
  publishedAt: number | null;
  score: number;
  /** 用于跨引擎去重。 */
  contentHash: string;
}

export interface SearchProviderStatus {
  providerId: string;
  ok: boolean;
  count: number;
  error: string | null;
  took: number;
}

export interface AggregatedSearchResponse {
  query: SearchQuery;
  results: SearchResult[];
  providers: SearchProviderStatus[];
  took: number;
  aiSummary: string | null;
}

export interface SearchProvider {
  id: string;
  name: string;
  capabilities: {
    web: boolean;
    images: boolean;
    news: boolean;
    code: boolean;
    suggestions: boolean;
  };
  search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult[]>;
  getSuggestions?(query: string, signal: AbortSignal): Promise<string[]>;
}

// ── 净化 / 阅读 ──

export interface CleanOptions {
  removeAds: boolean;
  removePopups: boolean;
  removeCookieBanner: boolean;
  removeTrackers: boolean;
  removeSidebar: boolean;
  blockMediaAutoplay: boolean;
  /** 注入 CSS 选择器黑名单（如 '#newsletter-modal, .cookie-bar'）。 */
  customSelectors: string[];
  /** 注入网络层域名黑名单。 */
  blockDomains: string[];
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  removeAds: true,
  removePopups: true,
  removeCookieBanner: true,
  removeTrackers: true,
  removeSidebar: true,
  blockMediaAutoplay: true,
  customSelectors: [],
  blockDomains: [],
};

export interface ReadabilityResult {
  title: string;
  author: string | null;
  publishedAt: number | null;
  contentMarkdown: string;
  contentText: string;
  excerpt: string;
  wordCount: number;
  images: string[];
  links: { href: string; text: string }[];
}

// ── Search History ──

export interface SearchHistoryEntry {
  id: SearchQueryId;
  workspaceId: WorkspaceId | null;
  text: string;
  providers: string[];
  resultCount: number;
  executedAt: number;
}
