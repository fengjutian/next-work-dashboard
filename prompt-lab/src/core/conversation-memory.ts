import type { ConversationFile } from '@/types/electron';
import type { MemoryConfig } from '@/store/types';
import { createLocalEmbeddings } from './memory/local-embedding';

type EmbeddingBackend = 'remote' | 'local' | 'sparse';

export interface MemorySource {
  documentId: string;
  filePath: string;
  fileName: string;
  title?: string;
  site: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  documentModifiedAt: number;
  excerptHash: string;
}

/** Lightweight citation persisted with chat messages; content remains in the original Markdown file. */
export type MemoryCitation = Omit<MemorySource, 'content'>;

export function toMemoryCitation(source: MemorySource | MemoryCitation): MemoryCitation {
  const citation = 'content' in source
    ? (({ content: _content, ...rest }) => rest)(source)
    : source;
  return {
    ...citation,
    documentModifiedAt: citation.documentModifiedAt ?? 0,
    excerptHash: citation.excerptHash ?? '',
  };
}

export interface ConversationMemoryProvider {
  readonly id: string;
  sync(options?: MemorySyncOptions): Promise<MemoryIndexStats>;
  search(query: string, limit?: number): Promise<MemorySource[]>;
  removeDocument(filePath: string): Promise<void>;
}

export interface MemoryIndexStats {
  documents: number;
  chunks: number;
  failedFiles: string[];
  durationMs: number;
  embeddingFallback: boolean;
  embeddingBackend?: EmbeddingBackend;
}

export interface MemorySyncProgress {
  phase: 'reading' | 'embedding' | 'saving';
  completed: number;
  total: number;
  fileName?: string;
}

export interface MemorySyncOptions {
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: MemorySyncProgress) => void;
}

interface IndexedChunk extends Omit<MemorySource, 'score'> {
  vector: Record<string, number>;
  norm: number;
  denseVector?: number[];
  denseNorm?: number;
}

interface PersistedMemoryIndex {
  signature: string;
  chunks: IndexedChunk[];
  documentSignatures?: Record<string, string>;
  embeddingBackend?: EmbeddingBackend;
}

const MAX_CHUNK_CHARS = 800;
const CHUNK_OVERLAP = 100;
const INDEX_DB_NAME = 'next-work-dashboard-memory';
const INDEX_STORE_NAME = 'indexes';
const INDEX_CACHE_KEY = 'conversation-history-v3';
export const DEFAULT_MEMORY_CONTEXT_BUDGET = 6000;

/**
 * Produces domain-neutral retrieval variants. A complete question remains the
 * primary query; interrogative clauses are also removed so a document heading
 * can match the subject even when it does not contain the user's full question.
 */
export function deriveMemoryQueries(query: string): string[] {
  const original = query.replace(/[？?！!。]+$/g, '').trim();
  if (!original) return [];
  const candidates = new Set<string>([original]);
  const questionClause = original.match(/^(.{2,}?)(?:为什么|为何|怎么会|怎么|如何)(?:.*)$/)?.[1]?.trim();
  if (questionClause && questionClause.length >= 2) candidates.add(questionClause);
  const normalized = original
    .replace(/(?:为什么|为何|怎么会|怎么|如何|请问|是否|能否)/g, ' ')
    .replace(/(?:这么|那么|这样|那样|究竟|到底)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length >= 2 && normalized !== original) candidates.add(normalized);
  return [...candidates].slice(0, 3);
}

export function hashMemoryText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function openIndexDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(INDEX_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(INDEX_STORE_NAME)) {
        request.result.createObjectStore(INDEX_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readPersistedIndex(): Promise<PersistedMemoryIndex | null> {
  const db = await openIndexDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(INDEX_STORE_NAME, 'readonly').objectStore(INDEX_STORE_NAME).get(INDEX_CACHE_KEY);
    request.onsuccess = () => resolve((request.result as PersistedMemoryIndex | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

async function writePersistedIndex(index: PersistedMemoryIndex): Promise<void> {
  const db = await openIndexDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(INDEX_STORE_NAME, 'readwrite');
    transaction.objectStore(INDEX_STORE_NAME).put(index, INDEX_CACHE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
}

async function clearPersistedIndex(): Promise<void> {
  const db = await openIndexDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(INDEX_STORE_NAME, 'readwrite');
    transaction.objectStore(INDEX_STORE_NAME).delete(INDEX_CACHE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
}

function tokens(text: string): string[] {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const words: string[] = normalized.match(/[a-z0-9_\-.]{2,}/g) ?? [];
  const chinese = normalized.replace(/[^\u3400-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) words.push(chinese.slice(index, index + 2));
  return words;
}

function vectorize(text: string): { vector: Record<string, number>; norm: number } {
  const vector: Record<string, number> = {};
  for (const token of tokens(text)) vector[token] = (vector[token] ?? 0) + 1;
  const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0));
  return { vector, norm };
}

function similarity(a: Record<string, number>, aNorm: number, b: Record<string, number>, bNorm: number): number {
  if (!aNorm || !bNorm) return 0;
  const [small, large] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  let dot = 0;
  for (const [key, value] of Object.entries(small)) dot += value * (large[key] ?? 0);
  return dot / (aNorm * bNorm);
}

function denseNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function denseSimilarity(a: number[], aNorm: number, b: number[], bNorm: number): number {
  if (!aNorm || !bNorm || a.length !== b.length) return 0;
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return dot / (aNorm * bNorm);
}

function bm25Scores(query: string, chunks: IndexedChunk[]): Map<IndexedChunk, number> {
  const queryTokens = [...new Set(tokens(query))];
  const scores = new Map<IndexedChunk, number>();
  if (!queryTokens.length || !chunks.length) return scores;
  const lengths = chunks.map((chunk) => Object.values(chunk.vector).reduce((sum, count) => sum + count, 0));
  const averageLength = lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, lengths.length);
  const documentFrequency = Object.fromEntries(queryTokens.map((token) => [token,
    chunks.reduce((count, chunk) => count + (chunk.vector[token] ? 1 : 0), 0)]));
  chunks.forEach((chunk, index) => {
    let score = 0;
    for (const token of queryTokens) {
      const frequency = chunk.vector[token] ?? 0;
      if (!frequency) continue;
      const idf = Math.log(1 + (chunks.length - documentFrequency[token] + 0.5) / (documentFrequency[token] + 0.5));
      const denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * lengths[index] / Math.max(1, averageLength));
      score += idf * frequency * 2.2 / denominator;
    }
    scores.set(chunk, score / (score + 3));
  });
  return scores;
}

function mergeAdjacentChunks(chunks: Array<IndexedChunk & { score: number }>): Array<IndexedChunk & { score: number }> {
  const merged: Array<IndexedChunk & { score: number }> = [];
  for (const chunk of chunks) {
    if (merged.some((item) => item.excerptHash === chunk.excerptHash)) continue;
    const neighbor = merged.find((item) => item.documentId === chunk.documentId
      && chunk.startLine <= item.endLine + 2 && chunk.endLine >= item.startLine - 2);
    if (!neighbor) { merged.push({ ...chunk }); continue; }
    if (chunk.startLine < neighbor.startLine) neighbor.content = `${chunk.content}\n${neighbor.content}`;
    else if (chunk.endLine > neighbor.endLine) neighbor.content = `${neighbor.content}\n${chunk.content}`;
    neighbor.startLine = Math.min(neighbor.startLine, chunk.startLine);
    neighbor.endLine = Math.max(neighbor.endLine, chunk.endLine);
    neighbor.score = Math.max(neighbor.score, chunk.score);
    neighbor.excerptHash = hashMemoryText(neighbor.content);
  }
  return merged;
}

export function splitConversationDocument(file: ConversationFile, content: string): IndexedChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: IndexedChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && (size < MAX_CHUNK_CHARS || end === start)) {
      size += lines[end].length + 1;
      end += 1;
      if (size >= MAX_CHUNK_CHARS && /^#{1,3}\s/.test(lines[end] ?? '')) break;
    }
    const chunkContent = lines.slice(start, end).join('\n').trim();
    if (chunkContent) {
      const encoded = vectorize(`${file.title ?? ''} ${file.site} ${chunkContent}`);
      chunks.push({
        documentId: file.path,
        filePath: file.path,
        fileName: file.fileName,
        title: file.title,
        site: file.site,
        startLine: start + 1,
        endLine: end,
        content: chunkContent,
        documentModifiedAt: file.modifiedAt,
        excerptHash: hashMemoryText(chunkContent),
        ...encoded,
      });
    }
    if (end >= lines.length) break;
    let overlap = 0;
    let nextStart = end;
    while (nextStart > start + 1 && overlap < CHUNK_OVERLAP) {
      nextStart -= 1;
      overlap += lines[nextStart].length + 1;
    }
    start = nextStart;
  }
  return chunks;
}

export class LocalConversationMemoryProvider implements ConversationMemoryProvider {
  readonly id = 'local-conversation-memory';
  private chunks: IndexedChunk[] = [];
  private signature = '';
  private documentSignatures: Record<string, string> = {};
  private cacheLoaded = false;
  private activeSync: Promise<MemoryIndexStats> | null = null;
  private embeddingBackend: EmbeddingBackend = 'sparse';
  private searchConfig: MemoryConfig = {
    provider: 'local', contextBudget: 6000, recallCount: 6,
    minScore: 0.08,
    maxPerDocument: 2,
    autoIndex: true, embeddingBaseUrl: '', embeddingApiKey: '', embeddingModel: 'text-embedding-3-small',
    localEmbeddingEnabled: false, localEmbeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    tencentDbEnabled: false, tencentDbBaseUrl: 'http://localhost:8420',
    tencentDbServiceId: '', tencentDbUserKey: '',
  };

  configure(config: MemoryConfig): void {
    this.searchConfig = { ...config,
      minScore: Math.max(0, Math.min(1, config.minScore)),
      maxPerDocument: Math.max(1, Math.min(10, Math.floor(config.maxPerDocument))) };
  }

  private embeddingIdentity(): string {
    const remote = this.searchConfig.provider === 'openai'
      ? `remote:${this.searchConfig.embeddingBaseUrl}:${this.searchConfig.embeddingModel}`
      : 'remote:disabled';
    const local = this.searchConfig.localEmbeddingEnabled
      ? `local:${this.searchConfig.localEmbeddingModel}`
      : 'local:disabled';
    return `${remote}|${local}`;
  }

  private semanticEmbeddingRequested(): boolean {
    return this.searchConfig.provider === 'openai' || this.searchConfig.localEmbeddingEnabled;
  }

  private async embedChunksWith(chunks: IndexedChunk[], backend: Exclude<EmbeddingBackend, 'sparse'>, options?: MemorySyncOptions): Promise<boolean> {
    for (let offset = 0; offset < chunks.length; offset += 32) {
      if (options?.signal?.aborted) throw new Error('INDEX_CANCELLED');
      const batch = chunks.slice(offset, offset + 32);
      options?.onProgress?.({ phase: 'embedding', completed: offset, total: chunks.length });
      let embeddings: number[][];
      try {
        if (backend === 'remote') {
          const result = await window.electronAPI.createEmbeddings({
            baseUrl: this.searchConfig.embeddingBaseUrl, apiKey: this.searchConfig.embeddingApiKey,
            model: this.searchConfig.embeddingModel, inputs: batch.map((chunk) => chunk.content),
          });
          if (!result.success || result.embeddings?.length !== batch.length) return false;
          embeddings = result.embeddings;
        } else {
          embeddings = await createLocalEmbeddings(batch.map((chunk) => chunk.content), this.searchConfig.localEmbeddingModel);
        }
      } catch { return false; }
      embeddings.forEach((embedding, index) => {
        batch[index].denseVector = embedding;
        batch[index].denseNorm = denseNorm(embedding);
      });
    }
    options?.onProgress?.({ phase: 'embedding', completed: chunks.length, total: chunks.length });
    return true;
  }

  private async embedChunks(chunks: IndexedChunk[], options?: MemorySyncOptions): Promise<EmbeddingBackend> {
    if (!chunks.length) return this.embeddingBackend;
    const remoteConfigured = this.searchConfig.provider === 'openai'
      && !!this.searchConfig.embeddingBaseUrl && !!this.searchConfig.embeddingApiKey && !!this.searchConfig.embeddingModel;
    const preferExistingLocal = this.embeddingBackend === 'local' && this.searchConfig.localEmbeddingEnabled;
    if (preferExistingLocal && await this.embedChunksWith(chunks, 'local', options)) return 'local';
    if (remoteConfigured && await this.embedChunksWith(chunks, 'remote', options)) return 'remote';
    chunks.forEach((chunk) => { delete chunk.denseVector; delete chunk.denseNorm; });
    if (this.embeddingBackend !== 'remote' && this.searchConfig.localEmbeddingEnabled && this.searchConfig.localEmbeddingModel
      && await this.embedChunksWith(chunks, 'local', options)) return 'local';
    chunks.forEach((chunk) => { delete chunk.denseVector; delete chunk.denseNorm; });
    return 'sparse';
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    const cached = await readPersistedIndex();
    if (cached) {
      this.signature = cached.signature;
      this.chunks = cached.chunks;
      this.documentSignatures = cached.documentSignatures ?? {};
      this.embeddingBackend = cached.embeddingBackend ?? (cached.chunks.some((chunk) => chunk.denseVector) ? 'remote' : 'sparse');
    }
  }

  async sync(options: MemorySyncOptions = {}): Promise<MemoryIndexStats> {
    if (this.activeSync) {
      if (!options.force) return this.activeSync;
      try { await this.activeSync; } catch { /* start the requested rebuild */ }
    }
    const run = this.performSync(options);
    this.activeSync = run;
    try { return await run; }
    finally { if (this.activeSync === run) this.activeSync = null; }
  }

  private async performSync(options: MemorySyncOptions): Promise<MemoryIndexStats> {
    const startedAt = Date.now();
    await this.loadCache();
    if (options.force) {
      this.signature = '';
      this.documentSignatures = {};
      this.chunks = [];
    }
    const files = await window.electronAPI.listConversations();
    const identity = this.embeddingIdentity();
    const currentSignatures = Object.fromEntries(files.map((file) => [file.path, `${file.modifiedAt}:${file.size}:${identity}`]));
    let signature = files.map((file) => `${file.path}:${currentSignatures[file.path]}`).join('|');
    if (signature === this.signature) return {
      documents: files.length, chunks: this.chunks.length, failedFiles: [], durationMs: Date.now() - startedAt,
      embeddingFallback: this.embeddingBackend === 'sparse' && this.semanticEmbeddingRequested(), embeddingBackend: this.embeddingBackend,
    };
    const changedFiles = files.filter((file) => this.documentSignatures[file.path] !== currentSignatures[file.path]);
    const currentPaths = new Set(files.map((file) => file.path));
    const retainedChunks = this.chunks.filter((chunk) =>
      currentPaths.has(chunk.filePath) && this.documentSignatures[chunk.filePath] === currentSignatures[chunk.filePath]
    );
    const documents: Array<{ path: string; chunks: IndexedChunk[] } | null> = [];
    for (let index = 0; index < changedFiles.length; index += 1) {
      if (options.signal?.aborted) throw new Error('INDEX_CANCELLED');
      const file = changedFiles[index];
      options.onProgress?.({ phase: 'reading', completed: index, total: changedFiles.length, fileName: file.fileName });
      if (options.signal?.aborted) throw new Error('INDEX_CANCELLED');
      const result = await window.electronAPI.readConversation(file.path);
      documents.push(result.success ? { path: file.path, chunks: splitConversationDocument(file, result.content ?? '') } : null);
    }
    options.onProgress?.({ phase: 'reading', completed: changedFiles.length, total: changedFiles.length });
    const failedFiles = changedFiles.filter((file) => !documents.some((document) => document?.path === file.path));
    for (const failed of failedFiles) {
      delete currentSignatures[failed.path];
    }
    signature = files.filter((file) => currentSignatures[file.path]).map((file) => `${file.path}:${currentSignatures[file.path]}`).join('|');
    const newChunks = documents.flatMap((document) => document?.chunks ?? []);
    const embeddingBackend = await this.embedChunks(newChunks, options);
    if (embeddingBackend === 'sparse' && (this.searchConfig.provider === 'openai' || this.searchConfig.localEmbeddingEnabled)) {
      for (const file of changedFiles) delete currentSignatures[file.path];
      signature = files.filter((file) => currentSignatures[file.path]).map((file) => `${file.path}:${currentSignatures[file.path]}`).join('|');
    }
    this.chunks = [...retainedChunks, ...newChunks];
    this.signature = signature;
    this.documentSignatures = currentSignatures;
    this.embeddingBackend = embeddingBackend;
    if (options.signal?.aborted) throw new Error('INDEX_CANCELLED');
    options.onProgress?.({ phase: 'saving', completed: 0, total: 1 });
    await writePersistedIndex({ signature, chunks: this.chunks, documentSignatures: currentSignatures, embeddingBackend });
    options.onProgress?.({ phase: 'saving', completed: 1, total: 1 });
    return { documents: files.length, chunks: this.chunks.length,
      failedFiles: failedFiles.map((file) => file.fileName), durationMs: Date.now() - startedAt,
      embeddingFallback: embeddingBackend === 'sparse' && this.semanticEmbeddingRequested(), embeddingBackend };
  }

  async clear(): Promise<void> {
    this.signature = '';
    this.documentSignatures = {};
    this.chunks = [];
    this.cacheLoaded = true;
    this.embeddingBackend = 'sparse';
    await clearPersistedIndex();
  }

  async search(query: string, limit = 6): Promise<MemorySource[]> {
    await this.sync();
    const queries = deriveMemoryQueries(query);
    if (!queries.length) return [];
    const encodedQueries = queries.map(vectorize);
    let queryDenseVectors: number[][] = [];
    try {
      if (this.embeddingBackend === 'remote') {
        const result = await window.electronAPI.createEmbeddings({
          baseUrl: this.searchConfig.embeddingBaseUrl, apiKey: this.searchConfig.embeddingApiKey,
          model: this.searchConfig.embeddingModel, inputs: queries,
        });
        queryDenseVectors = result.success ? (result.embeddings ?? []) : [];
      } else if (this.embeddingBackend === 'local') {
        queryDenseVectors = await createLocalEmbeddings(queries, this.searchConfig.localEmbeddingModel);
      }
    } catch { queryDenseVectors = []; }
    const queryDenseNorms = queryDenseVectors.map(denseNorm);
    const normalizedQuery = query.toLocaleLowerCase();
    const bm25Variants = queries.map((candidate) => bm25Scores(candidate, this.chunks));
    const now = Date.now();
    const ranked = mergeAdjacentChunks(this.chunks
      .map((chunk) => {
        const sparse = Math.max(...encodedQueries.map((encoded) => similarity(encoded.vector, encoded.norm, chunk.vector, chunk.norm)));
        const dense = chunk.denseVector && queryDenseVectors.length
          ? Math.max(...queryDenseVectors.map((vector, index) => denseSimilarity(vector, queryDenseNorms[index], chunk.denseVector!, chunk.denseNorm ?? denseNorm(chunk.denseVector!))))
          : 0;
        const keyword = chunk.content.toLocaleLowerCase().includes(normalizedQuery) ? 1 : 0;
        const field = Math.max(
          ...encodedQueries.map((encoded) => similarity(encoded.vector, encoded.norm, vectorize(chunk.title ?? '').vector, vectorize(chunk.title ?? '').norm)),
          ...encodedQueries.map((encoded) => similarity(encoded.vector, encoded.norm, vectorize(chunk.site).vector, vectorize(chunk.site).norm)),
        );
        const freshness = Math.exp(-Math.max(0, now - chunk.documentModifiedAt) / (180 * 24 * 60 * 60 * 1000));
        const lexical = Math.max(...bm25Variants.map((scores) => scores.get(chunk) ?? 0));
        const score = queryDenseVectors.length && chunk.denseVector
          ? dense * 0.65 + lexical * 0.15 + sparse * 0.10 + keyword * 0.05 + field * 0.03 + freshness * 0.02
          : lexical * 0.35 + sparse * 0.35 + keyword * 0.15 + field * 0.10 + freshness * 0.05;
        return { ...chunk, score };
      })
      .filter((chunk) => chunk.score >= this.searchConfig.minScore)
      .sort((a, b) => b.score - a.score));
    const perDocument = new Map<string, number>();
    const diversified = ranked.filter((chunk) => {
      const count = perDocument.get(chunk.documentId) ?? 0;
      if (count >= this.searchConfig.maxPerDocument) return false;
      perDocument.set(chunk.documentId, count + 1);
      return true;
    });
    return diversified.slice(0, limit).map(({
      vector: _vector, norm: _norm, denseVector: _denseVector, denseNorm: _denseNorm, ...source
    }) => source);
  }

  async removeDocument(filePath: string): Promise<void> {
    this.chunks = this.chunks.filter((chunk) => chunk.filePath !== filePath);
    delete this.documentSignatures[filePath];
    this.signature = '';
    await writePersistedIndex({ signature: '', chunks: this.chunks, documentSignatures: this.documentSignatures });
  }
}

export const conversationMemory = new LocalConversationMemoryProvider();

export function selectMemorySourcesForBudget(
  sources: MemorySource[],
  budget = DEFAULT_MEMORY_CONTEXT_BUDGET,
): MemorySource[] {
  const selected: MemorySource[] = [];
  let used = 0;
  for (const source of sources) {
    const overhead = source.fileName.length + 100;
    if (selected.length > 0 && used + overhead + source.content.length > budget) continue;
    const available = Math.max(200, budget - used - overhead);
    selected.push(source.content.length > available
      ? { ...source, content: `${source.content.slice(0, available)}\n[片段已按上下文预算截断]` }
      : source);
    used += overhead + Math.min(source.content.length, available);
    if (used >= budget) break;
  }
  return selected;
}

export function buildMemoryContext(sources: MemorySource[], budget = DEFAULT_MEMORY_CONTEXT_BUDGET): string {
  if (!sources.length) return '';
  const selected = selectMemorySourcesForBudget(sources, budget);
  return ['[历史知识库上下文]', '请基于以下原始历史片段回答；引用事实时使用 [S1]、[S2]。上下文不足时请明确说明。',
    ...selected.map((source, index) => `[S${index + 1}] 文件：${source.fileName}；位置：第 ${source.startLine}-${source.endLine} 行\n${source.content}`),
  ].join('\n\n');
}
