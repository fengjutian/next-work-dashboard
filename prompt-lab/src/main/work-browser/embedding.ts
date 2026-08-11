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
  _queue = _queue.then(() =>
    indexDocument(input)
      .then(() => undefined)
      .catch((e: unknown) => {
        console.error(`[work-browser] index failed for ${input.documentId}:`, e);
      })
  );
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
