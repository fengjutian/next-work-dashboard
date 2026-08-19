export interface CacheEntry<T> { key: string; value: T; createdAt: number; hits: number }
export interface RetryJob<T> { id: string; payload: T; attempts: number; nextAttemptAt: number; lastError?: string }
export interface DependencyGraph { edges: Record<string, string[]> }

export const stableContentKey = (parts: Array<string | number | boolean | undefined>) => {
  const value = parts.join('\u241f'); let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
};

export class ReviewResultCache<T> {
  constructor(private entries: Record<string, CacheEntry<T>> = {}, private maxEntries = 200) {}
  get(key: string): T | undefined { const entry = this.entries[key]; if (!entry) return undefined; entry.hits += 1; return entry.value; }
  set(key: string, value: T) { this.entries[key] = { key, value, createdAt: Date.now(), hits: 0 }; const overflow = Object.values(this.entries).sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, Object.keys(this.entries).length - this.maxEntries)); overflow.forEach((entry) => delete this.entries[entry.key]); }
  serialize() { return { ...this.entries }; }
}

export function scheduleRetry<T>(queue: RetryJob<T>[], payload: T, error: unknown, now = Date.now()): RetryJob<T>[] {
  const previous = queue.find((item) => JSON.stringify(item.payload) === JSON.stringify(payload)); const attempts = (previous?.attempts ?? 0) + 1;
  const job: RetryJob<T> = { id: previous?.id ?? `retry-${now}-${Math.random().toString(36).slice(2, 7)}`, payload, attempts, nextAttemptAt: now + Math.min(300_000, 2 ** attempts * 1_000), lastError: error instanceof Error ? error.message : String(error) };
  return [...queue.filter((item) => item.id !== job.id), job];
}

export async function processInChunks<T, R>(items: T[], worker: (item: T, index: number) => Promise<R> | R, options: { chunkSize?: number; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {}): Promise<R[]> {
  const output: R[] = []; const chunkSize = Math.max(1, options.chunkSize ?? 8);
  for (let index = 0; index < items.length; index += 1) { if (options.signal?.aborted) throw new DOMException('任务已取消', 'AbortError'); output.push(await worker(items[index], index)); options.onProgress?.(index + 1, items.length); if ((index + 1) % chunkSize === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
  return output;
}

export function buildDependencyGraph(chapters: string[], links: Array<{ from: string; to: string }>): DependencyGraph {
  const sets = Object.fromEntries(chapters.map((chapter) => [chapter, new Set<string>()]));
  links.forEach(({ from, to }) => { if (!sets[from] || !sets[to] || from === to) return; sets[from].add(to); sets[to].add(from); });
  return { edges: Object.fromEntries(Object.entries(sets).map(([chapter, values]) => [chapter, [...values].sort()])) };
}

export function affectedByChange(graph: DependencyGraph, changed: string, maxDepth = 2): string[] {
  const result = new Set([changed]); let frontier = [changed];
  for (let depth = 0; depth < maxDepth; depth += 1) { const next = frontier.flatMap((node) => graph.edges[node] ?? []).filter((node) => !result.has(node)); next.forEach((node) => result.add(node)); frontier = [...new Set(next)]; if (!frontier.length) break; }
  return [...result];
}
