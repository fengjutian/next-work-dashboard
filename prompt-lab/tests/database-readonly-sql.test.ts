import { describe, expect, it } from 'vitest';
import { validateReadonlyDatabaseSql } from '../src/db';

describe('database readonly SQL validation', () => {
  it.each([
    'SELECT * FROM prompts',
    'WITH recent AS (SELECT * FROM prompts) SELECT * FROM recent',
    'EXPLAIN QUERY PLAN SELECT * FROM prompts',
    'PRAGMA table_info(prompts)',
    'PRAGMA integrity_check',
  ])('allows safe query: %s', (sql) => {
    expect(validateReadonlyDatabaseSql(sql)).toEqual({ valid: true });
  });

  it.each([
    'UPDATE prompts SET title = "x"',
    'DELETE FROM prompts',
    'WITH changed AS (DELETE FROM prompts RETURNING *) SELECT * FROM changed',
    'EXPLAIN UPDATE prompts SET title = "x"',
    'PRAGMA journal_mode = WAL',
    'ATTACH DATABASE "other.db" AS other',
    'SELECT 1; SELECT 2',
  ])('rejects unsafe query: %s', (sql) => {
    expect(validateReadonlyDatabaseSql(sql).valid).toBe(false);
  });

  it('ignores forbidden words inside comments and string literals', () => {
    expect(validateReadonlyDatabaseSql("SELECT 'DELETE' AS example -- UPDATE\n")).toEqual({ valid: true });
  });

  it('rejects non-whitelisted pragma calls', () => {
    expect(validateReadonlyDatabaseSql('PRAGMA writable_schema').valid).toBe(false);
  });
});
