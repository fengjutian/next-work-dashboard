import type Database from 'better-sqlite3';
import type { WebsiteCategory, WebsiteRecord, WebsiteRecordFilters, WebsiteRecordInput } from '../../core/website-registry/types';
import { sanitizeWebsiteInput } from '../../core/website-registry/validation';

const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class WebsiteRegistryStore {
  constructor(private readonly db: Database.Database) {}

  list(filters: WebsiteRecordFilters = {}): WebsiteRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.archived !== undefined) { clauses.push('archived = ?'); params.push(filters.archived ? 1 : 0); }
    if (filters.favorite) clauses.push('favorite = 1');
    if (filters.categoryId === null) clauses.push('category_id IS NULL');
    else if (filters.categoryId) { clauses.push('category_id = ?'); params.push(filters.categoryId); }
    if (filters.query?.trim()) {
      clauses.push("(name LIKE ? OR url LIKE ? OR description LIKE ? OR notes LIKE ? OR tags LIKE ?)");
      const query = `%${filters.query.trim()}%`;
      params.push(query, query, query, query, query);
    }
    const order = filters.sort === 'name' ? 'name COLLATE NOCASE ASC' : filters.sort === 'opened' ? 'last_opened_at DESC, updated_at DESC' : filters.sort === 'popular' ? 'open_count DESC, updated_at DESC' : 'updated_at DESC';
    const rows = this.db.prepare(`SELECT * FROM website_records ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${order}`).all(...params) as any[];
    return rows.map(rowToRecord);
  }

  create(input: WebsiteRecordInput): WebsiteRecord {
    const value = sanitizeWebsiteInput(input);
    const now = Date.now();
    const recordId = id();
    try {
      this.db.prepare(`INSERT INTO website_records(id,name,url,normalized_url,description,category_id,tags,notes,favicon_url,favorite,archived,created_at,updated_at,last_opened_at,open_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(recordId, value.name, value.url, value.normalizedUrl, value.description, value.categoryId, JSON.stringify(value.tags), value.notes, value.faviconUrl, value.favorite ? 1 : 0, value.archived ? 1 : 0, now, now, null, 0);
    } catch (error) { if (String(error).includes('UNIQUE')) throw new Error('该网站已经存在'); throw error; }
    return this.get(recordId)!;
  }

  get(recordId: string): WebsiteRecord | null {
    const row = this.db.prepare('SELECT * FROM website_records WHERE id = ?').get(recordId) as any;
    return row ? rowToRecord(row) : null;
  }

  update(recordId: string, patch: Partial<WebsiteRecordInput>): WebsiteRecord {
    const current = this.get(recordId);
    if (!current) throw new Error('网站记录不存在');
    const value = sanitizeWebsiteInput({ ...current, ...patch });
    try {
      this.db.prepare(`UPDATE website_records SET name=?,url=?,normalized_url=?,description=?,category_id=?,tags=?,notes=?,favicon_url=?,favorite=?,archived=?,updated_at=? WHERE id=?`)
        .run(value.name, value.url, value.normalizedUrl, value.description, value.categoryId, JSON.stringify(value.tags), value.notes, value.faviconUrl, value.favorite ? 1 : 0, value.archived ? 1 : 0, Date.now(), recordId);
    } catch (error) { if (String(error).includes('UNIQUE')) throw new Error('该网站已经存在'); throw error; }
    return this.get(recordId)!;
  }

  remove(recordId: string): void { this.db.prepare('DELETE FROM website_records WHERE id = ?').run(recordId); }
  markOpened(recordId: string): WebsiteRecord { this.db.prepare('UPDATE website_records SET last_opened_at=?, open_count=open_count+1 WHERE id=?').run(Date.now(), recordId); return this.get(recordId)!; }

  listCategories(): WebsiteCategory[] { return (this.db.prepare('SELECT * FROM website_categories ORDER BY position, name').all() as any[]).map(rowToCategory); }
  createCategory(name: string, color = '#6366f1'): WebsiteCategory {
    const value = name.trim(); if (!value) throw new Error('请输入分类名称');
    const now = Date.now(); const categoryId = id();
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM website_categories').get() as any).value;
    try { this.db.prepare('INSERT INTO website_categories(id,name,color,position,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(categoryId, value.slice(0, 80), color, position, now, now); }
    catch (error) { if (String(error).includes('UNIQUE')) throw new Error('分类名称已存在'); throw error; }
    return this.listCategories().find((category) => category.id === categoryId)!;
  }
  updateCategory(categoryId: string, patch: Partial<Pick<WebsiteCategory, 'name' | 'color' | 'position'>>): WebsiteCategory {
    const current = this.listCategories().find((category) => category.id === categoryId); if (!current) throw new Error('分类不存在');
    this.db.prepare('UPDATE website_categories SET name=?,color=?,position=?,updated_at=? WHERE id=?').run((patch.name ?? current.name).trim(), patch.color ?? current.color, patch.position ?? current.position, Date.now(), categoryId);
    return this.listCategories().find((category) => category.id === categoryId)!;
  }
  removeCategory(categoryId: string): void { this.db.prepare('DELETE FROM website_categories WHERE id = ?').run(categoryId); }
}

function rowToRecord(row: any): WebsiteRecord { return { id: row.id, name: row.name, url: row.url, normalizedUrl: row.normalized_url, description: row.description, categoryId: row.category_id, tags: JSON.parse(row.tags || '[]'), notes: row.notes, faviconUrl: row.favicon_url, favorite: !!row.favorite, archived: !!row.archived, createdAt: row.created_at, updatedAt: row.updated_at, lastOpenedAt: row.last_opened_at, openCount: row.open_count }; }
function rowToCategory(row: any): WebsiteCategory { return { id: row.id, name: row.name, color: row.color, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at }; }
