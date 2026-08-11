import { describe, expect, it } from 'vitest';
import { gateQuality } from '../src/plugins/lyric-studio/analysis';
import type { LyricSection } from '../src/plugins/lyric-studio/types';

const section = (overrides: Partial<LyricSection>): LyricSection => ({
  id: overrides.id ?? 's1',
  kind: overrides.kind ?? 'Verse',
  title: overrides.title ?? 'Verse 1',
  lyrics: overrides.lyrics ?? '',
  emotion: overrides.emotion ?? '',
  rhyme: overrides.rhyme ?? '',
  syllables: overrides.syllables ?? '8-10',
  ...overrides,
});

describe('lyric quality gate', () => {
  it('returns an empty summary when there is no lyrics', () => {
    const report = gateQuality([], 90);
    expect(report.overall).toBe(0);
    expect(report.totalLines).toBe(0);
    expect(report.summary[0]).toMatch(/先生成或写入/);
  });

  it('flags cliche phrases, overlong lines and rhythm deviation', () => {
    const sections = [
      section({
        id: 'v1',
        title: 'Verse 1',
        lyrics: ['短短短', '这行非常非常非常非常非常非常非常长要超出常规字数了', '短句再来'].join('\n'),
      }),
      section({
        id: 'c1',
        kind: 'Chorus',
        title: 'Chorus',
        lyrics: ['撕心裂肺的痛', '爱到永远'].join('\n'),
      }),
    ];
    const report = gateQuality(sections, 90);
    expect(report.issues.some((issue) => issue.category === 'cliche')).toBe(true);
    expect(report.issues.some((issue) => issue.category === 'length' && issue.severity === 'warning')).toBe(true);
    // The first verse has max-min char counts way beyond 6, so it should report rhythm deviation
    expect(report.issues.some((issue) => issue.category === 'rhythm')).toBe(true);
    expect(report.flaggedLines).toBeGreaterThan(0);
    expect(report.summary.length).toBeLessThanOrEqual(3);
  });

  it('scores a clean chorus with repeats higher than a chaotic verse', () => {
    const cleanChorus = [section({ id: 'c', kind: 'Chorus', title: 'Chorus', lyrics: '在雨后的街上\n在雨后的街上\n我们再次相见\n我们再次相见' })];
    const messyVerse = [section({ id: 'v', title: 'Verse', lyrics: '啊\n这一句非常非常非常非常非常非常长\n短' })];
    const cleanReport = gateQuality(cleanChorus, 90);
    const messyReport = gateQuality(messyVerse, 90);
    expect(cleanReport.overall).toBeGreaterThan(messyReport.overall);
  });

  it('flags an empty project as zero overall', () => {
    const report = gateQuality([], 90);
    expect(report.overall).toBe(0);
    expect(report.summary[0]).toMatch(/先生成或写入/);
  });

  it('reports rhyme mismatch when section target is set but never matches', () => {
    const sections = [section({ id: 'v', title: 'Verse', rhyme: 'eng', lyrics: '窗前的灯\n遥远的灯\n海边的风' })];
    const report = gateQuality(sections, 90);
    // 'eng' target with two 'eng' lines + one 'eng' line should still be detected,
    // but if we swap to a non-matching rhyme target, gate should flag it.
    const mismatchSections = [section({ id: 'v2', title: 'Verse', rhyme: 'ian', lyrics: '我望着天空\n陪你到以后\n这是新的夜' })];
    const mismatchReport = gateQuality(mismatchSections, 90);
    expect(mismatchReport.issues.some((issue) => issue.category === 'rhyme')).toBe(true);
  });
});
