/**
 * searchLocal — FTS5 本地全文搜索
 *
 * 注意：searchLocal 集成测试需要 better-sqlite3 + FTS5 native 模块。
 * vitest 跑在 Node 24 上（ABI 137），预编译 better-sqlite3 是 ABI 133；
 * rebuild 因 ClangCL 工具缺失败。
 * 因此集成测试 skip，但保留为 Electron 环境手工验证清单。
 * 纯函数 buildFtsQuery 不依赖 native，单独跑全测。
 */
import { describe, it, expect } from 'vitest';
import { buildFtsQuery } from '@/core/work-browser/search/local';

describe('buildFtsQuery (纯函数)', () => {
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
  it('去标点保留 Unicode 词', () => {
    expect(buildFtsQuery('"hello, world!"')).toBe('hello* AND world*');
  });
  it('限制最多 8 token', () => {
    const tokens = 'a1 a2 a3 a4 a5 a6 a7 a8 a9 a10 a11';
    const out = buildFtsQuery(tokens);
    const ands = out.split(' AND ');
    expect(ands.length).toBe(8);
  });
});

describe('searchLocal 集成 (Electron 环境验证)', () => {
  it.skip('基本检索命中（Electron 环境）', () => undefined);
  it.skip('BM25 排序：标题命中优先（Electron 环境）', () => undefined);
  it.skip('scope=workspace 只查当前工作区（Electron 环境）', () => undefined);
  it.skip('scope=library 跨工作区（Electron 环境）', () => undefined);
  it.skip('高亮返回 snippet（Electron 环境）', () => undefined);
  it.skip('空 query 返回 []（Electron 环境）', () => undefined);
});
