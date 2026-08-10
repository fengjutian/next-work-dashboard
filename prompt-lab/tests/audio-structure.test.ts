import { describe, expect, it } from 'vitest';
import { buildCandidateSegments, normalizeStructureSegments, parseAiStructure } from '../src/plugins/lyric-studio/audio-structure';
import type { AudioFeatureFrame, AudioStructureSegment } from '../src/plugins/lyric-studio/types';

function frame(time: number, rms: number, color: number): AudioFeatureFrame {
  return { time, rms, spectralCentroid: 1000 + color * 1000, chroma: new Array(12).fill(color), mfcc: new Array(13).fill(color * 10) };
}

describe('audio structure analysis', () => {
  it('creates contiguous candidate sections from novelty changes', () => {
    const frames = Array.from({ length: 80 }, (_, index) => frame(index * 0.5, index < 24 ? 0.04 : index < 52 ? 0.2 : 0.08, index < 24 ? 0 : index < 52 ? 1 : 0.3));
    const sections = buildCandidateSegments(frames, 40, 120);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections[0].kind).toBe('Intro');
    expect(sections.at(-1)?.kind).toBe('Outro');
    expect(sections.at(-1)?.end).toBe(40);
  });

  it('clamps and reconnects edited segment boundaries', () => {
    const sections: AudioStructureSegment[] = [
      { id: 'a', start: -2, end: 10, kind: 'Intro', confidence: 1, energy: 0, bars: 1, emotion: '', reason: '' },
      { id: 'b', start: 12, end: 50, kind: 'Verse', confidence: 1, energy: 0, bars: 1, emotion: '', reason: '' },
    ];
    const normalized = normalizeStructureSegments(sections, 40, 120);
    expect(normalized[0].start).toBe(0);
    expect(normalized[1].start).toBe(normalized[0].end);
    expect(normalized[1].end).toBe(40);
  });

  it('rejects unknown AI labels without breaking the timeline', () => {
    const fallback = buildCandidateSegments([frame(0, .1, 0), frame(10, .2, 1), frame(20, .1, 0)], 30, 90);
    const parsed = parseAiStructure({ sections: [{ start: 0, end: 30, kind: 'Drop' }] }, fallback, 30, 90);
    expect(parsed[0].kind).toBe('Unknown');
    expect(parsed[0].end).toBe(30);
  });
});
