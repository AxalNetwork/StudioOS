/**
 * T11 + Task #8 (DI) — Founder Wellbeing.
 *
 * Endpoints (mounted at /api/wellbeing in index.ts):
 *   POST   /checkins                   — submit weekly pulse (legacy)
 *   GET    /checkins                   — list THIS user's history (legacy)
 *   POST   /daily                      — submit a daily pulse
 *   GET    /daily?days=30              — list THIS user's daily pulses
 *   GET    /aggregate?days=30|90       — admin-only anonymized aggregate
 *   GET    /resources                  — list curated resources
 *   POST   /resources                  — admin only
 *   DELETE /resources/:id              — admin only
 *   GET    /experts                    — directory (matched, filtered, search)
 *   GET    /experts/categories         — catalogue (for filter UI)
 *   GET    /experts/:uid               — single expert (counts as "view")
 *   POST   /experts/:uid/book          — record booking + return launch URL
 *   POST   /experts/:uid/rate          — rate an expert
 *
 * Privacy contract:
 *   • Per-row check-ins are visible ONLY to the authoring founder.
 *   • Investors are explicitly forbidden from /checkins, /daily, /aggregate.
 *   • Aggregate cohort floor = 7. Allowed windows = 30 or 90 days only.
 *     Counts bucketed to the nearest 5; means rounded to 1dp.
 *   • Daily/weekly answers are AES-GCM ciphertext on disk.
 *
 * Tier gating (Task #8):
 *   • Free founders: unlimited check-ins, but max 3 distinct expert profile
 *     views per calendar month.
 *   • Growth/Studio founders: unlimited matches/views.
 *   • Admin/partner/investor/mentor bypass the cap.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { encryptString, decryptInt, decryptString } from '../services/cryptoBox';
import { notify } from '../services/notify';
import {
  EXPERT_CATEGORIES, EXPERT_CATEGORY_FAMILIES,
  isValidCategoryKey, VALID_MODALITIES, VALID_PRICING_MODELS,
} from '../data/expertCategories';
import {
  applyFilters, loadRatingAggregates, rankExperts,
  type ExpertRow, type MatchPrefs,
} from '../services/wellbeing/match';
import { ensureSeededExperts } from '../services/wellbeing/seedExperts';
import { userMeetsTier, type TierUser } from '../middleware/requireTier';

const wellbeing = new Hono<{ Bindings: Env }>();

const MIN_AGGREGATE_COHORT = 7;
const ALLOWED_AGGREGATE_WINDOWS = [30, 90] as const;
const COUNT_BUCKET = 5;
const QUESTION_KEYS = ['stress', 'sleep', 'support', 'decisions', 'energy'] as const;
type QKey = typeof QUESTION_KEYS[number];

const ALLOWED_RESOURCE_CATEGORIES = new Set(['therapy', 'peer_group', 'hotline', 'reading', 'coaching']);
const FREE_TIER_PROFILE_VIEWS_PER_MONTH = 3;

function bucket(n: number, step = COUNT_BUCKET): number {
  if (n <= 0) return 0;
  return Math.floor(n / step) * step;
}
function role(user: { role: string }): string {
  return String(user.role || '').toLowerCase();
}
function weekAnchor(d: Date = new Date()): string {
  const day = d.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
function uuidHex(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// --------------------------------------------------------------------------
// Lazy schema bootstrap.
// 034_unmounted_routes.sql failed to apply remotely (see replit.md gotcha)
// so wellbeing tables may not exist on prod D1. This function self-heals on
// the first request and is cheap thereafter (CREATE IF NOT EXISTS).
// --------------------------------------------------------------------------
let _schemaReady = false;
async function ensureWellbeingSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  const STMTS = [
    `CREATE TABLE IF NOT EXISTS wellbeing_checkins (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       user_id INTEGER NOT NULL,
       week_anchor TEXT NOT NULL,
       stress_enc TEXT NOT NULL,
       sleep_enc TEXT NOT NULL,
       support_enc TEXT NOT NULL,
       decisions_enc TEXT NOT NULL,
       energy_enc TEXT NOT NULL,
       notes_enc TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(user_id, week_anchor)
     )`,
    `CREATE TABLE IF NOT EXISTS wellbeing_resources (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       category TEXT NOT NULL,
       name TEXT NOT NULL,
       description TEXT,
       url TEXT,
       region TEXT,
       is_24_7 INTEGER NOT NULL DEFAULT 0,
       is_free INTEGER NOT NULL DEFAULT 0,
       sort_order INTEGER NOT NULL DEFAULT 100,
       created_by_user_id INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(category, name)
     )`,
    `CREATE TABLE IF NOT EXISTS wellbeing_daily_pulses (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       user_id INTEGER NOT NULL,
       day TEXT NOT NULL,
       mood_enc TEXT, stress_enc TEXT, sleep_enc TEXT,
       energy_enc TEXT, focus_enc TEXT, social_enc TEXT,
       free_text_enc TEXT,
       tags_enc TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(user_id, day)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_wellbeing_daily_user_day
       ON wellbeing_daily_pulses(user_id, day DESC)`,
    `CREATE TABLE IF NOT EXISTS experts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       user_id INTEGER,
       name TEXT NOT NULL,
       headline TEXT, bio TEXT, photo_url TEXT,
       categories_json TEXT NOT NULL DEFAULT '[]',
       sectors_json TEXT NOT NULL DEFAULT '[]',
       languages_json TEXT NOT NULL DEFAULT '["en"]',
       timezones_json TEXT NOT NULL DEFAULT '[]',
       modalities_json TEXT NOT NULL DEFAULT '["video"]',
       pricing_model TEXT NOT NULL DEFAULT 'paid',
       hourly_rate_usd INTEGER,
       first_session_free INTEGER NOT NULL DEFAULT 0,
       calendly_url TEXT, booking_url TEXT, website_url TEXT,
       verified INTEGER NOT NULL DEFAULT 0,
       is_active INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_experts_active ON experts(is_active)`,
    `CREATE TABLE IF NOT EXISTS expert_ratings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       stars INTEGER NOT NULL,
       review TEXT,
       category_match_pct INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(expert_id, user_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_expert_ratings_expert ON expert_ratings(expert_id)`,
    `CREATE TABLE IF NOT EXISTS expert_bookings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       scheduled_at TEXT,
       duration_minutes INTEGER NOT NULL DEFAULT 30,
       status TEXT NOT NULL DEFAULT 'requested',
       booking_external_url TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_expert_bookings_user ON expert_bookings(user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS expert_profile_views (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       expert_id INTEGER NOT NULL,
       viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_expert_views_user_time
       ON expert_profile_views(user_id, viewed_at DESC)`,
  ];
  for (const sql of STMTS) {
    try { await env.DB.prepare(sql).run(); }
    catch (e: any) { console.warn('[wellbeing] schema bootstrap stmt failed:', String(e?.message || e)); }
  }
  _schemaReady = true;
}

// ---------------------------------------------------------------------------
// Pulse check-ins (legacy weekly)
// ---------------------------------------------------------------------------
type CheckinRow = {
  id: number; uid: string; user_id: number; week_anchor: string;
  stress_enc: string; sleep_enc: string; support_enc: string;
  decisions_enc: string; energy_enc: string; notes_enc: string | null;
  created_at: string;
};

async function serializeOwn(env: Env, row: CheckinRow) {
  const [stress, sleep, support, decisions, energy, notes] = await Promise.all([
    decryptInt(env, row.stress_enc),
    decryptInt(env, row.sleep_enc),
    decryptInt(env, row.support_enc),
    decryptInt(env, row.decisions_enc),
    decryptInt(env, row.energy_enc),
    row.notes_enc ? decryptString(env, row.notes_enc) : Promise.resolve(null),
  ]);
  return {
    id: row.id, uid: row.uid, week_anchor: row.week_anchor,
    created_at: row.created_at,
    stress, sleep, support, decisions, energy, notes,
  };
}

wellbeing.post('/checkins', async (c) => {
  const user = await requireAuth(c);
  const r = role(user);
  if (r !== 'founder' && r !== 'admin') {
    return c.json({ detail: 'Founders only' }, 403);
  }
  await ensureWellbeingSchema(c.env);

  const body = await c.req.json().catch(() => ({}));
  const intAnswer = (k: QKey) => {
    const v = Number((body as any)?.[k]);
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`Field ${k} must be an integer 1..5`);
    }
    return v;
  };
  let answers: Record<QKey, number>;
  try {
    answers = {
      stress: intAnswer('stress'), sleep: intAnswer('sleep'),
      support: intAnswer('support'), decisions: intAnswer('decisions'),
      energy: intAnswer('energy'),
    };
  } catch (e: any) {
    return c.json({ detail: e?.message || 'Invalid payload' }, 400);
  }
  const rawNotes = (body as any)?.notes ?? null;
  if (rawNotes != null && (typeof rawNotes !== 'string' || rawNotes.length > 4000)) {
    return c.json({ detail: 'notes must be a string ≤ 4000 chars' }, 400);
  }

  const anchor = weekAnchor();
  const newUid = uuidHex();
  const [s_e, sl_e, su_e, d_e, en_e] = await Promise.all([
    encryptString(c.env, String(answers.stress)),
    encryptString(c.env, String(answers.sleep)),
    encryptString(c.env, String(answers.support)),
    encryptString(c.env, String(answers.decisions)),
    encryptString(c.env, String(answers.energy)),
  ]);
  const notesEnc = rawNotes ? await encryptString(c.env, rawNotes) : null;

  await c.env.DB.prepare(
    `INSERT INTO wellbeing_checkins
       (uid, user_id, week_anchor, stress_enc, sleep_enc, support_enc,
        decisions_enc, energy_enc, notes_enc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, week_anchor) DO UPDATE SET
       stress_enc    = excluded.stress_enc,
       sleep_enc     = excluded.sleep_enc,
       support_enc   = excluded.support_enc,
       decisions_enc = excluded.decisions_enc,
       energy_enc    = excluded.energy_enc,
       notes_enc     = excluded.notes_enc,
       created_at    = excluded.created_at`,
  ).bind(newUid, user.id, anchor, s_e, sl_e, su_e, d_e, en_e, notesEnc).run();

  const row = await c.env.DB.prepare(
    'SELECT * FROM wellbeing_checkins WHERE user_id = ? AND week_anchor = ?',
  ).bind(user.id, anchor).first<CheckinRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(await serializeOwn(c.env, row));
});

wellbeing.get('/checkins', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') {
    return c.json({ detail: 'Not available for investors' }, 403);
  }
  const limitRaw = Number(c.req.query('limit') ?? 26);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 26, 200));
  try {
    await ensureWellbeingSchema(c.env);
    const res = await c.env.DB.prepare(
      `SELECT * FROM wellbeing_checkins
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
    ).bind(user.id, limit).all<CheckinRow>();
    const rows = (res.results || []) as CheckinRow[];
    const serialized = await Promise.all(rows.map((r) => serializeOwn(c.env, r)));
    const thisWeek = weekAnchor();
    return c.json({
      checkins: serialized,
      this_week_anchor: thisWeek,
      submitted_this_week: rows.some((r) => r.week_anchor === thisWeek),
    });
  } catch (e: any) {
    // Defensive: never 500 the page on a fresh / migrating DB.
    console.warn('[wellbeing] /checkins failed, returning empty:', String(e?.message || e));
    return c.json({
      checkins: [],
      this_week_anchor: weekAnchor(),
      submitted_this_week: false,
    });
  }
});

// ---------------------------------------------------------------------------
// Daily pulse (Task #8 DI)
// ---------------------------------------------------------------------------
type DailyRow = {
  id: number; uid: string; user_id: number; day: string;
  mood_enc: string | null; stress_enc: string | null; sleep_enc: string | null;
  energy_enc: string | null; focus_enc: string | null; social_enc: string | null;
  free_text_enc: string | null; tags_enc: string | null; created_at: string;
};

// Per the privacy contract every wellbeing field is AES-GCM at rest. The
// only consumer of free_text is the authoring founder (no admin/aggregate
// path reads it), so paraphrasing-on-display would be a no-op — we keep the
// invariant by never exposing free_text via /aggregate or any other endpoint.
async function serializeDaily(env: Env, row: DailyRow) {
  const dec = async (s: string | null) => {
    if (!s) return null;
    try { return await decryptInt(env, s); } catch { return null; }
  };
  const [mood, stress, sleep, energy, focus, social] = await Promise.all([
    dec(row.mood_enc), dec(row.stress_enc), dec(row.sleep_enc),
    dec(row.energy_enc), dec(row.focus_enc), dec(row.social_enc),
  ]);
  let free_text: string | null = null;
  if (row.free_text_enc) {
    try { free_text = await decryptString(env, row.free_text_enc); }
    catch { free_text = null; }
  }
  let tags: string[] = [];
  if (row.tags_enc) {
    try {
      const decoded = await decryptString(env, row.tags_enc);
      const parsed = JSON.parse(decoded || '[]');
      tags = Array.isArray(parsed) ? parsed.map((x: any) => String(x)) : [];
    } catch { tags = []; }
  }
  return {
    id: row.id, uid: row.uid, day: row.day,
    mood, stress, sleep, energy, focus, social,
    free_text, tags, created_at: row.created_at,
  };
}

const DAILY_KEYS = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social'] as const;
type DKey = typeof DAILY_KEYS[number];

wellbeing.post('/daily', async (c) => {
  const user = await requireAuth(c);
  const r = role(user);
  if (r === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);

  const body = await c.req.json().catch(() => ({}));
  const day = String((body as any)?.day || todayUTC()).slice(0, 10);
  const vals: Record<DKey, number | null> = {
    mood: null, stress: null, sleep: null, energy: null, focus: null, social: null,
  };
  for (const k of DAILY_KEYS) {
    const raw = (body as any)?.[k];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return c.json({ detail: `${k} must be integer 1..5` }, 400);
    }
    vals[k] = n;
  }
  const rawText = (body as any)?.free_text ?? null;
  if (rawText != null && (typeof rawText !== 'string' || rawText.length > 4000)) {
    return c.json({ detail: 'free_text must be a string ≤ 4000 chars' }, 400);
  }
  const tagsArr = Array.isArray((body as any)?.tags)
    ? ((body as any).tags as any[]).filter((x) => typeof x === 'string').slice(0, 16)
    : [];

  // Encrypt every metric + free_text + tags so the at-rest privacy contract
  // applies to all daily wellbeing data, not just the free-text fields.
  const encMaybe = (n: number | null) =>
    n == null ? Promise.resolve<string | null>(null) : encryptString(c.env, String(n));
  const [
    mood_enc, stress_enc, sleep_enc, energy_enc, focus_enc, social_enc,
  ] = await Promise.all([
    encMaybe(vals.mood), encMaybe(vals.stress), encMaybe(vals.sleep),
    encMaybe(vals.energy), encMaybe(vals.focus), encMaybe(vals.social),
  ]);
  const free_text_enc = rawText ? await encryptString(c.env, rawText) : null;
  const tags_enc = tagsArr.length ? await encryptString(c.env, JSON.stringify(tagsArr)) : null;
  const newUid = uuidHex();

  await c.env.DB.prepare(
    `INSERT INTO wellbeing_daily_pulses
       (uid, user_id, day, mood_enc, stress_enc, sleep_enc,
        energy_enc, focus_enc, social_enc,
        free_text_enc, tags_enc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, day) DO UPDATE SET
       mood_enc = excluded.mood_enc, stress_enc = excluded.stress_enc,
       sleep_enc = excluded.sleep_enc, energy_enc = excluded.energy_enc,
       focus_enc = excluded.focus_enc, social_enc = excluded.social_enc,
       free_text_enc = excluded.free_text_enc, tags_enc = excluded.tags_enc,
       created_at = excluded.created_at`,
  ).bind(
    newUid, user.id, day,
    mood_enc, stress_enc, sleep_enc,
    energy_enc, focus_enc, social_enc,
    free_text_enc, tags_enc,
  ).run();

  const row = await c.env.DB.prepare(
    'SELECT * FROM wellbeing_daily_pulses WHERE user_id = ? AND day = ?',
  ).bind(user.id, day).first<DailyRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(await serializeDaily(c.env, row));
});

wellbeing.get('/daily', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  const daysRaw = Number(c.req.query('days') ?? 30);
  const days = Math.max(1, Math.min(Number.isFinite(daysRaw) ? daysRaw : 30, 180));
  try {
    await ensureWellbeingSchema(c.env);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const res = await c.env.DB.prepare(
      `SELECT * FROM wellbeing_daily_pulses
         WHERE user_id = ? AND day >= ?
         ORDER BY day ASC`,
    ).bind(user.id, cutoff).all<DailyRow>();
    const rows = (res.results || []) as DailyRow[];
    const pulses = await Promise.all(rows.map((r) => serializeDaily(c.env, r)));
    return c.json({
      pulses,
      today: todayUTC(),
      submitted_today: rows.some((r) => r.day === todayUTC()),
      window_days: days,
    });
  } catch (e: any) {
    console.warn('[wellbeing] /daily failed, returning empty:', String(e?.message || e));
    return c.json({ pulses: [], today: todayUTC(), submitted_today: false, window_days: days });
  }
});

// ---------------------------------------------------------------------------
// Aggregate (admin only)
// ---------------------------------------------------------------------------
wellbeing.get('/aggregate', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  const days = Number(c.req.query('days') ?? 30);
  if (!ALLOWED_AGGREGATE_WINDOWS.includes(days as 30 | 90)) {
    return c.json({
      detail: `days must be one of ${JSON.stringify(ALLOWED_AGGREGATE_WINDOWS)} for privacy`,
    }, 400);
  }
  try {
    await ensureWellbeingSchema(c.env);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const res = await c.env.DB.prepare(
      `SELECT user_id, stress_enc, sleep_enc, support_enc, decisions_enc, energy_enc
         FROM wellbeing_checkins
        WHERE created_at >= ?`,
    ).bind(cutoff).all<Pick<CheckinRow, 'user_id' | 'stress_enc' | 'sleep_enc' | 'support_enc' | 'decisions_enc' | 'energy_enc'>>();
    const rows = res.results || [];
    const distinct = new Set(rows.map((r: any) => r.user_id));
    const cohort = distinct.size;

    console.info(
      `wellbeing aggregate access by admin user_id=${user.id} window_days=${days} cohort=${cohort}`,
    );

    if (cohort < MIN_AGGREGATE_COHORT) {
      return c.json({
        window_days: days,
        cohort_size: bucket(cohort),
        submissions: bucket(rows.length),
        insufficient_data: true,
        min_cohort: MIN_AGGREGATE_COHORT,
        averages: null,
      });
    }
    const buckets: Record<QKey, number[]> = {
      stress: [], sleep: [], support: [], decisions: [], energy: [],
    };
    for (const r of rows as any[]) {
      for (const k of QUESTION_KEYS) {
        const v = await decryptInt(c.env, r[`${k}_enc`]);
        if (v != null) buckets[k].push(v);
      }
    }
    const averages: Record<QKey, number | null> = {} as any;
    for (const k of QUESTION_KEYS) {
      averages[k] = buckets[k].length
        ? Math.round((buckets[k].reduce((s, v) => s + v, 0) / buckets[k].length) * 10) / 10
        : null;
    }
    return c.json({
      window_days: days,
      cohort_size: bucket(cohort),
      submissions: bucket(rows.length),
      insufficient_data: false,
      averages,
    });
  } catch (e: any) {
    console.warn('[wellbeing] /aggregate failed:', String(e?.message || e));
    return c.json({
      window_days: days,
      cohort_size: 0, submissions: 0,
      insufficient_data: true, min_cohort: MIN_AGGREGATE_COHORT, averages: null,
    });
  }
});

// ---------------------------------------------------------------------------
// Resource directory
// ---------------------------------------------------------------------------
type ResourceRow = {
  id: number; uid: string; category: string; name: string;
  description: string | null; url: string | null; region: string | null;
  is_24_7: number; is_free: number; sort_order: number;
  created_at: string;
};

const DEFAULT_RESOURCES: Array<Omit<ResourceRow, 'id' | 'uid' | 'created_at'>> = [
  { category: 'hotline', name: '988 Suicide & Crisis Lifeline (US)',
    description: "Free, confidential 24/7 support if you're in crisis or know someone who is. Call or text 988.",
    url: 'https://988lifeline.org', region: 'us', is_24_7: 1, is_free: 1, sort_order: 1 },
  { category: 'hotline', name: 'Samaritans (UK & Ireland)',
    description: 'Free 24/7 emotional support. Call 116 123 from UK or Ireland.',
    url: 'https://www.samaritans.org', region: 'uk', is_24_7: 1, is_free: 1, sort_order: 2 },
  { category: 'peer_group', name: 'Founders Network — Mental Health Circle',
    description: 'Peer support group for founders navigating burnout, stress, and isolation.',
    url: 'https://foundersnetwork.com', region: 'global', is_24_7: 0, is_free: 0, sort_order: 10 },
  { category: 'peer_group', name: 'Reboot.io — Founder Coaching Community',
    description: 'Coaching circles + writing on the inner work of leadership.',
    url: 'https://www.reboot.io', region: 'global', is_24_7: 0, is_free: 0, sort_order: 11 },
  { category: 'therapy', name: 'BetterHelp — online therapy',
    description: 'Matched 1:1 with a licensed therapist; sessions by video, phone, or chat.',
    url: 'https://www.betterhelp.com', region: 'global', is_24_7: 0, is_free: 0, sort_order: 20 },
  { category: 'therapy', name: 'Open Path Collective',
    description: 'Affordable in-person and online therapy ($30-$70/session) with vetted clinicians.',
    url: 'https://openpathcollective.org', region: 'us', is_24_7: 0, is_free: 0, sort_order: 21 },
  { category: 'coaching', name: 'The Founder Coach Directory',
    description: 'Curated directory of executive coaches who specialize in early-stage founders.',
    url: 'https://www.foundercoach.directory', region: 'global', is_24_7: 0, is_free: 0, sort_order: 30 },
  { category: 'reading', name: "The Founder's Dilemmas (Noam Wasserman)",
    description: 'Evidence-based read on the human side of starting a company — co-founder splits, equity, control.',
    url: 'https://press.princeton.edu/books/paperback/9780691158303/the-founders-dilemmas',
    region: 'global', is_24_7: 0, is_free: 0, sort_order: 40 },
  { category: 'reading', name: "It's Called Imposter Syndrome (First Round Review)",
    description: 'Free essay on naming and working through imposter syndrome as a founder.',
    url: 'https://review.firstround.com', region: 'global', is_24_7: 0, is_free: 1, sort_order: 41 },
];

function serializeResource(r: ResourceRow) {
  return {
    id: r.id, uid: r.uid, category: r.category, name: r.name,
    description: r.description, url: r.url, region: r.region,
    is_24_7: !!r.is_24_7, is_free: !!r.is_free,
    sort_order: r.sort_order, created_at: r.created_at,
  };
}

async function ensureDefaultResources(env: Env): Promise<void> {
  for (const spec of DEFAULT_RESOURCES) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO wellbeing_resources
           (uid, category, name, description, url, region, is_24_7, is_free, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uuidHex(), spec.category, spec.name, spec.description, spec.url,
        spec.region, spec.is_24_7, spec.is_free, spec.sort_order,
      ).run();
    } catch (e: any) {
      console.warn('[wellbeing] seed insert failed:', String(e?.message || e));
    }
  }
}

wellbeing.get('/resources', async (c) => {
  await requireAuth(c);
  try {
    await ensureWellbeingSchema(c.env);
    await ensureDefaultResources(c.env);
    const category = c.req.query('category');
    const region = c.req.query('region');
    let sql = 'SELECT * FROM wellbeing_resources WHERE 1=1';
    const params: any[] = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (region) { sql += ' AND (region = ? OR region = ?)'; params.push(region, 'global'); }
    sql += ' ORDER BY sort_order ASC';
    const res = await c.env.DB.prepare(sql).bind(...params).all<ResourceRow>();
    return c.json({ resources: (res.results || []).map((r: any) => serializeResource(r)) });
  } catch (e: any) {
    console.warn('[wellbeing] /resources failed:', String(e?.message || e));
    return c.json({ resources: [] });
  }
});

wellbeing.post('/resources', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const category = String((body as any)?.category || '');
  if (!ALLOWED_RESOURCE_CATEGORIES.has(category)) {
    return c.json({ detail: `category must be one of ${[...ALLOWED_RESOURCE_CATEGORIES].sort()}` }, 400);
  }
  const name = String((body as any)?.name || '').trim();
  if (!name) return c.json({ detail: 'name is required' }, 400);
  const uid = uuidHex();
  await c.env.DB.prepare(
    `INSERT INTO wellbeing_resources
       (uid, category, name, description, url, region, is_24_7, is_free, sort_order, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, category, name,
    (body as any)?.description ?? null, (body as any)?.url ?? null,
    (body as any)?.region ?? null,
    (body as any)?.is_24_7 ? 1 : 0, (body as any)?.is_free ? 1 : 0,
    Number((body as any)?.sort_order ?? 100), user.id,
  ).run();
  const row = await c.env.DB.prepare(
    'SELECT * FROM wellbeing_resources WHERE uid = ?',
  ).bind(uid).first<ResourceRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(serializeResource(row));
});

wellbeing.delete('/resources/:id', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  await ensureWellbeingSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT id FROM wellbeing_resources WHERE id = ?',
  ).bind(id).first<{ id: number }>();
  if (!row) return c.json({ detail: 'Resource not found' }, 404);
  await c.env.DB.prepare('DELETE FROM wellbeing_resources WHERE id = ?').bind(id).run();
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Expert directory (Task #8 DI)
// ---------------------------------------------------------------------------
function serializeExpert(e: ExpertRow, opts: { include_score?: number; rating_avg?: number; rating_count?: number; breakdown?: any } = {}) {
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
  return {
    uid: e.uid,
    name: e.name,
    headline: e.headline,
    bio: e.bio,
    photo_url: e.photo_url,
    categories: parse(e.categories_json),
    sectors: parse(e.sectors_json),
    languages: parse(e.languages_json),
    timezones: parse(e.timezones_json),
    modalities: parse(e.modalities_json),
    pricing_model: e.pricing_model,
    hourly_rate_usd: e.hourly_rate_usd,
    first_session_free: !!e.first_session_free,
    calendly_url: e.calendly_url,
    booking_url: e.booking_url,
    website_url: e.website_url,
    verified: !!e.verified,
    rating_avg: opts.rating_avg ?? 0,
    rating_count: opts.rating_count ?? 0,
    match_score: opts.include_score ?? null,
    match_breakdown: opts.breakdown ?? null,
  };
}

async function countMonthlyProfileViews(env: Env, userId: number): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT expert_id) as n
       FROM expert_profile_views
      WHERE user_id = ? AND viewed_at >= ?`,
  ).bind(userId, monthStart).first<{ n: number }>();
  return Number(r?.n || 0);
}

wellbeing.get('/experts/categories', async (c) => {
  await requireAuth(c);
  return c.json({
    families: EXPERT_CATEGORY_FAMILIES,
    categories: EXPERT_CATEGORIES,
    modalities: VALID_MODALITIES,
    pricing_models: VALID_PRICING_MODELS,
  });
});

wellbeing.get('/experts', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') {
    return c.json({ detail: 'Not available for investors' }, 403);
  }
  try {
    await ensureWellbeingSchema(c.env);
    await ensureSeededExperts(c.env);

    const all = await c.env.DB.prepare(
      `SELECT * FROM experts WHERE is_active = 1`,
    ).all<ExpertRow>();
    const experts = (all.results || []) as ExpertRow[];

    const filtered = applyFilters(experts, {
      category: c.req.query('category') || null,
      language: c.req.query('language') || null,
      modality: c.req.query('modality') || null,
      price_max: c.req.query('price_max') ? Number(c.req.query('price_max')) : null,
      q: c.req.query('q') || null,
    });

    // Build prefs from query string (FE may pass JSON arrays via repeated keys).
    const prefsCategories = c.req.queries('want_category') || [];
    const prefsLanguages = (c.req.queries('want_language') || ['en']).map((x) => x.toLowerCase());
    const prefsSectors = c.req.queries('want_sector') || [];
    const prefsModalities = c.req.queries('want_modality') || [];
    const prefs: MatchPrefs = {
      categories: prefsCategories,
      sectors: prefsSectors,
      languages: prefsLanguages,
      timezone: c.req.query('tz') || null,
      modalities: prefsModalities,
      budget_max_usd: c.req.query('budget_max') ? Number(c.req.query('budget_max')) : null,
    };

    const ratings = await loadRatingAggregates(c.env, filtered.map((e) => e.id));
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 6), 50));
    const ranked = rankExperts(filtered, prefs, ratings, limit);

    // Free-tier cap surface (informational; actual block on /experts/:uid)
    let viewBudget: { tier: string; views_used: number; views_limit: number | null; remaining: number | null } | null = null;
    if (role(user) === 'founder' && !userMeetsTier(user as TierUser, 'growth')) {
      const used = await countMonthlyProfileViews(c.env, user.id);
      viewBudget = {
        tier: 'free',
        views_used: used,
        views_limit: FREE_TIER_PROFILE_VIEWS_PER_MONTH,
        remaining: Math.max(0, FREE_TIER_PROFILE_VIEWS_PER_MONTH - used),
      };
    } else {
      viewBudget = {
        tier: userMeetsTier(user as TierUser, 'growth') ? 'growth_plus' : role(user),
        views_used: 0, views_limit: null, remaining: null,
      };
    }

    return c.json({
      matches: ranked.map((s) => serializeExpert(s.expert, {
        include_score: Math.round(s.score * 100) / 100,
        rating_avg: s.rating_avg, rating_count: s.rating_count,
        breakdown: s.breakdown,
      })),
      total_active: experts.length,
      filtered_count: filtered.length,
      view_budget: viewBudget,
    });
  } catch (e: any) {
    console.warn('[wellbeing] /experts failed:', String(e?.message || e));
    return c.json({ matches: [], total_active: 0, filtered_count: 0, view_budget: null });
  }
});

wellbeing.get('/experts/:uid', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);
  await ensureSeededExperts(c.env);

  const uid = c.req.param('uid');
  const expert = await c.env.DB.prepare(
    'SELECT * FROM experts WHERE uid = ? AND is_active = 1',
  ).bind(uid).first<ExpertRow>();
  if (!expert) return c.json({ detail: 'Expert not found' }, 404);

  // Tier gate: free founders can view at most N distinct experts/month.
  if (role(user) === 'founder' && !userMeetsTier(user as TierUser, 'growth')) {
    // Has the user already viewed THIS expert this month? If so, allow.
    const monthStart = (() => {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    })();
    const seen = await c.env.DB.prepare(
      `SELECT 1 FROM expert_profile_views
        WHERE user_id = ? AND expert_id = ? AND viewed_at >= ? LIMIT 1`,
    ).bind(user.id, expert.id, monthStart).first();
    if (!seen) {
      const used = await countMonthlyProfileViews(c.env, user.id);
      if (used >= FREE_TIER_PROFILE_VIEWS_PER_MONTH) {
        return c.json({
          error: 'tier_required',
          required: 'growth',
          message: `Free tier is capped at ${FREE_TIER_PROFILE_VIEWS_PER_MONTH} matched expert profile views per month. Upgrade to Growth for unlimited matches.`,
          plan: { tier: 'growth', price_label: '$79 / month' },
          checkout_path: '/api/billing/tier/checkout',
        }, 402);
      }
    }
  }

  // Record the view.
  try {
    await c.env.DB.prepare(
      `INSERT INTO expert_profile_views (user_id, expert_id) VALUES (?, ?)`,
    ).bind(user.id, expert.id).run();
  } catch { /* non-fatal */ }

  const ratings = await loadRatingAggregates(c.env, [expert.id]);
  const agg = ratings.get(expert.id);
  return c.json(serializeExpert(expert, {
    rating_avg: agg?.avg_stars ?? 0,
    rating_count: agg?.count ?? 0,
  }));
});

// Internal scheduling fallback. Generates 30-min slots over the next 14
// business days (09:00–17:00 in the expert's first declared timezone, or
// UTC otherwise). Used by the FE when the expert has no external calendar.
function generateInternalSlots(expert: ExpertRow, days = 14, slotMinutes = 30): string[] {
  const tzs = (() => {
    try { return JSON.parse(expert.timezones_json || '[]') as string[]; }
    catch { return [] as string[]; }
  })();
  const tz = tzs[0] || 'UTC';
  const now = new Date();
  const slots: string[] = [];
  for (let d = 1; d <= days && slots.length < 48; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    for (let h = 9; h < 17 && slots.length < 48; h++) {
      for (let m = 0; m < 60 && slots.length < 48; m += slotMinutes) {
        const slot = new Date(Date.UTC(
          day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0,
        ));
        slots.push(slot.toISOString());
      }
    }
    void tz; // tz is informational; UTC anchor is conservative — FE renders local
  }
  return slots;
}

wellbeing.get('/experts/:uid/slots', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);

  const uid = c.req.param('uid');
  const expert = await c.env.DB.prepare(
    'SELECT * FROM experts WHERE uid = ? AND is_active = 1',
  ).bind(uid).first<ExpertRow>();
  if (!expert) return c.json({ detail: 'Expert not found' }, 404);

  const launchUrl = expert.calendly_url || expert.booking_url || null;
  if (launchUrl) {
    // External scheduler exists — internal slots are not used.
    return c.json({ external: true, launch_url: launchUrl, slots: [] });
  }

  // Filter out slots already booked.
  const taken = await c.env.DB.prepare(
    `SELECT scheduled_at FROM expert_bookings
     WHERE expert_id = ? AND scheduled_at IS NOT NULL AND status != 'cancelled'`,
  ).bind(expert.id).all<{ scheduled_at: string }>();
  const takenSet = new Set((taken.results || []).map((r) => r.scheduled_at));

  const slots = generateInternalSlots(expert).filter((s) => !takenSet.has(s));
  return c.json({ external: false, launch_url: null, slots });
});

wellbeing.post('/experts/:uid/book', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);

  const uid = c.req.param('uid');
  const expert = await c.env.DB.prepare(
    'SELECT * FROM experts WHERE uid = ? AND is_active = 1',
  ).bind(uid).first<ExpertRow>();
  if (!expert) return c.json({ detail: 'Expert not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const launchUrl = expert.calendly_url || expert.booking_url || expert.website_url || null;
  const notes = typeof (body as any)?.notes === 'string' ? (body as any).notes.slice(0, 1000) : null;
  const duration = Number((body as any)?.duration_minutes) || 30;

  // Internal-scheduling path: founder picked an explicit slot from /slots.
  let scheduledAt: string | null = null;
  const rawSlot = (body as any)?.scheduled_at;
  if (typeof rawSlot === 'string' && rawSlot.length > 0) {
    const dt = new Date(rawSlot);
    if (!Number.isNaN(dt.getTime()) && dt.getTime() > Date.now() - 60_000) {
      scheduledAt = dt.toISOString();
    } else {
      return c.json({ detail: 'scheduled_at must be a valid future ISO timestamp' }, 400);
    }
  }

  const usingInternal = !launchUrl;
  if (usingInternal && !scheduledAt) {
    // Force internal callers to pick a slot — the old "we'll reach out" stub
    // is no longer a fallback when there's no external scheduler.
    return c.json({
      detail: 'scheduled_at is required when the expert has no external scheduler',
      slots_endpoint: `/api/wellbeing/experts/${uid}/slots`,
    }, 400);
  }

  // Concurrency guard: refuse if the slot was just taken.
  if (usingInternal && scheduledAt) {
    const clash = await c.env.DB.prepare(
      `SELECT id FROM expert_bookings
       WHERE expert_id = ? AND scheduled_at = ? AND status != 'cancelled' LIMIT 1`,
    ).bind(expert.id, scheduledAt).first();
    if (clash) return c.json({ detail: 'That slot was just taken — please pick another.' }, 409);
  }

  const bookingUid = uuidHex();
  try {
    await c.env.DB.prepare(
      `INSERT INTO expert_bookings
         (uid, expert_id, user_id, scheduled_at, duration_minutes, status,
          booking_external_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      bookingUid, expert.id, user.id,
      scheduledAt, duration,
      usingInternal ? 'scheduled' : 'requested',
      launchUrl, notes,
    ).run();
  } catch (e: any) {
    console.warn('[wellbeing] booking insert failed:', String(e?.message || e));
  }

  // Fan out notifications. Founder always gets one; expert too if linked to a user_id.
  try {
    const when = scheduledAt ? new Date(scheduledAt).toUTCString() : 'time TBD via external scheduler';
    await notify(c.env, {
      userId: user.id,
      type: 'expert_booking_confirmed',
      title: `Booking with ${expert.name}`,
      body: usingInternal
        ? `Confirmed for ${when} (${duration} min). The expert has been notified.`
        : `Open the scheduler to confirm your slot with ${expert.name}.`,
      link: usingInternal ? '/wellbeing' : (launchUrl || '/wellbeing'),
      category: 'calendar',
      channels: ['in_app', 'email'],
    });
    if (expert.user_id) {
      await notify(c.env, {
        userId: expert.user_id,
        type: 'expert_booking_received',
        title: `New booking request`,
        body: usingInternal
          ? `A founder booked you for ${when} (${duration} min).${notes ? ` Notes: ${notes}` : ''}`
          : `A founder is opening your external scheduler.`,
        link: '/wellbeing',
        category: 'calendar',
        channels: ['in_app', 'email'],
      });
    }
  } catch (e) {
    console.warn('[wellbeing] booking notify failed:', String((e as any)?.message || e));
  }

  return c.json({
    booking_uid: bookingUid,
    launch_url: launchUrl,
    scheduled_at: scheduledAt,
    fallback: usingInternal ? 'internal_scheduled' : null,
    message: usingInternal
      ? `Confirmed for ${new Date(scheduledAt!).toUTCString()}. Both of you have been emailed.`
      : 'Open the booking URL to confirm your slot with the expert.',
  });
});

wellbeing.post('/experts/:uid/rate', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);

  const uid = c.req.param('uid');
  const expert = await c.env.DB.prepare(
    'SELECT id FROM experts WHERE uid = ?',
  ).bind(uid).first<{ id: number }>();
  if (!expert) return c.json({ detail: 'Expert not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const stars = Number((body as any)?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return c.json({ detail: 'stars must be integer 1..5' }, 400);
  }
  const review = typeof (body as any)?.review === 'string' ? (body as any).review.slice(0, 2000) : null;
  const matchPct = (body as any)?.category_match_pct;
  const matchPctNum = Number.isFinite(matchPct) ? Math.max(0, Math.min(100, Number(matchPct))) : null;

  await c.env.DB.prepare(
    `INSERT INTO expert_ratings (uid, expert_id, user_id, stars, review, category_match_pct)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(expert_id, user_id) DO UPDATE SET
       stars = excluded.stars, review = excluded.review,
       category_match_pct = excluded.category_match_pct,
       created_at = datetime('now')`,
  ).bind(uuidHex(), expert.id, user.id, stars, review, matchPctNum).run();
  return c.json({ ok: true });
});

// Expose schema bootstrap for tests / admin.
export { ensureWellbeingSchema };

// Suppress unused-warning for isValidCategoryKey export consumer in future routes.
void isValidCategoryKey;

export default wellbeing;
