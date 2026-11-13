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
 *
 * The route returns those two figures coarsened: the median to the nearest
 * 5 points, the percentile to the nearest 10. The week changes one venture
 * at a time, and two exact reads either side of a move would recover the
 * mover's score.
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

/** Nearest 5. 33 becomes 35; 38.5 becomes 40. */
export function coarsenMedian(exact: number): number {
  return Math.round(exact / 5) * 5;
}

/** Nearest 10. 40 stays 40; 45 becomes 50. */
export function coarsenPercentile(exact: number): number {
  return Math.round(exact / 10) * 10;
}
