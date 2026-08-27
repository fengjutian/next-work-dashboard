import { describe, expect, it } from 'vitest';
import { timeLabel, pickSupportedRecorderMime } from '../src/core';

describe('screen-capture core/helpers', () => {
  it('formats seconds as zero-padded mm:ss', () => {
    expect(timeLabel(0)).toBe('00:00');
    expect(timeLabel(5)).toBe('00:05');
    expect(timeLabel(59)).toBe('00:59');
    expect(timeLabel(60)).toBe('01:00');
    expect(timeLabel(125)).toBe('02:05');
    expect(timeLabel(3600)).toBe('60:00');
  });

  it('picks the first supported recorder MIME type', () => {
    expect(pickSupportedRecorderMime(() => false)).toBeUndefined();
    expect(pickSupportedRecorderMime((m) => m === 'video/webm;codecs=vp8,opus')).toBe('video/webm;codecs=vp8,opus');
    expect(pickSupportedRecorderMime((m) => m === 'video/webm;codecs=vp9,opus')).toBe('video/webm;codecs=vp9,opus');
  });

  it('prefers VP9 over VP8 over generic WebM', () => {
    expect(pickSupportedRecorderMime(() => true)).toBe('video/webm;codecs=vp9,opus');
  });
});
