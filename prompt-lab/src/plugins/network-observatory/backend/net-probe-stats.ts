/**
 * Statistics aggregation for probe samples.
 *
 * Given a list of `latencyMs` samples (numbers, may include nulls for failed
 * probes), compute: min / max / avg / median / p50 / p90 / p95 / p99 / jitter
 * / loss_pct.
 *
 * "loss_pct" is the percentage of failed probes (success=false). It's computed
 * by the caller passing both `latencies` and `totalCount` separately.
 */

export interface ProbeStats {
  count: number;
  successCount: number;
  lossPct: number; // 0-100
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  jitter: number | null; // mean absolute deviation from median
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export function computeStats(latencies: Array<number | null>, totalCount?: number): ProbeStats {
  const total = totalCount ?? latencies.length;
  const success = latencies.filter((v): v is number => v != null && Number.isFinite(v));
  const lossPct = total === 0 ? 0 : ((total - success.length) / total) * 100;

  if (success.length === 0) {
    return {
      count: total,
      successCount: 0,
      lossPct,
      min: null,
      max: null,
      avg: null,
      median: null,
      p50: null,
      p90: null,
      p95: null,
      p99: null,
      jitter: null,
    };
  }

  const sorted = [...success].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const median = percentile(sorted, 50) ?? 0;
  // Jitter: mean absolute deviation from median. (RFC-style jitter uses diff
  // between consecutive samples, but mean abs dev is easier to interpret and
  // matches user expectations of "how much does latency wiggle?".)
  const jitter = sorted.reduce((acc, v) => acc + Math.abs(v - median), 0) / sorted.length;

  return {
    count: total,
    successCount: sorted.length,
    lossPct,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    jitter,
  };
}
