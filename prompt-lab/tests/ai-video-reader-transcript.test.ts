import { describe, expect, it } from 'vitest';
import { exportTranscript, parseTranscript, parseTimestamp } from '../src/core/ai-video-reader/transcript';

describe('ai video reader transcript', () => {
  it('parses SRT timestamps and text', () => {
    const result = parseTranscript('1\n00:00:01,250 --> 00:00:03,500\n你好，视频\n', '.srt');
    expect(result.segments[0]).toMatchObject({ startMs: 1250, endMs: 3500, text: '你好，视频' });
  });
  it('parses VTT and strips cue markup', () => {
    const result = parseTranscript('WEBVTT\n\n00:01.000 --> 00:02.000\n<b>Hello</b>', '.vtt');
    expect(result.segments[0].text).toBe('Hello');
  });
  it('exports valid SRT', () => {
    const output = exportTranscript([{ id: 'a', index: 0, startMs: 1000, endMs: 2500, text: 'Test' }], 'srt');
    expect(output).toContain('00:00:01,000 --> 00:00:02,500');
  });
  it('supports minute-only timestamps', () => expect(parseTimestamp('01:02.500')).toBe(62500));
});
