import { describe, expect, it } from 'vitest';
import { buildVocabularyGraph, mergeEntry, normalizeWord, parseLookupResponse } from '../src/plugins/english-lookup/model';

const response = JSON.stringify({ word: 'Serendipity', phonetic: '/ˌserənˈdɪpəti/', partOfSpeech: 'noun', definitions: [{ meaning: '意外发现美好事物的幸运', example: 'We met by serendipity.', translation: '我们因缘际会。' }], collocations: ['pure serendipity'], topics: ['discovery'], relations: [{ word: 'chance', type: 'synonym' }, { word: 'planned', type: 'antonym' }], memoryTip: '把它想成一次幸运偶遇。' });

describe('english lookup model', () => {
  it('normalizes safe English queries', () => expect(normalizeWord("  Mother's   Day! ")).toBe("mother's day"));
  it('parses structured AI output including fenced JSON', () => { const entry = parseLookupResponse(`\`\`\`json\n${response}\n\`\`\``, 'serendipity', 10); expect(entry.word).toBe('serendipity'); expect(entry.relations).toHaveLength(2); expect(entry.createdAt).toBe(10); });
  it('preserves the original creation time when updating', () => { const old = parseLookupResponse(response, 'serendipity', 10); const next = parseLookupResponse(response, 'serendipity', 20); expect(mergeEntry(old, next)).toMatchObject({ createdAt: 10, updatedAt: 20 }); });
  it('builds deduplicated word and topic relationships', () => { const entry = parseLookupResponse(response, 'serendipity'); const graph = buildVocabularyGraph([entry]); expect(graph.nodes.map((node) => node.id)).toContain('topic:discovery'); expect(graph.links.some((link) => link.value === 'synonym')).toBe(true); });
  it('rejects a response without definitions', () => expect(() => parseLookupResponse('{"word":"test"}', 'test')).toThrow(/缺少释义/));
});
