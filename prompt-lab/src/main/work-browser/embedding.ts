/**
 * Embedding indexer — 把 document 异步入 lance 索引
 *
 * 流程：
 *  1. 拿到 documentId + plainText
 *  2. chunk 文本
 *  3. 调 embedder 拿 vector
 *  4. 调 applyLanceDocumentOperations 入索引
 *  5. 失败重试（最多 3 次，指数退避）
 *
 * 注意：embedding 初始化需要下载模型（约 23MB），首次会慢。
 */
import { chunkText, embedBatch, DEFAULT_MODEL_ID } from '../../core/work-browser/embedding';
import type { LanceDocumentIndexOperation } from '../lancedb-memory';
import { applyLanceDocumentOperations } from '../lancedb-memory';
import type { DocumentId } from '../../core/work-browser/types';
import { getDatabase } from './database';

export interface IndexDocumentInput {
  documentId: DocumentId;
  title: string;
  plainText: string;
  workspaceId?: string;
  url?: string;
  modelId?: string;
}

let _queue: Promise<void> = Promise.resolve();

/**
 * 异步把 document 入向量索引（不阻塞 save 主流程）
 * 串行化：单 worker 顺序处理，避免同时下载模型/抢占 GPU
 */
export function enqueueIndexDocument(input: IndexDocumentInput): void {
  updateJob(input.documentId, 'pending', 0, null);
  _queue = _queue.then(() => runIndexJob(input));
}

async function runIndexJob(input: IndexDocumentInput): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    updateJob(input.documentId, 'indexing', attempt, null);
    try {
      await indexDocument(input);
      updateJob(input.documentId, 'indexed', attempt, null);
      return;
    } catch (error) {
      lastError = error;
      updateJob(input.documentId, attempt === 3 ? 'failed' : 'pending', attempt, errorMessage(error));
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
  console.error(`[work-browser] index failed for ${input.documentId}:`, lastError);
}

function updateJob(documentId: DocumentId, status: 'pending' | 'indexing' | 'indexed' | 'failed', attempts: number, error: string | null): void {
  getDatabase().prepare(`
    INSERT INTO document_index_jobs(document_id, status, attempts, error, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      status=excluded.status, attempts=excluded.attempts, error=excluded.error, updated_at=excluded.updated_at
  `).run(documentId, status, attempts, error, Date.now());
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

/** 等所有排队任务完成（用于测试 / 应用退出） */
export async function drainIndexQueue(): Promise<void> {
  await _queue;
}

export async function indexDocument(input: IndexDocumentInput): Promise<{ chunks: number; model: string }> {
  if (!input.plainText || input.plainText.length < 16) {
    return { chunks: 0, model: input.modelId || DEFAULT_MODEL_ID };
  }
  const modelId = input.modelId || DEFAULT_MODEL_ID;
  const chunks = chunkText(input.plainText, { maxChars: 800, overlapChars: 80 });
  if (!chunks.length) return { chunks: 0, model: modelId };

  // 1. embed 全部 chunks
  const results = await embedBatch(chunks.map((c) => c.text), modelId);
  if (!results.length || !results[0].vector.length) {
    return { chunks: 0, model: modelId };
  }
  const dim = results[0].vector.length;

  // 2. 构造 lance operations
  const operations: LanceDocumentIndexOperation[] = results.map((r, i) => ({
    id: 0,
    operation: 'upsert_vector' as const,
    chunkId: `${input.documentId}::${i}`,
    documentId: input.documentId,
    payload: {
      content: chunks[i].text,
      sectionTitle: chunks[i].text.slice(0, 80),
      page: chunks[i].index,
      vector: r.vector,
      modelId,
    },
    retryCount: 0,
  }));

  // 3. apply（lancedb-memory 内部按 dimension 分表，模型变更会自建新表）
  await applyLanceDocumentOperations(operations);
  console.log(`[work-browser] indexed ${chunks.length} chunks (${dim}-d) for ${input.documentId}`);
  return { chunks: chunks.length, model: modelId };
}
