/**
 * Task #4 — the investor profile (profiling chatbot).
 *
 * Endpoints:
 *   GET  /api/investor-profile/me        — fetch caller's profile (or empty shell)
 *   PUT  /api/investor-profile/me        — upsert profile from chatbot
 *   POST /api/investor-profile/me/opt-out — convenience: flip contribute=0
 *
 * D670 retired the Investor Signals tab of the /market-intel page, and with
 * it `/api/investor-signals` (the snapshot reads, the legacy `/profile`
 * alias and the uncalled `/coach-match`) and the cron that aggregated the
 * snapshots. The profile stays: Settings and investor onboarding write it.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getSQL } from '../db';
import { hashEmail } from '../util/hashEmail';
import { bindingKey } from '../util/schemaBootstrap';

export const investorProfile = new Hono<{ Bindings: Env }>();

const TICKET_BANDS = ['<$10k', '$10k-$50k', '$50k-$250k', '$250k-$1M', '$1M+'] as const;
const TICKET_BAND_RANGES: Record<string, [number, number]> = {
  '<$10k':       [0,         10_000],
  '$10k-$50k':   [10_000,    50_000],
  '$50k-$250k':  [50_000,    250_000],
  '$250k-$1M':   [250_000,   1_000_000],
  '$1M+':        [1_000_000, 5_000_000],
};
// #6131 (D6128 Q2): sectors and anti-thesis sectors are drawn from the NFX
// taxonomy the investor onboarding offers (`frontend/src/lib/nfxSectors.js`,
// verbatim and in its order; a test holds the two lists equal). Before this the
// writer kept only the legacy labels below, so every onboarding pick was dropped
// and `completed_at` (which needs a sector) was never set.
export const NFX_SECTORS: readonly string[] = [
  'Advertising', 'AgTech', 'AI', 'Analytics', 'AR/VR', 'AudioTech', 'AutoTech',
  'BioTech', 'Chemicals', 'ClimateTech/CleanTech', 'Cloud Infrastructure',
  'ConstructionTech', 'Consumer Health', 'Consumer Internet', 'Cosmetics',
  'Creator/Passion Economy', 'Cybersecurity', 'Data Services', 'DeepTech',
  'DefenseTech', 'Developer Tools', 'Diagnostics', 'Digital Health',
  'Direct-to-Consumer (DTC)', 'Drug Delivery', 'E-commerce', 'Education', 'EnergyTech',
  'Enterprise Applications', 'Enterprise Infrastructure', 'Enterprise',
  'Entertainment & Sports', 'Fashion', 'FinTech', 'Food and Beverage',
  'Future of Work', 'Games', 'Gaming/eSports', 'General Tech', 'Generative Tech/AI',
  'Gig Economy', 'GovTech', 'Hardware', 'Health & Hospital Services', 'Health IT',
  'Human Capital/HRTech', 'Impact', 'Insurance', 'IoT', 'LegalTech', 'Local Services',
  'Lodging/Hospitality', 'Logistics', 'Manufacturing', 'MarketingTech', 'Marketplaces',
  'Material Science', 'Media/Content', 'Medical Devices', 'Messaging',
  'Parenting/Families', 'Payments', 'Pharmaceuticals', 'Real Estate/PropTech',
  'Retail', 'Robotics', 'SaaS', 'Sales & CRM', 'Security', 'Semiconductors',
  'Smart Cities/UrbanTech', 'SMB Software', 'Social Commerce', 'Social Networks',
  'Space', 'Supply Chain Tech', 'Therapeutics', 'TransportationTech', 'Travel',
  'Web3/Blockchain', 'Web3/Crypto', 'Wellness & Fitness',
];
// The earlier vocabulary. Rows saved before #6131 hold these labels, and the
// Settings cards ("My thesis", the thesis editor, Firm settings) still offer
// them and send the stored arrays back whole, so they stay accepted: dropping
// them would erase a stored thesis on an unrelated Settings save.
export const LEGACY_SECTOR_OPTIONS: readonly string[] = ['AI/ML','Climate','Fintech','Healthtech','Consumer','Enterprise SaaS','Crypto','Bio','Defense','Robotics','Energy'];
// One vocabulary for the thesis and the anti-thesis (same list, opposite sign).
export const SECTOR_OPTIONS: readonly string[] = [...new Set([...NFX_SECTORS, ...LEGACY_SECTOR_OPTIONS])];
const STAGE_OPTIONS  = ['Pre-seed','Seed','Series A','Series B+','Growth'];
const GEO_OPTIONS    = ['North America','Europe','LATAM','APAC','MENA','Africa'];

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','of','in','on','for','to','with','at','by',
  'is','are','we','our','my','i','you','your','from','into','that','this',
  'be','as','it','its','they','their','them','will','can','also','have','has',
  'about','more','most','some','any','all','one','two','very','just','than',
  'who','what','when','where','why','how',
]);

const MIGRATED = new WeakMap<object, boolean>();
async function ensureSchema(env: Env): Promise<void> {
  if (MIGRATED.get(bindingKey(env))) return;
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
    MIGRATED.set(bindingKey(env), true);
  } catch (e) {
    console.error('[investor_signals] migration failed', e);
  }
}

function asStrArr(v: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  // A closed vocabulary bounds the array by itself (each value at most once),
  // so the cap is the vocabulary's size; an open list keeps the cap of 25.
  // The NFX list is longer than 25, and onboarding sets no pick limit.
  const max = allowed ? allowed.length : 25;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = String(x || '').trim();
    if (!s) continue;
    if (allowed && !allowed.includes(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid profile' }, 400);

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
  // #6392: new profiles default to 1; the conflict update preserves absent consent atomically.
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

  // Onboarding fields. Preserve-if-absent: the Settings cards PUT a fixed
  // subset, and "My thesis" sends one of these at a time when the investor
  // corrects it (#6136), so treating absent as null would wipe the others.
  // Only overwrite when the key is present in the body; present-but-blank clears.
  const ACCRED_OPTIONS = ['accredited', 'qp', 'non_us', 'not_sure'];
  const LP_INTENT_OPTIONS = ['yes_now', 'maybe', 'deal_only', 'no'];
  const clampStr = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const accreditation_status = typeof body.accreditation_status === 'string' && ACCRED_OPTIONS.includes(body.accreditation_status)
    ? body.accreditation_status : null;
  const country = clampStr(body.country, 80);
  const firm_name = clampStr(body.firm_name, 120);
  const lp_intent = typeof body.lp_intent === 'string' && LP_INTENT_OPTIONS.includes(body.lp_intent)
    ? body.lp_intent : null;
  const target = parseInt(String(body.lp_target_usd), 10);
  const lp_target_usd = Number.isFinite(target) && target >= 0 ? target : null;
  const notes = clampStr(body.notes, 2000);
  // Presence is separate from normalization: an explicit clear is a write.
  // Evaluate it in the upsert so concurrent edits to different fields compose.
  const supplied = JSON.stringify(Object.fromEntries(Object.keys(body).map((key) => [key, true])));

  await c.env.DB.batch([
    c.env.DB.prepare(
      `WITH supplied_fields(flags) AS (VALUES (?))
      INSERT INTO investor_profiles (
        user_id, investor_type, sectors_json, stages_json, geos_json,
        ticket_band, ticket_min_usd, ticket_max_usd,
        thesis_text, thesis_keywords_json, contribute_to_signals,
        anti_thesis_sectors_json, anti_thesis_stages_json, value_weights_json,
        accreditation_status, country, firm_name, lp_intent, lp_target_usd, notes,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        investor_type = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.investor_type') THEN excluded.investor_type ELSE investor_profiles.investor_type END,
        sectors_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.sectors') THEN excluded.sectors_json ELSE investor_profiles.sectors_json END,
        stages_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.stages') THEN excluded.stages_json ELSE investor_profiles.stages_json END,
        geos_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.geos') THEN excluded.geos_json ELSE investor_profiles.geos_json END,
        ticket_band = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.ticket_band') THEN excluded.ticket_band ELSE investor_profiles.ticket_band END,
        ticket_min_usd = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.ticket_band') THEN excluded.ticket_min_usd ELSE investor_profiles.ticket_min_usd END,
        ticket_max_usd = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.ticket_band') THEN excluded.ticket_max_usd ELSE investor_profiles.ticket_max_usd END,
        thesis_text = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.thesis_text') THEN excluded.thesis_text ELSE investor_profiles.thesis_text END,
        thesis_keywords_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.thesis_text') THEN excluded.thesis_keywords_json ELSE investor_profiles.thesis_keywords_json END,
        contribute_to_signals = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.contribute_to_signals') THEN excluded.contribute_to_signals ELSE investor_profiles.contribute_to_signals END,
        anti_thesis_sectors_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.anti_thesis_sectors') THEN excluded.anti_thesis_sectors_json ELSE investor_profiles.anti_thesis_sectors_json END,
        anti_thesis_stages_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.anti_thesis_stages') THEN excluded.anti_thesis_stages_json ELSE investor_profiles.anti_thesis_stages_json END,
        value_weights_json = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.value_weights') THEN excluded.value_weights_json ELSE investor_profiles.value_weights_json END,
        accreditation_status = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.accreditation_status') THEN excluded.accreditation_status ELSE investor_profiles.accreditation_status END,
        country = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.country') THEN excluded.country ELSE investor_profiles.country END,
        firm_name = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.firm_name') THEN excluded.firm_name ELSE investor_profiles.firm_name END,
        lp_intent = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.lp_intent') THEN excluded.lp_intent ELSE investor_profiles.lp_intent END,
        lp_target_usd = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.lp_target_usd') THEN excluded.lp_target_usd ELSE investor_profiles.lp_target_usd END,
        notes = CASE WHEN json_extract((SELECT flags FROM supplied_fields), '$.notes') THEN excluded.notes ELSE investor_profiles.notes END,
        updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      supplied, user.id, investor_type,
      JSON.stringify(sectors), JSON.stringify(stages), JSON.stringify(geos),
      ticket_band, ticket_min_usd, ticket_max_usd,
      thesis_text, JSON.stringify(thesis_keywords), contribute_to_signals,
      JSON.stringify(anti_thesis_sectors), JSON.stringify(anti_thesis_stages), JSON.stringify(value_weights),
      accreditation_status, country, firm_name, lp_intent, lp_target_usd, notes,
    ),
    c.env.DB.prepare(
      `UPDATE investor_profiles SET completed_at = ?
       WHERE user_id = ? AND NULLIF(investor_type, '') IS NOT NULL AND ticket_band IS NOT NULL
         AND CASE WHEN json_valid(sectors_json) THEN json_array_length(sectors_json) ELSE 0 END > 0
         AND CASE WHEN json_valid(stages_json) THEN json_array_length(stages_json) ELSE 0 END > 0`,
    ).bind(new Date().toISOString(), user.id),
  ]);

  try {
    const sql = getSQL(c.env);
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('investor_profile_updated', ${`Investor profile updated (sectors=${sectors.length}, stages=${stages.length}, anti=${anti_thesis_sectors.length}, contribute=${body.contribute_to_signals === undefined ? 'unchanged' : contribute_to_signals})`}, ${await hashEmail(user.email)}, ${user.id})`;
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
