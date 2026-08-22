/**
 * Embedder — Transformers.js 封装
 *
 * 默认模型：Xenova/all-MiniLM-L6-v2（384 维，本地下载，多语言）
 * 通过 @huggingface/transformers pipeline('feature-extraction') 推理
 *
 * 懒加载：首次调用时初始化 pipeline，之后复用
 */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_DIM = 384;

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dim: number;
  took: number;
}

// Per-model cache. A `Map<modelId, Promise<pipeline>>` keeps concurrent
// calls with different model IDs from racing on a single shared promise
// (the previous implementation overwrote `currentModel` while another
// call was awaiting initialization, returning the wrong pipeline).
const pipelineCache = new Map<string, Promise<FeatureExtractionPipeline>>();
let envConfigured = false;

async function configureEnvOnce(): Promise<void> {
  if (envConfigured) return;
  envConfigured = true;
  const transformers = await import('@huggingface/transformers') as any;
  if (!transformers.env?.cacheDir) {
    try {
      const { app } = await import('electron');
      transformers.env.cacheDir = `${app.getPath('userData')}/transformers-cache`;
      transformers.env.allowLocalModels = true;
    } catch { /* 在非 Electron 环境（如 vitest）跑时跳过 */ }
  }
}

async function getPipeline(modelId: string = DEFAULT_MODEL_ID): Promise<FeatureExtractionPipeline> {
  const cached = pipelineCache.get(modelId);
  if (cached) return await cached;
  const promise = (async () => {
    await configureEnvOnce();
    const transformers = await import('@huggingface/transformers') as any;
    const { pipeline } = transformers;
    return await pipeline('feature-extraction', modelId, { dtype: 'q8' });
  })();
  pipelineCache.set(modelId, promise);
  return await promise;
}

/**
 * 把单条文本 encode 成 384 维向量（mean-pooled）
 */
export async function embed(text: string, modelId: string = DEFAULT_MODEL_ID): Promise<EmbeddingResult> {
  if (!text.trim()) return { vector: [], model: modelId, dim: 0, took: 0 };
  const t0 = Date.now();
  const pipe = await getPipeline(modelId);
  const out = await pipe(text, { pooling: 'mean', normalize: true });
  // out.data 是 Float32Array，转 number[]
  const vector = Array.from(out.data as Float32Array);
  return { vector, model: modelId, dim: vector.length, took: Date.now() - t0 };
}

/**
 * 批量 embed
 */
export async function embedBatch(texts: string[], modelId: string = DEFAULT_MODEL_ID): Promise<EmbeddingResult[]> {
  if (!texts.length) return [];
  const pipe = await getPipeline(modelId);
  const t0 = Date.now();
  const out = await pipe(texts, { pooling: 'mean', normalize: true });
  // out.data 是 N x dim 的扁平数组，按 dim 切分
  const dim = out.dims?.[out.dims.length - 1] ?? DEFAULT_DIM;
  const data = out.data as Float32Array;
  const result: EmbeddingResult[] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * dim;
    const vector = Array.from(data.slice(start, start + dim));
    result.push({ vector, model: modelId, dim, took: 0 });
  }
  if (result.length) result[0].took = Date.now() - t0;
  return result;
}

/** 单元测试用：重置 pipeline 缓存（mock 时不需要等懒加载） */
export function _resetEmbedderForTests(): void {
  pipelineCache.clear();
  envConfigured = false;
}
