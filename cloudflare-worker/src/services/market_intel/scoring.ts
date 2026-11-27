/**
 * Task #14 (AA-1) — Composite scoring for Market Intelligence.
 *
 * The aggregator pulls rows retrieved in the last `WINDOW_DAYS` days, applies a
 * per-source weight and a recency decay, then averages into a 0..100
 * composite per (sector, dimension). Composite of composites = the
 * sector "Compass" headline number.
 *
 * D7708 (#7708) — what a score counts:
 *   - Once. One row per observation identity (`observationKey`, D7707), the
 *     latest stored: a figure fetched again does not weigh again.
 *   - In the window. An observation is in the window when its provider last
 *     returned it inside the window (its retrieval date, `retrievedAt`), and
 *     recency decay runs on that date. The period it measures never decides
 *     membership: an annual figure confirmed this week is in.
 *   - Count. `source_count` is the distinct registered providers that
 *     contributed, for a dimension and for the composite. An unregistered
 *     source key is never counted.
 *   - Mix. Each provider's share of the weight the score used, with its count
 *     of distinct observations, whether its figure is sector-specific or one
 *     macro figure copied to every sector (`scope = 'context'`, D7707), and the
 *     coverage and periods that figure really has.
 */
import type { CommonRow, Dimension, SourceDescriptor } from './registry';
import { observationKey, retrievedAt } from './liveRows';

export const WINDOW_DAYS = 30;
const HALF_LIFE_DAYS = 14;             // newest row weighted ~2× older row at the window edge
const DAY_MS = 86_400_000;
export const DIMENSIONS: Dimension[] = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];

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

/** One provider's part in a score (D7708). */
export interface MixEntry {
  source_key: string;
  /** Share of the weight the score used, 0..1. The entries of one score sum to 1. */
  share: number;
  /** Distinct observations of this provider the score used. */
  observations: number;
  /** 'sector' when the figure is this sector's own; 'context' when one macro figure is copied to every sector. Null when the row does not say. */
  scope: 'sector' | 'context' | null;
  /** The area a copied figure covers (World, OECD aggregate, EU27), as stored; null when not recorded. */
  coverage_area: string | null;
  /** Earliest and latest period measured among the observations used; null when none records one. */
  period_from: string | null;
  period_to: string | null;
}

/** The window a score covers and what fed it, as stored beside the point (D7708). */
export interface ScoreMix {
  window_start: string;
  window_end: string;
  entries: MixEntry[];
  /** True when every observation the score used is one macro figure copied to every sector. */
  context_only: boolean;
}

/** One dimension's score: `value` is null when no observation contributed. */
export interface DimensionScore { value: number | null; source_count: number; mix: ScoreMix | null }

/** A row as the scorer reads it: the D7707 fields are optional, for rows stored before D7707. */
export type ScoredRow = CommonRow & { id?: number };

interface AccumIn {
  rows: ScoredRow[];
  sources: Map<string, SourceDescriptor>;
  now: Date;
}

/** The window a score computed at `now` covers: the `WINDOW_DAYS` days before it. */
export function scoreWindow(now: Date): { window_start: string; window_end: string } {
  return { window_start: new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString(), window_end: now.toISOString() };
}

/**
 * D7708 — one row per observation identity: the latest stored (latest
 * retrieval, then highest id), so a figure fetched by several runs counts once.
 * Rows of an unregistered source are dropped here: they never count.
 */
export function distinctObservations(rows: ScoredRow[], sources: Map<string, SourceDescriptor>): ScoredRow[] {
  const latest = new Map<string, ScoredRow>();
  for (const row of rows) {
    if (!sources.has(row.source_key)) continue;
    const key = observationKey(row);
    const held = latest.get(key);
    if (!held) { latest.set(key, row); continue; }
    const a = retrievedAt(row), b = retrievedAt(held);
    if (a > b || (a === b && (row.id ?? 0) > (held.id ?? 0))) latest.set(key, row);
  }
  return [...latest.values()];
}

/**
 * Returns a map of dimension → 0..100 composite score for one sector, the
 * distinct registered providers that contributed and the mix the score used.
 * A dimension no observation contributes to has NO value (`null`, source_count
 * 0, mix null) — D538.
 */
export function composeSectorScores({ rows, sources, now }: AccumIn): Record<Dimension, DimensionScore> {
  const numer: Record<string, number> = {};
  const denom: Record<string, number> = {};
  type Part = { weight: number; keys: Set<string>; scope: Set<string>; coverage: Set<string>; periods: string[] };
  const parts: Record<string, Map<string, Part>> = {};
  for (const d of DIMENSIONS) { numer[d] = 0; denom[d] = 0; parts[d] = new Map(); }

  for (const row of distinctObservations(rows, sources)) {
    const src = sources.get(row.source_key)!;
    // In the window by its retrieval date, as before D7708 a row stamped a moment after `now` counts as new.
    const ageDays = Math.max(0, (now.getTime() - new Date(retrievedAt(row)).getTime()) / DAY_MS);
    if (!Number.isFinite(ageDays) || ageDays > WINDOW_DAYS) continue;
    const decay = recencyDecay(ageDays);
    for (const dim of src.dimensions) {
      const weight = src.weight * decay;
      numer[dim] += contribution(row.metric_value, src.weight, decay);
      denom[dim] += weight * 100; // max possible contribution
      const part = parts[dim].get(row.source_key) || { weight: 0, keys: new Set(), scope: new Set(), coverage: new Set(), periods: [] };
      part.weight += weight;
      part.keys.add(observationKey(row));
      part.scope.add(row.scope ?? 'unknown');
      if (row.coverage_area) part.coverage.add(row.coverage_area);
      if (row.observed_period) part.periods.push(row.observed_period);
      parts[dim].set(row.source_key, part);
    }
  }

  const window = scoreWindow(now);
  const out = {} as Record<Dimension, DimensionScore>;
  for (const d of DIMENSIONS) {
    if (!(denom[d] > 0)) { out[d] = { value: null, source_count: 0, mix: null }; continue; }
    const total = [...parts[d].values()].reduce((n, p) => n + p.weight, 0);
    const entries = [...parts[d]].map(([source_key, p]): MixEntry => {
      const periods = [...p.periods].sort();
      return {
        source_key,
        share: total > 0 ? p.weight / total : 0,
        observations: p.keys.size,
        scope: p.scope.size === 1 && !p.scope.has('unknown') ? ([...p.scope][0] as 'sector' | 'context') : null,
        coverage_area: p.coverage.size ? [...p.coverage].sort().join(', ') : null,
        period_from: periods[0] ?? null,
        period_to: periods.at(-1) ?? null,
      };
    }).sort((a, b) => b.share - a.share || a.source_key.localeCompare(b.source_key));
    out[d] = {
      value: Math.round((numer[d] / denom[d]) * 1000) / 10,
      source_count: entries.length,
      mix: { ...window, entries, context_only: entries.every((e) => e.scope === 'context') },
    };
  }
  return out;
}

/**
 * D7708 — the composite's mix. The headline is an equal-weighted mean of the
 * dimensions that have a value, so a provider's share of it is the mean of its
 * shares in those dimensions; `source_count` is the distinct registered
 * providers across them. Null when no dimension has a value.
 */
export function compositeMix(scores: Record<Dimension, DimensionScore>): { source_count: number; mix: ScoreMix } | null {
  const recorded = DIMENSIONS.map((d) => scores[d]).filter((s) => s?.value != null && s.mix);
  if (recorded.length === 0) return null;
  const by = new Map<string, MixEntry & { keys: number }>();
  for (const s of recorded) {
    for (const e of s.mix!.entries) {
      const held = by.get(e.source_key);
      if (!held) { by.set(e.source_key, { ...e, share: e.share / recorded.length, keys: e.observations }); continue; }
      held.share += e.share / recorded.length;
      held.observations = Math.max(held.observations, e.observations);
    }
  }
  const entries = [...by.values()].map(({ keys, ...e }) => e)
    .sort((a, b) => b.share - a.share || a.source_key.localeCompare(b.source_key));
  const { window_start, window_end } = recorded[0].mix!;
  return { source_count: entries.length, mix: { window_start, window_end, entries, context_only: entries.every((e) => e.scope === 'context') } };
}

/**
 * Composite-of-composites, equal-weighted across the dimensions that HAVE a
 * value. `null` when none does: an average of nothing is not 50 (D538).
 */
export function compositeHeadline(scores: Record<Dimension, { value: number | null }>): number | null {
  const recorded = DIMENSIONS
    .map((d) => scores[d]?.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (recorded.length === 0) return null;
  const sum = recorded.reduce((s, v) => s + v, 0);
  return Math.round((sum / recorded.length) * 10) / 10;
}

/** YYYY-MM period key (UTC) for the supplied date. */
export function periodKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** What a point written before D7708 says about its window: never a derived date. */
export const WINDOW_NOT_RECORDED = 'Window not recorded';

/**
 * D7708 — the window and mix stored beside an index point, as a read returns
 * them. A point written before D7708 has neither: its window reads
 * `WINDOW_NOT_RECORDED` and its mix is null. A stored mix that cannot be read
 * is treated the same way, never guessed.
 */
export function storedWindow(row: { window_start?: string | null; window_end?: string | null; source_mix_json?: string | null }): {
  window_start: string | null; window_end: string | null; window_reason: string | null; source_mix: ScoreMix | null;
} {
  const start = row.window_start ?? null;
  const end = row.window_end ?? null;
  let mix: ScoreMix | null = null;
  if (row.source_mix_json) {
    try {
      const parsed = JSON.parse(row.source_mix_json);
      if (parsed && Array.isArray(parsed.entries)) mix = parsed as ScoreMix;
    } catch { mix = null; }
  }
  if (!start || !end) return { window_start: null, window_end: null, window_reason: WINDOW_NOT_RECORDED, source_mix: null };
  return { window_start: start, window_end: end, window_reason: null, source_mix: mix };
}
