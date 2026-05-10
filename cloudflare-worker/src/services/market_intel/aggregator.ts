/**
 * Task #14 (AA-1) — Market Intelligence aggregator.
 *
 * Two entry points the cron consumes:
 *   - `runSourcesByCadence(env, cadence)` — dispatches every registered
 *     source matching `cadence`, writing observations to
 *     `market_intel_rows`. Sources flagged LIVE call `fetchLive`; the
 *     rest call the always-available `fetchStub`.
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

async function runOneSource(env: Env, src: SourceDescriptor): Promise<{ source: string; inserted: number; mode: 'live' | 'stub' | 'degraded'; error?: string }> {
  const sectors = SECTORS.slice();
  const wantLive = isLive(env, src.key) && typeof src.fetchLive === 'function';
  // GRACEFUL DEGRADE — when a LIVE provider has burned its daily quota
  // we don't skip the cadence: we fall back to the deterministic stub so
  // the aggregator's recency window stays populated and composites don't
  // flatline. The mode label tells operators what happened.
  if (wantLive && (await isExhausted(env, src.key))) {
    const rows = src.fetchStub({ sectors, now: new Date() });
    const r = await persistRows(env, rows);
    return { source: src.key, inserted: r.inserted, mode: 'degraded', error: 'quota_exhausted' };
  }
  try {
    const rows = wantLive
      ? await src.fetchLive!(env, { sectors })
      : src.fetchStub({ sectors, now: new Date() });
    if (wantLive) await bumpQuota(env, src.key, { cap: src.daily_cap });
    const r = await persistRows(env, rows);
    return { source: src.key, inserted: r.inserted, mode: wantLive ? 'live' : 'stub' };
  } catch (e) {
    const msg = (e as Error)?.message || 'fetch_failed';
    if (wantLive && /429|rate.?limit/i.test(msg)) await markRateLimited(env, src.key);
    else if (wantLive) await bumpQuota(env, src.key, { error: true, cap: src.daily_cap });
    // Same continuity guarantee on transient failures: fill the window
    // with stub rows rather than leaving sectors data-starved.
    if (wantLive) {
      try {
        const rows = src.fetchStub({ sectors, now: new Date() });
        const r = await persistRows(env, rows);
        return { source: src.key, inserted: r.inserted, mode: 'degraded', error: msg };
      } catch {
        /* fall through */
      }
    }
    return { source: src.key, inserted: 0, mode: wantLive ? 'live' : 'stub', error: msg };
  }
}

export async function runSourcesByCadence(env: Env, cadence: Cadence): Promise<{ scanned: number; ok: number; failed: number; inserted: number; details: Array<Awaited<ReturnType<typeof runOneSource>>> }> {
  const sources = listSources().filter((s) => s.cadence === cadence);
  const details: Array<Awaited<ReturnType<typeof runOneSource>>> = [];
  let inserted = 0;
  let ok = 0;
  let failed = 0;
  for (const s of sources) {
    const r = await runOneSource(env, s);
    details.push(r);
    inserted += r.inserted;
    // 'degraded' is still successful continuity — count as ok but
    // surface the underlying error string in `details` for operators.
    if (r.error && r.mode !== 'degraded') failed += 1; else ok += 1;
  }
  return { scanned: sources.length, ok, failed, inserted, details };
}

interface IndexRow {
  sector: string;
  geo: string;
  period_key: string;
  dimension: Dimension | 'composite';
  value: number;
  source_count: number;
}

/** Read recent rows + recompute every (sector, dimension) composite. */
export async function recomputeIndexes(env: Env): Promise<{ sectors: number; rows_written: number }> {
  const sources = new Map(listSources().map((s) => [s.key, s] as const));
  const period = periodKey();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const allRows = (await env.DB.prepare(
    `SELECT source_key, sector, geo, metric_key, metric_value, ts
       FROM market_intel_rows WHERE ts >= ?`
  ).bind(cutoff).all<{ source_key: string; sector: string; geo: string; metric_key: string; metric_value: number; ts: string }>()).results || [];

  // Group rows by sector for the composer.
  const bySector = new Map<string, CommonRow[]>();
  for (const r of allRows) {
    const arr = bySector.get(r.sector) || [];
    arr.push(r as CommonRow);
    bySector.set(r.sector, arr);
  }

  const writes: IndexRow[] = [];
  const now = new Date();
  for (const sector of SECTORS) {
    const rows = bySector.get(sector) || [];
    const scores = composeSectorScores({ rows, sources, now });
    const dims: Dimension[] = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
    for (const d of dims) {
      writes.push({ sector, geo: 'global', period_key: period, dimension: d, value: scores[d].value, source_count: scores[d].source_count });
    }
    writes.push({
      sector, geo: 'global', period_key: period, dimension: 'composite',
      value: compositeHeadline(scores), source_count: rows.length,
    });
  }

  if (writes.length === 0) return { sectors: 0, rows_written: 0 };

  const stmts = writes.map((w) =>
    env.DB.prepare(
      `INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(sector, geo, period_key, dimension) DO UPDATE SET
         value = excluded.value,
         source_count = excluded.source_count,
         computed_at = excluded.computed_at`
    ).bind(w.sector, w.geo, w.period_key, w.dimension, w.value, w.source_count)
  );
  await env.DB.batch(stmts);

  // Persist the warm KV snapshot the /sector-compass route falls back to
  // when the edge cache misses. Written via the shared `writeKv` helper so
  // the prefix matches the read path. Do NOT bust here — the compute is
  // already the freshest snapshot we have.
  await writeKv(env, 'compass:global', { period_key: period, computed_at: new Date().toISOString(), rows: writes });

  return { sectors: SECTORS.length, rows_written: writes.length };
}
