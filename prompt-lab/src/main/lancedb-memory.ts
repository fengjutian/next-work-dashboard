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
const DOCUMENT_TABLE_PREFIX = 'document_chunks_';
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

export interface LanceDocumentIndexOperation {
  id: number;
  operation: 'upsert_vector' | 'delete_vector' | 'delete_document';
  chunkId?: string;
  documentId?: string;
  payload: { content?: string; sectionTitle?: string; page?: number; vector?: number[]; modelId?: string };
  retryCount: number;
}

function sqlString(value: string): string { return `'${value.replace(/'/g, "''")}'`; }

async function documentTableNames(): Promise<string[]> {
  return (await (await getDatabase()).tableNames()).filter((name: string) => name.startsWith(DOCUMENT_TABLE_PREFIX));
}

export async function applyLanceDocumentOperations(operations: LanceDocumentIndexOperation[]): Promise<void> {
  if (!operations.length) return;
  const groups = new Map<number, Array<Record<string, unknown>>>();
  for (const operation of operations) {
    if (operation.operation !== 'upsert_vector' || !operation.chunkId || !operation.documentId) continue;
    const vector = operation.payload.vector;
    const modelId = operation.payload.modelId;
    if (!Array.isArray(vector) || !vector.length || vector.some((value) => !Number.isFinite(value)) || !modelId) {
      throw new Error(`INVALID_DOCUMENT_VECTOR:${operation.id}`);
    }
    const rows = groups.get(vector.length) ?? [];
    rows.push({ id: operation.chunkId, documentId: operation.documentId, modelId,
      content: operation.payload.content ?? '', sectionTitle: operation.payload.sectionTitle ?? '',
      page: operation.payload.page ?? -1, vector });
    groups.set(vector.length, rows);
  }
  const database = await getDatabase();
  const existingNames = new Set<string>(await database.tableNames());
  const deleteChunkIds = [...new Set(operations.filter((item) => item.operation === 'delete_vector').flatMap((item) => item.chunkId ? [item.chunkId] : []))];
  const deleteDocumentIds = [...new Set(operations.filter((item) => item.operation === 'delete_document').flatMap((item) => item.documentId ? [item.documentId] : []))];
  for (const name of await documentTableNames()) {
    const table = await database.openTable(name);
    for (let offset = 0; offset < deleteChunkIds.length; offset += 250) {
      const ids = deleteChunkIds.slice(offset, offset + 250);
      if (ids.length) await table.delete(`id IN (${ids.map(sqlString).join(',')})`);
    }
    for (let offset = 0; offset < deleteDocumentIds.length; offset += 250) {
      const ids = deleteDocumentIds.slice(offset, offset + 250);
      if (ids.length) await table.delete(`documentId IN (${ids.map(sqlString).join(',')})`);
    }
  }
  for (const [dimension, rows] of groups) {
    const name = `${DOCUMENT_TABLE_PREFIX}${dimension}`;
    if (!existingNames.has(name)) {
      await database.createTable(name, rows);
      existingNames.add(name);
    } else {
      const table = await database.openTable(name);
      await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
    }
  }
}

export async function searchLanceDocuments(vector: number[], modelId: string, limit: number): Promise<LanceMemoryMatch[]> {
  if (!vector.length || !modelId) return [];
  const database = await getDatabase();
  const name = `${DOCUMENT_TABLE_PREFIX}${vector.length}`;
  if (!(await database.tableNames()).includes(name)) return [];
  const table = await database.openTable(name);
  const rows = await table.vectorSearch(vector).distanceType('cosine')
    .where(`modelId = ${sqlString(modelId)}`).limit(Math.max(1, Math.min(200, limit))).toArray();
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    distance: typeof row._distance === 'number' ? row._distance : Number.POSITIVE_INFINITY,
  }));
}
