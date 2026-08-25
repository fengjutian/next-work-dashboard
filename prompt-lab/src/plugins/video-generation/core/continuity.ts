export const DEFAULT_STITCH_THRESHOLD = 0.55;

export function calculateRgbFrameSimilarity(previous: Uint8Array, next: Uint8Array): number {
  if (!previous.length || previous.length !== next.length) throw new Error('接缝帧尺寸不一致');
  let difference = 0;
  for (let index = 0; index < previous.length; index += 1) difference += Math.abs(previous[index] - next[index]);
  return Math.max(0, Math.min(1, 1 - difference / previous.length / 255));
}

export function stitchPasses(score: number, threshold = DEFAULT_STITCH_THRESHOLD): boolean {
  return Number.isFinite(score) && score >= threshold;
}
