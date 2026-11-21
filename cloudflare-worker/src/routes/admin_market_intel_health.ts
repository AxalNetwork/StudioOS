/**
 * D7707 (#7707) — HQ › market-intelligence source health: what each source
 * is set to, what its recent runs did and what its stored rows measure.
 * Mounts itself at `/api/admin/market-intel/health`, ahead of the admin hub,
 * behind `requireHqAdmin` (an HQ admin; a branch deployment is refused).
 * Read-only.
 *
 *   GET / → { sources: [SourceHealth], runs_per_source }
 *
 * SourceHealth: `{ key, display_name, flag: 'live' | 'off', cadence, status,
 * runs: [{ started_at, finished_at, outcome, reason, error_class, rows_seen,
 * rows_inserted, rows_unchanged }], runs_reason, live_rows, newest_period,
 * newest_period_end, newest_retrieved_at }`.
 *
 * A source with no run on record has `runs: []` and `runs_reason` saying so;
 * runs are recorded from D7707 on, for sources flagged live only. Only live
 * rows are counted (`liveRowSql()`, D538). `newest_period` is null with
 * `newest_period_reason` when no stored row records its period (every row
 * written before D7707). `newest_retrieved_at` is `COALESCE(retrieved_at, ts)`.
 * A read that fails answers 503 `market_intel_health_unreadable`, never zeros.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import admin from './admin';
import { listSources, isLive } from '../services/market_intel/registry';
import { liveRowSql, retrievedAtSql } from '../services/market_intel/liveRows';
import '../services/market_intel/sources';

/** How many recent runs each source shows. */
export const RUNS_PER_SOURCE = 5;
export const NO_RUN_REASON = 'No run on record. Runs are recorded from D7707 on, for sources flagged live.';
export const NO_PERIOD_REASON = 'No stored row records the period it measures.';

type RunRow = {
  source_key: string; started_at: string; finished_at: string | null; outcome: string; reason: string | null;
  error_class: string | null; rows_seen: number; rows_inserted: number; rows_unchanged: number | null;
};

const health = new Hono<{ Bindings: Env }>();

health.get('/', async (c) => {
  await requireHqAdmin(c);
  c.header('Cache-Control', 'private, no-store');
  let runs: RunRow[], held: Array<{ source_key: string; live_rows: number; newest_retrieved_at: string | null }>,
    periods: Array<{ source_key: string; observed_period: string; observed_period_end: string }>;
  try {
    [runs, held, periods] = await Promise.all([
      c.env.DB.prepare(
        `SELECT source_key, started_at, finished_at, outcome, reason, error_class, rows_seen, rows_inserted, rows_unchanged
           FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY started_at DESC, id DESC) AS rn
                   FROM market_intel_source_runs)
          WHERE rn <= ?
          ORDER BY source_key, started_at DESC, id DESC`
      ).bind(RUNS_PER_SOURCE).all<RunRow>().then((r) => r.results || []),
      c.env.DB.prepare(
        `SELECT source_key, COUNT(*) AS live_rows, MAX(${retrievedAtSql()}) AS newest_retrieved_at
           FROM market_intel_rows WHERE ${liveRowSql()} GROUP BY source_key`
      ).all<{ source_key: string; live_rows: number; newest_retrieved_at: string | null }>().then((r) => r.results || []),
      c.env.DB.prepare(
        `SELECT source_key, observed_period, observed_period_end
           FROM (SELECT source_key, observed_period, observed_period_end,
                        ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY observed_period_end DESC, id DESC) AS rn
                   FROM market_intel_rows
                  WHERE observed_period_end IS NOT NULL AND ${liveRowSql()})
          WHERE rn = 1`
      ).all<{ source_key: string; observed_period: string; observed_period_end: string }>().then((r) => r.results || []),
    ]);
  } catch (e) {
    return refuse(c, 503, {
      code: 'market_intel_health_unreadable',
      message: 'The market-intelligence run record could not be read.',
      raw: e,
    });
  }
  const runsBy = new Map<string, RunRow[]>();
  for (const r of runs) runsBy.set(r.source_key, [...(runsBy.get(r.source_key) || []), r]);
  const heldBy = new Map(held.map((h) => [h.source_key, h] as const));
  const periodBy = new Map(periods.map((p) => [p.source_key, p] as const));
  const sources = listSources()
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((s) => {
      const mine = (runsBy.get(s.key) || []).map(({ source_key: _k, ...rest }) => rest);
      const h = heldBy.get(s.key);
      const p = periodBy.get(s.key);
      return {
        key: s.key,
        display_name: s.display_name,
        flag: isLive(c.env, s.key) ? 'live' as const : 'off' as const,
        cadence: s.cadence,
        status: s.status ?? 'draft',
        runs: mine,
        ...(mine.length ? {} : { runs_reason: NO_RUN_REASON }),
        live_rows: Number(h?.live_rows ?? 0),
        newest_period: p?.observed_period ?? null,
        newest_period_end: p?.observed_period_end ?? null,
        ...(p ? {} : { newest_period_reason: NO_PERIOD_REASON }),
        newest_retrieved_at: h?.newest_retrieved_at ?? null,
      };
    });
  return c.json({ sources, runs_per_source: RUNS_PER_SOURCE });
});

export const mount: RouteMount = { path: '/api/admin/market-intel/health', router: health, before: [admin] };
export default health;
