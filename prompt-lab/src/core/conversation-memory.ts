import type { ConversationFile } from '@/types/electron';

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
}

/** Lightweight citation persisted with chat messages; content remains in the original Markdown file. */
export type MemoryCitation = Omit<MemorySource, 'content'>;

export function toMemoryCitation(source: MemorySource): MemoryCitation {
  const { content: _content, ...citation } = source;
  return citation;
}

export interface ConversationMemoryProvider {
  readonly id: string;
  sync(): Promise<{ documents: number; chunks: number }>;
  search(query: string, limit?: number): Promise<MemorySource[]>;
  removeDocument(filePath: string): Promise<void>;
}

interface IndexedChunk extends Omit<MemorySource, 'score'> {
  vector: Record<string, number>;
  norm: number;
}

interface PersistedMemoryIndex {
  signature: string;
  chunks: IndexedChunk[];
  documentSignatures?: Record<string, string>;
}

const MAX_CHUNK_CHARS = 800;
const CHUNK_OVERLAP = 100;
const INDEX_DB_NAME = 'next-work-dashboard-memory';
const INDEX_STORE_NAME = 'indexes';
const INDEX_CACHE_KEY = 'conversation-history-v1';

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

function tokens(text: string): string[] {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const words = normalized.match(/[a-z0-9_\-.]{2,}/g) ?? [];
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

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    const cached = await readPersistedIndex();
    if (cached) {
      this.signature = cached.signature;
      this.chunks = cached.chunks;
      this.documentSignatures = cached.documentSignatures ?? {};
    }
  }

  async sync(): Promise<{ documents: number; chunks: number }> {
    await this.loadCache();
    const files = await window.electronAPI.listConversations();
    const currentSignatures = Object.fromEntries(files.map((file) => [file.path, `${file.modifiedAt}:${file.size}`]));
    let signature = files.map((file) => `${file.path}:${currentSignatures[file.path]}`).join('|');
    if (signature === this.signature) return { documents: files.length, chunks: this.chunks.length };
    const changedFiles = files.filter((file) => this.documentSignatures[file.path] !== currentSignatures[file.path]);
    const currentPaths = new Set(files.map((file) => file.path));
    const retainedChunks = this.chunks.filter((chunk) =>
      currentPaths.has(chunk.filePath) && this.documentSignatures[chunk.filePath] === currentSignatures[chunk.filePath]
    );
    const documents = await Promise.all(changedFiles.map(async (file) => {
      const result = await window.electronAPI.readConversation(file.path);
      return result.success ? { path: file.path, chunks: splitConversationDocument(file, result.content ?? '') } : null;
    }));
    for (const failed of changedFiles.filter((file) => !documents.some((document) => document?.path === file.path))) {
      delete currentSignatures[failed.path];
    }
    signature = files.filter((file) => currentSignatures[file.path]).map((file) => `${file.path}:${currentSignatures[file.path]}`).join('|');
    this.chunks = [...retainedChunks, ...documents.flatMap((document) => document?.chunks ?? [])];
    this.signature = signature;
    this.documentSignatures = currentSignatures;
    await writePersistedIndex({ signature, chunks: this.chunks, documentSignatures: currentSignatures });
    return { documents: files.length, chunks: this.chunks.length };
  }

  async search(query: string, limit = 6): Promise<MemorySource[]> {
    await this.sync();
    const encoded = vectorize(query);
    const normalizedQuery = query.toLocaleLowerCase();
    const ranked = this.chunks
      .map((chunk) => {
        const cosine = similarity(encoded.vector, encoded.norm, chunk.vector, chunk.norm);
        const keyword = chunk.content.toLocaleLowerCase().includes(normalizedQuery) ? 1 : 0;
        return { ...chunk, score: cosine * 0.75 + keyword * 0.25 };
      })
      .filter((chunk) => chunk.score >= 0.08)
      .sort((a, b) => b.score - a.score);
    const perDocument = new Map<string, number>();
    const diversified = ranked.filter((chunk) => {
      const count = perDocument.get(chunk.documentId) ?? 0;
      if (count >= 2) return false;
      perDocument.set(chunk.documentId, count + 1);
      return true;
    });
    return diversified.slice(0, limit).map(({ vector: _vector, norm: _norm, ...source }) => source);
  }

  async removeDocument(filePath: string): Promise<void> {
    this.chunks = this.chunks.filter((chunk) => chunk.filePath !== filePath);
    delete this.documentSignatures[filePath];
    this.signature = '';
    await writePersistedIndex({ signature: '', chunks: this.chunks, documentSignatures: this.documentSignatures });
  }
}

export const conversationMemory = new LocalConversationMemoryProvider();

export function buildMemoryContext(sources: MemorySource[]): string {
  if (!sources.length) return '';
  return ['[历史知识库上下文]', '请基于以下原始历史片段回答；引用事实时使用 [S1]、[S2]。上下文不足时请明确说明。',
    ...sources.map((source, index) => `[S${index + 1}] 文件：${source.fileName}；位置：第 ${source.startLine}-${source.endLine} 行\n${source.content}`),
  ].join('\n\n');
}
