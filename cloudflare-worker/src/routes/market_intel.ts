import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getMarketHeadlines } from '../services/market-data';
import type { InvestorUser } from '../middleware/requireInvestorTier';
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
import { callerHasFullLens } from '../util/marketIntelTier';

const marketIntel = new Hono<{ Bindings: Env }>();

// D670 — the /market-intel page is retired, with its sector digest. What
// stays here is what other pages read: Research (the founder desk and the
// investor overview) and the Spinout Lab's market page, plus Settings'
// contribution opt-out and the reducer's admin refresh. The endpoints only
// that page called (macro, competitive intelligence, export, the investor and
// geography lenses, the watchlist, the seven AT-2 tabs, the investor fit, the
// platform personas and the investor-signals alias) went with it.

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

marketIntel.get('/private-rounds', (c) => c.json({
  rounds: [],
  total: null,
  not_recorded: notRecorded(NOT_RECORDED_REASONS.private_rounds),
  updated_at: new Date().toISOString(),
}));

marketIntel.get('/studio-benchmarks', (c) => c.json({
  not_recorded: notRecorded(NOT_RECORDED_REASONS.studio_benchmarks),
}));

// ─────────────────────────────────────────────────────────────────────────
// Task #14 (AA-1) — Aggregator-backed lenses.
//
// All endpoints here read from the new `market_intel_indexes` /
// `market_intel_rows` tables populated by the cron-driven aggregator
// (services/market_intel/aggregator.ts). Tier gating is enforced
// SERVER-SIDE per the AA-1 spec:
//   • Free            → composite indexes only (sector compass headline).
//   • Growth/Pro      → the full lens.
// Bypass roles (admin/partner/advisor) always see the full surface. (The
// watchlist, the exports and their digest went with the page, D670.)
// ─────────────────────────────────────────────────────────────────────────

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

// =============================================================================
// Task #6 (AT-1) — Anonymised advisor-derived MI surfaces.
//
// Read endpoints over `market_intel_aggregates` (k≥5 enforced both at
// reduce-time and read-time). Since D670 only the founder's fit remains (the
// Spinout Lab market page reads it). Investor-identity disclosure on it
// requires an active pairwise NDA; otherwise the counter-party id is hashed.
// =============================================================================
import { ensureExtractorSchema } from '../services/market_intel/extractor_schema';
import { refuse } from '../util/refusal';

marketIntel.use('/at1/*', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/fit/*',         async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/contribution-optout', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });

const K_MIN = 5;
function safeJson(s: string | null | undefined): any { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

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

export default marketIntel;
