export type WereadAnalysisDocument = { id: string; text: string };

const STOP_WORDS = new Set(['一个', '一些', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '自己', '什么', '为什么', '怎么', '可以', '不是', '没有', '就是', '因为', '所以', '但是', '如果', '已经', '还是', '以及', '而且', '对于', '通过', '进行', '这种', '一种', '可能', '需要', '应该', '非常', '这样', '作者', '书中', 'the', 'and', 'that', 'this', 'with', 'from', 'have']);
const tokenCache = new Map<string, string[]>();
const tfidfCache = new Map<string, Map<string, number>>();
const MAX_CACHE_ENTRIES = 2_000;

function trimCache<T>(cache: Map<string, T>): void {
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

export function extractWereadWords(text: string): string[] {
  const key = `${text.length}:${hashText(text)}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const normalized = text.toLocaleLowerCase();
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  const raw = Segmenter
    ? [...new Segmenter('zh-CN', { granularity: 'word' }).segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment)
    : normalized.match(/[a-z][a-z0-9]{2,}|[\u4e00-\u9fff]{2,6}/g) || [];
  const words = raw.map((word) => word.trim()).filter((word) => word.length >= 2 && word.length <= 16 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  tokenCache.set(key, words); trimCache(tokenCache);
  return words;
}

export function tfIdfWereadTerms(documents: WereadAnalysisDocument[]): Map<string, number> {
  const signature = documents.map((document) => `${document.id}:${document.text.length}:${hashText(document.text)}`).join('|');
  const cached = tfidfCache.get(signature);
  if (cached) return new Map(cached);
  const tokenized = documents.map((document) => extractWereadWords(document.text));
  const documentFrequency = new Map<string, number>();
  for (const words of tokenized) for (const word of new Set(words)) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  const scores = new Map<string, number>();
  for (const words of tokenized) {
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    for (const [word, count] of counts) {
      const idf = Math.log((documents.length + 1) / ((documentFrequency.get(word) || 0) + 1)) + 1;
      scores.set(word, (scores.get(word) || 0) + count * idf);
    }
  }
  tfidfCache.set(signature, scores); trimCache(tfidfCache);
  return new Map(scores);
}

export function clearWereadAnalysisCache(): void { tokenCache.clear(); tfidfCache.clear(); }
