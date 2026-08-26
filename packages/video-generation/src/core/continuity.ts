export const DEFAULT_STITCH_THRESHOLD = 0.65;
export interface StitchMetrics {
  pixel: number;
  ssim: number;
  motionDirection: number;
  subjectPosition: number;
  exposure: number;
  colorTemperature: number;
  histogram: number;
  faceIdentity: number | null;
  faceConfidence: "low" | "unavailable";
  score: number;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function calculateRgbFrameSimilarity(
  a: Uint8Array,
  b: Uint8Array,
): number {
  if (!a.length || a.length !== b.length) throw new Error("接缝帧尺寸不一致");
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += Math.abs(a[i] - b[i]);
  return clamp(1 - d / a.length / 255);
}
function luma(f: Uint8Array): Float64Array {
  const v = new Float64Array(f.length / 3);
  for (let i = 0; i < v.length; i += 1)
    v[i] = f[i * 3] * 0.299 + f[i * 3 + 1] * 0.587 + f[i * 3 + 2] * 0.114;
  return v;
}
function ssim(a: Uint8Array, b: Uint8Array): number {
  const x = luma(a),
    y = luma(b),
    n = x.length;
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let vx = 0,
    vy = 0,
    cov = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - mx,
      dy = y[i] - my;
    vx += dx * dx;
    vy += dy * dy;
    cov += dx * dy;
  }
  const q = Math.max(1, n - 1);
  vx /= q;
  vy /= q;
  cov /= q;
  const c1 = 6.5025,
    c2 = 58.5225;
  return clamp(
    ((2 * mx * my + c1) * (2 * cov + c2)) /
      ((mx * mx + my * my + c1) * (vx + vy + c2)),
  );
}
function hist(f: Uint8Array): number[] {
  const bins = new Array<number>(48).fill(0);
  for (let i = 0; i < f.length; i += 3)
    for (let c = 0; c < 3; c += 1)
      bins[c * 16 + Math.min(15, f[i + c] >> 4)] += 1;
  return bins.map((v) => v / (f.length / 3) / 3);
}
function histScore(a: Uint8Array, b: Uint8Array): number {
  const x = hist(a),
    y = hist(b);
  return clamp(x.reduce((s, v, i) => s + Math.min(v, y[i]), 0));
}
function means(f: Uint8Array): [number, number, number] {
  const t = [0, 0, 0];
  for (let i = 0; i < f.length; i += 3) {
    t[0] += f[i];
    t[1] += f[i + 1];
    t[2] += f[i + 2];
  }
  const n = f.length / 3;
  return [t[0] / n, t[1] / n, t[2] / n];
}
function centroid(f: Uint8Array, w: number, h: number): [number, number] {
  const g = luma(f);
  let sx = 0,
    sy = 0,
    weight = 0;
  for (let y = 1; y < h - 1; y += 1)
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x,
        e = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
      if (e > 25) {
        sx += x * e;
        sy += y * e;
        weight += e;
      }
    }
  return weight ? [sx / weight / w, sy / weight / h] : [0.5, 0.5];
}
function pos(a: [number, number], b: [number, number]): number {
  return clamp(1 - Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.SQRT2);
}
function motion(
  a0: Uint8Array,
  a1: Uint8Array,
  b0: Uint8Array,
  b1: Uint8Array,
  w: number,
  h: number,
): number {
  const p0 = centroid(a0, w, h),
    p1 = centroid(a1, w, h),
    q0 = centroid(b0, w, h),
    q1 = centroid(b1, w, h),
    ax = p1[0] - p0[0],
    ay = p1[1] - p0[1],
    bx = q1[0] - q0[0],
    by = q1[1] - q0[1],
    am = Math.hypot(ax, ay),
    bm = Math.hypot(bx, by);
  return am < 0.005 || bm < 0.005
    ? 1
    : clamp(((ax * bx + ay * by) / am / bm + 1) / 2);
}
function face(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
): number | null {
  const crop = (f: Uint8Array) => {
    const v: number[] = [];
    let n = 0;
    for (let y = Math.floor(h * 0.08); y < Math.floor(h * 0.62); y += 1)
      for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x += 1) {
        const i = (y * w + x) * 3,
          r = f[i],
          g = f[i + 1],
          bl = f[i + 2];
        if (r > 60 && r > g * 1.05 && g > bl * 0.8 && r - bl > 10) {
          v.push(r, g, bl);
          n += 1;
        }
      }
    return n > w * h * 0.015 ? new Uint8Array(v) : null;
  };
  const x = crop(a),
    y = crop(b);
  return x && y ? histScore(x, y) : null;
}
export function analyzeStitchFrames(
  a0: Uint8Array,
  a1: Uint8Array,
  b0: Uint8Array,
  b1: Uint8Array,
  w: number,
  h: number,
): StitchMetrics {
  const pixel = calculateRgbFrameSimilarity(a1, b0),
    structure = ssim(a1, b0),
    ma = means(a1),
    mb = means(b0),
    exposure = clamp(
      1 -
        Math.abs((ma[0] + ma[1] + ma[2]) / 3 - (mb[0] + mb[1] + mb[2]) / 3) /
          128,
    ),
    colorTemperature = clamp(
      1 - Math.abs(ma[0] - ma[2] - (mb[0] - mb[2])) / 128,
    ),
    subjectPosition = pos(centroid(a1, w, h), centroid(b0, w, h)),
    motionDirection = motion(a0, a1, b0, b1, w, h),
    histogram = histScore(a1, b0),
    faceIdentity = face(a1, b0, w, h),
    weighted: [[number, number]] | Array<[number, number]> = [
      [structure, 0.27],
      [motionDirection, 0.16],
      [subjectPosition, 0.14],
      [histogram, 0.14],
      [exposure, 0.09],
      [colorTemperature, 0.08],
      [pixel, 0.07],
    ];
  if (faceIdentity !== null) weighted.push([faceIdentity, 0.15]);
  const total = weighted.reduce((s, x) => s + x[1], 0),
    score = weighted.reduce((s, x) => s + x[0] * x[1], 0) / total;
  return {
    pixel,
    ssim: structure,
    motionDirection,
    subjectPosition,
    exposure,
    colorTemperature,
    histogram,
    faceIdentity,
    faceConfidence: faceIdentity === null ? "unavailable" : "low",
    score,
  };
}
export function stitchPasses(
  score: number,
  threshold = DEFAULT_STITCH_THRESHOLD,
): boolean {
  return Number.isFinite(score) && score >= threshold;
}
