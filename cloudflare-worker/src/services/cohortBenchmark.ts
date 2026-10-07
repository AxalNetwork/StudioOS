/**
 * D589 — a cohort median and the founder's percentile.
 *
 * Pure. Five is the smallest set that shows a figure, the same threshold
 * D358 set for profiling trends (`SMALL_CELL_MIN`). Below that, the route
 * returns a reason and no number. The median of an odd count is the middle
 * recorded score; of an even count, the mean of the two middle scores.
 * The percentile is the rank
 *   round(100 * (strictly below + half the ties) / n)
 * over the same scores, including the founder's own.
 */

export const COHORT_BENCHMARK_MIN = 5;

export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentileRank(values: readonly number[], own: number): number {
  let below = 0;
  let tied = 0;
  for (const value of values) {
    if (value < own) below += 1;
    else if (value === own) tied += 1;
  }
  return Math.round((100 * (below + 0.5 * tied)) / values.length);
}
