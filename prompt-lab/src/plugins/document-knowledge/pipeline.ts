import type { MemoryConfig } from '@/store';
import { chunkDocument } from './chunking';
import { createHashEmbeddings } from './hash-embedding';
import { parseDocument } from './parser';
import type { DocumentChunk, ParsedDocument } from './types';

const BATCH_SIZE = 16;

async function embed(inputs: string[], config: MemoryConfig): Promise<number[][]> {
  if (config.provider === 'local') {
    return createHashEmbeddings(inputs);
  }
  const result = await window.electronAPI.createEmbeddings({
    baseUrl: config.embeddingBaseUrl,
    apiKey: config.embeddingApiKey,
    model: config.embeddingModel,
    inputs,
  });
  if (!result.success || !result.embeddings) throw new Error(result.error ?? '向量化失败');
  return result.embeddings;
}

export async function indexDocument(
  file: File,
  memoryConfig: MemoryConfig,
  onProgress?: (stage: string, progress: number) => void,
): Promise<{ document: ParsedDocument; chunks: DocumentChunk[] }> {
  onProgress?.('正在解析文档', 10);
  const document = await parseDocument(file);
  const rawChunks = chunkDocument(document);
  if (!rawChunks.length) throw new Error('没有提取到可索引的文本，请确认文件不是纯扫描件');
  const chunks: DocumentChunk[] = [];
  for (let offset = 0; offset < rawChunks.length; offset += BATCH_SIZE) {
    const batch = rawChunks.slice(offset, offset + BATCH_SIZE);
    onProgress?.('正在向量化', 25 + Math.round(offset / rawChunks.length * 70));
    const vectors = await embed(batch.map((item) => `${item.sectionTitle}\n${item.content}`), memoryConfig);
    batch.forEach((item, index) => chunks.push({ ...item, vector: vectors[index] }));
  }
  onProgress?.('索引完成', 100);
  return { document, chunks };
}

export async function embedQuestion(question: string, memoryConfig: MemoryConfig): Promise<number[]> {
  const [vector] = await embed([question], memoryConfig);
  if (!vector) throw new Error('问题向量化失败');
  return vector;
}
