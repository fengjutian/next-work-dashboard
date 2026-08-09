import { describe, expect, it } from 'vitest';
import { buildTimeline, formatClock, inspectLyrics, lineToBeatGrid } from '../src/plugins/lyric-studio/composition-analysis';
import type { LyricProject } from '../src/plugins/lyric-studio/types';

const project = {
  id: 'song', title: '测试', theme: '', style: '', emotion: '', language: '中文', bpm: 60, location: '', time: '', story: '', coreImages: [], tags: [], favorite: false, collection: '', status: 'draft', coverColor: '#000000', creativePrompt: '', promptHistory: [], promptPriority: 'prompt', scratchpad: '', beatMarks: {}, favoriteLines: [], updatedAt: 0,
  sections: [{ id: 'v', kind: 'Verse', title: 'Verse 1', lyrics: '我把旧车票留在书里\n爱情思念让我无法呼吸', emotion: '', rhyme: '', syllables: '8-10' }],
} satisfies LyricProject;

describe('lyric composition tools', () => {
  it('builds a BPM based structure timeline', () => { const timeline = buildTimeline(project); expect(timeline[0].durationSeconds).toBe(32); expect(formatClock(timeline[0].endSeconds)).toBe('00:32'); });
  it('maps lyric characters to beat subdivisions', () => { expect(lineToBeatGrid('雨把夏天').map((item) => `${item.beat}${item.subdivision ? '&' : ''}`)).toEqual(['1', '1&', '2', '2&']); });
  it('finds cliché and abstract wording', () => { const issues = inspectLyrics(project); expect(issues.some((item) => item.category === '陈词滥调')).toBe(true); expect(issues.some((item) => item.category === '抽象表达')).toBe(true); });
});
