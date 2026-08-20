import { describe, expect, it } from 'vitest';
import { mergeWithNext, normalizeSegments, splitSegment } from '../src/core/ai-video-reader/editing';

const segments = [
  { id: 'a', index: 0, startMs: 0, endMs: 1000, text: '第一段' },
  { id: 'b', index: 1, startMs: 1000, endMs: 2000, text: '第二段' },
];

describe('video transcript editing', () => {
  it('normalizes ids, indexes and whitespace', () => expect(normalizeSegments([{ ...segments[0], text: '  内容  ' }])[0]).toMatchObject({ id: 'segment-1', index: 0, text: '内容' }));
  it('rejects invalid time ranges', () => expect(() => normalizeSegments([{ ...segments[0], endMs: 0 }])).toThrow('时间范围无效'));
  it('splits a segment', () => expect(splitSegment(segments, 'a', 500, '前', '后')).toMatchObject([{ endMs: 500, text: '前' }, { startMs: 500, text: '后' }, segments[1]]));
  it('merges with the next segment', () => expect(mergeWithNext(segments, 'a')).toMatchObject([{ startMs: 0, endMs: 2000, text: '第一段 第二段' }]));
});
