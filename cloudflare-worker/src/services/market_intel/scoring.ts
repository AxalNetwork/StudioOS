/**
 * Task #14 (AA-1) — Composite scoring for Market Intelligence.
 *
 * The aggregator pulls rows from the last `WINDOW_DAYS` days, applies a
 * per-source weight and a recency decay, then averages into a 0..100
 * composite per (sector, dimension). Composite of composites = the
 * sector "Compass" headline number.
 */
import type { CommonRow, Dimension, SourceDescriptor } from './registry';

export const WINDOW_DAYS = 30;
const HALF_LIFE_DAYS = 14;             // newest row weighted ~2× older row at the window edge

/** Decay factor in [0,1] for a row that is `ageDays` old. */
export function recencyDecay(ageDays: number): number {
  if (!isFinite(ageDays) || ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Map a normalised metric_value (0..1) plus weight into a 0..100 score contribution. */
function contribution(metric_value: number, weight: number, decay: number): number {
  const v = Math.max(0, Math.min(1, metric_value));
  return v * 100 * weight * decay;
}

interface AccumIn {
  rows: CommonRow[];
  sources: Map<string, SourceDescriptor>;
  now: Date;
}

/**
 * Returns a map of dimension → 0..100 composite score for one sector,
 * plus the source-count contributing to each dimension. Missing
 * dimensions get a neutral 50 with source_count=0 so the UI never
 * breaks on a sparse sector.
 */
export function composeSectorScores({ rows, sources, now }: AccumIn): Record<Dimension, { value: number; source_count: number }> {
  const dims: Dimension[] = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
  const numer: Record<string, number> = {};
  const denom: Record<string, number> = {};
  const counts: Record<string, Set<string>> = {};
  for (const d of dims) { numer[d] = 0; denom[d] = 0; counts[d] = new Set(); }

  for (const row of rows) {
    const src = sources.get(row.source_key);
    if (!src) continue;
    const ageDays = Math.max(0, (now.getTime() - new Date(row.ts).getTime()) / 86_400_000);
    if (ageDays > WINDOW_DAYS) continue;
    const decay = recencyDecay(ageDays);
    for (const dim of src.dimensions) {
      numer[dim] += contribution(row.metric_value, src.weight, decay);
      denom[dim] += src.weight * decay * 100; // max possible contribution
      counts[dim].add(row.source_key);
    }
  }

  const out = {} as Record<Dimension, { value: number; source_count: number }>;
  for (const d of dims) {
    const v = denom[d] > 0 ? Math.round((numer[d] / denom[d]) * 1000) / 10 : 50;
    out[d] = { value: v, source_count: counts[d].size };
  }
  return out;
}

/** Composite-of-composites. Equal-weighted across dimensions. */
export function compositeHeadline(scores: Record<Dimension, { value: number }>): number {
  const dims: Dimension[] = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
  const sum = dims.reduce((s, d) => s + (scores[d]?.value ?? 50), 0);
  return Math.round((sum / dims.length) * 10) / 10;
}

/** YYYY-MM period key (UTC) for the supplied date. */
export function periodKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
