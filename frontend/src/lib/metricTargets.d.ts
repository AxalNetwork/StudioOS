/** Types for the existing shared target comparison used by D6102 (#6102). */
export interface MetricTarget {
  metric_key: string;
  target_value: number;
  direction: string;
  [key: string]: unknown;
}
export function readTarget<T extends MetricTarget>(target: T, latest: Record<string, unknown>): T & { actual: number | null; met: boolean | null };
export const METRIC_LABELS: Record<string, string>;
export function metricLabel(key: string): string;
export const PCT_KEYS: Set<string>;
export const COUNT_KEYS: Set<string>;
