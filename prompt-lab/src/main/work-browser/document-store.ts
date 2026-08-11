/**
 * DocumentStore — documents / document_versions / annotations
 */
import type Database from 'better-sqlite3';
import type { Document, DocumentId, DocumentVersion, DocumentVersionId, Annotation, AnnotationId } from '../../core/work-browser/types';
import { newId, now } from '../../core/work-browser/types';

export class DocumentStore {
  constructor(private db: Database.Database) {}

  // ── Document ──

  listDocuments(workspaceId: string, limit = 200): Document[] {
    const rows = this.db.prepare('SELECT * FROM documents WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?').all(workspaceId, limit) as any[];
    return rows.map(rowToDocument);
  }

  getDocument(id: DocumentId): Document | null {
    const r = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    return r ? rowToDocument(r) : null;
  }

  upsertDocument(doc: Document): void {
    const exists = this.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(doc.id);
    if (exists) {
      this.db.prepare(`UPDATE documents SET title=?, url=?, source_type=?, content_path=?, raw_path=?, screenshot_path=?, content_hash=?, author=?, published_at=?, captured_at=?, word_count=?, summary=?, origin_tab_id=?, updated_at=? WHERE id=?`)
        .run(doc.title, doc.url, doc.sourceType, doc.contentPath, doc.rawPath, doc.screenshotPath, doc.contentHash,
             doc.author, doc.publishedAt, doc.capturedAt, doc.wordCount, doc.summary, doc.originTabId, doc.updatedAt, doc.id);
    } else {
      this.db.prepare(`INSERT INTO documents(id, workspace_id, title, url, source_type, content_path, raw_path, screenshot_path, content_hash, author, published_at, captured_at, word_count, summary, origin_tab_id, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        doc.id, doc.workspaceId, doc.title, doc.url, doc.sourceType, doc.contentPath, doc.rawPath, doc.screenshotPath,
        doc.contentHash, doc.author, doc.publishedAt, doc.capturedAt, doc.wordCount, doc.summary, doc.originTabId, doc.createdAt, doc.updatedAt,
      );
    }
  }

  // ── DocumentVersion ──

  appendVersion(v: DocumentVersion): void {
    this.db.prepare(`INSERT INTO document_versions(id, document_id, content_hash, raw_path, diff_summary, word_delta, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(v.id, v.documentId, v.contentHash, v.rawPath, v.diffSummary, v.wordDelta, v.capturedAt);
  }

  listVersions(documentId: DocumentId, limit = 20): DocumentVersion[] {
    const rows = this.db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY captured_at DESC LIMIT ?').all(documentId, limit) as any[];
    return rows.map((r) => ({
      id: r.id, documentId: r.document_id, contentHash: r.content_hash,
      rawPath: r.raw_path, diffSummary: r.diff_summary, wordDelta: r.word_delta, capturedAt: r.captured_at,
    }));
  }

  // ── Annotation ──

  listAnnotations(documentId: DocumentId): Annotation[] {
    const rows = this.db.prepare('SELECT * FROM annotations WHERE document_id = ? ORDER BY created_at ASC').all(documentId) as any[];
    return rows.map((r) => ({
      id: r.id, documentId: r.document_id, selector: r.selector, rangeText: r.range_text,
      note: r.note, color: r.color, createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  createAnnotation(input: { documentId: DocumentId; selector: string; rangeText: string; note: string; color: Annotation['color'] }): Annotation {
    const t = now();
    const a: Annotation = {
      id: newId<AnnotationId>(), documentId: input.documentId,
      selector: input.selector, rangeText: input.rangeText, note: input.note, color: input.color,
      createdAt: t, updatedAt: t,
    };
    this.db.prepare(`INSERT INTO annotations(id, document_id, selector, range_text, note, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(a.id, a.documentId, a.selector, a.rangeText, a.note, a.color, a.createdAt, a.updatedAt);
    return a;
  }

  deleteAnnotation(id: AnnotationId): void {
    this.db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
  }
}

function rowToDocument(r: any): Document {
  return {
    id: r.id, workspaceId: r.workspace_id, title: r.title, url: r.url,
    sourceType: r.source_type, contentPath: r.content_path, rawPath: r.raw_path,
    screenshotPath: r.screenshot_path, contentHash: r.content_hash, author: r.author,
    publishedAt: r.published_at, capturedAt: r.captured_at, wordCount: r.word_count,
    summary: r.summary, originTabId: r.origin_tab_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
