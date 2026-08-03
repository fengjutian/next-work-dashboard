export interface LocalEmbeddingProgress {
  status: string;
  file?: string;
  progress?: number;
}

type FeatureExtractor = (
  inputs: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): unknown }>;

const pipelines = new Map<string, Promise<FeatureExtractor>>();

async function loadPipeline(
  model: string,
  onProgress?: (progress: LocalEmbeddingProgress) => void,
): Promise<FeatureExtractor> {
  let cached = pipelines.get(model);
  if (!cached) {
    cached = import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.useBrowserCache = true;
      const extractor = await pipeline('feature-extraction', model, {
        dtype: 'q8',
        progress_callback: (event: LocalEmbeddingProgress) => onProgress?.(event),
      });
      return extractor as unknown as FeatureExtractor;
    });
    pipelines.set(model, cached);
    cached.catch(() => pipelines.delete(model));
  }
  return cached;
}

export async function createLocalEmbeddings(
  inputs: string[],
  model: string,
  onProgress?: (progress: LocalEmbeddingProgress) => void,
): Promise<number[][]> {
  if (!inputs.length) return [];
  const extractor = await loadPipeline(model, onProgress);
  const output = await extractor(inputs, { pooling: 'mean', normalize: true });
  const values = output.tolist();
  if (!Array.isArray(values) || values.length !== inputs.length
    || values.some((vector) => !Array.isArray(vector) || vector.some((value) => typeof value !== 'number'))) {
    throw new Error('INVALID_LOCAL_EMBEDDING_RESPONSE');
  }
  return values as number[][];
}

export async function testLocalEmbedding(model: string): Promise<number> {
  const [vector] = await createLocalEmbeddings(['本地语义检索测试'], model);
  return vector?.length ?? 0;
}
