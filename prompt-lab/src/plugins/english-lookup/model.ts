import type { LookupHistoryItem, ReviewLogItem, VocabularyGraph, WordEntry, WordRelation } from './types';

type JsonRecord = Record<string, unknown>;
const relationTypes = new Set<WordRelation['type']>(['synonym', 'antonym', 'related', 'word-family']);

function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function strings(value: unknown, limit: number): string[] { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit) : []; }

export function normalizeWord(value: string): string { return value.trim().toLocaleLowerCase('en-US').replace(/[^a-z\-' ]/g, '').replace(/\s+/g, ' '); }

export function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 500);
}

export function parseLookupResponse(raw: string, requestedWord: string, now = Date.now()): WordEntry {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的词典数据，请重试');
  let data: JsonRecord;
  try { data = record(JSON.parse(fenced.slice(start, end + 1))); } catch { throw new Error('AI 返回格式不完整，请重试'); }
  const word = normalizeWord(String(data.word || requestedWord));
  if (!word) throw new Error('请输入有效的英文单词或短语');
  const definitions = Array.isArray(data.definitions) ? data.definitions.map(record).map((item) => ({
    partOfSpeech: String(item.partOfSpeech || '').trim() || undefined, meaning: String(item.meaning || '').trim(), example: String(item.example || '').trim(), translation: String(item.translation || '').trim(),
  })).filter((item) => item.meaning).slice(0, 6) : [];
  if (!definitions.length) throw new Error('AI 返回结果缺少释义，请重试');
  const relations: WordRelation[] = Array.isArray(data.relations) ? data.relations.map(record).map((item) => ({
    word: normalizeWord(String(item.word || '')),
    type: relationTypes.has(item.type as WordRelation['type']) ? item.type as WordRelation['type'] : 'related',
  })).filter((item) => item.word && item.word !== word).slice(0, 16) : [];
  const forms = Array.isArray(data.forms) ? data.forms.map(record).map((item) => ({ label: String(item.label || '').trim(), value: String(item.value || '').trim() })).filter((item) => item.label && item.value).slice(0, 10) : [];
  const comparisons = Array.isArray(data.comparisons) ? data.comparisons.map(record).map((item) => ({ word: normalizeWord(String(item.word || '')), difference: String(item.difference || '').trim(), example: String(item.example || '').trim() || undefined })).filter((item) => item.word && item.difference).slice(0, 6) : [];
  const suggestions = strings(data.suggestions, 5).map(normalizeWord).filter((item) => item && item !== word);
  return { id: word, word, phonetic: String(data.phonetic || '').trim(), partOfSpeech: String(data.partOfSpeech || '').trim(), definitions, forms, comparisons, suggestions, collocations: strings(data.collocations, 10), topics: strings(data.topics, 6), relations, memoryTip: String(data.memoryTip || '').trim(), createdAt: now, updatedAt: now };
}

export function formatNextReview(nextReviewAt: number | undefined, now = Date.now()): string {
  if (!nextReviewAt || nextReviewAt <= now) return '今日复习';
  const days = Math.ceil((nextReviewAt - now) / 86_400_000);
  return days === 1 ? '明日复习' : `${days} 天后复习`;
}

export function mergeEntry(previous: WordEntry | undefined, next: WordEntry): WordEntry {
  return previous ? { ...next, familiarity: previous.familiarity, reviewCount: previous.reviewCount, nextReviewAt: previous.nextReviewAt, createdAt: previous.createdAt, updatedAt: next.updatedAt } : next;
}

export function addLookupHistory(history: LookupHistoryItem[], item: LookupHistoryItem, limit = 20): LookupHistoryItem[] {
  return [item, ...history.filter((entry) => entry.query.toLocaleLowerCase('en-US') !== item.query.toLocaleLowerCase('en-US'))].slice(0, limit);
}

export function reviewEntry(entry: WordEntry, rating: 'forgot' | 'hard' | 'known', now = Date.now()): WordEntry {
  const reviewCount = (entry.reviewCount ?? 0) + 1;
  const days = rating === 'forgot' ? 1 : rating === 'hard' ? Math.min(7, Math.max(2, reviewCount * 2)) : Math.min(90, Math.max(7, reviewCount * 7));
  return { ...entry, familiarity: rating === 'forgot' ? 'new' : rating === 'hard' ? 'learning' : 'mastered', reviewCount, nextReviewAt: now + days * 86_400_000, updatedAt: now };
}

export function dueForReview(entries: WordEntry[], now = Date.now()): WordEntry[] {
  return entries.filter((entry) => (entry.nextReviewAt ?? entry.createdAt) <= now).sort((a, b) => (a.nextReviewAt ?? a.createdAt) - (b.nextReviewAt ?? b.createdAt));
}

export function vocabularyStats(entries: WordEntry[]): { total: number; newCount: number; learning: number; mastered: number; reviews: number; masteryRate: number } {
  const newCount = entries.filter((entry) => (entry.familiarity ?? 'new') === 'new').length;
  const learning = entries.filter((entry) => entry.familiarity === 'learning').length;
  const mastered = entries.filter((entry) => entry.familiarity === 'mastered').length;
  const reviews = entries.reduce((sum, entry) => sum + (entry.reviewCount ?? 0), 0);
  return { total: entries.length, newCount, learning, mastered, reviews, masteryRate: entries.length ? Math.round(mastered / entries.length * 100) : 0 };
}

function csvCell(value: unknown): string { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

export function vocabularyToCsv(entries: WordEntry[]): string {
  const rows = entries.map((entry) => [entry.word, entry.phonetic, entry.partOfSpeech, entry.definitions.map((item) => item.meaning).join('；'), entry.definitions[0]?.example ?? '', entry.familiarity ?? 'new', entry.reviewCount ?? 0]);
  return ['word,phonetic,partOfSpeech,meanings,example,familiarity,reviewCount', ...rows.map((row) => row.map(csvCell).join(','))].join('\n');
}

export function importVocabularyJson(raw: string, now = Date.now()): WordEntry[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('JSON 文件格式不正确'); }
  if (!Array.isArray(value)) throw new Error('JSON 文件必须是单词数组');
  return value.map(record).map((item) => {
    const word = normalizeWord(String(item.word || ''));
    const definitions = Array.isArray(item.definitions) ? item.definitions.map(record).map((definition) => ({ partOfSpeech: String(definition.partOfSpeech || '').trim() || undefined, meaning: String(definition.meaning || '').trim(), example: String(definition.example || '').trim(), translation: String(definition.translation || '').trim() })).filter((definition) => definition.meaning) : [];
    if (!word || !definitions.length) return null;
    return { ...item, id: word, word, definitions, collocations: strings(item.collocations, 10), topics: strings(item.topics, 6), relations: [], phonetic: String(item.phonetic || ''), partOfSpeech: String(item.partOfSpeech || ''), memoryTip: String(item.memoryTip || ''), createdAt: Number(item.createdAt) || now, updatedAt: now } as WordEntry;
  }).filter((entry): entry is WordEntry => entry !== null);
}

export function mergeVocabulary(current: WordEntry[], incoming: WordEntry[]): WordEntry[] {
  const merged = new Map(current.map((entry) => [entry.word, entry]));
  for (const entry of incoming) merged.set(entry.word, mergeEntry(merged.get(entry.word), entry));
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function localDay(timestamp: number): string { const date = new Date(timestamp); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

export function learningActivity(log: ReviewLogItem[], now = Date.now(), days = 7): { today: number; streak: number; days: Array<{ date: string; count: number }> } {
  const counts = new Map<string, number>();
  for (const item of log) counts.set(localDay(item.reviewedAt), (counts.get(localDay(item.reviewedAt)) ?? 0) + 1);
  const result = Array.from({ length: days }, (_, offset) => { const date = new Date(now); date.setDate(date.getDate() - (days - 1 - offset)); const key = localDay(date.getTime()); return { date: key, count: counts.get(key) ?? 0 }; });
  let streak = 0; const cursor = new Date(now);
  while ((counts.get(localDay(cursor.getTime())) ?? 0) > 0) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return { today: counts.get(localDay(now)) ?? 0, streak, days: result };
}

export function buildVocabularyGraph(entries: WordEntry[]): VocabularyGraph {
  const nodes = new Map<string, VocabularyGraph['nodes'][number]>();
  const links = new Map<string, VocabularyGraph['links'][number]>();
  const saved = new Set(entries.map((entry) => entry.word));
  const addNode = (name: string, category: number) => { const id = category === 2 ? `topic:${name}` : name; if (!nodes.has(id)) nodes.set(id, { id, name, category, symbolSize: category === 0 ? 30 : category === 2 ? 16 : 20, saved: saved.has(name) }); return id; };
  for (const entry of entries) {
    const source = addNode(entry.word, 0);
    for (const relation of entry.relations) { const target = addNode(relation.word, 1); const key = `${source}\0${target}\0${relation.type}`; links.set(key, { source, target, value: relation.type }); }
    for (const topic of entry.topics) { const target = addNode(topic, 2); const key = `${source}\0${target}\0topic`; links.set(key, { source, target, value: 'topic' }); }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}
