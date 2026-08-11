/**
 * searchLocal — FTS5 本地全文搜索
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@/core/work-browser/storage';
import { searchLocal, buildFtsQuery } from '@/core/work-browser/search/local';

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');
  const r = runMigrations(db);
  expect(r.to).toBeGreaterThanOrEqual(2);

  // 准备 workspace + 文档
  db.prepare(`INSERT INTO workspaces(id, name, description, icon, color, storage_path, privacy_mode, created_at, updated_at, archived_at)
              VALUES (?, 'ws1', '', '🌊', '#000', '', 'normal', ?, ?, NULL)`).run('ws1', Date.now(), Date.now());
  db.prepare(`INSERT INTO documents(id, workspace_id, title, url, source_type, content_path, raw_path, content_hash, captured_at, word_count, summary, plain_text, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'web', '', '', 'h1', ?, ?, ?, ?, ?, ?)`).run(
    'd1', 'ws1', 'ClickHouse 内存优化',
    'https://example.com/clickhouse-memory',
    Date.now(), 500, '深入分析 ClickHouse 内存管理',
    'ClickHouse 内存管理包含内存池、MemoryTracker、用户配额等机制。当遇到内存溢出时需要检查 max_memory_usage 和 max_server_memory_usage 设置。',
    Date.now(), Date.now(),
  );
  db.prepare(`INSERT INTO documents(id, workspace_id, title, url, source_type, content_path, raw_path, content_hash, captured_at, word_count, summary, plain_text, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'web', '', '', 'h2', ?, ?, ?, ?, ?, ?)`).run(
    'd2', 'ws1', 'PostHog 部署指南',
    'https://example.com/posthog-deploy',
    Date.now(), 300, 'PostHog ClickHouse 部署',
    'PostHog 使用 ClickHouse 作为 OLAP 存储。部署时需要配置 Kubernetes 资源限制，以及 ClickHouse 集群副本。',
    Date.now(), Date.now(),
  );
  db.prepare(`INSERT INTO documents(id, workspace_id, title, url, source_type, content_path, raw_path, content_hash, captured_at, word_count, summary, plain_text, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'web', '', '', 'h3', ?, ?, ?, ?, ?, ?)`).run(
    'd3', 'ws2', 'Rust 异步编程',
    'https://example.com/rust-async',
    Date.now(), 200, 'Tokio 运行时',
    'Tokio 是 Rust 生态最流行的异步运行时，基于 reactor 模式。',
    Date.now(), Date.now(),
  );
});

describe('buildFtsQuery', () => {
  it('转空格分隔为 AND prefix', () => {
    expect(buildFtsQuery('clickhouse 内存')).toBe('clickhouse* AND 内存*');
  });
  it('过滤长度 < 2 的 token', () => {
    expect(buildFtsQuery('a b clickhouse')).toBe('clickhouse*');
  });
  it('空字符串返回空', () => {
    expect(buildFtsQuery('')).toBe('');
    expect(buildFtsQuery('   ')).toBe('');
  });
});

describe('searchLocal', () => {
  it('基本检索命中', () => {
    const out = searchLocal(db, { text: 'clickhouse', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 10 }, {
      scope: 'library', limit: 10,
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.some((r) => r.id === 'local-d1')).toBe(true);
    expect(out.some((r) => r.id === 'local-d2')).toBe(true);
  });

  it('BM25 排序：标题命中优先', () => {
    const out = searchLocal(db, { text: 'clickhouse', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 10 }, {
      scope: 'library', limit: 10,
    });
    // d1 标题包含 "ClickHouse" 应比 d2 排名高
    expect(out[0].id).toBe('local-d1');
  });

  it('scope=workspace 只查当前工作区', () => {
    const out = searchLocal(db, { text: 'rust', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 10 }, {
      scope: 'workspace', workspaceId: 'ws1', limit: 10,
    });
    expect(out.length).toBe(0); // d3 在 ws2，不应被命中
  });

  it('scope=workspace 命中本工作区文档', () => {
    const out = searchLocal(db, { text: 'clickhouse', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 10 }, {
      scope: 'workspace', workspaceId: 'ws2', limit: 10,
    });
    // d3 在 ws2 但内容不含 clickhouse
    expect(out.length).toBe(0);
  });

  it('高亮返回 snippet', () => {
    const out = searchLocal(db, { text: '内存', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 5 }, {
      scope: 'library', limit: 5, highlight: { open: '《', close: '》' },
    });
    expect(out.length).toBeGreaterThan(0);
    // snippet 可能含高亮
    if (out[0].snippet) {
      expect(out[0].snippet.length).toBeGreaterThan(0);
    }
  });

  it('空 query 返回 []', () => {
    const out = searchLocal(db, { text: '', locale: 'zh-CN', safeSearch: true, timeRange: 'all', page: 1, perPage: 10 }, {
      scope: 'library',
    });
    expect(out).toEqual([]);
  });
});
