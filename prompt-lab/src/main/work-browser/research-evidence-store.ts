import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type EvidenceStatus = 'clue' | 'verified' | 'disputed';
export interface ResearchEvidenceRecord {
  id: string;
  researchId: string;
  workspaceId: string;
  title: string;
  url: string;
  excerpt: string;
  status: EvidenceStatus;
  occurrenceCount: number;
  createdAt: number;
  updatedAt: number;
}

export class ResearchEvidenceStore {
  constructor(private db: Database.Database) {}

  record(researchId: string, workspaceId: string, citations: Array<{ title: string; url: string; excerpt: string }>): ResearchEvidenceRecord[] {
    const counts = new Map<string, number>();
    citations.forEach((citation) => counts.set(citation.url, (counts.get(citation.url) || 0) + 1));
    const unique = new Map(citations.map((citation) => [citation.url, citation]));
    const insert = this.db.prepare(`
      INSERT INTO research_evidence(id, research_id, workspace_id, title, url, excerpt, status, occurrence_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(research_id, url) DO UPDATE SET
        title=excluded.title, excerpt=excluded.excerpt, status=excluded.status,
        occurrence_count=excluded.occurrence_count, updated_at=excluded.updated_at
    `);
    const now = Date.now();
    this.db.transaction(() => {
      for (const citation of unique.values()) {
        const count = counts.get(citation.url) || 1;
        insert.run(randomUUID(), researchId, workspaceId, citation.title, citation.url, citation.excerpt, count > 1 ? 'verified' : 'clue', count, now, now);
      }
    })();
    return this.list(researchId);
  }

  list(researchId: string): ResearchEvidenceRecord[] {
    return (this.db.prepare('SELECT * FROM research_evidence WHERE research_id=? ORDER BY status DESC, occurrence_count DESC').all(researchId) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id), researchId: String(row.research_id), workspaceId: String(row.workspace_id),
        title: String(row.title), url: String(row.url), excerpt: String(row.excerpt), status: row.status as EvidenceStatus,
        occurrenceCount: Number(row.occurrence_count), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      }));
  }

  setStatus(id: string, status: EvidenceStatus): void {
    this.db.prepare('UPDATE research_evidence SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id);
  }
}
