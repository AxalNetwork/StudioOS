/**
 * Task #4 — Investor Signals + profiling chatbot.
 *
 * Endpoints (split into two Hono apps so each path lives at the correct
 * top-level base — see index.ts):
 *   GET  /api/investor-profile/me        — fetch caller's profile (or empty shell)
 *   PUT  /api/investor-profile/me        — upsert profile from chatbot
 *   POST /api/investor-profile/me/opt-out — convenience: flip contribute=0
 *   GET  /api/investor-signals/latest    — most recent anonymised snapshot
 *
 * Aggregation runs from the worker cron (see index.ts) every 6h. Cells with
 * fewer than MIN_CELL_SIZE (=5) contributors are reported as
 * { n: null, reason: 'insufficient_data' } — never raw counts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getSQL } from '../db';
import { hashEmail } from '../util/hashEmail';
import { callerHasFullLens } from '../util/marketIntelTier';
import {
  confidenceAdjustedAlignment,
} from '../services/matchingVectors';
import { isAdmin, isFounder, mapError } from './_t13t14t15_helpers';
import { filterOptedInUserIds } from '../services/matchingConsent';

export const investorProfile = new Hono<{ Bindings: Env }>();
export const investorSignals = new Hono<{ Bindings: Env }>();

export const MIN_CELL_SIZE = 5;
const TICKET_BANDS = ['<$10k', '$10k-$50k', '$50k-$250k', '$250k-$1M', '$1M+'] as const;
const TICKET_BAND_RANGES: Record<string, [number, number]> = {
  '<$10k':       [0,         10_000],
  '$10k-$50k':   [10_000,    50_000],
  '$50k-$250k':  [50_000,    250_000],
  '$250k-$1M':   [250_000,   1_000_000],
  '$1M+':        [1_000_000, 5_000_000],
};
const SECTOR_OPTIONS = ['AI/ML','Climate','Fintech','Healthtech','Consumer','Enterprise SaaS','Crypto','Bio','Defense','Robotics','Energy'];
const STAGE_OPTIONS  = ['Pre-seed','Seed','Series A','Series B+','Growth'];
const GEO_OPTIONS    = ['North America','Europe','LATAM','APAC','MENA','Africa'];

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','of','in','on','for','to','with','at','by',
  'is','are','we','our','my','i','you','your','from','into','that','this',
  'be','as','it','its','they','their','them','will','can','also','have','has',
  'about','more','most','some','any','all','one','two','very','just','than',
  'who','what','when','where','why','how',
]);

let migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (migrated) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS investor_profiles (
        user_id INTEGER PRIMARY KEY,
        investor_type TEXT,
        sectors_json TEXT NOT NULL DEFAULT '[]',
        stages_json TEXT NOT NULL DEFAULT '[]',
        geos_json TEXT NOT NULL DEFAULT '[]',
        ticket_band TEXT,
        ticket_min_usd INTEGER,
        ticket_max_usd INTEGER,
        thesis_text TEXT,
        thesis_keywords_json TEXT NOT NULL DEFAULT '[]',
        contribute_to_signals INTEGER NOT NULL DEFAULT 1,
        anti_thesis_sectors_json TEXT NOT NULL DEFAULT '[]',
        anti_thesis_stages_json TEXT NOT NULL DEFAULT '[]',
        value_weights_json TEXT NOT NULL DEFAULT '{}',
        accreditation_status TEXT,
        country TEXT,
        firm_name TEXT,
        lp_intent TEXT,
        lp_target_usd INTEGER,
        notes TEXT,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_investor_profiles_contribute ON investor_profiles(contribute_to_signals)`,
    ).run();
    // Lazy-bootstrap: add columns for Task #16 if the table was created before
    // migration 096. D1/SQLite ALTER TABLE ADD COLUMN errors harmlessly on
    // duplicates; we catch and continue so the bootstrap is idempotent.
    const bootstrapCols = [
      `ALTER TABLE investor_profiles ADD COLUMN anti_thesis_sectors_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE investor_profiles ADD COLUMN anti_thesis_stages_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE investor_profiles ADD COLUMN value_weights_json TEXT NOT NULL DEFAULT '{}'`,
      // Migration 140 — unify onboarding fields into the canonical store.
      `ALTER TABLE investor_profiles ADD COLUMN accreditation_status TEXT`,
      `ALTER TABLE investor_profiles ADD COLUMN country TEXT`,
      `ALTER TABLE investor_profiles ADD COLUMN firm_name TEXT`,
      `ALTER TABLE investor_profiles ADD COLUMN lp_intent TEXT`,
      `ALTER TABLE investor_profiles ADD COLUMN lp_target_usd INTEGER`,
      `ALTER TABLE investor_profiles ADD COLUMN notes TEXT`,
    ];
    for (const colSql of bootstrapCols) {
      try { await env.DB.prepare(colSql).run(); } catch { /* already exists */ }
    }
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS investor_signals_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        period_start TIMESTAMP,
        period_end TIMESTAMP,
        n_total INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL
      )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_investor_signals_snapshots_computed_at ON investor_signals_snapshots(computed_at DESC)`,
    ).run();
    migrated = true;
  } catch (e) {
    console.error('[investor_signals] migration failed', e);
  }
}

function asStrArr(v: unknown, allowed?: string[]): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = String(x || '').trim();
    if (!s) continue;
    if (allowed && !allowed.includes(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 25) break;
  }
  return out;
}

export function extractKeywords(text: string, max = 20): string[] {
  if (!text) return [];
  const tokens = String(text).toLowerCase()
    .replace(/[^a-z0-9\s/+-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && t.length <= 24 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

interface ProfileRow {
  user_id: number;
  investor_type: string | null;
  sectors_json: string;
  stages_json: string;
  geos_json: string;
  ticket_band: string | null;
  ticket_min_usd: number | null;
  ticket_max_usd: number | null;
  thesis_text: string | null;
  thesis_keywords_json: string;
  contribute_to_signals: number;
  anti_thesis_sectors_json: string;
  anti_thesis_stages_json: string;
  value_weights_json: string;
  accreditation_status: string | null;
  country: string | null;
  firm_name: string | null;
  lp_intent: string | null;
  lp_target_usd: number | null;
  notes: string | null;
  completed_at: string | null;
  updated_at: string;
}

function emptyProfile(userId: number): ProfileRow {
  return {
    user_id: userId,
    investor_type: null,
    sectors_json: '[]',
    stages_json: '[]',
    geos_json: '[]',
    ticket_band: null,
    ticket_min_usd: null,
    ticket_max_usd: null,
    thesis_text: null,
    thesis_keywords_json: '[]',
    contribute_to_signals: 1,
    anti_thesis_sectors_json: '[]',
    anti_thesis_stages_json: '[]',
    value_weights_json: '{}',
    accreditation_status: null,
    country: null,
    firm_name: null,
    lp_intent: null,
    lp_target_usd: null,
    notes: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const j: unknown = JSON.parse(s);
    return Array.isArray(j) ? j.map(x => String(x)) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(s: string): Record<string, unknown> {
  try {
    const j: unknown = JSON.parse(s);
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function shapeProfile(row: ProfileRow) {
  return {
    user_id: row.user_id,
    investor_type: row.investor_type,
    sectors: safeJsonArray(row.sectors_json),
    stages: safeJsonArray(row.stages_json),
    geos: safeJsonArray(row.geos_json),
    ticket_band: row.ticket_band,
    ticket_min_usd: row.ticket_min_usd,
    ticket_max_usd: row.ticket_max_usd,
    thesis_text: row.thesis_text,
    thesis_keywords: safeJsonArray(row.thesis_keywords_json),
    contribute_to_signals: !!row.contribute_to_signals,
    anti_thesis_sectors: safeJsonArray(row.anti_thesis_sectors_json),
    anti_thesis_stages: safeJsonArray(row.anti_thesis_stages_json),
    value_weights: safeJsonObject(row.value_weights_json),
    accreditation_status: row.accreditation_status,
    country: row.country,
    firm_name: row.firm_name,
    lp_intent: row.lp_intent,
    lp_target_usd: row.lp_target_usd,
    notes: row.notes,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

investorProfile.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare(
    `SELECT * FROM investor_profiles WHERE user_id = ?`,
  ).bind(user.id).first<ProfileRow>();
  return c.json({ profile: shapeProfile(row || emptyProfile(user.id)) });
});

interface ProfileUpsertBody {
  investor_type?: unknown;
  sectors?: unknown;
  stages?: unknown;
  geos?: unknown;
  ticket_band?: unknown;
  thesis_text?: unknown;
  contribute_to_signals?: unknown;
  anti_thesis_sectors?: unknown;
  anti_thesis_stages?: unknown;
  value_weights?: unknown;
  accreditation_status?: unknown;
  country?: unknown;
  firm_name?: unknown;
  lp_intent?: unknown;
  lp_target_usd?: unknown;
  notes?: unknown;
}

investorProfile.put('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  let body: ProfileUpsertBody;
  try { body = await c.req.json<ProfileUpsertBody>(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const investor_type = typeof body.investor_type === 'string'
    ? body.investor_type.slice(0, 32) : null;
  const sectors = asStrArr(body.sectors, SECTOR_OPTIONS);
  const stages  = asStrArr(body.stages,  STAGE_OPTIONS);
  const geos    = asStrArr(body.geos,    GEO_OPTIONS);
  const ticket_band = typeof body.ticket_band === 'string' && (TICKET_BANDS as readonly string[]).includes(body.ticket_band)
    ? body.ticket_band : null;
  const range = ticket_band ? TICKET_BAND_RANGES[ticket_band] : null;
  const ticket_min_usd = range ? range[0] : null;
  const ticket_max_usd = range ? range[1] : null;
  const thesis_text = typeof body.thesis_text === 'string'
    ? body.thesis_text.slice(0, 2000).trim() || null : null;
  const thesis_keywords = thesis_text ? extractKeywords(thesis_text) : [];
  const contribute_to_signals = body.contribute_to_signals === undefined
    ? 1 : (body.contribute_to_signals ? 1 : 0);
  const anti_thesis_sectors = asStrArr(body.anti_thesis_sectors, SECTOR_OPTIONS);
  const anti_thesis_stages = asStrArr(body.anti_thesis_stages, STAGE_OPTIONS);
  const value_weights = (() => {
    if (!body.value_weights || typeof body.value_weights !== 'object' || Array.isArray(body.value_weights)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.value_weights)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isNaN(n)) out[k] = Math.max(0, Math.min(1, n));
    }
    return out;
  })();

  // Onboarding fields the Settings cards don't send. Preserve-if-absent: the
  // two Settings cards PUT a fixed subset (no accreditation/firm/LP/notes), so
  // treating absent as null would wipe what onboarding persisted. Only
  // overwrite when the key is present in the body.
  const ACCRED_OPTIONS = ['accredited', 'qp', 'non_us', 'not_sure'];
  const LP_INTENT_OPTIONS = ['yes_now', 'maybe', 'deal_only', 'no'];
  const existing = await c.env.DB.prepare(
    `SELECT accreditation_status, country, firm_name, lp_intent, lp_target_usd, notes
       FROM investor_profiles WHERE user_id = ?`,
  ).bind(user.id).first<{
    accreditation_status: string | null; country: string | null; firm_name: string | null;
    lp_intent: string | null; lp_target_usd: number | null; notes: string | null;
  }>();
  const clampStr = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const accreditation_status = body.accreditation_status === undefined
    ? (existing?.accreditation_status ?? null)
    : (typeof body.accreditation_status === 'string' && ACCRED_OPTIONS.includes(body.accreditation_status) ? body.accreditation_status : null);
  const country = body.country === undefined ? (existing?.country ?? null) : clampStr(body.country, 80);
  const firm_name = body.firm_name === undefined ? (existing?.firm_name ?? null) : clampStr(body.firm_name, 120);
  const lp_intent = body.lp_intent === undefined
    ? (existing?.lp_intent ?? null)
    : (typeof body.lp_intent === 'string' && LP_INTENT_OPTIONS.includes(body.lp_intent) ? body.lp_intent : null);
  const lp_target_usd = body.lp_target_usd === undefined
    ? (existing?.lp_target_usd ?? null)
    : (() => { const n = parseInt(String(body.lp_target_usd), 10); return Number.isFinite(n) && n >= 0 ? n : null; })();
  const notes = body.notes === undefined ? (existing?.notes ?? null) : clampStr(body.notes, 2000);

  const isComplete = !!(investor_type && sectors.length && stages.length && ticket_band);
  const completed_at = isComplete ? new Date().toISOString() : null;

  await c.env.DB.prepare(
    `INSERT INTO investor_profiles (
      user_id, investor_type, sectors_json, stages_json, geos_json,
      ticket_band, ticket_min_usd, ticket_max_usd,
      thesis_text, thesis_keywords_json, contribute_to_signals,
      anti_thesis_sectors_json, anti_thesis_stages_json, value_weights_json,
      accreditation_status, country, firm_name, lp_intent, lp_target_usd, notes,
      completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT completed_at FROM investor_profiles WHERE user_id = ?)), CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      investor_type = excluded.investor_type,
      sectors_json = excluded.sectors_json,
      stages_json = excluded.stages_json,
      geos_json = excluded.geos_json,
      ticket_band = excluded.ticket_band,
      ticket_min_usd = excluded.ticket_min_usd,
      ticket_max_usd = excluded.ticket_max_usd,
      thesis_text = excluded.thesis_text,
      thesis_keywords_json = excluded.thesis_keywords_json,
      contribute_to_signals = excluded.contribute_to_signals,
      anti_thesis_sectors_json = excluded.anti_thesis_sectors_json,
      anti_thesis_stages_json = excluded.anti_thesis_stages_json,
      value_weights_json = excluded.value_weights_json,
      accreditation_status = excluded.accreditation_status,
      country = excluded.country,
      firm_name = excluded.firm_name,
      lp_intent = excluded.lp_intent,
      lp_target_usd = excluded.lp_target_usd,
      notes = excluded.notes,
      completed_at = COALESCE(excluded.completed_at, investor_profiles.completed_at),
      updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    user.id, investor_type,
    JSON.stringify(sectors), JSON.stringify(stages), JSON.stringify(geos),
    ticket_band, ticket_min_usd, ticket_max_usd,
    thesis_text, JSON.stringify(thesis_keywords), contribute_to_signals,
    JSON.stringify(anti_thesis_sectors), JSON.stringify(anti_thesis_stages), JSON.stringify(value_weights),
    accreditation_status, country, firm_name, lp_intent, lp_target_usd, notes,
    completed_at, user.id,
  ).run();

  try {
    const sql = getSQL(c.env);
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('investor_profile_updated', ${`Investor profile updated (sectors=${sectors.length}, stages=${stages.length}, anti=${anti_thesis_sectors.length}, contribute=${contribute_to_signals})`}, ${await hashEmail(user.email)}, ${user.id})`;
  } catch {}

  const row = await c.env.DB.prepare(
    `SELECT * FROM investor_profiles WHERE user_id = ?`,
  ).bind(user.id).first<ProfileRow>();
  return c.json({ profile: shapeProfile(row || emptyProfile(user.id)) });
});

investorProfile.post('/me/opt-out', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await c.env.DB.prepare(
    `INSERT INTO investor_profiles (user_id, contribute_to_signals, updated_at)
     VALUES (?, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       contribute_to_signals = 0, updated_at = CURRENT_TIMESTAMP`,
  ).bind(user.id).run();
  return c.json({ ok: true, contribute_to_signals: false });
});

// Task #5 (AK) — filtered view of the latest snapshot. The spec asks for
// GET /api/investor-signals?sector=&stage=&geo= so the Investor Signals
// sub-tab can pre-filter the cells server-side. We read the same latest
// snapshot used by /latest and narrow each cell-array to the requested
// labels (case-insensitive). When a filter param is omitted that
// dimension is returned unfiltered. K-anonymity masking from the
// aggregator is preserved — we never re-derive counts here, just slice.
//
// TIER GATE: the spec requires Free callers to see only the
// sector-compass overview. Investors below 'professional' tier and
// founders without growth/studio entitlement get 402; admin / partner /
// advisor bypass via the same `callerHasFullLens` predicate that the
// Market-Intel lens routes use, so behaviour is symmetric across the
// seven sub-tabs. `/latest` below is gated with the same predicate so
// the alias mount under /api/market-intel/investor-signals/* stays
// symmetric across both paths.
investorSignals.get('/', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  await ensureSchema(c.env);
  const sectorFilter = (c.req.query('sector') || '').trim().toLowerCase();
  const stageFilter  = (c.req.query('stage')  || '').trim().toLowerCase();
  const geoFilter    = (c.req.query('geo')    || '').trim().toLowerCase();

  const latest = await c.env.DB.prepare(
    `SELECT computed_at, n_total, payload_json FROM investor_signals_snapshots
     ORDER BY computed_at DESC LIMIT 1`,
  ).first<{ computed_at: string; n_total: number; payload_json: string }>();
  if (!latest) {
    return c.json({
      snapshot: null,
      message: 'No snapshot computed yet — first run pending.',
      min_cell_size: MIN_CELL_SIZE,
      filters: { sector: sectorFilter || null, stage: stageFilter || null, geo: geoFilter || null },
    });
  }
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(latest.payload_json);
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch { /* malformed payload — fall through */ }

  type Cell = { label: string; n: number | null; pct?: number; reason?: string };
  const sliceCells = (arr: unknown, want: string): Cell[] => {
    if (!Array.isArray(arr)) return [];
    if (!want) return arr as Cell[];
    return (arr as Cell[]).filter(c => String(c?.label || '').toLowerCase() === want);
  };

  const sectors = sliceCells(payload.sectors, sectorFilter);
  const stages  = sliceCells(payload.stages,  stageFilter);
  const geos    = sliceCells(payload.geos,    geoFilter);

  // Sector × stage ticket buckets — narrow when either filter is set.
  type Bucket = { sector: string; stage: string; n: number | null; reason?: string };
  let ticket_stats_by_sector_stage = (Array.isArray(payload.ticket_stats_by_sector_stage)
    ? payload.ticket_stats_by_sector_stage as Bucket[]
    : []);
  if (sectorFilter) ticket_stats_by_sector_stage = ticket_stats_by_sector_stage.filter(b => String(b.sector).toLowerCase() === sectorFilter);
  if (stageFilter)  ticket_stats_by_sector_stage = ticket_stats_by_sector_stage.filter(b => String(b.stage).toLowerCase()  === stageFilter);

  const safeNTotal = latest.n_total >= MIN_CELL_SIZE ? latest.n_total : null;
  return c.json({
    snapshot: {
      computed_at: latest.computed_at,
      n_total: safeNTotal,
      ...(safeNTotal == null ? { reason: 'insufficient_data' as const } : {}),
      sectors,
      stages,
      geos,
      ticket_bands: payload.ticket_bands || [],
      ticket_stats: payload.ticket_stats || { n: null, reason: 'insufficient_data' },
      ticket_stats_by_sector_stage,
      thesis_keywords: payload.thesis_keywords || [],
      options: payload.options || {},
    },
    filters: { sector: sectorFilter || null, stage: stageFilter || null, geo: geoFilter || null },
    min_cell_size: MIN_CELL_SIZE,
  });
});

investorSignals.get('/latest', async (c) => {
  const user = await requireAuth(c);
  // Task #5 (AK) — Investor Signals is a paid sub-tab. Gated with the
  // same predicate as GET /, so the alias mount under
  // /api/market-intel/investor-signals/* stays symmetric. Free callers
  // see the sector-compass overview only; admin/partner/advisor bypass.
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  await ensureSchema(c.env);

  const latest = await c.env.DB.prepare(
    `SELECT computed_at, n_total, payload_json FROM investor_signals_snapshots
     ORDER BY computed_at DESC LIMIT 1`,
  ).first<{ computed_at: string; n_total: number; payload_json: string }>();

  if (!latest) {
    return c.json({
      snapshot: null,
      message: 'No snapshot computed yet — first run pending.',
      min_cell_size: MIN_CELL_SIZE,
    });
  }
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(latest.payload_json);
    if (parsed && typeof parsed === 'object') {
      payload = parsed as Record<string, unknown>;
    }
  } catch { /* ignore malformed payloads — fall back to empty */ }
  // Trend: pull n_total from up to ~30d of past snapshots.
  const trendRows = await c.env.DB.prepare(
    `SELECT computed_at, n_total FROM investor_signals_snapshots
     WHERE computed_at >= datetime('now', '-30 days')
     ORDER BY computed_at ASC`,
  ).all<{ computed_at: string; n_total: number }>();
  // K-anonymity hardening: when total contributors are below MIN_CELL_SIZE,
  // also mask n_total + every trend point's count so that an external
  // observer can't infer small-cohort participation from the participation
  // counter or the trend strip. Cells inside `payload` are already masked
  // by the aggregator.
  const safeNTotal = latest.n_total >= MIN_CELL_SIZE ? latest.n_total : null;
  const trend = (trendRows.results || []).map(r => ({
    at: r.computed_at,
    n: r.n_total >= MIN_CELL_SIZE ? r.n_total : null,
  }));
  return c.json({
    snapshot: {
      computed_at: latest.computed_at,
      ...payload,
      n_total: safeNTotal,
      ...(safeNTotal == null ? { reason: 'insufficient_data' as const } : {}),
    },
    trend,
    min_cell_size: MIN_CELL_SIZE,
  });
});

// --- Aggregator ------------------------------------------------------------
//
// Pulls every investor_profile with contribute_to_signals=1 belonging to a
// user with role='investor' and a non-empty completed_at, then emits a
// snapshot with k-anonymity ≥ MIN_CELL_SIZE.

interface AggregateRow {
  sectors_json: string;
  stages_json: string;
  geos_json: string;
  ticket_band: string | null;
  ticket_min_usd: number | null;
  ticket_max_usd: number | null;
  thesis_keywords_json: string;
}

interface SectorStageBucketStats {
  sector: string;
  stage: string;
  n: number | null;
  median_min?: number | null;
  median_max?: number | null;
  iqr_min?: { p25: number | null; p75: number | null };
  iqr_max?: { p25: number | null; p75: number | null };
  reason?: 'insufficient_data';
}

// Step 4 requirement: median + IQR ticket size per (sector × stage) bucket.
// Each profile contributes its (min, max) ticket to every bucket formed by
// the cross-product of its sectors and stages. Cells below MIN_CELL_SIZE are
// returned with `n: null, reason: 'insufficient_data'`.
function buildSectorStageTicketStats(rows: AggregateRow[]): SectorStageBucketStats[] {
  const buckets = new Map<string, { sector: string; stage: string; mins: number[]; maxs: number[] }>();
  const safeArr = (s: string): string[] => safeJsonArray(s);
  for (const r of rows) {
    if (typeof r.ticket_min_usd !== 'number' || typeof r.ticket_max_usd !== 'number') continue;
    const sectors = safeArr(r.sectors_json);
    const stages  = safeArr(r.stages_json);
    for (const sector of sectors) {
      if (!SECTOR_OPTIONS.includes(sector)) continue;
      for (const stage of stages) {
        if (!STAGE_OPTIONS.includes(stage)) continue;
        const key = `${sector}\u241E${stage}`;
        let b = buckets.get(key);
        if (!b) { b = { sector, stage, mins: [], maxs: [] }; buckets.set(key, b); }
        b.mins.push(r.ticket_min_usd);
        b.maxs.push(r.ticket_max_usd);
      }
    }
  }
  return [...buckets.values()].map(b => {
    const n = Math.min(b.mins.length, b.maxs.length);
    if (n < MIN_CELL_SIZE) {
      return { sector: b.sector, stage: b.stage, n: null, reason: 'insufficient_data' as const };
    }
    b.mins.sort((a, c) => a - c);
    b.maxs.sort((a, c) => a - c);
    return {
      sector: b.sector,
      stage: b.stage,
      n,
      median_min: quantile(b.mins, 0.5),
      median_max: quantile(b.maxs, 0.5),
      iqr_min: { p25: quantile(b.mins, 0.25), p75: quantile(b.mins, 0.75) },
      iqr_max: { p25: quantile(b.maxs, 0.25), p75: quantile(b.maxs, 0.75) },
    };
  });
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
  }
  return sorted[base];
}

function reportCell(label: string, n: number) {
  if (n >= MIN_CELL_SIZE) return { label, n, pct: 0 };
  return { label, n: null, reason: 'insufficient_data' as const };
}

export async function aggregateInvestorSignals(env: Env): Promise<{ n_total: number; snapshot_id: number | null }> {
  await ensureSchema(env);
  const result = await env.DB.prepare(
    `SELECT ip.sectors_json, ip.stages_json, ip.geos_json, ip.ticket_band,
            ip.ticket_min_usd, ip.ticket_max_usd, ip.thesis_keywords_json
       FROM investor_profiles ip
       JOIN users u ON u.id = ip.user_id
      WHERE ip.contribute_to_signals = 1
        AND ip.completed_at IS NOT NULL
        AND u.role = 'investor'`,
  ).all<AggregateRow>();
  const rows = result.results || [];
  const n_total = rows.length;

  const sectorCounts = new Map<string, number>();
  const stageCounts  = new Map<string, number>();
  const geoCounts    = new Map<string, number>();
  const bandCounts   = new Map<string, number>();
  const kwCounts     = new Map<string, number>();
  const tickMins: number[] = [];
  const tickMaxs: number[] = [];

  const safeArr = (s: string): string[] => safeJsonArray(s);

  for (const r of rows) {
    for (const s of safeArr(r.sectors_json)) sectorCounts.set(s, (sectorCounts.get(s) || 0) + 1);
    for (const s of safeArr(r.stages_json))  stageCounts.set(s,  (stageCounts.get(s)  || 0) + 1);
    for (const s of safeArr(r.geos_json))    geoCounts.set(s,    (geoCounts.get(s)    || 0) + 1);
    if (r.ticket_band) bandCounts.set(r.ticket_band, (bandCounts.get(r.ticket_band) || 0) + 1);
    if (typeof r.ticket_min_usd === 'number') tickMins.push(r.ticket_min_usd);
    if (typeof r.ticket_max_usd === 'number') tickMaxs.push(r.ticket_max_usd);
    for (const k of safeArr(r.thesis_keywords_json)) kwCounts.set(k, (kwCounts.get(k) || 0) + 1);
  }

  const buildCells = (counts: Map<string, number>, allowed: string[]) => {
    return allowed.map(label => {
      const n = counts.get(label) || 0;
      const cell = reportCell(label, n);
      if (cell.n != null) cell.pct = pct(n, n_total);
      return cell;
    });
  };

  const sectors = buildCells(sectorCounts, SECTOR_OPTIONS);
  const stages  = buildCells(stageCounts,  STAGE_OPTIONS);
  const geos    = buildCells(geoCounts,    GEO_OPTIONS);
  const ticket_bands = buildCells(bandCounts, [...TICKET_BANDS]);

  // Thesis cloud: only keywords meeting MIN_CELL_SIZE are surfaced.
  const thesis_keywords = [...kwCounts.entries()]
    .filter(([, n]) => n >= MIN_CELL_SIZE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([keyword, n]) => ({ keyword, n }));

  tickMins.sort((a, b) => a - b);
  tickMaxs.sort((a, b) => a - b);
  // Use the smaller of the two ticket arrays as the effective sample size
  // (some rows may have null bands). Both must independently meet
  // MIN_CELL_SIZE before we publish any quantile.
  const tickN = Math.min(tickMins.length, tickMaxs.length);
  const ticket_stats = tickN >= MIN_CELL_SIZE ? {
    n: tickN,
    median_min: quantile(tickMins, 0.5),
    median_max: quantile(tickMaxs, 0.5),
    iqr_min: { p25: quantile(tickMins, 0.25), p75: quantile(tickMins, 0.75) },
    iqr_max: { p25: quantile(tickMaxs, 0.25), p75: quantile(tickMaxs, 0.75) },
  } : { n: null, reason: 'insufficient_data' as const };

  const ticket_stats_by_sector_stage = buildSectorStageTicketStats(rows);

  const payload = {
    n_total,
    min_cell_size: MIN_CELL_SIZE,
    sectors, stages, geos, ticket_bands,
    ticket_stats,
    ticket_stats_by_sector_stage,
    thesis_keywords,
    options: {
      sectors: SECTOR_OPTIONS,
      stages: STAGE_OPTIONS,
      geos: GEO_OPTIONS,
      ticket_bands: [...TICKET_BANDS],
    },
  };

  const ins = await env.DB.prepare(
    `INSERT INTO investor_signals_snapshots (n_total, payload_json) VALUES (?, ?)`,
  ).bind(n_total, JSON.stringify(payload)).run();
  // Trim history beyond ~120 snapshots (~30 days @ 6h cadence) to keep the
  // table tidy. Best-effort.
  try {
    await env.DB.prepare(
      `DELETE FROM investor_signals_snapshots
        WHERE id NOT IN (SELECT id FROM investor_signals_snapshots
                          ORDER BY computed_at DESC LIMIT 200)`,
    ).run();
  } catch {}
  const meta = ins.meta as { last_row_id?: number } | undefined;
  return {
    n_total,
    snapshot_id: meta?.last_row_id ?? null,
  };
}

// Backward-compat: legacy callers that used /api/investor-signals/profile/me*
// or /api/investor-profile/profile/me* (pre-2026-05-10 paths) still work.
investorSignals.route('/profile', investorProfile);
// ---------------------------------------------------------------------------
// Task #4 — Coach matching (benevolence/universalism alignment + skill gaps)
// ---------------------------------------------------------------------------
investorSignals.get('/coach-match', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isFounder(user) && !isAdmin(user)) {
      return c.json({ detail: 'Founder or admin role required' }, 403);
    }
    const { userId } = c.req.query();
    const targetId = userId ? Number(userId) : user.id;
    // Prevent IDOR: only self or admin can target another user's vectors
    if (targetId !== user.id && !isAdmin(user)) {
      return c.json({ detail: 'Not authorized' }, 403);
    }

    // Load target vectors
    const vRes = await c.env.DB.prepare(
      `SELECT vd.slug, uv.score, uv.confidence
         FROM user_values uv
         JOIN value_dimensions vd ON vd.id = uv.dimension_id
        WHERE uv.user_id = ?`,
    ).bind(targetId).all<{ slug: string; score: number; confidence: number }>();
    const sRes = await c.env.DB.prepare(
      `SELECT sc.slug, MAX(us.self_level) AS level
         FROM user_skills us
         JOIN skills s ON s.id = us.skill_id
         JOIN skill_categories sc ON sc.slug = s.category_slug
        WHERE us.user_id = ?
        GROUP BY sc.slug`,
    ).bind(targetId).all<{ slug: string; level: number }>();

    const targetValues: Record<string, { score: number; confidence: number }> = {};
    for (const r of vRes.results || []) targetValues[r.slug] = { score: Number(r.score) || 0, confidence: Number(r.confidence) || 0 };
    const targetSkills: Record<string, number> = {};
    for (const r of sRes.results || []) targetSkills[r.slug] = Number(r.level) || 0;

    // Coach pool: distinct users who have role=coach OR completed coachs_lens_v1
    // Exclude admins who are not coaches; respect directory visibility
    const coachRows = await c.env.DB.prepare(
      // `headshot_r2_key`, not `avatar_url`; and `show_in_directory` lives on
      // `user_settings`, not `users`. The filter is preserved rather than
      // dropped — it is a visibility opt-out, and widening who appears in a
      // people directory is not a repair.
      `SELECT DISTINCT u.id AS user_id, u.name, u.email, u.role, u.headshot_r2_key
         FROM users u
         LEFT JOIN assessment_results ar ON ar.user_id = u.id
         LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE (u.role = 'coach' OR ar.track = 'coachs_lens_v1')
          AND (us.show_in_directory IS NULL OR us.show_in_directory = 1)
        ORDER BY u.name ASC`,
    ).all<{ user_id: number; name: string; email: string; role: string; avatar_url: string | null }>();
    const coaches = (coachRows.results || []) as { user_id: number; name: string; email: string; role: string; avatar_url: string | null }[];

    // Privacy-first consent filter: only surface coaches who have opted in
    const optedIn = await filterOptedInUserIds(c.env, coaches.map((co) => co.user_id));
    const visibleCoaches = coaches.filter((co) => optedIn.has(co.user_id));

    const coachIds = visibleCoaches.map((co) => co.user_id).filter(Boolean);
    const coachValuesMap = new Map<number, Record<string, { score: number; confidence: number }>>();
    const coachSkillsMap = new Map<number, Record<string, number>>();
    if (coachIds.length) {
      const ph = coachIds.map(() => '?').join(',');
      const cv = await c.env.DB.prepare(
        `SELECT uv.user_id, vd.slug, uv.score, uv.confidence
           FROM user_values uv
           JOIN value_dimensions vd ON vd.id = uv.dimension_id
          WHERE uv.user_id IN (${ph})`,
      ).bind(...coachIds).all<{ user_id: number; slug: string; score: number; confidence: number }>();
      for (const r of cv.results || []) {
        const m = coachValuesMap.get(r.user_id) || {};
        m[r.slug] = { score: Number(r.score) || 0, confidence: Number(r.confidence) || 0 };
        coachValuesMap.set(r.user_id, m);
      }
      const cs = await c.env.DB.prepare(
        `SELECT us.user_id, sc.slug, MAX(us.self_level) AS level
           FROM user_skills us
           JOIN skills s ON s.id = us.skill_id
           JOIN skill_categories sc ON sc.slug = s.category_slug
          WHERE us.user_id IN (${ph})
          GROUP BY us.user_id, sc.slug`,
      ).bind(...coachIds).all<{ user_id: number; slug: string; level: number }>();
      for (const r of cs.results || []) {
        const m = coachSkillsMap.get(r.user_id) || {};
        m[r.slug] = Number(r.level) || 0;
        coachSkillsMap.set(r.user_id, m);
      }
    }

    const scored = visibleCoaches.map((co) => {
      const cVec = coachValuesMap.get(co.user_id) || {};
      const cSkills = coachSkillsMap.get(co.user_id) || {};

      // 1. Coach alignment: benevolence + universalism founder↔coach similarity
      const tB = targetValues['schwartz_benevolence'] || { score: 0, confidence: 0 };
      const tU = targetValues['schwartz_universalism'] || { score: 0, confidence: 0 };
      const cB = cVec['schwartz_benevolence'] || { score: 0, confidence: 0 };
      const cU = cVec['schwartz_universalism'] || { score: 0, confidence: 0 };
      // Similarity per dimension: inverse of absolute difference, scaled −2..2 → 0..1
      const bSim = (1 - Math.abs(tB.score - cB.score) / 4) * Math.min(tB.confidence, cB.confidence);
      const uSim = (1 - Math.abs(tU.score - cU.score) / 4) * Math.min(tU.confidence, cU.confidence);
      const coachAlignment = Math.round((bSim + uSim) / 2 * 40);

      // 2. Skill coverage: how many of the founder's weak axes does the coach cover well?
      const gaps = Object.keys(targetSkills).filter((k) => (targetSkills[k] || 0) < 2.5);
      const covered = gaps.filter((g) => (cSkills[g] || 0) > 3);
      const coverageScore = Math.min(30, covered.length * 7);

      // 3. Values overlap (confidence-adjusted)
      const valScore = confidenceAdjustedAlignment(targetValues, cVec);
      const overlapScore = valScore.overlapCount > 0 ? Math.round(((valScore.score + 1) / 2) * 30) : 0;

      const total = Math.min(100, coachAlignment + coverageScore + overlapScore);

      return {
        coach: {
          user_id: co.user_id,
          name: co.name,
          email: isAdmin(user) ? co.email : null,
          role: co.role,
          avatar_url: co.avatar_url,
        },
        match_score: total,
        breakdown: { coach_alignment: coachAlignment, skill_coverage: coverageScore, values_overlap: overlapScore },
        reasons: [
          ...(coachAlignment > 0 ? [`Coach alignment: ${coachAlignment}`] : []),
          ...(coverageScore > 0 ? [`Covers ${covered.length} skill gap(s)`] : []),
          ...(overlapScore > 0 ? [`Values overlap: ${overlapScore}`] : []),
        ].slice(0, 4),
      };
    });

    scored.sort((a, b) => b.match_score - a.match_score);
    return c.json({ items: scored.slice(0, 20) });
  } catch (e) { return mapError(c, e); }
});

export default investorSignals;
