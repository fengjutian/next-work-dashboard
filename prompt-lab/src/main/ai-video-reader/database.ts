import BetterSqlite3 from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import type { TranscriptSegment, VideoReaderProject, VideoSearchResult } from '../../core/ai-video-reader/types';

let database: BetterSqlite3.Database | undefined;

function db(): BetterSqlite3.Database {
  if (database) return database;
  database = new BetterSqlite3(path.join(app.getPath('userData'), 'ai-video-reader.db'));
  database.exec(`
    CREATE TABLE IF NOT EXISTS video_segments (
      project_id TEXT NOT NULL, project_name TEXT NOT NULL, segment_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, text TEXT NOT NULL,
      PRIMARY KEY (project_id, segment_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS video_segments_fts USING fts5(project_id UNINDEXED, segment_id UNINDEXED, text, tokenize='unicode61');
  `);
  return database;
}

export function indexVideoProject(project: VideoReaderProject): void {
  const connection = db();
  connection.transaction(() => {
    connection.prepare('DELETE FROM video_segments WHERE project_id = ?').run(project.id);
    connection.prepare('DELETE FROM video_segments_fts WHERE project_id = ?').run(project.id);
    const row = connection.prepare('INSERT INTO video_segments VALUES (?, ?, ?, ?, ?, ?, ?)');
    const fts = connection.prepare('INSERT INTO video_segments_fts(project_id, segment_id, text) VALUES (?, ?, ?)');
    for (const segment of project.segments) { row.run(project.id, project.name, segment.id, segment.index, segment.startMs, segment.endMs, segment.text); fts.run(project.id, segment.id, segment.text); }
  })();
}

export function removeVideoProject(projectId: string): void {
  const connection = db(); connection.prepare('DELETE FROM video_segments WHERE project_id = ?').run(projectId); connection.prepare('DELETE FROM video_segments_fts WHERE project_id = ?').run(projectId);
}

export function searchVideoSegments(query: string, projectId?: string, limit = 20): VideoSearchResult[] {
  const connection = db(); const normalized = query.trim(); if (!normalized) return [];
  let rows: Array<Record<string, unknown>> = [];
  try {
    const terms = normalized.split(/\s+/).filter(Boolean).map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    rows = connection.prepare(`SELECT s.* FROM video_segments_fts f JOIN video_segments s ON s.project_id=f.project_id AND s.segment_id=f.segment_id WHERE video_segments_fts MATCH ? ${projectId ? 'AND s.project_id = ?' : ''} ORDER BY bm25(video_segments_fts) LIMIT ?`).all(...(projectId ? [terms, projectId, limit] : [terms, limit])) as Array<Record<string, unknown>>;
  } catch { /* Chinese phrases and punctuation may need LIKE fallback */ }
  if (!rows.length) rows = connection.prepare(`SELECT * FROM video_segments WHERE text LIKE ? ${projectId ? 'AND project_id = ?' : ''} ORDER BY segment_index LIMIT ?`).all(...(projectId ? [`%${normalized}%`, projectId, limit] : [`%${normalized}%`, limit])) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ projectId: String(row.project_id), projectName: String(row.project_name), id: String(row.segment_id), index: Number(row.segment_index), startMs: Number(row.start_ms), endMs: Number(row.end_ms), text: String(row.text) }));
}

export function projectContext(project: VideoReaderProject, question: string): TranscriptSegment[] {
  const indexed = searchVideoSegments(question, project.id, 8);
  return indexed.length ? indexed : project.segments.slice(0, 8);
}
