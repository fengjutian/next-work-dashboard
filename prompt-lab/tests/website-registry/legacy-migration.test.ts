import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as DatabaseNS from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyWebsiteRegistry } from '../../src/main/website-registry/legacy-migration';

type DatabaseCtor = new (filename: string) => DatabaseNS.Database;
const Database: DatabaseCtor = ((DatabaseNS as unknown as { default?: DatabaseCtor }).default || (DatabaseNS as unknown as DatabaseCtor));
const temporaryDirectories: string[] = [];

function createDatabase(file: string): DatabaseNS.Database {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE website_categories(id TEXT PRIMARY KEY,name TEXT UNIQUE,color TEXT,position INTEGER,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE website_records(id TEXT PRIMARY KEY,name TEXT,url TEXT,normalized_url TEXT UNIQUE,description TEXT,category_id TEXT,tags TEXT,notes TEXT,favicon_url TEXT,favorite INTEGER,archived INTEGER,created_at INTEGER,updated_at INTEGER,last_opened_at INTEGER,open_count INTEGER);
  `);
  return db;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('legacy website registry migration', () => {
  it('imports legacy rows into an empty development database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'website-registry-'));
    temporaryDirectories.push(directory);
    const legacyPath = path.join(directory, 'legacy.db');
    const legacy = createDatabase(legacyPath);
    legacy.prepare('INSERT INTO website_categories VALUES(?,?,?,?,?,?)').run('c1', '开发', '#fff', 0, 1, 1);
    legacy.prepare('INSERT INTO website_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('r1', 'Example', 'https://example.com', 'https://example.com', '', 'c1', '[]', '', null, 1, 0, 1, 1, null, 0);
    legacy.close();
    const target = createDatabase(path.join(directory, 'target.db'));

    expect(migrateLegacyWebsiteRegistry(target, legacyPath)).toBe(1);
    expect(target.prepare('SELECT name FROM website_records').get()).toEqual({ name: 'Example' });
    expect(target.prepare('SELECT name FROM website_categories').get()).toEqual({ name: '开发' });
    target.close();
  });

  it('does not overwrite a non-empty target database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'website-registry-'));
    temporaryDirectories.push(directory);
    const legacyPath = path.join(directory, 'legacy.db');
    const legacy = createDatabase(legacyPath);
    legacy.prepare('INSERT INTO website_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old', 'Old', 'https://old.example', 'https://old.example', '', null, '[]', '', null, 0, 0, 1, 1, null, 0);
    legacy.close();
    const target = createDatabase(path.join(directory, 'target.db'));
    target.prepare('INSERT INTO website_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('new', 'New', 'https://new.example', 'https://new.example', '', null, '[]', '', null, 0, 0, 1, 1, null, 0);

    expect(migrateLegacyWebsiteRegistry(target, legacyPath)).toBe(0);
    expect(target.prepare('SELECT id FROM website_records').all()).toEqual([{ id: 'new' }]);
    target.close();
  });
});
