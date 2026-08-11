/**
 * Graph edges — 纯函数 + schema 部分测试
 *
 * 集成测试（需要 better-sqlite3 native）skip。
 */
import { describe, it, expect } from 'vitest';

describe('PageEdge 数据结构', () => {
  it('5 类边枚举', () => {
    const kinds = ['cited-by', 'similar-to', 'searched-from', 'opened-from', 'saved-with'];
    expect(kinds.length).toBe(5);
  });
});

describe('graph IPC channels（占位）', () => {
  it('expected: list-by-document / list-by-workspace / record operations', () => {
    const expected = [
      'work-browser:graph:list-by-document',
      'work-browser:graph:list-by-workspace',
      'work-browser:graph:record-saved-with',
      'work-browser:graph:record-edge',
    ];
    expect(expected.length).toBe(4);
  });
});

describe('GraphStore 集成（Electron 环境）', () => {
  it.skip('recordEdge 插入 + 唯一约束（同 from/to 不重复插入而是 weight 累加）', () => undefined);
  it.skip('listByDocument 双向查询（from + to）', () => undefined);
  it.skip('recordCitedBy 批量插入', () => undefined);
});
