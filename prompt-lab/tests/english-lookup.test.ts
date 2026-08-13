import { describe, expect, it } from 'vitest';
import { addLookupHistory, buildVocabularyGraph, dueForReview, mergeEntry, normalizeQuery, normalizeWord, parseLookupResponse, reviewEntry } from '../src/plugins/english-lookup/model';

const response = JSON.stringify({ word: 'Serendipity', phonetic: '/ˌserənˈdɪpəti/', partOfSpeech: 'noun', definitions: [{ meaning: '意外发现美好事物的幸运', example: 'We met by serendipity.', translation: '我们因缘际会。' }], collocations: ['pure serendipity'], topics: ['discovery'], relations: [{ word: 'chance', type: 'synonym' }, { word: 'planned', type: 'antonym' }], memoryTip: '把它想成一次幸运偶遇。' });

describe('english lookup model', () => {
  it('normalizes safe English queries', () => expect(normalizeWord("  Mother's   Day! ")).toBe("mother's day"));
  it('parses structured AI output including fenced JSON', () => { const entry = parseLookupResponse(`\`\`\`json\n${response}\n\`\`\``, 'serendipity', 10); expect(entry.word).toBe('serendipity'); expect(entry.relations).toHaveLength(2); expect(entry.createdAt).toBe(10); });
  it('preserves the original creation time when updating', () => { const old = parseLookupResponse(response, 'serendipity', 10); const next = parseLookupResponse(response, 'serendipity', 20); expect(mergeEntry(old, next)).toMatchObject({ createdAt: 10, updatedAt: 20 }); });
  it('builds deduplicated word and topic relationships', () => { const entry = parseLookupResponse(response, 'serendipity'); const graph = buildVocabularyGraph([entry]); expect(graph.nodes.map((node) => node.id)).toContain('topic:discovery'); expect(graph.links.some((link) => link.value === 'synonym')).toBe(true); });
  it('rejects a response without definitions', () => expect(() => parseLookupResponse('{"word":"test"}', 'test')).toThrow(/缺少释义/));
  it('keeps sentence context while normalizing whitespace', () => expect(normalizeQuery('  I  ran into it.  ')).toBe('I ran into it.'));
  it('deduplicates recent history case-insensitively', () => expect(addLookupHistory([{ query: 'Test', word: 'test', lookedUpAt: 1 }], { query: 'test', word: 'test', lookedUpAt: 2 })).toEqual([{ query: 'test', word: 'test', lookedUpAt: 2 }]));
  it('schedules reviews from learner feedback', () => { const entry = parseLookupResponse(response, 'serendipity', 10); const reviewed = reviewEntry(entry, 'known', 100); expect(reviewed.familiarity).toBe('mastered'); expect(reviewed.nextReviewAt).toBeGreaterThan(100); expect(dueForReview([reviewed], 101)).toHaveLength(0); });
  it('parses word forms, definition parts of speech and comparisons', () => { const entry = parseLookupResponse(JSON.stringify({ word: 'run', definitions: [{ partOfSpeech: 'verb', meaning: '跑' }], forms: [{ label: '过去式', value: 'ran' }], comparisons: [{ word: 'jog', difference: '速度较慢' }] }), 'run'); expect(entry.definitions[0].partOfSpeech).toBe('verb'); expect(entry.forms).toEqual([{ label: '过去式', value: 'ran' }]); expect(entry.comparisons?.[0].word).toBe('jog'); });
});
