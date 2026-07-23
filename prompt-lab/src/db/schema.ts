import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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
