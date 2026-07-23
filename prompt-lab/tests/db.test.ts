import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { drizzle, type SqlJsDatabase as DrizzleDb } from 'drizzle-orm/sql-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';

// ── 测试数据库初始化 ──

let sqlJs: SqlJsDatabase;
let db: DrizzleDb<typeof schema>;

beforeAll(async () => {
  // sql.js v1.x 用 initSqlJs() 初始化（异步加载 WASM）
  const SQL = await initSqlJs();
  sqlJs = new SQL.Database();
  db = drizzle(sqlJs, { schema });

  // 建表 — drizzle 的 sql-js driver 会自动根据 schema 创建表，
  // 但需要先跑一次查询来触发 migration。这里手动跑 CREATE TABLE。
  // 实际上 drizzle sql-js 没有自动 migration，需要手动执行。
  // 我们用 db.run() 来创建。
  db.run(`CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '通用', tags TEXT NOT NULL DEFAULT '[]',
    variables TEXT NOT NULL DEFAULT '[]', is_favorite INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0, usage_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
    input_selector TEXT NOT NULL, submit_selector TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, use_proxy INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inject_history (
    id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL, site_id TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1, timestamp INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`);
});

// ── prompts 表 CRUD ──

describe('prompts 表 CRUD', () => {
  it('insert + select 单条', () => {
    db.insert(schema.prompts).values({
      id: 'p-1',
      title: '测试提示词',
      content: '这是内容 {{var}}',
      category: '通用',
      tags: JSON.stringify(['react', 'test']),
      variables: JSON.stringify([{ name: 'var', defaultValue: '', description: '' }]),
      isFavorite: 1,
      isPinned: 0,
      usageCount: 5,
      createdAt: 1000,
      updatedAt: 2000,
    }).run();

    const rows = db.select().from(schema.prompts).all();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p-1');
    expect(rows[0].title).toBe('测试提示词');
    expect(rows[0].isFavorite).toBe(1);
    expect(rows[0].usageCount).toBe(5);
  });

  it('select where by id', () => {
    db.insert(schema.prompts).values({
      id: 'p-2', title: '标题2', content: '内容2',
      category: '编程', tags: '[]', variables: '[]',
      isFavorite: 0, isPinned: 0, usageCount: 0,
      createdAt: 3000, updatedAt: 3000,
    }).run();

    const row = db.select().from(schema.prompts).where(eq(schema.prompts.id, 'p-2')).get();
    expect(row).toBeTruthy();
    expect(row!.title).toBe('标题2');
  });

  it('update', () => {
    db.insert(schema.prompts).values({
      id: 'p-3', title: '旧标题', content: '旧内容',
      category: '写作', tags: '[]', variables: '[]',
      isFavorite: 0, isPinned: 0, usageCount: 0,
      createdAt: 4000, updatedAt: 4000,
    }).run();

    db.update(schema.prompts)
      .set({ title: '新标题', updatedAt: 5000 })
      .where(eq(schema.prompts.id, 'p-3'))
      .run();

    const row = db.select().from(schema.prompts).where(eq(schema.prompts.id, 'p-3')).get();
    expect(row!.title).toBe('新标题');
    expect(row!.updatedAt).toBe(5000);
  });

  it('delete', () => {
    db.insert(schema.prompts).values({
      id: 'p-del', title: '待删除', content: 'x',
      category: '通用', tags: '[]', variables: '[]',
      isFavorite: 0, isPinned: 0, usageCount: 0,
      createdAt: 6000, updatedAt: 6000,
    }).run();

    db.delete(schema.prompts).where(eq(schema.prompts.id, 'p-del')).run();

    const rows = db.select().from(schema.prompts).where(eq(schema.prompts.id, 'p-del')).all();
    expect(rows.length).toBe(0);
  });

  it('tags/variables JSON 字符串存取', () => {
    const tags = ['typescript', 'react', 'hooks'];
    const vars = [{ name: 'lang', defaultValue: 'ts', description: '语言' }];

    db.insert(schema.prompts).values({
      id: 'p-json',
      title: 'JSON 测试',
      content: '测试',
      category: '编程',
      tags: JSON.stringify(tags),
      variables: JSON.stringify(vars),
      isFavorite: 0, isPinned: 0, usageCount: 0,
      createdAt: 7000, updatedAt: 7000,
    }).run();

    const row = db.select().from(schema.prompts).where(eq(schema.prompts.id, 'p-json')).get();
    expect(JSON.parse(row!.tags as string)).toEqual(tags);
    expect(JSON.parse(row!.variables as string)).toEqual(vars);
  });
});

// ── sites 表 CRUD ──

describe('sites 表 CRUD', () => {
  it('insert + select', () => {
    db.insert(schema.sites).values({
      id: 'site-1',
      name: 'DeepSeek',
      url: 'https://chat.deepseek.com/',
      inputSelector: 'textarea',
      submitSelector: 'button.send',
      enabled: 1,
      useProxy: 0,
      sortOrder: 0,
    }).run();

    const row = db.select().from(schema.sites).where(eq(schema.sites.id, 'site-1')).get();
    expect(row!.name).toBe('DeepSeek');
    expect(row!.url).toBe('https://chat.deepseek.com/');
    expect(row!.inputSelector).toBe('textarea');
  });

  it('update site config', () => {
    db.insert(schema.sites).values({
      id: 'site-2', name: 'Old', url: 'https://old.com',
      inputSelector: 'input', submitSelector: '', enabled: 0,
      useProxy: 0, sortOrder: 1,
    }).run();

    db.update(schema.sites)
      .set({ enabled: 1, sortOrder: 5 })
      .where(eq(schema.sites.id, 'site-2'))
      .run();

    const row = db.select().from(schema.sites).where(eq(schema.sites.id, 'site-2')).get();
    expect(row!.enabled).toBe(1);
    expect(row!.sortOrder).toBe(5);
  });

  it('delete site', () => {
    db.insert(schema.sites).values({
      id: 'site-del', name: 'X', url: 'https://x.com',
      inputSelector: 'textarea', submitSelector: '', enabled: 1,
      useProxy: 0, sortOrder: 0,
    }).run();
    db.delete(schema.sites).where(eq(schema.sites.id, 'site-del')).run();
    expect(db.select().from(schema.sites).where(eq(schema.sites.id, 'site-del')).all().length).toBe(0);
  });
});

// ── inject_history 表 CRUD ──

describe('inject_history 表 CRUD', () => {
  it('insert + select 注入记录', () => {
    db.insert(schema.injectHistory).values({
      id: 'inj-1',
      promptId: 'p-1',
      siteId: 'site-1',
      success: 1,
      timestamp: Date.now(),
    }).run();

    const rows = db.select().from(schema.injectHistory).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = db.select().from(schema.injectHistory).where(eq(schema.injectHistory.id, 'inj-1')).get();
    expect(row!.promptId).toBe('p-1');
    expect(row!.success).toBe(1);
  });

  it('按 promptId 查询注入记录', () => {
    db.insert(schema.injectHistory).values({
      id: 'inj-a1', promptId: 'prompt-A', siteId: 's1', success: 1, timestamp: 1,
    }).run();
    db.insert(schema.injectHistory).values({
      id: 'inj-a2', promptId: 'prompt-A', siteId: 's2', success: 0, timestamp: 2,
    }).run();
    db.insert(schema.injectHistory).values({
      id: 'inj-b1', promptId: 'prompt-B', siteId: 's1', success: 1, timestamp: 3,
    }).run();

    const aRows = db.select().from(schema.injectHistory)
      .where(eq(schema.injectHistory.promptId, 'prompt-A')).all();
    expect(aRows.length).toBe(2);
  });
});

// ── settings 表 CRUD ──

describe('settings 表 CRUD', () => {
  it('insert + select key-value', () => {
    db.insert(schema.settings).values({
      key: 'theme',
      value: 'dark',
    }).run();

    const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'theme')).get();
    expect(row!.value).toBe('dark');
  });

  it('upsert — update existing key', () => {
    db.insert(schema.settings).values({ key: 'lang', value: 'zh' }).run();

    // sqlite upsert: INSERT OR REPLACE
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('lang', 'en')`);

    const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'lang')).get();
    expect(row!.value).toBe('en');
  });

  it('delete setting', () => {
    db.insert(schema.settings).values({ key: 'temp', value: 'x' }).run();
    db.delete(schema.settings).where(eq(schema.settings.key, 'temp')).run();
    expect(db.select().from(schema.settings).where(eq(schema.settings.key, 'temp')).all().length).toBe(0);
  });
});
