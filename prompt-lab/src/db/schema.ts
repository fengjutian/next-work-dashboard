import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ── 提示词 ──
export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category').notNull().default('通用'),
  tags: text('tags').notNull().default('[]'),   // JSON array stored as text
  variables: text('variables').notNull().default('[]'), // JSON array of Variable
  isFavorite: integer('is_favorite').notNull().default(0),
  isPinned: integer('is_pinned').notNull().default(0),
  usageCount: integer('usage_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── AI 站点配置 ──
export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  inputSelector: text('input_selector').notNull(),
  submitSelector: text('submit_selector').notNull().default(''),
  enabled: integer('enabled').notNull().default(1),
  useProxy: integer('use_proxy').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

// ── 注入历史 ──
export const injectHistory = sqliteTable('inject_history', {
  id: text('id').primaryKey(),
  promptId: text('prompt_id').notNull(),
  siteId: text('site_id').notNull(),
  success: integer('success').notNull().default(1),
  timestamp: integer('timestamp').notNull(),
});

// ── 应用设置 (key-value) ──
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const llmResponseCache = sqliteTable('llm_response_cache', {
  key: text('key').primaryKey(),
  response: text('response').notNull(),
  reasoning: text('reasoning').notNull().default(''),
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  lastAccessedAt: integer('last_accessed_at').notNull(),
  hitCount: integer('hit_count').notNull().default(0),
});

export const embeddingCache = sqliteTable('embedding_cache', {
  key: text('key').primaryKey(),
  identity: text('identity').notNull(),
  vector: text('vector').notNull(),
  createdAt: integer('created_at').notNull(),
  lastAccessedAt: integer('last_accessed_at').notNull(),
  hitCount: integer('hit_count').notNull().default(0),
});

export const semanticShadowCache = sqliteTable('semantic_shadow_cache', {
  key: text('key').primaryKey(), namespace: text('namespace').notNull(), model: text('model').notNull(),
  prompt: text('prompt').notNull(), response: text('response').notNull(), vector: text('vector').notNull(),
  createdAt: integer('created_at').notNull(), lastAccessedAt: integer('last_accessed_at').notNull(),
});

export const llmCacheEvents = sqliteTable('llm_cache_events', {
  id: text('id').primaryKey(), event: text('event').notNull(), namespace: text('namespace').notNull().default(''),
  model: text('model').notNull().default(''), value: integer('value').notNull().default(0), createdAt: integer('created_at').notNull(),
});

// 微信读书离线缓存。完整笔记保留为 JSON，同时用 searchable_text 提供本地搜索。
export const wereadBooks = sqliteTable('weread_books', {
  bookId: text('book_id').primaryKey(),
  title: text('title').notNull(),
  author: text('author').notNull().default(''),
  noteCount: integer('note_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  bookmarkCount: integer('bookmark_count').notNull().default(0),
  highlights: text('highlights').notNull().default('[]'),
  reviews: text('reviews').notNull().default('[]'),
  searchableText: text('searchable_text').notNull().default(''),
  cachedAt: integer('cached_at').notNull(),
});

export const wereadReviewState = sqliteTable('weread_review_state', {
  bookId: text('book_id').primaryKey(),
  lastReviewedAt: integer('last_reviewed_at').notNull(),
  nextReviewAt: integer('next_review_at').notNull(),
  reviewCount: integer('review_count').notNull().default(0),
});

export const wereadActions = sqliteTable('weread_actions', {
  id: text('id').primaryKey(), bookId: text('book_id').notNull(), sourceNoteId: text('source_note_id').notNull(),
  content: text('content').notNull(), status: text('status').notNull().default('todo'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
});

export const wereadSyncHistory = sqliteTable('weread_sync_history', {
  id: text('id').primaryKey(), syncedAt: integer('synced_at').notNull(),
  addedBooks: integer('added_books').notNull(), updatedBooks: integer('updated_books').notNull(), deletedBooks: integer('deleted_books').notNull(),
  addedNotes: integer('added_notes').notNull(), deletedNotes: integer('deleted_notes').notNull(), totalBooks: integer('total_books').notNull(), totalNotes: integer('total_notes').notNull(),
});

export const hanyuJinjieExecutions = sqliteTable('hanyu_jinjie_executions', {
  id: text('id').primaryKey(),
  word: text('word').notNull(),
  status: text('status').notNull(),
  svgContent: text('svg_content').notNull().default(''),
  error: text('error').notNull().default(''),
  model: text('model').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});

// ── Schema version tracking ──
export const schemaVersion = sqliteTable("schema_version", {
  version: integer("version").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
  description: text("description").notNull().default(""),
});

// ── Agent sessions ──
export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  instruction: text("instruction").notNull().default(""),
  worktreePath: text("worktree_path"),
  worktreeBranch: text("worktree_branch"),
  worktreeHead: text("worktree_head"),
  worktreeDirty: integer("worktree_dirty").notNull().default(0),
  isPinned: integer("is_pinned").notNull().default(0),
  parentSessionId: text("parent_session_id"),
  tokenBudget: integer("token_budget"),
  payload: text("payload").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  archivedAt: integer("archived_at"),
});

// ── Agent chat messages per session ──
export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  seq: integer("seq").notNull().default(0),
  timestamp: integer("timestamp").notNull(),
});

// ── Agent log entries per session ──
export const agentLogs = sqliteTable("agent_logs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  seq: integer("seq").notNull().default(0),
  timestamp: integer("timestamp").notNull(),
});

// ── Agent file proposals per session ──
export const agentProposals = sqliteTable("agent_proposals", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  path: text("path").notNull(),
  original: text("original").notNull().default(""),
  modified: text("modified").notNull().default(""),
  language: text("language").notNull().default(""),
  previousPath: text("previous_path"),
  accepted: integer("accepted"),
  acceptedAt: integer("accepted_at"),
  seq: integer("seq").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// ── Agent task records (for restart recovery) ──
export const agentTasks = sqliteTable("agent_tasks", {
  taskId: text("task_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  workspaceRoot: text("workspace_root").notNull().default(""),
  executionRoot: text("execution_root"),
  instruction: text("instruction").notNull().default(""),
  modelConfig: text("model_config").notNull().default("{}"),
  multiFile: integer("multi_file").notNull().default(0),
  tokenBudget: integer("token_budget").notNull().default(32000),
  state: text("state").notNull().default("queued"),
  error: text("error"),
  recovery: text("recovery"),
  result: text("result"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  updatedAt: integer("updated_at").notNull(),
});

// ── Skills (imported SKILL.md bundles) ──
export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  body: text("body").notNull().default(""),
  source: text("source").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const skillFiles = sqliteTable("skill_files", {
  id: text("id").primaryKey(),
  skillId: text("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
});
