/**
 * Research Graph — Page-level 边类型
 *
 * 节点：Document（已存在）+ Tab（已存在）+ Annotation（已存在）
 * 边（5 类）：
 *   cited-by        — Document A 在 RAG / Search 引用了 Document B
 *   similar-to      — Document A 与 Document B 内容相似（embedding cosine > 0.85）
 *   searched-from   — Document A 是某次 Search Query 的 top 结果
 *   opened-from     — Document A 是从某次 Search 打开的
 *   saved-with      — Document A 与 Document B 在同一 Workspace / 同一任务保存
 */
import type Database from 'better-sqlite3';
import { newId, now, type DocumentId, type TabId, type WorkspaceId, type AnnotationId } from '../types';

export type EdgeKind = 'cited-by' | 'similar-to' | 'searched-from' | 'opened-from' | 'saved-with';

export interface PageEdge {
  id: string;
  kind: EdgeKind;
  workspaceId: WorkspaceId;
  fromType: 'document' | 'tab' | 'annotation';
  fromId: string;
  toType: 'document' | 'tab' | 'annotation';
  toId: string;
  /** 边权重（cite 计数 / cosine 相似度 / 出现次数） */
  weight: number;
  metadata: string; // JSON
  createdAt: number;
}

const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS page_edges (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  from_type     TEXT NOT NULL,
  from_id       TEXT NOT NULL,
  to_type       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  UNIQUE (kind, from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_edges_workspace ON page_edges(workspace_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_from ON page_edges(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON page_edges(to_type, to_id);
`;

export class GraphStore {
  constructor(private db: Database.Database) {
    this.db.exec(SCHEMA_V3);
  }

  recordEdge(input: Omit<PageEdge, 'id' | 'createdAt'>): void {
    const id = newId<string>();
    const t = now();
    // 唯一约束下用 INSERT OR REPLACE 增加 weight
    const existing = this.db.prepare(
      'SELECT id, weight FROM page_edges WHERE kind = ? AND from_type = ? AND from_id = ? AND to_type = ? AND to_id = ?',
    ).get(input.kind, input.fromType, input.fromId, input.toType, input.toId) as { id: string; weight: number } | undefined;
    if (existing) {
      this.db.prepare('UPDATE page_edges SET weight = weight + ? WHERE id = ?').run(input.weight, existing.id);
    } else {
      this.db.prepare(
        'INSERT INTO page_edges(id, kind, workspace_id, from_type, from_id, to_type, to_id, weight, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, input.kind, input.workspaceId, input.fromType, input.fromId, input.toType, input.toId, input.weight, input.metadata, t);
    }
  }

  listByDocument(documentId: DocumentId, kinds?: EdgeKind[]): PageEdge[] {
    const kFilter = kinds && kinds.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : '';
    const rows = this.db.prepare(
      `SELECT * FROM page_edges WHERE (from_type = 'document' AND from_id = ?) OR (to_type = 'document' AND to_id = ?) ${kFilter} ORDER BY weight DESC, created_at DESC LIMIT 200`,
    ).all(...(kinds && kinds.length ? [documentId, documentId, ...kinds] : [documentId, documentId])) as any[];
    return rows.map(rowToEdge);
  }

  listByWorkspace(workspaceId: WorkspaceId, kind?: EdgeKind, limit = 200): PageEdge[] {
    const kFilter = kind ? 'AND kind = ?' : '';
    const params: any[] = [workspaceId];
    if (kind) params.push(kind);
    params.push(limit);
    const rows = this.db.prepare(
      `SELECT * FROM page_edges WHERE workspace_id = ? ${kFilter} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params) as any[];
    return rows.map(rowToEdge);
  }

  /** 自动从 Search 结果批量记 cited-by 边 */
  recordCitedBy(workspaceId: WorkspaceId, source: 'web' | 'rag' | 'hybrid', results: Array<{ canonicalUrl: string; documentId?: string; title?: string }>): number {
    let count = 0;
    for (const r of results) {
      if (!r.documentId) continue; // 跳过未保存的网页
      this.recordEdge({
        kind: 'cited-by',
        workspaceId,
        fromType: 'document',
        fromId: r.documentId,
        toType: 'document',
        toId: r.documentId, // 自引用边 = search 来源记录
        weight: 1,
        metadata: JSON.stringify({ source, url: r.canonicalUrl, title: r.title || '' }),
      });
      count++;
    }
    return count;
  }
}

function rowToEdge(r: any): PageEdge {
  return {
    id: r.id,
    kind: r.kind,
    workspaceId: r.workspace_id,
    fromType: r.from_type,
    fromId: r.from_id,
    toType: r.to_type,
    toId: r.to_id,
    weight: r.weight,
    metadata: r.metadata,
    createdAt: r.created_at,
  };
}
