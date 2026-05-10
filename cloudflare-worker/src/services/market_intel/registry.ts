/**
 * Task #14 (AA-1) — Market Intelligence source registry.
 *
 * Each connector lives in `./sources/<key>.ts` and calls `registerSource`
 * at module top-level. The aggregator iterates this map on its scheduled
 * tick and runs only sources whose `MI_FLAG_<KEY>` env flag is truthy.
 *
 * Stub vs LIVE:
 *   - Every source ships with a synthetic `fetchStub` that returns
 *     plausible normalised rows so the aggregator pipeline is exercisable
 *     end-to-end before any contract is signed.
 *   - When `MI_FLAG_<KEY>=live`, `fetchLive` runs instead. Paid providers
 *     (PitchBook, CB Insights, ...) keep `fetchLive` as a TODO that throws
 *     so a deploy can't accidentally exercise an un-paid contract.
 */
import type { Env } from '../../types';

export type SectorKey = string;

/** Common normalised observation row written to `market_intel_rows`. */
export interface CommonRow {
  source_key: string;
  sector: SectorKey;
  geo?: string;                  // ISO country code or 'global'
  metric_key: string;            // 'demand' | 'capital' | 'talent_jobs' | ...
  metric_value: number;          // normalised 0..1 (or absolute, see unit)
  raw_value?: number;
  unit?: 'index' | 'usd' | 'count' | 'pct';
  ts: string;                    // ISO timestamp
  citation_url?: string;
  payload?: unknown;             // raw provider payload (truncated by writer)
}

/** Cadence the aggregator uses to schedule a source. */
export type Cadence = 'hourly' | 'daily' | 'weekly';

/** Composite dimension a source's metrics roll up into. */
export type Dimension = 'demand' | 'supply' | 'capital' | 'talent' | 'research' | 'sentiment';

export interface SourceDescriptor {
  key: string;                          // url-safe; primary key
  display_name: string;
  category: 'analyst' | 'capital_market' | 'web_signals' | 'public_data' | 'jobs' | 'research' | 'commerce';
  cadence: Cadence;
  /** Composite dimensions this source contributes weight toward. */
  dimensions: Dimension[];
  /** Aggregator weight (0..1). Higher = more influence on composite. */
  weight: number;
  /** True when access requires a paid contract (PitchBook etc.). */
  paid?: boolean;
  /** Per-day call cap surfaced to the quota tracker. */
  daily_cap?: number;
  /** Tier this source's data is gated to. */
  min_tier?: 'free' | 'growth' | 'pro' | 'institutional';
  /** Live fetcher — called when MI_FLAG_<KEY>=live. */
  fetchLive?: (env: Env, opts: { sectors: string[] }) => Promise<CommonRow[]>;
  /** Always-available stub. */
  fetchStub: (opts: { sectors: string[]; now?: Date }) => CommonRow[];
}

const REGISTRY = new Map<string, SourceDescriptor>();

export function registerSource(d: SourceDescriptor): void {
  if (REGISTRY.has(d.key)) {
    // Allow re-registration in dev; later registration wins.
    REGISTRY.set(d.key, d);
    return;
  }
  REGISTRY.set(d.key, d);
}

export function getSource(key: string): SourceDescriptor | undefined {
  return REGISTRY.get(key);
}

export function listSources(): SourceDescriptor[] {
  return Array.from(REGISTRY.values());
}

/**
 * Returns true when the operator flipped this source to LIVE via env.
 * Convention: `MI_FLAG_<UPPERCASE_KEY>=live`. Anything else (unset,
 * 'stub', '0') means run the stub.
 */
export function isLive(env: Env, key: string): boolean {
  const flag = (env as unknown as Record<string, string | undefined>)[
    `MI_FLAG_${key.toUpperCase()}`
  ];
  return (flag || '').toLowerCase() === 'live';
}
