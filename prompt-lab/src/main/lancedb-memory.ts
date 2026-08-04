import { app } from 'electron';
import path from 'node:path';

export interface LanceMemoryChunk {
  id: string;
  documentId: string;
  filePath: string;
  fileName: string;
  title: string;
  site: string;
  startLine: number;
  endLine: number;
  content: string;
  documentModifiedAt: number;
  excerptHash: string;
  vector: number[];
}

export interface LanceMemoryMatch {
  id: string;
  distance: number;
}

const TABLE_NAME = 'conversation_chunks';
let databasePromise: Promise<any> | null = null;

async function getDatabase(): Promise<any> {
  if (!databasePromise) {
    databasePromise = import('@lancedb/lancedb').then(({ connect }) =>
      connect(path.join(app.getPath('userData'), 'memory.lancedb')));
    databasePromise.catch(() => { databasePromise = null; });
  }
  return databasePromise;
}

export async function replaceLanceMemoryIndex(chunks: LanceMemoryChunk[]): Promise<void> {
  const database = await getDatabase();
  const names = await database.tableNames();
  if (!chunks.length) {
    if (names.includes(TABLE_NAME)) await database.dropTable(TABLE_NAME);
    return;
  }
  await database.createTable(TABLE_NAME, chunks, { mode: 'overwrite' });
}

export async function searchLanceMemory(vector: number[], limit: number): Promise<LanceMemoryMatch[]> {
  if (!vector.length) return [];
  const database = await getDatabase();
  if (!(await database.tableNames()).includes(TABLE_NAME)) return [];
  const table = await database.openTable(TABLE_NAME);
  const rows = await table.vectorSearch(vector).distanceType('cosine')
    .limit(Math.max(1, Math.min(200, limit))).toArray();
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    distance: typeof row._distance === 'number' ? row._distance : Number.POSITIVE_INFINITY,
  }));
}

export async function clearLanceMemoryIndex(): Promise<void> {
  const database = await getDatabase();
  if ((await database.tableNames()).includes(TABLE_NAME)) await database.dropTable(TABLE_NAME);
}
