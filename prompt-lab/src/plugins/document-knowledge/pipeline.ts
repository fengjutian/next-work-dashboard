import { createLocalEmbeddings } from '@/core/memory/local-embedding';
import type { MemoryConfig } from '@/store';
import { chunkDocument } from './chunking';
import { createHashEmbeddings } from './hash-embedding';
import { parseDocument } from './parser';
import type { DocumentChunk, ParsedDocument } from './types';

const BATCH_SIZE = 16;

export type EmbeddingMode = 'remote-semantic' | 'local-semantic' | 'hash-fallback';
interface EmbeddingResult { vectors: number[][]; mode: EmbeddingMode }

async function remoteEmbeddings(inputs: string[], config: MemoryConfig): Promise<number[][]> {
  const result = await window.electronAPI.createEmbeddings({
    baseUrl: config.embeddingBaseUrl,
    apiKey: config.embeddingApiKey,
    model: config.embeddingModel,
    inputs,
  });
  if (!result.success || !result.embeddings) throw new Error(result.error ?? '远程向量化失败');
  return result.embeddings;
}

async function embed(inputs: string[], config: MemoryConfig, requested?: EmbeddingMode): Promise<EmbeddingResult> {
  if (requested === 'hash-fallback') return { vectors: createHashEmbeddings(inputs), mode: requested };
  if (requested === 'remote-semantic') return { vectors: await remoteEmbeddings(inputs, config), mode: requested };
  if (requested === 'local-semantic') {
    return { vectors: await createLocalEmbeddings(inputs, config.localEmbeddingModel), mode: requested };
  }

  if (config.provider === 'openai' && config.embeddingBaseUrl && config.embeddingApiKey) {
    try {
      return { vectors: await remoteEmbeddings(inputs, config), mode: 'remote-semantic' };
    } catch (error) {
      console.warn('[DocumentKnowledge] Remote embeddings unavailable; trying local semantic model.', error);
    }
  }
  try {
    return { vectors: await createLocalEmbeddings(inputs, config.localEmbeddingModel), mode: 'local-semantic' };
  } catch (error) {
    console.warn('[DocumentKnowledge] Local semantic model unavailable; using hash fallback.', error);
    return { vectors: createHashEmbeddings(inputs), mode: 'hash-fallback' };
  }
}

export async function indexDocument(
  file: File,
  memoryConfig: MemoryConfig,
  onProgress?: (stage: string, progress: number) => void,
  requestedMode?: EmbeddingMode,
): Promise<{ document: ParsedDocument; chunks: DocumentChunk[]; embeddingMode: EmbeddingMode }> {
  onProgress?.('正在解析文档', 10);
  const document = await parseDocument(file);
  const rawChunks = chunkDocument(document);
  if (!rawChunks.length) throw new Error('没有提取到可索引的文本，请确认文件不是纯扫描件');
  const chunks: DocumentChunk[] = [];
  let embeddingMode = requestedMode;
  for (let offset = 0; offset < rawChunks.length; offset += BATCH_SIZE) {
    const batch = rawChunks.slice(offset, offset + BATCH_SIZE);
    onProgress?.('正在进行语义向量化', 25 + Math.round(offset / rawChunks.length * 70));
    const embedded = await embed(batch.map((item) => `${item.sectionTitle}\n${item.content}`), memoryConfig, embeddingMode);
    embeddingMode = embedded.mode;
    batch.forEach((item, index) => chunks.push({ ...item, vector: embedded.vectors[index] }));
  }
  onProgress?.('索引完成', 100);
  return { document, chunks, embeddingMode: embeddingMode ?? 'hash-fallback' };
}

export async function embedQuestion(question: string, memoryConfig: MemoryConfig, mode: EmbeddingMode): Promise<number[]> {
  const { vectors: [vector] } = await embed([question], memoryConfig, mode);
  if (!vector) throw new Error('问题向量化失败');
  return vector;
}

export async function reembedDocumentChunks(
  chunks: DocumentChunk[],
  memoryConfig: MemoryConfig,
  requestedMode?: EmbeddingMode,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ chunks: DocumentChunk[]; embeddingMode: EmbeddingMode }> {
  const rebuilt: DocumentChunk[] = [];
  let embeddingMode = requestedMode;
  for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + BATCH_SIZE);
    const embedded = await embed(batch.map((item) => `${item.sectionTitle}\n${item.content}`), memoryConfig, embeddingMode);
    embeddingMode = embedded.mode;
    batch.forEach((item, index) => rebuilt.push({ ...item, vector: embedded.vectors[index] }));
    onProgress?.(Math.min(offset + batch.length, chunks.length), chunks.length);
  }
  return { chunks: rebuilt, embeddingMode: embeddingMode ?? 'hash-fallback' };
}
