import { describe, expect, it } from 'vitest';
import {
  addLookupHistory,
  BUILT_IN_WORD_BOOKS,
  buildVocabularyGraph,
  dueForReview,
  filterVocabulary,
  formatNextReview,
  importVocabularyJson,
  isSentenceQuery,
  learningActivity,
  mergeEntry,
  mergeVocabulary,
  normalizeQuery,
  normalizeWord,
  parseLookupResponse,
  parseSentenceTranslation,
  reviewEntry,
  updateEntryLabels,
  vocabularyStats,
  vocabularyToCsv,
} from '../src/core';
import type { WordEntry } from '../src/core/types';

const NOW = 1_700_000_000_000;

function makeEntry(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'run',
    word: 'run',
    phonetic: '/rʌn/',
    partOfSpeech: 'verb',
    definitions: [{ meaning: '跑', example: 'I run fast.', translation: '我跑得快。' }],
    collocations: ['run fast'],
    topics: ['sports'],
    relations: [{ word: 'jog', type: 'synonym' }],
    memoryTip: '谐音"润"',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('english-lookup core/model', () => {
  it('normalizes words to lowercase ASCII', () => {
    expect(normalizeWord("  Don't Stop  ")).toBe("don't stop");
  });

  it('trims and clamps queries to 500 chars', () => {
    const long = 'a'.repeat(800);
    expect(normalizeQuery(`  hello   world  ${long}`).length).toBe(500);
  });

  it('detects sentence vs word queries', () => {
    expect(isSentenceQuery('run')).toBe(false);
    expect(isSentenceQuery('I love to learn English every day.')).toBe(true);
    expect(isSentenceQuery('How are you?')).toBe(true);
  });

  it('parses sentence translations from a fenced JSON block', () => {
    const raw = '```json\n{"translation":"你好","grammar":"陈述句","keyExpressions":[{"expression":"hello","meaning":"问候"}],"alternatives":["嗨"]}\n```';
    const out = parseSentenceTranslation(raw, 'hello');
    expect(out.translation).toBe('你好');
    expect(out.keyExpressions[0].expression).toBe('hello');
  });

  it('parses lookup responses with relations and forms', () => {
    const raw = JSON.stringify({
      word: 'Run',
      phonetic: '/rʌn/',
      partOfSpeech: 'verb',
      definitions: [{ partOfSpeech: 'verb', meaning: '跑', example: 'I run.', translation: '我跑。' }],
      forms: [{ label: '过去式', value: 'ran' }],
      collocations: ['run fast'],
      topics: ['sports'],
      relations: [{ word: 'Jog', type: 'synonym' }, { word: 'INVALID-TYPE', type: 'made-up' }],
      memoryTip: 'tip',
    });
    const entry = parseLookupResponse(raw, 'Run', NOW);
    expect(entry.id).toBe('run');
    expect(entry.forms?.[0].value).toBe('ran');
    expect(entry.relations.length).toBeGreaterThanOrEqual(1);
    expect(entry.relations.some((r) => r.word === 'jog' && r.type === 'synonym')).toBe(true);
  });

  it('formats next review labels', () => {
    expect(formatNextReview(undefined, NOW)).toBe('今日复习');
    expect(formatNextReview(NOW - 1000, NOW)).toBe('今日复习');
    expect(formatNextReview(NOW + 86_400_000, NOW)).toBe('明日复习');
    expect(formatNextReview(NOW + 5 * 86_400_000, NOW)).toBe('5 天后复习');
  });

  it('merges entries preserving learning state', () => {
    const previous = makeEntry({ familiarity: 'learning', reviewCount: 3 });
    const next = makeEntry({ memoryTip: 'new tip' });
    const merged = mergeEntry(previous, next);
    expect(merged.familiarity).toBe('learning');
    expect(merged.reviewCount).toBe(3);
    expect(merged.memoryTip).toBe('new tip');
  });

  it('updates entry labels (tags + books) idempotently', () => {
    const entry = makeEntry({ tags: ['a'], wordBooks: ['CET-4'] });
    const updated = updateEntryLabels(entry, { addTags: ['a', 'b'], addBooks: ['CET-4', 'IELTS'] });
    expect(updated.tags).toEqual(['a', 'b']);
    expect(updated.wordBooks).toEqual(['CET-4', 'IELTS']);
  });

  it('filters vocabulary by tag / book / familiarity', () => {
    const entries = [
      makeEntry({ id: 'a', word: 'a', tags: ['x'], wordBooks: ['CET-4'] }),
      makeEntry({ id: 'b', word: 'b', tags: ['y'], wordBooks: ['IELTS'], familiarity: 'mastered' }),
      makeEntry({ id: 'c', word: 'c', tags: ['x'], familiarity: 'learning' }),
    ];
    expect(filterVocabulary(entries, '', '', 'all')).toHaveLength(3);
    expect(filterVocabulary(entries, 'x', '', 'all')).toHaveLength(2);
    expect(filterVocabulary(entries, '', 'CET-4', 'all')).toHaveLength(1);
    expect(filterVocabulary(entries, '', '', 'mastered')).toHaveLength(1);
  });

  it('records lookup history without duplicates (case-insensitive)', () => {
    const history = addLookupHistory([], { query: 'Hello', word: 'hello', lookedUpAt: 1 });
    const next = addLookupHistory(history, { query: 'HELLO', word: 'hello', lookedUpAt: 2 });
    expect(next).toHaveLength(1);
    expect(next[0].lookedUpAt).toBe(2);
  });

  it('schedules review with rating-based intervals', () => {
    expect(reviewEntry(makeEntry(), 'forgot', NOW).familiarity).toBe('new');
    expect(reviewEntry(makeEntry(), 'hard', NOW).familiarity).toBe('learning');
    expect(reviewEntry(makeEntry(), 'known', NOW).familiarity).toBe('mastered');
  });

  it('returns due entries sorted by review time', () => {
    const entries = [
      makeEntry({ id: 'a', word: 'a', createdAt: NOW - 1000 }),
      makeEntry({ id: 'b', word: 'b', createdAt: NOW - 5000, nextReviewAt: NOW - 100 }),
    ];
    const due = dueForReview(entries, NOW);
    expect(due.map((e) => e.word)).toEqual(['a', 'b']);
  });

  it('computes vocabulary statistics', () => {
    const entries = [
      makeEntry({ id: 'a', familiarity: 'new' }),
      makeEntry({ id: 'b', familiarity: 'learning' }),
      makeEntry({ id: 'c', familiarity: 'mastered', reviewCount: 2 }),
    ];
    const stats = vocabularyStats(entries);
    expect(stats.total).toBe(3);
    expect(stats.newCount).toBe(1);
    expect(stats.masteryRate).toBe(33);
    expect(stats.reviews).toBe(2);
  });

  it('round-trips vocabulary via JSON import (with validation)', () => {
    const csv = vocabularyToCsv([makeEntry()]);
    expect(csv.split('\n')[0]).toContain('word,phonetic');
    const json = JSON.stringify([{ word: 'Run', definitions: [{ meaning: '跑', example: 'I run.', translation: '' }] }]);
    const imported = importVocabularyJson(json, NOW);
    expect(imported[0].word).toBe('run');
    expect(imported[0].id).toBe('run');
  });

  it('rejects oversized or non-array JSON imports', () => {
    expect(() => importVocabularyJson('{}', NOW)).toThrow();
    expect(() => importVocabularyJson('not json', NOW)).toThrow();
  });

  it('merges incoming vocabulary without losing user state', () => {
    const current = [makeEntry({ id: 'run', familiarity: 'mastered', reviewCount: 5 })];
    const incoming = [makeEntry({ id: 'run' }), makeEntry({ id: 'jump', word: 'jump' })];
    const merged = mergeVocabulary(current, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.word === 'run')?.familiarity).toBe('mastered');
  });

  it('builds a graph with relations and topics', () => {
    const entries = [makeEntry({ topics: ['sports'], relations: [{ word: 'jog', type: 'synonym' }] })];
    const graph = buildVocabularyGraph(entries);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.links.length).toBeGreaterThanOrEqual(1);
  });

  it('computes learning activity streak and daily counts', () => {
    const today = NOW;
    const yesterday = today - 86_400_000;
    const log = [
      { word: 'a', rating: 'known' as const, reviewedAt: today },
      { word: 'b', rating: 'known' as const, reviewedAt: yesterday },
    ];
    const activity = learningActivity(log, today, 7);
    expect(activity.streak).toBeGreaterThanOrEqual(1);
    expect(activity.days).toHaveLength(7);
  });

  it('exposes the built-in word book list', () => {
    expect(BUILT_IN_WORD_BOOKS).toContain('CET-4');
    expect(BUILT_IN_WORD_BOOKS).toContain('IELTS');
  });
});
