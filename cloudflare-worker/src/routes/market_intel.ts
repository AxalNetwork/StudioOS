import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getLiveQuotes, getMarketHeadlines } from '../services/market-data';
import { ensureInvestorTier, effectiveInvestorTier, type InvestorUser } from '../middleware/requireInvestorTier';
import type { User } from '../types';
import type { TierUser } from '../middleware/requireTier';

/** Authenticated caller as enriched by requireAuth + tier joins. */
type MIUser = User & Partial<TierUser> & Partial<InvestorUser>;
import { ensureMarketIntelSchema } from '../services/market_intel/schema';
import { listSources, isLive } from '../services/market_intel/registry';
import { SECTORS, recomputeIndexes, COMPASS_KV_KEY } from '../services/market_intel/aggregator';
import { liveIndexSql, liveRowSql, NO_LIVE_SOURCE_REASON } from '../services/market_intel/liveRows';
import { periodKey, WINDOW_DAYS } from '../services/market_intel/scoring';
import { readEdgeCache, writeEdgeCache, readKv, writeKv } from '../services/market_intel/cache';
// Side-effect import — every connector calls registerSource() at module
// top-level so listSources() returns the full set after this barrel.
import '../services/market_intel/sources';
import { investorSignals as investorSignalsApp } from './investor_signals';
import { callerHasFullLens } from '../util/marketIntelTier';

const marketIntel = new Hono<{ Bindings: Env }>();

// Task #5 (AK) — spec requires `GET /api/market-intel/investor-signals`
// alongside the standalone `/api/investor-signals` mount. We mount the
// same Hono sub-app under `/investor-signals` so both paths surface the
// identical filtered+latest endpoints with no logic duplication.
marketIntel.route('/investor-signals', investorSignalsApp);

// All market-intel endpoints require an authenticated session.
marketIntel.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureMarketIntelSchema(c.env);
  await next();
});

// ─────────────────────────────────────────────────────────────────────────
// D538 (#1078) — no figure written into the code reaches a screen.
//
// Until D538 this file carried five constants of figures nobody recorded —
// sector revenue multiples, sentiment and hiring claims (MARKET_PULSE),
// sector P/E and IPO windows (MACRO_DATA), six named private rounds
// (PRIVATE_ROUNDS), "high-conviction plays" (HIGH_CONVICTION) and fifteen
// studio benchmarks (STUDIO_BENCHMARKS) — and seven endpoints served them as
// readings. Each endpoint keeps its shape and its live parts (the headline
// and quote feeds call real providers) and says what is not recorded, and
// why. Never a zero, never an invented figure.
// ─────────────────────────────────────────────────────────────────────────

/** The shape every "not recorded" part of a market-intel response takes. */
export interface NotRecorded { recorded: false; reason: string }
export function notRecorded(reason: string): NotRecorded {
  return { recorded: false, reason };
}

export const NOT_RECORDED_REASONS = {
  sector_signals: 'No live source records sector multiples, sentiment or hiring signals yet',
  sector_macro: 'No live source records sector P/E, growth or IPO windows yet',
  private_rounds: 'No store of private funding rounds yet',
  studio_benchmarks: 'Studio benchmarks are not computed from recorded data yet',
  conviction_plays: 'Conviction plays need live sector data, and none is recorded yet',
} as const;

marketIntel.get('/market-pulse', async (c) => {
  const updated_at = new Date().toISOString();
  let headlines: any[] = [];
  let sources: string[] = [];
  let cached = false;
  let headlines_unreadable: string | null = null;
  try {
    const h = await getMarketHeadlines(c.env);
    headlines = h.headlines;
    sources = h.sources;
    cached = h.cached;
  } catch (e) {
    headlines_unreadable = (e as Error)?.message || 'headline feeds unreadable';
  }
  return c.json({
    signals: [],
    signals_not_recorded: notRecorded(NOT_RECORDED_REASONS.sector_signals),
    headlines,
    headlines_sources: sources,
    headlines_cached: cached,
    headlines_unreadable,
    updated_at,
    total_sectors: null,
  });
});

marketIntel.get('/macro', async (c) => {
  let live_quotes: any[] = [];
  let quotes_updated_at: string | null = null;
  let cached = false;
  let quotes_unreadable: string | null = null;
  try {
    const q = await getLiveQuotes(c.env);
    live_quotes = q.quotes;
    quotes_updated_at = q.updated_at;
    cached = q.cached;
  } catch (e) {
    quotes_unreadable = (e as Error)?.message || 'quote feed unreadable';
  }
  return c.json({
    sectors: [],
    sectors_not_recorded: notRecorded(NOT_RECORDED_REASONS.sector_macro),
    interest_rate_impact: null,
    exit_environment: null,
    live_quotes,
    quotes_updated_at,
    quotes_cached: cached,
    quotes_unreadable,
  });
});

marketIntel.get('/private-rounds', (c) => c.json({
  rounds: [],
  total: null,
  not_recorded: notRecorded(NOT_RECORDED_REASONS.private_rounds),
  updated_at: new Date().toISOString(),
}));

marketIntel.get('/studio-benchmarks', (c) => c.json({
  not_recorded: notRecorded(NOT_RECORDED_REASONS.studio_benchmarks),
}));

marketIntel.get('/competitive-intelligence', (c) => c.json({
  high_conviction_plays: [],
  high_conviction_not_recorded: notRecorded(NOT_RECORDED_REASONS.conviction_plays),
  studio_benchmarks: null,
  studio_benchmarks_not_recorded: notRecorded(NOT_RECORDED_REASONS.studio_benchmarks),
  market_pulse: [],
  market_pulse_not_recorded: notRecorded(NOT_RECORDED_REASONS.sector_signals),
  updated_at: new Date().toISOString(),
}));

// Task #6 (W-1) — Market Intelligence export. Free investors get a paywall;
// Professional+ (and admin/partner/advisor bypass) pass. Since D538 there is
// nothing recorded to export: the CSV was the hardcoded market pulse, so the
// route answers 409 `not_recorded` with the reason instead of a file of
// invented rows.
marketIntel.get('/export', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role === 'investor') {
    ensureInvestorTier(user, 'professional');
  }
  return c.json({ error: 'not_recorded', ...notRecorded(NOT_RECORDED_REASONS.sector_signals) }, 409);
});

// ─────────────────────────────────────────────────────────────────────────
// Task #14 (AA-1) — Aggregator-backed lenses.
//
// All endpoints here read from the new `market_intel_indexes` /
// `market_intel_rows` tables populated by the cron-driven aggregator
// (services/market_intel/aggregator.ts). Tier gating is enforced
// SERVER-SIDE per the AA-1 spec:
//   • Free            → composite indexes only (sector compass headline).
//   • Growth/Pro      → full lens + watchlist read.
//   • Studio/Pro      → exports + alerts (watchlist write).
//   • Institutional   → quarterly Axal-VC PDF queue.
// Bypass roles (admin/partner/advisor) always see the full surface.
// ─────────────────────────────────────────────────────────────────────────

type Role = 'admin' | 'founder' | 'partner' | 'investor' | 'advisor';
const FULL_LENS_BYPASS: Role[] = ['admin', 'partner', 'advisor'];

interface IndexRow {
  sector: string; geo: string; period_key: string;
  dimension: string; value: number; source_count: number;
  computed_at: string;
  /** D538 — change against the previous month's live value; null when there is none. */
  delta_pct?: number | null;
}
interface CitationRow {
  source_key: string; sector: string; metric_key: string;
  metric_value: number; ts: string; ingested_at?: string;
  citation_url: string | null;
}
interface WatchlistRow {
  id: number; sector: string; geo: string; cadence: string; created_at: string;
}

/**
 * The current period's index rows, LIVE ONLY (D538): an index row is read
 * only when the aggregator computed it from live rows (`basis = 'live'`).
 * The stub-derived rows written before D538 have no basis and never surface.
 */
async function readCurrentIndexes(env: Env, period: string): Promise<IndexRow[]> {
  const read = async () => (await env.DB.prepare(
    `SELECT sector, geo, period_key, dimension, value, delta_pct, source_count, computed_at
       FROM market_intel_indexes WHERE period_key = ? AND geo = 'global' AND ${liveIndexSql()}`
  ).bind(period).all<IndexRow>()).results || [];
  const rows = await read();
  if (rows.length > 0) return rows;
  // Cold start path — first deploy after migration / before any cron run.
  // Compute on demand so the first reader gets whatever live data exists.
  await recomputeIndexes(env);
  return read();
}

const DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const;

/** A value or nothing: an index row's value, or null with the reason (D538). */
function indexValue(r: IndexRow | undefined): { value: number | null; source_count: number; delta_pct: number | null; reason?: string } {
  return r
    ? { value: r.value, source_count: r.source_count, delta_pct: r.delta_pct ?? null }
    : { value: null, source_count: 0, delta_pct: null, reason: NO_LIVE_SOURCE_REASON };
}

/** What the composite read says about its own history (D538). */
export const INDEX_HISTORY_NOTE =
  'One index value per sector, dimension and month. The current month is month to date: each refresh overwrites it.';
export const DELTA_NOTE =
  "delta_pct compares a figure with the previous month's live value; it is null when there is none.";
const DAY_MS = 86_400_000;

/**
 * A live observation older than this many days means live data has stopped:
 * the window cannot fill, and no date for a full index is given (D538).
 */
export const LIVE_STALE_AFTER_DAYS = 2;

/**
 * D538 step 4 — how fresh the composite is: the first day of live data inside
 * the scoring window, how many distinct days of the window carry a live
 * observation, whether that coverage is full and still current, when the
 * first full-window index is due, and how many monthly points the index has.
 * Coverage is counted from observation days, never from elapsed time since
 * the first one: a source that wrote once and stopped covers one day.
 * Read failures say "Unreadable", never zero.
 */
export async function readCompassFreshness(env: Env, now = new Date()) {
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();
  let live: Record<string, unknown>;
  try {
    const obs = await env.DB.prepare(
      `SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(DISTINCT substr(ts, 1, 10)) AS days
         FROM market_intel_rows WHERE ts >= ? AND ${liveRowSql()}`
    ).bind(cutoff).first<{ first_ts: string | null; last_ts: string | null; days: number | null }>();
    const firstTs = obs?.first_ts ?? null;
    const lastTs = obs?.last_ts ?? null;
    if (!firstTs || !lastTs) {
      live = { live_since: null, live_since_reason: 'No live source has reported yet', window_days: WINDOW_DAYS, days_covered: 0, window_full: false, first_full_index_in_days: null };
    } else {
      // A 30-day window spans 31 calendar dates; full means at most one of
      // the last WINDOW_DAYS days went without a live observation.
      const covered = Math.min(Number(obs?.days ?? 0), WINDOW_DAYS);
      const needed = WINDOW_DAYS - 1;
      const lastAgeDays = Math.max(0, (now.getTime() - new Date(lastTs).getTime()) / DAY_MS);
      const recent = lastAgeDays <= LIVE_STALE_AFTER_DAYS;
      const full = recent && covered >= needed;
      live = {
        live_since: firstTs.slice(0, 10),
        // Once live data covers the whole window, its first day inside the
        // window is a lower bound: the data may go back further.
        live_since_exact: !full,
        last_live: lastTs.slice(0, 10),
        live_recent: recent,
        window_days: WINDOW_DAYS,
        days_covered: covered,
        window_full: full,
        // The fewest further days of daily live observations before the
        // window is full; null while live data has stopped.
        first_full_index_in_days: full ? 0 : recent ? needed - covered : null,
        ...(recent ? {} : { first_full_index_reason: `No live observation in the last ${LIVE_STALE_AFTER_DAYS} days` }),
      };
    }
  } catch {
    live = { live_since: null, live_since_reason: 'Unreadable', window_days: WINDOW_DAYS, days_covered: null, window_full: null, first_full_index_in_days: null };
  }
  let points: Record<string, unknown>;
  try {
    const n = await env.DB.prepare(
      `SELECT COUNT(DISTINCT period_key) AS n FROM market_intel_indexes WHERE geo = 'global' AND ${liveIndexSql()}`
    ).first<{ n: number }>();
    points = { monthly_points: Number(n?.n ?? 0) };
  } catch {
    points = { monthly_points: null, monthly_points_reason: 'Unreadable' };
  }
  return { ...live, ...points };
}

/** Sector Compass — public composite. Free callers see this everywhere. */
marketIntel.get('/sector-compass', async (c) => {
  const user = await requireAuth(c);
  const period = periodKey();
  const tierLabel = callerHasFullLens(user) ? 'full' : 'free';
  const cached = await readEdgeCache(c.req.raw, tierLabel);
  if (cached) return cached;

  // Layered read: edge miss → KV warm snapshot (24h) → DB → cold compute.
  let rows: IndexRow[] = [];
  const warm = await readKv<{ period_key: string; rows: IndexRow[] }>(c.env, COMPASS_KV_KEY);
  if (warm && warm.period_key === period && Array.isArray(warm.rows) && warm.rows.length > 0) {
    rows = warm.rows;
  } else {
    rows = await readCurrentIndexes(c.env, period);
    if (rows.length > 0) {
      // Repopulate the warm snapshot so the next reader skips D1 entirely.
      await writeKv(c.env, COMPASS_KV_KEY, { period_key: period, computed_at: rows[0].computed_at, rows });
    }
  }
  const bySector: Record<string, Record<string, IndexRow>> = {};
  for (const r of rows) {
    bySector[r.sector] = bySector[r.sector] || {};
    bySector[r.sector][r.dimension] = r;
  }
  // Payload-level tier gating. Free callers get the composite headline
  // ONLY (no per-dimension breakdown); Growth+/bypass callers get the
  // full dimensional lens. Cache keys already fold in `tierLabel` so
  // the two shapes never cross-pollute the edge cache.
  //
  // D538: a sector or dimension with no live index row is `null` with the
  // reason — it used to be a neutral 50 that nothing recorded.
  const isFull = tierLabel === 'full';
  const sectors = SECTORS.map((sector) => {
    const dims = bySector[sector] || {};
    const head = indexValue(dims.composite);
    const base = {
      sector,
      composite: head.value,
      composite_delta_pct: head.delta_pct,
      ...(head.value == null ? { composite_reason: head.reason } : {}),
    };
    if (!isFull) return base;
    return {
      ...base,
      dimensions: DIMENSIONS.reduce((acc, d) => {
        acc[d] = indexValue(dims[d]);
        return acc;
      }, {} as Record<string, ReturnType<typeof indexValue>>),
    };
  });

  const body = {
    period_key: period,
    // D538 — the current month is always partial, and how much history and
    // how much live data stand behind it are part of the answer.
    period_status: 'month_to_date',
    history_note: INDEX_HISTORY_NOTE,
    delta_note: DELTA_NOTE,
    freshness: await readCompassFreshness(c.env),
    computed_at: rows[0]?.computed_at ?? null,
    recorded_sectors: sectors.filter((x) => x.composite != null).length,
    sectors,
    lens: tierLabel,
  };
  return writeEdgeCache(c.req.raw, tierLabel, body);
});

/** Order recorded figures first (by `score`, descending), then the rest by name. */
function recordedFirst<T extends { sector: string }>(rows: T[], score: (r: T) => number | null): T[] {
  return rows.slice().sort((a, b) => {
    const sa = score(a); const sb = score(b);
    if (sa == null && sb == null) return a.sector.localeCompare(b.sector);
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });
}

/** Founder lens — gap opportunities + sector picks. Growth-gated. */
marketIntel.get('/founder-lens', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({
      error: 'tier_required',
      required: 'growth',
      message: 'The founder lens needs the Growth tier or higher.',
      checkout_path: '/api/billing/checkout',
    }, 402);
  }
  const period = periodKey();
  const rows = await readCurrentIndexes(c.env, period);
  const picks = SECTORS.map((sector) => {
    const r = rows.filter((x) => x.sector === sector);
    const composite = r.find((x) => x.dimension === 'composite')?.value ?? null;
    const supply = r.find((x) => x.dimension === 'supply')?.value ?? null;
    const demand = r.find((x) => x.dimension === 'demand')?.value ?? null;
    const opportunity_gap = demand != null && supply != null ? Math.round((demand - supply) * 10) / 10 : null;
    return {
      sector, composite, demand, supply, opportunity_gap,
      ...(opportunity_gap == null ? { reason: NO_LIVE_SOURCE_REASON } : {}),
    };
  });
  return c.json({
    period_key: period,
    picks: recordedFirst(picks, (p) => p.opportunity_gap),
    computed_at: rows[0]?.computed_at ?? null,
  });
});

/** Investor lens — capital + sentiment ordering. Investor Pro+/bypass only. */
marketIntel.get('/investor-lens', async (c) => {
  const user = await requireAuth(c);
  // Strict gate: investors must hold Pro+; admin/partner/advisor bypass;
  // founders/other roles never see the investor lens (use /founder-lens).
  if (FULL_LENS_BYPASS.includes(user.role as Role)) {
    /* bypass */
  } else if (user.role === 'investor') {
    ensureInvestorTier(user, 'professional');
  } else {
    return c.json({ error: 'tier_required', required: 'investor_professional' }, 402);
  }
  const period = periodKey();
  const rows = await readCurrentIndexes(c.env, period);
  const ranked = SECTORS.map((sector) => {
    const r = rows.filter((x) => x.sector === sector);
    const capital = r.find((x) => x.dimension === 'capital')?.value ?? null;
    const sentiment = r.find((x) => x.dimension === 'sentiment')?.value ?? null;
    const composite = r.find((x) => x.dimension === 'composite')?.value ?? null;
    const score = capital != null && sentiment != null ? Math.round((capital * 0.6 + sentiment * 0.4) * 10) / 10 : null;
    return {
      sector, capital, sentiment, composite, score,
      ...(score == null ? { reason: NO_LIVE_SOURCE_REASON } : {}),
    };
  });
  return c.json({
    period_key: period,
    ranked: recordedFirst(ranked, (x) => x.score),
    computed_at: rows[0]?.computed_at ?? null,
  });
});

// Task #5 (AK) — Geography lens. Currently single 'global' band; per-geo
// rollups land in AA-2. Both `/geography` and `/geography-lens` route to
// the same handler so the seven sub-tabs share a consistent lens-naming
// convention without paying for an internal sub-request.
const geographyLensHandler = async (c: Context<{ Bindings: Env }>) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'professional' }, 402);
  }
  const period = periodKey();
  const rows = await readCurrentIndexes(c.env, period);
  const composites = rows.filter((r) => r.dimension === 'composite').map((r) => ({ sector: r.sector, composite: r.value }));
  return c.json({
    period_key: period,
    geos: [{
      geo: 'global',
      sectors: composites,
      ...(composites.length === 0 ? { not_recorded: notRecorded(NO_LIVE_SOURCE_REASON) } : {}),
    }],
  });
};
marketIntel.get('/geography', geographyLensHandler);
marketIntel.get('/geography-lens', geographyLensHandler);

/** Citations — last N rows backing the most recent index recompute. */
marketIntel.get('/citations', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const sector = c.req.query('sector') || '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  // Task #5 (AK) — `since` (ISO timestamp) lets the Citations tab fetch
  // only rows newer than the user's last visit. Falls back to a 30-day
  // window when omitted or unparseable. The DB rows expose both `ts`
  // (observation time, source-supplied) and `created_at` (ingest time
  // written by `persistRows`) so the UI can display when WE saw it vs
  // when the source published it.
  const sinceQ = c.req.query('since');
  let cutoff: string;
  if (sinceQ) {
    const d = new Date(sinceQ);
    cutoff = isNaN(d.getTime())
      ? new Date(Date.now() - 30 * 86_400_000).toISOString()
      : d.toISOString();
  } else {
    cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  }
  // `since` filters on ingest time (`created_at`), matching the
  // Citations tab UX expectation of "what's new since I last looked".
  // The ORDER BY stays on `ts` so the most recently *observed* metric
  // surfaces first — ingest can lag observation by minutes.
  // SQLite stores `created_at` as `YYYY-MM-DD HH:MM:SS` (datetime('now'))
  // while ISO `cutoff` uses the `T` separator with milliseconds + `Z`.
  // Lexical TEXT compare on those two formats is unsafe — wrap both
  // sides in `datetime(...)` so the comparison normalizes to the
  // canonical Julian-day form. Same treatment for ts handling.
  const rows = sector
    ? (await c.env.DB.prepare(
        `SELECT source_key, sector, metric_key, metric_value, ts, created_at AS ingested_at, citation_url
           FROM market_intel_rows WHERE datetime(created_at) >= datetime(?) AND sector = ? AND ${liveRowSql()}
           ORDER BY datetime(ts) DESC LIMIT ?`
      ).bind(cutoff, sector, limit).all<CitationRow>()).results
    : (await c.env.DB.prepare(
        `SELECT source_key, sector, metric_key, metric_value, ts, created_at AS ingested_at, citation_url
           FROM market_intel_rows WHERE datetime(created_at) >= datetime(?) AND ${liveRowSql()}
           ORDER BY datetime(ts) DESC LIMIT ?`
      ).bind(cutoff, limit).all<CitationRow>()).results;
  return c.json({ rows: rows || [], since: cutoff });
});

/** List the registered sources + their LIVE/STUB status. Available to all auth'd callers. */
marketIntel.get('/sources', async (c) => {
  const cached = await readKv<any>(c.env, 'sources:catalog');
  if (cached) return c.json(cached);
  const rows = listSources().map((s) => ({
    key: s.key,
    display_name: s.display_name,
    category: s.category,
    cadence: s.cadence,
    dimensions: s.dimensions,
    weight: s.weight,
    paid: !!s.paid,
    live: isLive(c.env, s.key),
  }));
  const body = { count: rows.length, sources: rows };
  await writeKv(c.env, 'sources:catalog', body, 60 * 60);
  return c.json(body);
});

// Watchlist — Growth+/Pro+ may CRUD their own; cron-driven digests reuse
// services/notify.ts (Task #14 cron pulses already flush pending digests).
marketIntel.get('/watchlist', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const rows = (await c.env.DB.prepare(
    `SELECT id, sector, geo, cadence, created_at FROM market_intel_watchlist WHERE user_id = ? ORDER BY id DESC`
  ).bind(user.id).all<WatchlistRow>()).results || [];
  // Task #32 — surface the per-user digest pause window so the UI can
  // render the "Pause digests" control with the correct state. NULL =
  // not paused; ISO timestamp = paused until then; the sentinel
  // '9999-12-31T00:00:00Z' = paused indefinitely.
  const pauseRow = await c.env.DB.prepare(
    `SELECT mi_digest_paused_until AS until FROM users WHERE id = ?`
  ).bind(user.id).first<{ until: string | null }>();
  const until = pauseRow?.until || null;
  const nowIso = new Date().toISOString();
  const isActive = !!(until && until > nowIso);
  const indefinite = !!(until && until.startsWith('9999-'));
  return c.json({
    rows,
    digest_pause: {
      paused_until: isActive ? until : null,
      indefinite: isActive && indefinite,
    },
  });
});

// Task #32 — set/clear the per-user digest pause window. Body shape:
//   { until: 'iso-string' }   → pause until that timestamp
//   { until: 'indefinite' }   → pause forever (sentinel year 9999)
//   { until: null }           → resume immediately
// 1w/1m presets are computed client-side so the server stays a thin
// passthrough — easier to add new presets without a deploy.
marketIntel.post('/watchlist/pause', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const body = await c.req.json<{ until?: string | null }>().catch(() => ({} as { until?: string | null }));
  let value: string | null = null;
  const until = body?.until;
  if (until != null) {
    if (until === 'indefinite') {
      value = '9999-12-31T00:00:00.000Z';
    } else {
      const d = new Date(String(until));
      if (isNaN(d.getTime())) return c.json({ error: 'invalid_until' }, 400);
      // Cap at 1 year so a typo (e.g. year 4001) doesn't strand the
      // user; "indefinite" is the explicit sentinel for forever.
      const max = new Date(Date.now() + 366 * 86_400_000);
      value = (d > max ? max : d).toISOString();
    }
  }
  await c.env.DB.prepare(
    `UPDATE users SET mi_digest_paused_until = ? WHERE id = ?`
  ).bind(value, user.id).run();
  return c.json({ ok: true, paused_until: value });
});

marketIntel.post('/watchlist', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const body = await c.req.json<{ sector?: string; geo?: string; cadence?: 'weekly' | 'monthly' }>().catch(() => ({} as { sector?: string; geo?: string; cadence?: 'weekly' | 'monthly' }));
  const sector = String(body.sector || '').trim();
  if (!sector || !(SECTORS as readonly string[]).includes(sector)) {
    return c.json({ error: 'invalid_sector' }, 400);
  }
  const geo = body.geo || 'global';
  const cadence = body.cadence === 'monthly' ? 'monthly' : 'weekly';
  await c.env.DB.prepare(
    `INSERT INTO market_intel_watchlist (user_id, sector, geo, cadence) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, sector, geo) DO UPDATE SET cadence = excluded.cadence`
  ).bind(user.id, sector, geo, cadence).run();
  return c.json({ ok: true });
});

marketIntel.delete('/watchlist/:id', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM market_intel_watchlist WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).run();
  return c.json({ ok: true });
});

// =============================================================================
// Task #6 (AT-1) — Anonymised advisor-derived MI surfaces.
//
// Nine read endpoints over `market_intel_aggregates` (k≥5 enforced both
// at reduce-time and read-time). Investor-identity disclosure on the
// `/fit/*` endpoints requires an active pairwise NDA; otherwise the
// counter-party id is hashed.
// =============================================================================
import { ensureExtractorSchema } from '../services/market_intel/extractor_schema';
import { refuse } from '../util/refusal';

marketIntel.use('/at1/*', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/sentiment',     async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/talc',          async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/demand-supply', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/sector-heat',   async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/sentiment-geo', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/capital-velocity', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/partner-pulse', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/fit/*',         async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/contribution-optout', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });

const K_MIN = 5;
function safeJson(s: string | null | undefined): any { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
function clampPeriods(p: string | undefined, fallback: number): number {
  const n = p ? parseInt(p, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(52, Math.max(1, n));
}

// 1. /sentiment — recent N weeks per sector, mean valence + energy.
marketIntel.get('/sentiment', async (c) => {
  const periods = clampPeriods(c.req.query('weeks'), 8);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='sentiment' AND n >= ?
       ORDER BY period_key DESC, dimension_key ASC LIMIT ?`,
  ).bind(K_MIN, periods * 32).all();
  const items = (rows.results || []).map((r: any) => ({
    sector: String(r.dimension_key).replace(/^sector:/, ''),
    period_key: r.period_key,
    valence: r.value,
    energy: safeJson(r.payload_json).energy ?? null,
    n: r.n,
  }));
  // Task #3 (CE) — `source: 'advisor'` tags this response as the
  // community-derived series. Frontend renders it as a second line
  // alongside the external series surfaced by /market-pulse,
  // /private-rounds, etc. — never as a replacement.
  return c.json({ items, k_min: K_MIN, source: 'advisor' });
});

// 2. /talc — TALC stage distribution per persona × sector.
marketIntel.get('/talc', async (c) => {
  const periods = clampPeriods(c.req.query('months'), 6);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='talc' AND n >= ?
       ORDER BY period_key DESC LIMIT ?`,
  ).bind(K_MIN, periods * 64).all();
  const items = (rows.results || []).map((r: any) => {
    const [persona, sector] = String(r.dimension_key).split(':');
    const p = safeJson(r.payload_json);
    return { persona, sector, period_key: r.period_key, mode: p.mode || null,
             distribution: p.distribution || {}, dominance: r.value, n: r.n };
  });
  return c.json({ items, k_min: K_MIN, source: 'advisor' });
});

// 3. /demand-supply — counts by sector × side × topic.
marketIntel.get('/demand-supply', async (c) => {
  const sector = (c.req.query('sector') || '').slice(0, 64) || null;
  const where = sector ? `AND dimension_key LIKE ?` : '';
  const stmt = c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value FROM market_intel_aggregates
       WHERE extractor='demand_supply' AND n >= ? ${where}
       ORDER BY period_key DESC, value DESC LIMIT 200`,
  );
  const rows = sector ? await stmt.bind(K_MIN, `${sector}:%`).all() : await stmt.bind(K_MIN).all();
  const items = (rows.results || []).map((r: any) => {
    const [sec, side, topic] = String(r.dimension_key).split(':');
    return { sector: sec, side, topic, period_key: r.period_key, count: r.value, n: r.n };
  });
  return c.json({ items, k_min: K_MIN, source: 'advisor' });
});

// 4. /sector-heat — composite "heat" index per sector (and sub-sector
//    when the reducer emits dimension_key='sector:X:Y' rows) per week.
marketIntel.get('/sector-heat', async (c) => {
  const weeks = clampPeriods(c.req.query('weeks'), 8);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='sector_heat' AND n >= ?
       ORDER BY period_key DESC, value DESC LIMIT ?`,
  ).bind(K_MIN, weeks * 64).all();
  const items = (rows.results || []).map((r: any) => {
    const p = safeJson(r.payload_json);
    // dimension_key is either `sector:X` (top-level) or `sector:X:Y`
    // (sub-sector). Split so the frontend can render expandable sub-rows.
    const parts = String(r.dimension_key).split(':');
    const sector = parts[1] || '';
    const sub_sector = parts.length > 2 ? parts.slice(2).join(':') : null;
    return { sector, sub_sector,
             period_key: r.period_key, heat: r.value,
             contributions: p.contributions ?? null, mean_valence: p.mean_valence ?? null, n: r.n };
  });
  return c.json({ items, k_min: K_MIN, source: 'advisor' });
});

// 5. /sentiment-geo — geo × sector cross-tab.
marketIntel.get('/sentiment-geo', async (c) => {
  const weeks = clampPeriods(c.req.query('weeks'), 4);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value FROM market_intel_aggregates
       WHERE extractor='sentiment_geo' AND n >= ?
       ORDER BY period_key DESC LIMIT ?`,
  ).bind(K_MIN, weeks * 64).all();
  const items = (rows.results || []).map((r: any) => {
    const [, geo, sector] = String(r.dimension_key).split(':');
    return { geo, sector, period_key: r.period_key, valence: r.value, n: r.n };
  });
  return c.json({ items, k_min: K_MIN, source: 'advisor' });
});

// 6. /capital-velocity — derived: investor-side TALC distribution shift
//    (higher dominance of 'distributing' → more capital recycling).
marketIntel.get('/capital-velocity', async (c) => {
  const months = clampPeriods(c.req.query('months'), 6);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='talc' AND n >= ? AND dimension_key LIKE 'investor:%'
       ORDER BY period_key DESC LIMIT ?`,
  ).bind(K_MIN, months * 16).all();
  const items = (rows.results || []).map((r: any) => {
    const [, sector] = String(r.dimension_key).split(':');
    const dist = (safeJson(r.payload_json).distribution || {}) as Record<string, number>;
    const total = Object.values(dist).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
    const distributing = (dist.distributing || 0) / total;
    const scaling = (dist.scaling || 0) / total;
    return { sector, period_key: r.period_key, velocity: round(distributing + 0.5 * scaling),
             distributing_share: round(distributing), scaling_share: round(scaling), n: r.n };
  });
  return c.json({ items, k_min: K_MIN, source: 'advisor' });
});

// 7. /partner-pulse — rolling supply-side topics aggregated across advisors+partners.
marketIntel.get('/partner-pulse', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value FROM market_intel_aggregates
       WHERE extractor='demand_supply' AND n >= ? AND dimension_key LIKE '%:supply:%'
       ORDER BY period_key DESC, value DESC LIMIT 200`,
  ).bind(K_MIN).all();
  const items = (rows.results || []).map((r: any) => {
    const [sector, , topic] = String(r.dimension_key).split(':');
    return { sector, topic, period_key: r.period_key, supply_count: r.value, n: r.n };
  });
  // Rate-card averages and comp-model histograms — populated by
  // the `partner_rate_card` / `partner_comp_model` extractors
  // (Task #1). Field names are snake_case (`rate_cards`, `comp_models`)
  // to match the rest of this route's response shape; the frontend
  // PartnerMarketplacePulseTab consumes them directly. Empty arrays
  // until k≥5 contributors per cell, in which case the frontend
  // renders the insufficient-data block.
  const rateRows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='partner_rate_card' AND n >= ?
       ORDER BY period_key DESC LIMIT 100`,
  ).bind(K_MIN).all().catch(() => ({ results: [] as any[] }));
  const rate_cards = ((rateRows as any).results || []).map((r: any) => {
    const [sector, topic] = String(r.dimension_key).split(':');
    const p = safeJson(r.payload_json);
    return {
      sector, topic, period_key: r.period_key,
      median_hourly: p.median_hourly ?? null,
      p25_hourly: p.p25_hourly ?? null,
      p75_hourly: p.p75_hourly ?? null,
      median_project: p.median_project ?? null,
      n: r.n,
    };
  });
  const compRows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='partner_comp_model' AND n >= ?
       ORDER BY period_key DESC LIMIT 100`,
  ).bind(K_MIN).all().catch(() => ({ results: [] as any[] }));
  const comp_models = ((compRows as any).results || []).map((r: any) => {
    const [sector] = String(r.dimension_key).split(':');
    const p = safeJson(r.payload_json);
    return {
      sector, period_key: r.period_key,
      distribution: p.distribution || {},
      n: r.n,
    };
  });
  return c.json({ items, rate_cards, comp_models, k_min: K_MIN, source: 'advisor' });
});

// 8. /fit/founder/:project_id — top investor matches for this founder's
//    project. Investor identifiers are hashed unless an active pairwise
//    NDA exists between viewer (founder) and the investor user.
marketIntel.get('/fit/founder/:project_id', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const projectId = parseInt(c.req.param('project_id'), 10);
  if (!Number.isFinite(projectId)) return c.json({ error: 'invalid_project' }, 400);
  // Resolve founder user_id for the project; require ownership.
  const owner = await c.env.DB.prepare(
    `SELECT u.id AS user_id FROM projects p JOIN users u ON u.founder_id = p.founder_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
  ).bind(projectId).first<{ user_id: number }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  if (owner.user_id !== user.id && !isAdmin) return c.json({ error: 'forbidden' }, 403);
  const cell = await c.env.DB.prepare(
    `SELECT n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='fit_match' AND dimension_key = ?`,
  ).bind(`founder:${owner.user_id}`).first<{ n: number; value: number; payload_json: string }>();
  if (!cell || (cell.n ?? 0) < K_MIN) {
    return c.json({ matches: [], note: cell ? 'k_anonymity_suppressed' : 'no_fit_yet', k_min: K_MIN, source: 'advisor' });
  }
  const matches = (safeJson(cell.payload_json).matches || []) as Array<{ user_id: number; score: number }>;
  const disclosed = await disclosedIdentities(c.env, user.id, matches.map((m) => m.user_id));
  return c.json({
    matches: await Promise.all(matches.map(async (m) => ({
      score: m.score,
      investor_user_id: disclosed.has(m.user_id) ? m.user_id : null,
      investor_id_hash: disclosed.has(m.user_id) ? null : await pseudoId(c.env, m.user_id),
      nda_required: !disclosed.has(m.user_id),
    }))),
    k_min: K_MIN,
    source: 'advisor',
  });
});

// 9. /fit/investor/me — top founder matches for the calling investor.
marketIntel.get('/fit/investor/me', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  if ((user.role || '').toLowerCase() !== 'investor' && (user.role || '').toLowerCase() !== 'admin') {
    return c.json({ error: 'forbidden', required_role: 'investor' }, 403);
  }
  const cell = await c.env.DB.prepare(
    `SELECT n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='fit_match' AND dimension_key = ?`,
  ).bind(`investor:${user.id}`).first<{ n: number; value: number; payload_json: string }>();
  if (!cell || (cell.n ?? 0) < K_MIN) {
    return c.json({ matches: [], note: cell ? 'k_anonymity_suppressed' : 'no_fit_yet', k_min: K_MIN, source: 'advisor' });
  }
  const matches = (safeJson(cell.payload_json).matches || []) as Array<{ user_id: number; score: number }>;
  const disclosed = await disclosedIdentities(c.env, user.id, matches.map((m) => m.user_id));
  return c.json({
    matches: await Promise.all(matches.map(async (m) => ({
      score: m.score,
      founder_user_id: disclosed.has(m.user_id) ? m.user_id : null,
      founder_id_hash: disclosed.has(m.user_id) ? null : await pseudoId(c.env, m.user_id),
      nda_required: !disclosed.has(m.user_id),
    }))),
    k_min: K_MIN,
    source: 'advisor',
  });
});

// Per-user opt-out toggle (default: contribute = optout=0).
marketIntel.get('/contribution-optout', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const r = await c.env.DB.prepare(`SELECT mi_contribution_optout AS x FROM users WHERE id = ?`)
    .bind(user.id).first<{ x: number | null }>();
  return c.json({ opted_out: Number(r?.x || 0) === 1 });
});
marketIntel.post('/contribution-optout', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const body = await c.req.json().catch(() => ({} as { opt_out?: boolean }));
  const flag = body.opt_out ? 1 : 0;
  await c.env.DB.prepare(`UPDATE users SET mi_contribution_optout = ? WHERE id = ?`).bind(flag, user.id).run();
  return c.json({ ok: true, opted_out: flag === 1, note: 'Existing contributions purged within 6h by the next reducer pass.' });
});

// Task #3 (CE) — admin-triggered immediate refresh. Enqueues an
// `mi_reduce` job so the next queue-drain tick rebuilds aggregates
// within minutes (vs the 6h cron). Admin only.
marketIntel.post('/admin/reduce', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const role = (user.role || '').toLowerCase();
  if (role !== 'admin') {
    return c.json({ error: 'forbidden', required_role: 'admin' }, 403);
  }
  try {
    const { Jobs } = await import('../models/jobs');
    await Jobs.enqueue(c.env, 'mi_reduce', { triggered_by: user.id, source: 'admin_refresh' });
    return c.json({ ok: true, enqueued: 'mi_reduce' });
  } catch (e) {
    return refuse(c, 500, { code: 'enqueue_failed', message: 'The refresh could not be queued. Try again in a moment.', raw: e, audience: 'member' });
  }
});

function round(x: number | null): number | null { return x == null ? null : Math.round(x * 1000) / 1000; }
// HMAC-SHA-256 truncated to 16 hex chars, keyed on
// AXAL_ENCRYPTION_SECRET (or JWT_SECRET as fallback) so non-disclosed
// numeric user-ids cannot be enumerated by brute-force preimage. The
// per-deployment secret means the opaque id is stable for one
// deployment but not portable across environments.
async function pseudoId(env: Env, id: number): Promise<string> {
  const secret = (env as any).AXAL_ENCRYPTION_SECRET || (env as any).JWT_SECRET || '';
  if (!secret) return `mi_anon_${(id * 2654435761 >>> 0).toString(36)}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`mi:fit:${id}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `mi_${hex.slice(0, 16)}`;
}

/** Returns the subset of `targetUserIds` for which an active pairwise NDA exists with the viewer. */
async function disclosedIdentities(env: Env, viewerId: number, targetUserIds: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (targetUserIds.length === 0) return out;
  const placeholders = targetUserIds.map(() => '?').join(',');
  try {
    const rows = await env.DB.prepare(
      `SELECT party_a_user_id AS a, party_b_user_id AS b
         FROM pairwise_ndas
         WHERE status='active'
           AND (valid_until IS NULL OR datetime(valid_until) > datetime('now'))
           AND ((party_a_user_id = ? AND party_b_user_id IN (${placeholders}))
             OR (party_b_user_id = ? AND party_a_user_id IN (${placeholders})))`,
    ).bind(viewerId, ...targetUserIds, viewerId, ...targetUserIds)
      .all<{ a: number; b: number }>();
    for (const r of rows.results || []) {
      if (r.a === viewerId) out.add(r.b);
      else if (r.b === viewerId) out.add(r.a);
    }
  } catch (e) {
    console.warn('[mi.fit] pairwise_ndas lookup failed:', (e as Error).message);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Task #4 (CF) — Platform Personas tab.
//
// Single endpoint returns 8 chart payloads describing the anonymised
// composition of platform users (founders, investors, advisors, partners).
// Every cell enforces k ≥ 5; sub-K cells are suppressed (returned as
// `null` or omitted from the payload entirely).
//
// Tier surfacing (rendered inline in the response so the UI doesn't
// have to know the rules):
//   • Free               → `role_donut` + `sector_heatmap` populated,
//                          all other charts return `{ tier_required: 'growth' }`
//   • Growth / Investor Pro / bypass roles → all 8 populated
//   • Studio / Institutional → adds `exports.csv_url` + `exports.pdf_url`
//
// Cached for 5 minutes via the existing MI KV layer; admin-trigger
// refresh is the same `POST /admin/reduce` enqueue route (the reducer
// purge runs first, then the next read recomputes from D1 on cache miss).
// ─────────────────────────────────────────────────────────────────────────

interface RoleDonutBucket { group: string; label: string; n: number }
interface RoleDonutChart { buckets: RoleDonutBucket[] }
interface SectorHeatCell { sector: string; persona: string; n: number }
interface SectorHeatChart { cells: SectorHeatCell[] }
interface StageFocusRow { stage: string; role: string; n: number }
interface StageFocusChart { rows: StageFocusRow[] }
interface GeoRow { country: string; n: number }
interface GeoChart { rows: GeoRow[] }
interface ActivityRow { role: string; active_users: number; events_per_user: number }
interface ActivityTopFeature { role: string; action: string; n: number }
interface ActivityChart { rows: ActivityRow[]; top_features: ActivityTopFeature[] }
interface FunnelRow { week: number; n: number }
interface FunnelChart {
  rows: FunnelRow[];
  completion_rate: number | null;
  started_band: string | null;
}
interface SignupsRow { week: string; role: string; n: number }
interface SignupsChart { rows: SignupsRow[] }
interface PipelineRow {
  tier_bucket: string;
  n: number;
  deals_watched: number;
  weighted_coverage: number;
}
interface PipelineChart { rows: PipelineRow[] }
interface GatedChart {
  tier_required: string;
  upgrade_path: string;
  blurred: boolean;
}
type Maybe<T> = T | GatedChart;

interface PlatformPersonasPayload {
  generated_at: string;
  k_min: number;
  source: 'platform';
  role_donut: Maybe<RoleDonutChart>;
  sector_heatmap: Maybe<SectorHeatChart>;
  stage_focus: Maybe<StageFocusChart>;
  geo_distribution: Maybe<GeoChart>;
  activity_composite: Maybe<ActivityChart>;
  spinout_lab_funnel: Maybe<FunnelChart>;
  signups_trend: Maybe<SignupsChart>;
  pipeline_coverage: Maybe<PipelineChart>;
  exports?: { csv_url: string; pdf_url: string };
  tier: 'free' | 'full' | 'export';
  /** Free-tier hint so the frontend can render blurred chart teasers. */
  free_teaser?: { gated_charts: string[]; reason: string };
}

function isGated(c: unknown): c is GatedChart {
  return !!c && typeof c === 'object' && 'tier_required' in (c as Record<string, unknown>);
}

const PERSONAS_KMIN = 5;

function suppressBelowK<T extends { n: number }>(rows: T[]): T[] {
  return rows.filter((r) => Number(r.n || 0) >= PERSONAS_KMIN);
}

function tierKind(user: MIUser): 'free' | 'full' | 'export' {
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'partner' || role === 'advisor') return 'export';
  if (role === 'investor') {
    const t = effectiveInvestorTier(user as InvestorUser);
    if (t === 'institutional') return 'export';
    if (t === 'professional') return 'full';
    return 'free';
  }
  const sub = String(user.subscription_tier ?? 'free').toLowerCase();
  if (sub === 'studio' || sub === 'institutional') return 'export';
  if (sub === 'growth' || sub === 'pro') return 'full';
  return 'free';
}

async function buildPersonasPayload(env: Env): Promise<PlatformPersonasPayload> {
  const now = new Date();
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch (e) {
      console.warn('[mi.personas] sub-query failed:', (e as Error).message);
      return fallback;
    }
  };

  // 1. Role distribution donut — role × sub-bucket.
  const role_donut = await safe(async () => {
    const roleRows = (await env.DB.prepare(
      `SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role`,
    ).all<{ role: string; n: number }>()).results || [];
    const founderSplit = (await env.DB.prepare(
      `SELECT persona_id AS bucket, COUNT(DISTINCT user_id) AS n
         FROM user_personas
        WHERE persona_id IN ('founder_new','founder_existing')
        GROUP BY persona_id`,
    ).all<{ bucket: string; n: number }>()).results || [];
    const investorTierRows = (await env.DB.prepare(
      `SELECT COALESCE(LOWER(subscription_tier),'free') AS bucket, COUNT(*) AS n
         FROM users WHERE role='investor' AND is_active=1 GROUP BY bucket`,
    ).all<{ bucket: string; n: number }>()).results || [];
    const partnerSubtypes = (await env.DB.prepare(
      `SELECT persona_id AS bucket, COUNT(DISTINCT user_id) AS n
         FROM user_personas
        WHERE persona_id IN ('service_provider','operator_advisor','corporate_vc','gp_external','sovereign_family_office')
        GROUP BY persona_id`,
    ).all<{ bucket: string; n: number }>()).results || [];
    const buckets = [
      ...suppressBelowK(roleRows).map((r) => ({ group: 'role', label: r.role, n: r.n })),
      ...suppressBelowK(founderSplit).map((r) => ({ group: 'founder_subtype', label: r.bucket, n: r.n })),
      ...suppressBelowK(investorTierRows).map((r) => ({ group: 'investor_tier', label: r.bucket, n: r.n })),
      ...suppressBelowK(partnerSubtypes).map((r) => ({ group: 'partner_subtype', label: r.bucket, n: r.n })),
    ];
    return { buckets, total: roleRows.reduce((s, r) => s + Number(r.n || 0), 0) };
  }, { buckets: [], total: 0 });

  // 2. Sector × Role heatmap — founders vs investors.
  const sector_heatmap = await safe(async () => {
    const rows = (await env.DB.prepare(
      `SELECT sector, persona, COUNT(DISTINCT user_id) AS n
         FROM market_intel_signals
        WHERE persona IN ('founder','investor') AND sector IS NOT NULL
        GROUP BY sector, persona`,
    ).all<{ sector: string; persona: string; n: number }>()).results || [];
    const cells = suppressBelowK(rows);
    return { cells, k_min: PERSONAS_KMIN };
  }, { cells: [], k_min: PERSONAS_KMIN });

  // 3. Stage focus stacked bar — founder project stage by role.
  const stage_focus = await safe(async () => {
    const rows = (await env.DB.prepare(
      `SELECT COALESCE(p.stage,'unknown') AS stage,
              u.role AS role,
              COUNT(DISTINCT u.id) AS n
         FROM users u
         LEFT JOIN projects p
           -- projects has no owner_user_id; founder_id is the only link,
           -- and it was already the first half of this disjunction.
           ON p.founder_id = u.founder_id
        WHERE u.is_active = 1
        GROUP BY stage, role`,
    ).all<{ stage: string; role: string; n: number }>()).results || [];
    return { rows: suppressBelowK(rows) };
  }, { rows: [] });

  // 4. Geo distribution pie.
  const geo_distribution = await safe(async () => {
    const rows = (await env.DB.prepare(
      `SELECT COALESCE(country,'unknown') AS country, COUNT(*) AS n
         FROM users WHERE is_active=1 GROUP BY country`,
    ).all<{ country: string; n: number }>()).results || [];
    return { rows: suppressBelowK(rows) };
  }, { rows: [] });

  // 5. Activity composite — events-per-active-user per role + top feature.
  const activity_composite = await safe(async () => {
    // D160 — BOTH SIDES WRAPPED IN datetime(), and the reason is measured.
    // `cutoff` is a raw ISO string (`2026-08-19T12:44:00.000Z`) while
    // `activity_logs.created_at` and `users.created_at` are
    // `DEFAULT (datetime('now'))` — `2026-08-19 12:44:00`. A lexical TEXT
    // compare hits index 10 first: ' ' (0x20) against 'T' (0x54), so EVERY
    // row dated on the cutoff's own date sorts below it and is dropped, while
    // later dates pass. The window silently returned one day short at its
    // leading edge. The Citations query 650 lines above already documents this
    // and already wraps both sides; these three did not.
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const events = (await env.DB.prepare(
      `SELECT u.role AS role,
              COUNT(*) AS events,
              COUNT(DISTINCT a.user_id) AS active_users
         FROM activity_logs a JOIN users u ON u.id = a.user_id
        WHERE datetime(a.created_at) >= datetime(?) AND u.is_active = 1
        GROUP BY u.role`,
    ).bind(cutoff).all<{ role: string; events: number; active_users: number }>()).results || [];
    const rows = events.filter((r) => Number(r.active_users || 0) >= PERSONAS_KMIN).map((r) => ({
      role: r.role,
      active_users: r.active_users,
      events_per_user: r.active_users ? Math.round((r.events / r.active_users) * 10) / 10 : 0,
    }));
    const top = (await env.DB.prepare(
      `SELECT u.role AS role, a.action AS action, COUNT(DISTINCT a.user_id) AS n
         FROM activity_logs a JOIN users u ON u.id = a.user_id
        WHERE datetime(a.created_at) >= datetime(?) AND u.is_active = 1
        GROUP BY u.role, a.action`,
    ).bind(cutoff).all<{ role: string; action: string; n: number }>()).results || [];
    const byRole = new Map<string, { role: string; action: string; n: number }>();
    for (const r of suppressBelowK(top)) {
      const cur = byRole.get(r.role);
      if (!cur || r.n > cur.n) byRole.set(r.role, r);
    }
    return { rows, top_features: Array.from(byRole.values()) };
  }, { rows: [], top_features: [] });

  // 6. Spin-Out Lab funnel — count per week + completion rate.
  const spinout_lab_funnel = await safe(async () => {
    const rows = (await env.DB.prepare(
      `SELECT spinout_lab_week AS week, COUNT(*) AS n
         FROM users WHERE role='founder' AND spinout_lab_active=1 AND is_active=1
        GROUP BY spinout_lab_week`,
    ).all<{ week: number; n: number }>()).results || [];
    const completedRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users
        WHERE role='founder' AND spinout_lab_active=1 AND is_incorporated=1`,
    ).first<{ n: number }>();
    const startedRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users
        WHERE role='founder' AND spinout_lab_active=1`,
    ).first<{ n: number }>();
    const completed = Number(completedRow?.n || 0);
    const started = Number(startedRow?.n || 0);
    // K-anonymity: suppress completion_rate unless BOTH the completed
    // and not-completed sub-cohorts each clear K. Otherwise a viewer
    // can back-solve the missing count from rate × started (e.g.
    // started=5, rate=20% ⇒ completed=1). Same reason we band started
    // into a coarse range instead of returning the exact integer.
    const notCompleted = Math.max(0, started - completed);
    const safeForRate = completed >= PERSONAS_KMIN && notCompleted >= PERSONAS_KMIN;
    const completion_rate = safeForRate
      ? Math.round((completed / started) * 1000) / 10
      : null;
    const startedBand = (() => {
      if (started < PERSONAS_KMIN) return null;
      if (started < 10) return '5-9';
      if (started < 25) return '10-24';
      if (started < 50) return '25-49';
      if (started < 100) return '50-99';
      if (started < 250) return '100-249';
      return '250+';
    })();
    return {
      rows: suppressBelowK(rows),
      completion_rate,
      started_band: startedBand,
    };
  }, { rows: [], completion_rate: null, started_band: null });

  // 7. New signups trend — weekly counts by role over last 12 weeks.
  const signups_trend = await safe(async () => {
    // D160 — BOTH SIDES WRAPPED IN datetime(), and the reason is measured.
    // `cutoff` is a raw ISO string (`2026-08-19T12:44:00.000Z`) while
    // `activity_logs.created_at` and `users.created_at` are
    // `DEFAULT (datetime('now'))` — `2026-08-19 12:44:00`. A lexical TEXT
    // compare hits index 10 first: ' ' (0x20) against 'T' (0x54), so EVERY
    // row dated on the cutoff's own date sorts below it and is dropped, while
    // later dates pass. The window silently returned one day short at its
    // leading edge. The Citations query 650 lines above already documents this
    // and already wraps both sides; these three did not.
    const cutoff = new Date(Date.now() - 12 * 7 * 86_400_000).toISOString();
    const rows = (await env.DB.prepare(
      `SELECT strftime('%Y-%W', created_at) AS week,
              role,
              COUNT(*) AS n
         FROM users
        WHERE datetime(created_at) >= datetime(?)
        GROUP BY week, role
        ORDER BY week ASC`,
    ).bind(cutoff).all<{ week: string; role: string; n: number }>()).results || [];
    return { rows: suppressBelowK(rows) };
  }, { rows: [] });

  // 8. Active investor pipeline coverage — investors weighted by tier × deals watched.
  const pipeline_coverage = await safe(async () => {
    const rows = (await env.DB.prepare(
      `SELECT COALESCE(LOWER(u.subscription_tier),'free') AS tier_bucket,
              COUNT(DISTINCT u.id) AS investors,
              COUNT(w.id) AS deals_watched
         FROM users u
         LEFT JOIN market_intel_watchlist w ON w.user_id = u.id
        WHERE u.role='investor' AND u.is_active=1
        GROUP BY tier_bucket`,
    ).all<{ tier_bucket: string; investors: number; deals_watched: number }>()).results || [];
    const weights: Record<string, number> = {
      institutional: 10, professional: 3, pro: 3, growth: 2, free: 1,
    };
    const cells = rows
      .filter((r) => Number(r.investors || 0) >= PERSONAS_KMIN)
      .map((r) => ({
        tier_bucket: r.tier_bucket,
        n: Number(r.investors),
        deals_watched: Number(r.deals_watched || 0),
        weighted_coverage: Number(r.investors) * (weights[r.tier_bucket] ?? 1)
                          + Number(r.deals_watched || 0),
      }));
    return { rows: cells };
  }, { rows: [] });

  return {
    generated_at: now.toISOString(),
    k_min: PERSONAS_KMIN,
    source: 'platform',
    role_donut,
    sector_heatmap,
    stage_focus,
    geo_distribution,
    activity_composite,
    spinout_lab_funnel,
    signups_trend,
    pipeline_coverage,
    tier: 'full',
  };
}

// ─── GET /api/market-intel/platform-personas ─────────────────────────
// SLO contract (Task #8 — review follow-up to Task #4):
//   • Warm cache hit (`personas:platform` present in KV):  ≤ 5 s p95
//   • Cold cache miss (KV miss → buildPersonasPayload runs all 8
//     D1 sub-queries):                                       ≤ 30 s p95
// Cache TTL is 5 min, so warm-path traffic dominates outside the first
// request after a key expiry. Latency telemetry is emitted to
// `activity_logs` (action=`mi.personas.served`) on every request
// regardless of tier; p50/p95 are computed downstream by SQL over
// `json_extract(details,'$.latency_ms')`.
// ---------------------------------------------------------------------
marketIntel.get('/platform-personas', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const tier = tierKind(user);
  const startedAt = Date.now();

  // 5-minute KV cache so all callers share one D1 read pass.
  let payload = await readKv<PlatformPersonasPayload>(c.env, 'personas:platform');
  const cacheHit = !!payload;
  if (!payload) {
    payload = await buildPersonasPayload(c.env);
    await writeKv(c.env, 'personas:platform', payload, 5 * 60);
  }

  // Free callers see only chart 1 + chart 2; the rest are gated.
  // We surface a `free_teaser` hint so the frontend renders a blurred
  // skeleton (per spec) rather than a hard paywall card. Each gated
  // chart still carries `tier_required` so client code can decide.
  if (tier === 'free') {
    const gated = { tier_required: 'growth', upgrade_path: '/billing', blurred: true };
    payload = {
      ...payload,
      stage_focus: gated,
      geo_distribution: gated,
      activity_composite: gated,
      spinout_lab_funnel: gated,
      signups_trend: gated,
      pipeline_coverage: gated,
      tier: 'free',
      free_teaser: {
        gated_charts: [
          'stage_focus', 'geo_distribution', 'activity_composite',
          'spinout_lab_funnel', 'signups_trend', 'pipeline_coverage',
        ],
        reason: 'Available on Growth, Investor Pro, and above.',
      },
    };
  } else if (tier === 'export') {
    payload = {
      ...payload,
      tier: 'export',
      exports: {
        csv_url: '/api/market-intel/platform-personas/export?format=csv',
        pdf_url: '/api/market-intel/platform-personas/export?format=pdf',
      },
    };
  }
  // Per-request latency telemetry — fire-and-forget so the response
  // path stays on the SLO budget. Downstream aggregation (p50/p95) is
  // SQL-side: `SELECT json_extract(details,'$.latency_ms') FROM
  // activity_logs WHERE action='mi.personas.served'`.
  const latency_ms = Date.now() - startedAt;
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, user_id) VALUES (?, ?, ?)`,
    ).bind(
      'mi.personas.served',
      JSON.stringify({ latency_ms, cache_hit: cacheHit, tier }),
      user.id,
    ).run().catch((e: unknown) => {
      console.warn('[mi.personas] telemetry insert failed:', (e as Error).message);
    }),
  );
  return c.json(payload);
});

marketIntel.get('/platform-personas/export', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const tier = tierKind(user);
  if (tier !== 'export') {
    return c.json({ error: 'tier_required', required: 'studio' }, 402);
  }
  const fmt = (c.req.query('format') || 'csv').toLowerCase();
  let payload = await readKv<PlatformPersonasPayload>(c.env, 'personas:platform');
  if (!payload) {
    payload = await buildPersonasPayload(c.env);
    await writeKv(c.env, 'personas:platform', payload, 5 * 60);
  }
  if (fmt === 'pdf') {
    const pdf = renderPersonasPdf(payload);
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="platform-personas-${new Date().toISOString().slice(0,10)}.pdf"`,
      },
    });
  }
  // CSV: flatten every chart into long-format rows.
  const lines = ['chart,group,label,n,extra'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Each chart is `Maybe<X> = X | GatedChart`. We narrow with the
  // existing `isGated()` type-guard before reaching into chart-specific
  // fields (.buckets / .cells / .rows). Tier-gated charts contribute
  // zero rows to the CSV — this matches the PDF renderer's behaviour
  // (lines 1292-1299) and keeps the export tier-safe end-to-end.
  if (!isGated(payload.role_donut)) {
    for (const b of (payload.role_donut.buckets || [])) {
      lines.push(['role_donut', b.group, b.label, b.n, ''].map(esc).join(','));
    }
  }
  if (!isGated(payload.sector_heatmap)) {
    for (const b of (payload.sector_heatmap.cells || [])) {
      lines.push(['sector_heatmap', b.persona, b.sector, b.n, ''].map(esc).join(','));
    }
  }
  if (!isGated(payload.stage_focus)) {
    for (const b of (payload.stage_focus.rows || [])) {
      lines.push(['stage_focus', b.role, b.stage, b.n, ''].map(esc).join(','));
    }
  }
  if (!isGated(payload.geo_distribution)) {
    for (const b of (payload.geo_distribution.rows || [])) {
      lines.push(['geo_distribution', '', b.country, b.n, ''].map(esc).join(','));
    }
  }
  if (!isGated(payload.activity_composite)) {
    for (const b of (payload.activity_composite.rows || [])) {
      lines.push(['activity_composite', b.role, 'events_per_user', b.active_users, b.events_per_user].map(esc).join(','));
    }
  }
  if (!isGated(payload.spinout_lab_funnel)) {
    for (const b of (payload.spinout_lab_funnel.rows || [])) {
      lines.push(['spinout_lab_funnel', '', `week_${b.week}`, b.n, ''].map(esc).join(','));
    }
  }
  if (!isGated(payload.signups_trend)) {
    for (const b of (payload.signups_trend.rows || [])) {
      lines.push(['signups_trend', b.role, b.week, b.n, ''].map(esc).join(','));
    }
  }
  if (!isGated(payload.pipeline_coverage)) {
    for (const b of (payload.pipeline_coverage.rows || [])) {
      lines.push(['pipeline_coverage', b.tier_bucket, 'investors', b.n, b.weighted_coverage].map(esc).join(','));
    }
  }
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="platform-personas-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
});

// ─── Minimal PDF renderer for Platform Personas export ────────────────
// Hand-rolled PDF 1.4 writer — no external lib (CF Workers can't easily
// pull pdf-lib). One Helvetica page, content auto-paginates at ~52 lines.
// Output is a real `application/pdf` byte stream that Acrobat / Chrome /
// Preview render natively. All offsets and `/Length` values are computed
// from BYTES (TextEncoder) — never from JS string length — so non-ASCII
// content (em-dashes, accented country names, etc.) cannot desync the
// xref table from the actual file layout.
function renderPersonasPdf(payload: PlatformPersonasPayload): Uint8Array {
  const enc = new TextEncoder();
  // Strip every code point outside printable ASCII so the stream stays
  // PDFDocEncoding-safe. Anything outside 0x20-0x7E becomes '?'.
  const ascii = (s: string) =>
    String(s).replace(/[^\x20-\x7E]/g, '?');
  const escTxt = (s: string) =>
    ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const byteLen = (s: string) => enc.encode(s).length;

  const lines: string[] = [];
  lines.push('Axal StudioOS - Platform Personas');
  lines.push(`Generated: ${payload.generated_at}`);
  lines.push(`k-anonymity threshold: ${payload.k_min}`);
  lines.push('');
  const section = (title: string, body: string[]) => {
    lines.push(`== ${title} ==`);
    if (body.length === 0) lines.push('  (no cohort cleared k threshold)');
    else for (const b of body) lines.push(`  ${b}`);
    lines.push('');
  };

  const donut = isGated(payload.role_donut) ? null : payload.role_donut;
  const heat = isGated(payload.sector_heatmap) ? null : payload.sector_heatmap;
  const stage = isGated(payload.stage_focus) ? null : payload.stage_focus;
  const geo = isGated(payload.geo_distribution) ? null : payload.geo_distribution;
  const activity = isGated(payload.activity_composite) ? null : payload.activity_composite;
  const funnel = isGated(payload.spinout_lab_funnel) ? null : payload.spinout_lab_funnel;
  const signups = isGated(payload.signups_trend) ? null : payload.signups_trend;
  const pipeline = isGated(payload.pipeline_coverage) ? null : payload.pipeline_coverage;

  section('Role distribution', (donut?.buckets ?? []).map(
    (b) => `[${b.group}] ${b.label}: n=${b.n}`,
  ));
  section('Sector x role heatmap', (heat?.cells ?? []).map(
    (c) => `${c.sector} / ${c.persona}: n=${c.n}`,
  ));
  section('Stage focus', (stage?.rows ?? []).map(
    (r) => `${r.stage} / ${r.role}: n=${r.n}`,
  ));
  section('Geography', (geo?.rows ?? []).map(
    (r) => `${r.country}: n=${r.n}`,
  ));
  section('Activity (last 30d)', (activity?.rows ?? []).map(
    (r) => `${r.role}: active=${r.active_users} events/user=${r.events_per_user}`,
  ));
  const funnelRows: string[] = (funnel?.rows ?? []).map(
    (r) => `Week ${r.week}: n=${r.n}`,
  );
  if (funnel?.completion_rate != null) funnelRows.push(`Completion rate: ${funnel.completion_rate}%`);
  if (funnel?.started_band) funnelRows.push(`Cohort size band: ${funnel.started_band}`);
  section('Spin-Out Lab funnel', funnelRows);
  section('Weekly signups', (signups?.rows ?? []).map(
    (r) => `${r.week} / ${r.role}: n=${r.n}`,
  ));
  section('Investor pipeline coverage', (pipeline?.rows ?? []).map(
    (r) => `${r.tier_bucket}: n=${r.n} weighted=${r.weighted_coverage}`,
  ));

  const PER_PAGE = 52;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PER_PAGE) pages.push(lines.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push(['(empty)']);

  const fontId = 3;
  const pagesId = 2;
  const catalogId = 1;
  const objs: string[] = [];
  const pageObjIds: number[] = [];
  pages.forEach((pageLines, idx) => {
    const pageId = 4 + idx * 2;
    const contentId = 5 + idx * 2;
    pageObjIds.push(pageId);
    let stream = 'BT /F1 10 Tf 12 TL 50 760 Td\n';
    for (const ln of pageLines) stream += `(${escTxt(ln)}) Tj T*\n`;
    stream += 'ET';
    const streamLen = byteLen(stream);
    objs[contentId] =
      `${contentId} 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`;
    objs[pageId] =
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`;
  });
  objs[catalogId] = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
  objs[pagesId] =
    `${pagesId} 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((i) => `${i} 0 R`).join(' ')}] ` +
    `/Count ${pageObjIds.length} >>\nendobj\n`;
  objs[fontId] = `${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const totalObjs = 3 + pages.length * 2;
  // Header is pure ASCII so we drop the optional 4-byte binary marker —
  // every CF Workers PDF reader (Acrobat / Chrome / Preview / pdf.js)
  // accepts a header without it; what matters is the xref byte offsets.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= totalObjs; i++) {
    offsets.push(byteLen(body));
    body += objs[i] || '';
  }
  const xrefStart = byteLen(body);
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${totalObjs + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return enc.encode(body);
}

export default marketIntel;
