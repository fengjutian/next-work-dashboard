import { describe, expect, it } from 'vitest';
import { buildSunoPrompt } from '../src/plugins/lyric-studio/music-tools';
import type { LyricProject } from '../src/plugins/lyric-studio/types';

const project: LyricProject = {
  id: 'p1', title: '夏夜', theme: '告别', style: '华语流行', emotion: '克制', language: '中文',
  bpm: 72, location: '车站', time: '黄昏', story: '没说出口的再见', coreImages: ['车票', '街灯'],
  tags: [], favorite: false, collection: '夏日 EP', status: 'draft', coverColor: '#7c3aed',
  creativePrompt: '', promptHistory: [], promptPriority: 'prompt', scratchpad: '',
  beatMarks: {}, favoriteLines: [],
  sections: [
    { id: 'v', kind: 'Verse', title: 'Verse 1', lyrics: '晚风吹过那片天空\n回忆突然开始失控', emotion: '克制', rhyme: 'ong', syllables: '8-10' },
    { id: 'c', kind: 'Chorus', title: 'Chorus', lyrics: '如果时间能够倒流\n如果时间能够倒流', emotion: '释放', rhyme: 'ou', syllables: '8-10' },
  ],
  updatedAt: 0,
};

describe('suno prompt builder', () => {
  it('includes style metadata in the header', () => {
    const prompt = buildSunoPrompt(project);
    expect(prompt).toMatch(/\[Style: 华语流行, 克制, 72 BPM, 车站, 黄昏, 华语演唱\]/);
    expect(prompt).toContain('[Verse]');
    expect(prompt).toContain('[Chorus]');
  });

  it('respects explicit styleHint and negative tags', () => {
    const prompt = buildSunoPrompt(project, { styleHint: 'cinematic pop, piano', negativeTags: ['auto-tune', 'distorted'] });
    expect(prompt).toMatch(/\[Style: cinematic pop, piano \| avoid: auto-tune, distorted\]/);
  });

  it('keeps arrangement and avoid as separate clauses', () => {
    const prompt = buildSunoPrompt(project, { arrangement: 'piano + strings', negativeTags: ['auto-tune'] });
    expect(prompt).toMatch(/Arrangement: piano \+ strings \| avoid: auto-tune/);
  });

  it('falls back to English vocal when language is not mapped', () => {
    const prompt = buildSunoPrompt({ ...project, language: 'English' });
    expect(prompt).toMatch(/English vocal/);
  });

  it('omits empty meta lines', () => {
    const prompt = buildSunoPrompt({ ...project, theme: '', story: '' });
    expect(prompt).not.toMatch(/Theme:/);
    expect(prompt).not.toMatch(/Story:/);
  });

  it('serializes sections with Suno tags', () => {
    const prompt = buildSunoPrompt(project);
    expect(prompt).toMatch(/\[Verse\]\n晚风吹过那片天空\n回忆突然开始失控/);
    expect(prompt).toMatch(/\[Chorus\]\n如果时间能够倒流\n如果时间能够倒流/);
  });
});
