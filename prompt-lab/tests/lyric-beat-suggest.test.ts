import { describe, expect, it } from 'vitest';
import { lineBeatMarkKey, lineToBeatGrid, suggestBeatMarks } from '../src/plugins/lyric-studio/composition-analysis';
import type { LyricSection } from '../src/plugins/lyric-studio/types';

const section: LyricSection = {
  id: 's1',
  kind: 'Verse',
  title: 'Verse 1',
  lyrics: '雨把夏天打湿\n路灯站在街角',
  emotion: '',
  rhyme: '',
  syllables: '8-10',
};

describe('lyric beat suggestion', () => {
  it('exposes a stable key helper', () => {
    expect(lineBeatMarkKey('s1', 0, 1)).toBe('s1:0:1');
  });

  it('marks the last character of each line as an accent', () => {
    const suggestions = suggestBeatMarks(section, 90);
    const lastOfFirstLine = lineBeatMarkKey('s1', 0, Array.from(section.lyrics.split('\n')[0]).length - 1);
    const lastOfSecondLine = lineBeatMarkKey('s1', 1, Array.from(section.lyrics.split('\n')[1]).length - 1);
    expect(suggestions[lastOfFirstLine]).toBe('accent');
    expect(suggestions[lastOfSecondLine]).toBe('accent');
  });

  it('respects existing marks (does not overwrite them)', () => {
    const key = lineBeatMarkKey('s1', 0, 0);
    const existing = { [key]: 'hold' as const };
    const suggestions = suggestBeatMarks(section, 90, existing);
    expect(suggestions[key]).toBeUndefined();
  });

  it('emits at least one accent per line that maps to strong beats', () => {
    const suggestions = suggestBeatMarks(section, 90);
    const accentKeys = Object.entries(suggestions).filter(([, mark]) => mark === 'accent');
    expect(accentKeys.length).toBeGreaterThanOrEqual(2);
  });

  it('marks punctuation-adjacent chars as hold', () => {
    const lyric: LyricSection = { ...section, lyrics: '你好，世界' };
    const suggestions = suggestBeatMarks(lyric, 90);
    const holdKeys = Object.entries(suggestions).filter(([, mark]) => mark === 'hold');
    expect(holdKeys.length).toBeGreaterThan(0);
  });

  it('stays aligned with lineToBeatGrid character index', () => {
    const cells = lineToBeatGrid('雨把夏天');
    const suggestions = suggestBeatMarks({ ...section, lyrics: '雨把夏天' }, 90);
    const accentIdx = Object.entries(suggestions).find(([, mark]) => mark === 'accent')?.[0];
    expect(accentIdx).toBeDefined();
    const [, , charIdx] = accentIdx!.split(':').map(Number);
    expect(cells[charIdx]).toBeDefined();
  });
});
