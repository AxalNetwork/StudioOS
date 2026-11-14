/**
 * Task #14 (AA-1) — Market Intelligence aggregator.
 *
 * Two entry points the cron consumes:
 *   - `runSourcesByCadence(env, cadence)` — dispatches every registered
 *     source matching `cadence`, writing observations to
 *     `market_intel_rows`. Sources flagged LIVE call `fetchLive`. The rest
 *     store nothing and the run says why, unless `MI_STUB_ROWS = "on"`
 *     (development and tests), where they write their `fetchStub` (D538).
 *   - `recomputeIndexes(env)` — reads the last-WINDOW_DAYS rows, applies
 *     weights + decay, writes per-(sector, dimension) composites to
 *     `market_intel_indexes` and busts the KV layer.
 *
 * Re-runs are safe: the `INSERT OR REPLACE` on `market_intel_indexes`
 * keys on the UNIQUE(sector, geo, period_key, dimension) constraint, and
 * row writes are append-only (the read path filters by `ts`).
 */
import type { Env } from '../../types';
import type { CommonRow, SourceDescriptor, Cadence, Dimension } from './registry';
import { listSources, isLive } from './registry';
import { compositeHeadline, composeSectorScores, periodKey, WINDOW_DAYS } from './scoring';
import { bumpQuota, isExhausted, markRateLimited } from './quota';
import { writeKv } from './cache';
import { isLiveRow, liveRowSql, liveIndexSql, LIVE_INDEX_BASIS } from './liveRows';

/** Canonical sector universe. Connectors normalise to one of these. */
export const SECTORS = [
  'Agentic B2B', 'Bio-Automation', 'AI Infrastructure', 'Fintech / DeFi',
  'Data / Analytics', 'Cybersecurity', 'Autonomous Robotics',
  'Climate Intelligence', 'Quantum Infrastructure', 'Enterprise AI',
  'Vertical SaaS', 'DevTools',
] as const;
export type Sector = typeof SECTORS[number];

const ROW_PAYLOAD_TRUNC = 8 * 1024;

async function persistRows(env: Env, rows: CommonRow[]): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };
  const stmts = rows.map((r) =>
    env.DB.prepare(
      `INSERT INTO market_intel_rows
         (source_key, sector, geo, metric_key, metric_value, raw_value, unit, ts, citation_url, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      r.source_key,
      r.sector,
      r.geo ?? 'global',
      r.metric_key,
      r.metric_value,
      r.raw_value ?? null,
      r.unit ?? 'index',
      r.ts,
      r.citation_url ?? null,
      r.payload ? JSON.stringify(r.payload).slice(0, ROW_PAYLOAD_TRUNC) : null,
    )
  );
  await env.DB.batch(stmts);
  return { inserted: rows.length };
}

/**
 * D538 step 2 — whether a source that cannot report live data writes its
 * synthetic stub instead. `MI_STUB_ROWS = "on"` only, set in `.dev.vars` or a
 * test. `wrangler.toml` declares it `"off"` at the top level and under
 * `[env.production.vars]`, and anything else counts as off, so production
 * never stores a stub row again: the 237,372 it stored before D538 are the
 * reason this exists.
 */
export function stubRowsEnabled(env: Env): boolean {
  const v = (env as unknown as Record<string, string | undefined>).MI_STUB_ROWS;
  return (v || '').toLowerCase() === 'on';
}

/** Why a run stored nothing for a source. Shown to operators, never a figure. */
export type SkipReason = 'flag_off' | 'no_live_client' | 'quota_exhausted' | 'no_live_rows' | 'fetch_failed';

export interface SourceRun {
  source: string;
  inserted: number;
  mode: 'live' | 'stub' | 'degraded' | 'skipped';
  /** Set when mode is 'skipped': why nothing was stored. */
  reason?: SkipReason;
  error?: string;
}

async function runOneSource(env: Env, src: SourceDescriptor): Promise<SourceRun> {
  const sectors = SECTORS.slice();
  const stubs = stubRowsEnabled(env);
  const flaggedLive = isLive(env, src.key);
  const wantLive = flaggedLive && typeof src.fetchLive === 'function';
  const stubRun = async (mode: 'stub' | 'degraded', error?: string): Promise<SourceRun> => {
    const r = await persistRows(env, src.fetchStub({ sectors, now: new Date() }));
    return { source: src.key, inserted: r.inserted, mode, ...(error ? { error } : {}) };
  };
  const skip = (reason: SkipReason, error?: string): SourceRun =>
    ({ source: src.key, inserted: 0, mode: 'skipped', reason, ...(error ? { error } : {}) });

  if (!wantLive) {
    // Off: development gets its stub; production stores nothing.
    if (stubs) return stubRun('stub');
    return skip(flaggedLive ? 'no_live_client' : 'flag_off');
  }
  // GRACEFUL DEGRADE (development only since D538) — a live provider that
  // has burned its daily quota falls back to the stub so a dev database keeps
  // its recency window. In production it stores nothing and says why.
  if (await isExhausted(env, src.key)) {
    return stubs ? stubRun('degraded', 'quota_exhausted') : skip('quota_exhausted');
  }
  try {
    const fetched = await src.fetchLive!(env, { sectors });
    await bumpQuota(env, src.key, { cap: src.daily_cap });
    // A connector still marked draft answers fetchLive with stub rows. Those
    // are never stored as if they were live: outside development only rows a
    // provider can be cited for are kept (the D538 predicate).
    const rows = stubs ? fetched : fetched.filter(isLiveRow);
    if (rows.length === 0) return skip('no_live_rows');
    const r = await persistRows(env, rows);
    return { source: src.key, inserted: r.inserted, mode: 'live' };
  } catch (e) {
    const msg = ((e as Error)?.message || 'fetch_failed').slice(0, 200);
    if (/429|rate.?limit/i.test(msg)) await markRateLimited(env, src.key);
    else await bumpQuota(env, src.key, { error: true, cap: src.daily_cap });
    if (stubs) {
      try {
        return await stubRun('degraded', msg);
      } catch {
        /* fall through */
      }
    }
    return skip('fetch_failed', msg);
  }
}

export interface CadenceRun {
  scanned: number;
  ok: number;
  failed: number;
  inserted: number;
  /** Sources that stored nothing, with how many for each reason. */
  skipped: number;
  skip_reasons: Partial<Record<SkipReason, number>>;
  details: SourceRun[];
}

/**
 * Run `sources` in turn and record the outcome. A live fetch that failed and
 * stored nothing counts as failed; one a development stub filled in for is
 * 'degraded' and counts as ok, as before D538; a source that is merely off
 * counts as ok. Every source that stored nothing is logged with
 * its reason, so the run itself records why a sector has no figure.
 */
async function runSources(env: Env, sources: SourceDescriptor[], label: string): Promise<CadenceRun> {
  const details: SourceRun[] = [];
  const skip_reasons: Partial<Record<SkipReason, number>> = {};
  let inserted = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of sources) {
    const r = await runOneSource(env, s);
    details.push(r);
    inserted += r.inserted;
    if (r.mode === 'skipped') {
      skipped += 1;
      skip_reasons[r.reason!] = (skip_reasons[r.reason!] || 0) + 1;
    }
    if (r.reason === 'fetch_failed') failed += 1;
    else ok += 1;
  }
  if (skipped > 0) {
    const counts = Object.entries(skip_reasons).map(([k, n]) => `${k}:${n}`).join(',');
    const failures = details
      .filter((d) => d.reason === 'fetch_failed' || d.reason === 'quota_exhausted' || d.reason === 'no_live_rows')
      .map((d) => `${d.source}=${d.reason}${d.error ? `(${d.error.slice(0, 80)})` : ''}`)
      .join(' ');
    console.info(`[market-intel] ${label} stored nothing for ${skipped} source(s): ${counts}${failures ? ` ${failures}` : ''}`);
  }
  return { scanned: sources.length, ok, failed, inserted, skipped, skip_reasons, details };
}

/**
 * Task #5 (AK) — convenience wrapper that runs every FREE source on the
 * given cadence. The spec asks for a single cron-callable entry point for
 * the always-available connectors; this just filters out `paid: true`
 * descriptors so the cron can call `runFreeConnectors(env, 'hourly')`
 * without leaking into paid quotas.
 *
 * NOTE: cron WIRING (wrangler.toml schedule + invocation in `index.ts`)
 * is owned by Task #9 (AO). This export is the contract that task hooks
 * into — the existing 6h aggregator in index.ts still uses
 * `runSourcesByCadence` to keep both free + paid sources flowing on the
 * same cadence today.
 */
export async function runFreeConnectors(env: Env, cadence: Cadence): Promise<CadenceRun> {
  return runSources(env, listSources().filter((s) => s.cadence === cadence && !s.paid), `free ${cadence}`);
}

export async function runSourcesByCadence(env: Env, cadence: Cadence): Promise<CadenceRun> {
  return runSources(env, listSources().filter((s) => s.cadence === cadence), cadence);
}

interface IndexRow {
  sector: string;
  geo: string;
  period_key: string;
  dimension: Dimension | 'composite';
  value: number;
  /** Change against the previous month's live value, in percent; null when there is none. */
  delta_pct: number | null;
  source_count: number;
}

/** The month before `period` (`YYYY-MM`). */
export function previousPeriodKey(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * D538 — the change from one month to the next, which nothing wrote before.
 * Only from a live previous-month value above zero; otherwise null, never 0.
 */
export function deltaPct(value: number, previous: number | undefined): number | null {
  if (previous == null || !isFinite(previous) || previous <= 0 || !isFinite(value)) return null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

/**
 * Read recent LIVE rows + recompute every (sector, dimension) composite.
 *
 * D538: stub rows are never read here (`liveRowSql`), a dimension no live
 * row contributes to is not written, and every row written carries
 * `basis = 'live'` so the read side can tell it from the stub-derived
 * indexes written before D538. For the current period, a dimension that has
 * lost its live data loses its row too, so a stale figure cannot linger.
 */
export async function recomputeIndexes(env: Env): Promise<{ sectors: number; rows_written: number; rows_cleared: number }> {
  const sources = new Map(listSources().map((s) => [s.key, s] as const));
  const period = periodKey();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const allRows = (await env.DB.prepare(
    `SELECT source_key, sector, geo, metric_key, metric_value, ts
       FROM market_intel_rows WHERE ts >= ? AND ${liveRowSql()}`
  ).bind(cutoff).all<{ source_key: string; sector: string; geo: string; metric_key: string; metric_value: number; ts: string }>()).results || [];

  // D538 — last month's live values, so each write carries its change.
  const prevRows = (await env.DB.prepare(
    `SELECT sector, dimension, value FROM market_intel_indexes
      WHERE geo = 'global' AND period_key = ? AND ${liveIndexSql()}`
  ).bind(previousPeriodKey(period)).all<{ sector: string; dimension: string; value: number }>()).results || [];
  const prev = new Map(prevRows.map((p) => [`${p.sector}|${p.dimension}`, p.value] as const));

  // Group rows by sector for the composer.
  const bySector = new Map<string, CommonRow[]>();
  for (const r of allRows) {
    const arr = bySector.get(r.sector) || [];
    arr.push(r as CommonRow);
    bySector.set(r.sector, arr);
  }

  const writes: IndexRow[] = [];
  const cleared: Array<{ sector: string; dimension: Dimension | 'composite' }> = [];
  const now = new Date();
  for (const sector of SECTORS) {
    const rows = bySector.get(sector) || [];
    const scores = composeSectorScores({ rows, sources, now });
    const dims: Dimension[] = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
    for (const d of dims) {
      const v = scores[d].value;
      if (v == null) { cleared.push({ sector, dimension: d }); continue; }
      writes.push({
        sector, geo: 'global', period_key: period, dimension: d, value: v,
        delta_pct: deltaPct(v, prev.get(`${sector}|${d}`)), source_count: scores[d].source_count,
      });
    }
    const headline = compositeHeadline(scores);
    if (headline == null) { cleared.push({ sector, dimension: 'composite' }); continue; }
    writes.push({
      sector, geo: 'global', period_key: period, dimension: 'composite',
      value: headline, delta_pct: deltaPct(headline, prev.get(`${sector}|composite`)), source_count: rows.length,
    });
  }

  const stmts = [
    ...cleared.map((x) =>
      env.DB.prepare(
        `DELETE FROM market_intel_indexes
          WHERE sector = ? AND geo = 'global' AND period_key = ? AND dimension = ?`
      ).bind(x.sector, period, x.dimension)
    ),
    ...writes.map((w) =>
      env.DB.prepare(
        `INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, delta_pct, source_count, computed_at, basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
         ON CONFLICT(sector, geo, period_key, dimension) DO UPDATE SET
           value = excluded.value,
           delta_pct = excluded.delta_pct,
           source_count = excluded.source_count,
           computed_at = excluded.computed_at,
           basis = excluded.basis`
      ).bind(w.sector, w.geo, w.period_key, w.dimension, w.value, w.delta_pct, w.source_count, LIVE_INDEX_BASIS)
    ),
  ];
  if (stmts.length > 0) await env.DB.batch(stmts);

  // Persist the warm KV snapshot the /sector-compass route falls back to
  // when the edge cache misses. Written via the shared `writeKv` helper so
  // the prefix matches the read path. Do NOT bust here — the compute is
  // already the freshest snapshot we have. The key is versioned (D538) so a
  // snapshot of stub-derived indexes written before D538 is never read.
  await writeKv(env, COMPASS_KV_KEY, { period_key: period, computed_at: new Date().toISOString(), rows: writes });

  return { sectors: SECTORS.length, rows_written: writes.length, rows_cleared: cleared.length };
}

/**
 * KV key of the warm sector-compass snapshot. `:live` since D538: the old
 * `compass:global` snapshot held stub-derived indexes and must never be read.
 */
export const COMPASS_KV_KEY = 'compass:global:live';
