import type { TranscriptImportResult, TranscriptSegment } from './types';

export function parseTimestamp(value: string): number {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) throw new Error(`无效时间戳：${value}`);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function makeSegment(index: number, startMs: number, endMs: number, text: string): TranscriptSegment {
  return { id: `segment-${index + 1}`, index, startMs, endMs, text: text.trim() };
}

export function parseTranscript(content: string, extension: string): TranscriptImportResult {
  if (extension.toLowerCase() === '.json') {
    const parsed = JSON.parse(content) as { language?: string; segments?: Array<{ start?: number; end?: number; startMs?: number; endMs?: number; text: string; speaker?: string }> };
    if (!Array.isArray(parsed.segments)) throw new Error('JSON 中缺少 segments 数组');
    return {
      language: parsed.language,
      segments: parsed.segments.map((item, index) => ({
        ...makeSegment(index, item.startMs ?? Math.round((item.start ?? 0) * 1000), item.endMs ?? Math.round((item.end ?? item.start ?? 0) * 1000), item.text),
        speaker: item.speaker,
      })),
    };
  }
  const normalized = content.replace(/^WEBVTT[^\n]*\n+/i, '').replace(/\r/g, '').trim();
  const blocks = normalized.split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [start, endWithSettings] = lines[timingIndex].split('-->').map((item) => item.trim());
    const end = endWithSettings.split(/\s+/)[0];
    const text = lines.slice(timingIndex + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (text) segments.push(makeSegment(segments.length, parseTimestamp(start), parseTimestamp(end), text));
  }
  if (!segments.length) throw new Error('没有识别到带时间戳的字幕片段');
  return { segments };
}

function stamp(ms: number, separator = ','): string {
  const total = Math.max(0, ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total % 3_600_000 / 60_000);
  const seconds = Math.floor(total % 60_000 / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

export function exportTranscript(segments: TranscriptSegment[], format: 'srt' | 'vtt' | 'txt' | 'md' | 'json'): string {
  if (format === 'json') return JSON.stringify({ segments }, null, 2);
  if (format === 'txt') return segments.map((item) => item.text).join('\n');
  if (format === 'md') return segments.map((item) => `- [${stamp(item.startMs, '.').slice(0, -4)}] ${item.text}`).join('\n');
  const body = segments.map((item, index) => `${index + 1}\n${stamp(item.startMs, format === 'vtt' ? '.' : ',')} --> ${stamp(item.endMs, format === 'vtt' ? '.' : ',')}\n${item.text}`).join('\n\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}
