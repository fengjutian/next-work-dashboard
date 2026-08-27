/**
 * Format a duration in seconds as `mm:ss` (zero-padded). Returns the
 * expected fixed-width string regardless of locale.
 */
export function timeLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Pick the first supported MIME type for MediaRecorder. Order is
 * preference: VP9/Opus → VP8/Opus → generic WebM. Returns `undefined`
 * if none of the candidates are supported by the host.
 */
export function pickSupportedRecorderMime(isTypeSupported: (mime: string) => boolean = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)): string | undefined {
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(isTypeSupported);
}
