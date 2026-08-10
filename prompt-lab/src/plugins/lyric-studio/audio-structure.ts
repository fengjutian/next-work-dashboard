import type { AudioFeatureFrame, AudioStructureSegment, SectionKind } from './types';

const SECTION_KINDS: SectionKind[] = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];

function distance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += (a[index] - b[index]) ** 2;
  return Math.sqrt(sum / length);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function featureVector(frame: AudioFeatureFrame): number[] {
  return [frame.rms * 4, frame.spectralCentroid / 4000, ...frame.chroma, ...frame.mfcc.slice(0, 8).map((value) => value / 100)];
}

export function normalizeStructureSegments(segments: AudioStructureSegment[], duration: number, bpm: number): AudioStructureSegment[] {
  const safeDuration = Math.max(0, duration);
  return segments
    .map((segment) => ({ ...segment, start: Math.max(0, Math.min(safeDuration, segment.start)), end: Math.max(0, Math.min(safeDuration, segment.end)) }))
    .filter((segment) => segment.end - segment.start >= 1)
    .sort((a, b) => a.start - b.start)
    .map((segment, index, sorted) => {
      const start = index ? sorted[index - 1].end : 0;
      const end = index === sorted.length - 1 ? safeDuration : Math.max(start + 1, segment.end);
      return { ...segment, start, end, bars: Math.max(1, Math.round((end - start) * Math.max(40, bpm) / 240)) };
    });
}

export function buildCandidateSegments(frames: AudioFeatureFrame[], duration: number, bpm: number): AudioStructureSegment[] {
  if (!frames.length || duration <= 0) return [];
  const novelty = frames.map((frame, index) => index ? distance(featureVector(frame), featureVector(frames[index - 1])) : 0);
  const threshold = mean(novelty) + Math.sqrt(mean(novelty.map((value) => (value - mean(novelty)) ** 2))) * 0.7;
  const minGap = Math.max(8, 60 / Math.max(40, bpm) * 8);
  const boundaries = [0];
  novelty.forEach((value, index) => {
    const time = frames[index].time;
    if (value >= threshold && time - (boundaries.at(-1) ?? 0) >= minGap && duration - time >= minGap / 2) boundaries.push(time);
  });
  boundaries.push(duration);

  // Merge tiny tails and cap noisy analyses to a practical song-form size.
  while (boundaries.length > 10) {
    let smallest = 1;
    for (let index = 2; index < boundaries.length - 1; index += 1) if (boundaries[index] - boundaries[index - 1] < boundaries[smallest] - boundaries[smallest - 1]) smallest = index;
    boundaries.splice(smallest, 1);
  }

  const segments = boundaries.slice(0, -1).map((start, index): AudioStructureSegment => {
    const end = boundaries[index + 1];
    const members = frames.filter((frame) => frame.time >= start && frame.time < end);
    const energy = mean(members.map((frame) => frame.rms));
    const first = index === 0; const last = index === boundaries.length - 2;
    return {
      id: crypto.randomUUID(), start, end,
      kind: first ? 'Intro' : last ? 'Outro' : 'Unknown',
      confidence: first || last ? 0.55 : 0.25,
      energy: Number(energy.toFixed(4)), bars: Math.max(1, Math.round((end - start) * bpm / 240)),
      emotion: energy > 0.18 ? '高能量' : energy > 0.09 ? '推进' : '克制',
      reason: first ? '位于歌曲开头' : last ? '位于歌曲结尾' : '根据音色、和声与能量变化检测到边界',
    };
  });
  return normalizeStructureSegments(segments, duration, bpm);
}

export function parseAiStructure(value: unknown, fallback: AudioStructureSegment[], duration: number, bpm: number): AudioStructureSegment[] {
  const raw = (value as { sections?: unknown[] })?.sections;
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw.map((item, index) => {
    const source = item as Record<string, unknown>; const base = fallback[index];
    const kind = SECTION_KINDS.includes(source.kind as SectionKind) ? source.kind as SectionKind : 'Unknown';
    return {
      id: base?.id ?? crypto.randomUUID(),
      start: Number(source.start ?? base?.start ?? 0), end: Number(source.end ?? base?.end ?? duration), kind,
      confidence: Math.max(0, Math.min(1, Number(source.confidence ?? base?.confidence ?? 0.5))),
      energy: base?.energy ?? 0, bars: Number(source.bars ?? base?.bars ?? 4),
      emotion: String(source.emotion ?? base?.emotion ?? ''), reason: String(source.reason ?? base?.reason ?? 'AI 根据本地特征摘要判断'),
    } satisfies AudioStructureSegment;
  });
  return normalizeStructureSegments(parsed, duration, bpm);
}

export function structurePrompt(frames: AudioFeatureFrame[], segments: AudioStructureSegment[], bpm: number, duration: number): string {
  const summary = segments.map((segment, index) => ({ index, start: +segment.start.toFixed(2), end: +segment.end.toFixed(2), bars: segment.bars, energy: segment.energy, candidate: segment.kind }));
  const energyCurve = frames.filter((_, index) => index % Math.max(1, Math.floor(frames.length / 40)) === 0).map((frame) => [+(frame.time.toFixed(1)), +(frame.rms.toFixed(4)), +((frame.spectralCentroid / 1000).toFixed(2))]);
  return `BPM: ${bpm}\n时长: ${duration.toFixed(2)} 秒\n候选段落: ${JSON.stringify(summary)}\n能量曲线[秒,RMS,频谱质心kHz]: ${JSON.stringify(energyCurve)}`;
}
