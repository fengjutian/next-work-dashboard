import type { TranscriptSegment } from './types';

export function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const ordered = segments.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text).sort((a, b) => a.startMs - b.startMs);
  ordered.forEach((item, index) => {
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs) throw new Error(`第 ${index + 1} 段时间范围无效`);
    if (index > 0 && item.startMs < ordered[index - 1].startMs) throw new Error(`第 ${index + 1} 段时间顺序无效`);
    item.id = `segment-${index + 1}`; item.index = index;
  });
  return ordered;
}

export function splitSegment(segments: TranscriptSegment[], segmentId: string, splitMs: number, firstText: string, secondText: string): TranscriptSegment[] {
  const index = segments.findIndex((item) => item.id === segmentId); if (index < 0) throw new Error('片段不存在');
  const source = segments[index]; if (splitMs <= source.startMs || splitMs >= source.endMs) throw new Error('拆分时间必须位于片段内部');
  return normalizeSegments([...segments.slice(0, index), { ...source, endMs: splitMs, text: firstText }, { ...source, startMs: splitMs, text: secondText }, ...segments.slice(index + 1)]);
}

export function mergeWithNext(segments: TranscriptSegment[], segmentId: string): TranscriptSegment[] {
  const index = segments.findIndex((item) => item.id === segmentId); if (index < 0 || index >= segments.length - 1) throw new Error('没有可合并的下一段');
  const current = segments[index]; const next = segments[index + 1];
  return normalizeSegments([...segments.slice(0, index), { ...current, endMs: next.endMs, text: `${current.text} ${next.text}` }, ...segments.slice(index + 2)]);
}
