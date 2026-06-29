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
import { decryptInt, decryptString } from '../services/cryptoBox';
import {
  validateDailyBody, encryptOrFallback,
} from './wellbeing.helpers';
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
import {
  createBookingPaymentIntent, mirrorBookingToCalendar, fanoutBookingNotifications,
} from '../services/wellbeing/bookings';
import { hasFeatureUnlock } from '../services/featureUnlocks';
import { stripeCall } from './billing';
import { clampLimit } from '../util/pagination';

const wellbeing = new Hono<{ Bindings: Env }>();

const MIN_AGGREGATE_COHORT = 7;
const ALLOWED_AGGREGATE_WINDOWS = [30, 90] as const;
const COUNT_BUCKET = 5;

const ALLOWED_RESOURCE_CATEGORIES = new Set(['therapy', 'peer_group', 'hotline', 'reading', 'coaching']);
const FREE_TIER_PROFILE_VIEWS_PER_MONTH = 3;

function bucket(n: number, step = COUNT_BUCKET): number {
  if (n <= 0) return 0;
  return Math.floor(n / step) * step;
}
function role(user: { role: string }): string {
  return String(user.role || '').toLowerCase();
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
    // Task #4 — services + recurring availability
    `CREATE TABLE IF NOT EXISTS expert_services (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       title TEXT NOT NULL,
       description TEXT,
       duration_minutes INTEGER NOT NULL DEFAULT 30,
       price_cents INTEGER NOT NULL DEFAULT 0,
       currency TEXT NOT NULL DEFAULT 'usd',
       is_active INTEGER NOT NULL DEFAULT 1,
       sort_order INTEGER NOT NULL DEFAULT 100,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_expert_services_expert
       ON expert_services(expert_id, is_active, sort_order)`,
    `CREATE TABLE IF NOT EXISTS expert_availability (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       day_of_week INTEGER NOT NULL,
       start_minute INTEGER NOT NULL,
       end_minute INTEGER NOT NULL,
       timezone TEXT NOT NULL DEFAULT 'UTC',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_expert_availability_expert
       ON expert_availability(expert_id, day_of_week)`,
    `CREATE INDEX IF NOT EXISTS idx_expert_bookings_expert_status
       ON expert_bookings(expert_id, status, scheduled_at)`,
  ];
  for (const sql of STMTS) {
    try { await env.DB.prepare(sql).run(); }
    catch (e: any) { console.warn('[wellbeing] schema bootstrap stmt failed:', String(e?.message || e)); }
  }
  // Task #33 — additive plaintext-fallback columns. ALTER TABLE ADD COLUMN
  // is NOT idempotent in SQLite/D1; we swallow the duplicate-column error
  // so this is safe on every cold start.
  const ALTERS = [
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN mood_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN stress_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN sleep_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN energy_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN focus_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN social_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN free_text_plain TEXT`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN tags_plain TEXT`,
    `ALTER TABLE wellbeing_checkins ADD COLUMN stress_plain INTEGER`,
    `ALTER TABLE wellbeing_checkins ADD COLUMN sleep_plain INTEGER`,
    `ALTER TABLE wellbeing_checkins ADD COLUMN support_plain INTEGER`,
    `ALTER TABLE wellbeing_checkins ADD COLUMN decisions_plain INTEGER`,
    `ALTER TABLE wellbeing_checkins ADD COLUMN energy_plain INTEGER`,
    `ALTER TABLE wellbeing_checkins ADD COLUMN notes_plain TEXT`,
    // Task #4 — expert profile completion + Stripe Connect + booking payment.
    `ALTER TABLE experts ADD COLUMN profile_completion_pct INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE experts ADD COLUMN stripe_account_id TEXT`,
    `ALTER TABLE experts ADD COLUMN stripe_charges_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE experts ADD COLUMN stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE experts ADD COLUMN application_fee_pct REAL`,
    `ALTER TABLE experts ADD COLUMN updated_at TEXT`,
    `ALTER TABLE experts ADD COLUMN hidden_by_admin INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE expert_bookings ADD COLUMN service_id INTEGER`,
    `ALTER TABLE expert_bookings ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'`,
    `ALTER TABLE expert_bookings ADD COLUMN stripe_session_id TEXT`,
    `ALTER TABLE expert_bookings ADD COLUMN stripe_payment_intent_id TEXT`,
    `ALTER TABLE expert_bookings ADD COLUMN amount_total_cents INTEGER`,
    `ALTER TABLE expert_bookings ADD COLUMN application_fee_cents INTEGER`,
    `ALTER TABLE expert_bookings ADD COLUMN currency TEXT`,
    `ALTER TABLE expert_bookings ADD COLUMN meet_link TEXT`,
    `ALTER TABLE expert_bookings ADD COLUMN hidden_by_admin INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE expert_bookings ADD COLUMN booker_note TEXT`,
  ];
  for (const sql of ALTERS) {
    try { await env.DB.prepare(sql).run(); }
    catch (e: any) {
      const msg = String(e?.message || e);
      if (!/duplicate column|already exists/i.test(msg)) {
        console.warn('[wellbeing] ALTER failed:', msg);
      }
    }
  }
  _schemaReady = true;
}

// ---------------------------------------------------------------------------
// Pulse check-ins (legacy weekly)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task #33 — POST /checkins now uses the CANONICAL daily-pulse schema
// (mood / stress / sleep / energy / focus / social[connection], tags,
// free_text) and writes to `wellbeing_daily_pulses`. The legacy weekly
// columns (`support`, `decisions`, `notes`) are no longer accepted on
// write — they remain in the DB for historical reads via the read path
// below, but no new code path writes to `wellbeing_checkins`.
//
// The handler logic is extracted into `submitCanonicalCheckin()` so it
// can be unit-tested against a stubbed env.DB without booting Hono.
// `POST /daily` is now a thin alias for the same handler.
// ---------------------------------------------------------------------------
export type CanonicalCheckinResult =
  | { status: 201; body: any }
  | { status: 400; body: { error: string; fields: Record<string, string> } }
  | { status: 500; body: { error: string } };

export async function submitCanonicalCheckin(
  env: Env, userId: number, body: any,
): Promise<CanonicalCheckinResult> {
  const v = validateDailyBody(body);
  if (!v.ok) return { status: 400, body: { error: 'Invalid input', fields: v.fields } };

  const [m, s, sl, en, fo, so] = await Promise.all([
    encryptOrFallback(env, v.values.mood),
    encryptOrFallback(env, v.values.stress),
    encryptOrFallback(env, v.values.sleep),
    encryptOrFallback(env, v.values.energy),
    encryptOrFallback(env, v.values.focus),
    encryptOrFallback(env, v.values.social),
  ]);
  const ft = await encryptOrFallback<string>(env, v.free_text);
  const tagsStr = v.tags.length ? JSON.stringify(v.tags) : null;
  const tg = await encryptOrFallback<string>(env, tagsStr);
  const newUid = uuidHex();

  try {
    await env.DB.prepare(
      `INSERT INTO wellbeing_daily_pulses
         (uid, user_id, day,
          mood_enc, stress_enc, sleep_enc, energy_enc, focus_enc, social_enc,
          free_text_enc, tags_enc,
          mood_plain, stress_plain, sleep_plain, energy_plain, focus_plain, social_plain,
          free_text_plain, tags_plain,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, day) DO UPDATE SET
         mood_enc = excluded.mood_enc, stress_enc = excluded.stress_enc,
         sleep_enc = excluded.sleep_enc, energy_enc = excluded.energy_enc,
         focus_enc = excluded.focus_enc, social_enc = excluded.social_enc,
         free_text_enc = excluded.free_text_enc, tags_enc = excluded.tags_enc,
         mood_plain = excluded.mood_plain, stress_plain = excluded.stress_plain,
         sleep_plain = excluded.sleep_plain, energy_plain = excluded.energy_plain,
         focus_plain = excluded.focus_plain, social_plain = excluded.social_plain,
         free_text_plain = excluded.free_text_plain, tags_plain = excluded.tags_plain,
         created_at = excluded.created_at`,
    ).bind(
      newUid, userId, v.day,
      m.enc, s.enc, sl.enc, en.enc, fo.enc, so.enc,
      ft.enc, tg.enc,
      m.plain, s.plain, sl.plain, en.plain, fo.plain, so.plain,
      ft.plain, tg.plain,
    ).run();
  } catch (e: any) {
    console.warn('[wellbeing] /checkins insert failed:', String(e?.message || e));
    return { status: 500, body: { error: "Couldn't save — try again. If this persists, contact support." } };
  }

  const row = await env.DB.prepare(
    'SELECT * FROM wellbeing_daily_pulses WHERE user_id = ? AND day = ?',
  ).bind(userId, v.day).first<DailyRow>();
  if (!row) {
    return { status: 500, body: { error: "Couldn't save — try again. If this persists, contact support." } };
  }
  const serialized = await serializeDaily(env, row as any);
  return {
    status: 201,
    body: { ok: true, captured_at: row.created_at, ...serialized, id: row.id },
  };
}

wellbeing.post('/checkins', async (c) => {
  const user = await requireAuth(c);
  const r = role(user);
  if (r === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const result = await submitCanonicalCheckin(c.env, user.id, body);
  return c.json(result.body, result.status);
});

wellbeing.get('/checkins', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') {
    return c.json({ detail: 'Not available for investors' }, 403);
  }
  const limit = clampLimit(c.req.query('limit'), 30, 200);
  try {
    await ensureWellbeingSchema(c.env);
    // Canonical read path is the daily-pulse table (Task #33).
    const res = await c.env.DB.prepare(
      `SELECT * FROM wellbeing_daily_pulses
         WHERE user_id = ?
         ORDER BY day DESC
         LIMIT ?`,
    ).bind(user.id, limit).all<DailyRow>();
    const rows = (res.results || []) as DailyRow[];
    const serialized = await Promise.all(rows.map((r) => serializeDaily(c.env, r)));
    return c.json({
      checkins: serialized,
      today: todayUTC(),
      submitted_today: rows.some((r) => r.day === todayUTC()),
    });
  } catch (e: any) {
    console.warn('[wellbeing] /checkins read failed, returning empty:', String(e?.message || e));
    return c.json({ checkins: [], today: todayUTC(), submitted_today: false });
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
async function serializeDaily(env: Env, row: DailyRow & {
  mood_plain?: number | null; stress_plain?: number | null;
  sleep_plain?: number | null; energy_plain?: number | null;
  focus_plain?: number | null; social_plain?: number | null;
  free_text_plain?: string | null; tags_plain?: string | null;
}) {
  // Task #33 — plaintext fallback columns win when ciphertext is missing
  // or fails to decrypt (e.g. JWT_SECRET was rotated mid-flight).
  const pick = async (enc: string | null, plain: number | null | undefined) => {
    if (enc) {
      try { const v = await decryptInt(env, enc); if (v != null) return v; } catch { /* fall through */ }
    }
    return plain ?? null;
  };
  const [mood, stress, sleep, energy, focus, social] = await Promise.all([
    pick(row.mood_enc, row.mood_plain),
    pick(row.stress_enc, row.stress_plain),
    pick(row.sleep_enc, row.sleep_plain),
    pick(row.energy_enc, row.energy_plain),
    pick(row.focus_enc, row.focus_plain),
    pick(row.social_enc, row.social_plain),
  ]);
  let free_text: string | null = null;
  if (row.free_text_enc) {
    try { free_text = await decryptString(env, row.free_text_enc); } catch { /* fall */ }
  }
  if (free_text == null) free_text = row.free_text_plain ?? null;

  let tags: string[] = [];
  const parseTags = (s: string | null | undefined) => {
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed.map((x: any) => String(x)) : [];
    } catch { return []; }
  };
  if (row.tags_enc) {
    try { tags = parseTags(await decryptString(env, row.tags_enc)); } catch { tags = []; }
  }
  if (!tags.length && row.tags_plain) tags = parseTags(row.tags_plain);

  return {
    id: row.id, uid: row.uid, day: row.day,
    mood, stress, sleep, energy, focus, social,
    free_text, tags, created_at: row.created_at,
  };
}

// Task #33 — POST /daily is now a backward-compat alias for the
// canonical /checkins handler (same body schema, same response shape).
wellbeing.post('/daily', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const result = await submitCanonicalCheckin(c.env, user.id, body);
  return c.json(result.body, result.status);
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
    // Task #33 — canonical read path is now `wellbeing_daily_pulses` since
    // /checkins POST writes there. We tolerate the `*_plain` fallback
    // columns being absent on stale dev DBs by retrying without them.
    const cols = 'user_id, mood_enc, stress_enc, sleep_enc, energy_enc, focus_enc, social_enc';
    let res: any;
    try {
      res = await c.env.DB.prepare(
        `SELECT ${cols},
                mood_plain, stress_plain, sleep_plain, energy_plain, focus_plain, social_plain
           FROM wellbeing_daily_pulses
          WHERE created_at >= ?`,
      ).bind(cutoff).all<any>();
    } catch (e: any) {
      if (/no such column/i.test(String(e?.message || ''))) {
        res = await c.env.DB.prepare(
          `SELECT ${cols}
             FROM wellbeing_daily_pulses
            WHERE created_at >= ?`,
        ).bind(cutoff).all<any>();
      } else { throw e; }
    }
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
    const AGG_KEYS = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social'] as const;
    const buckets: Record<typeof AGG_KEYS[number], number[]> = {
      mood: [], stress: [], sleep: [], energy: [], focus: [], social: [],
    };
    for (const r of rows as any[]) {
      for (const k of AGG_KEYS) {
        let v = await decryptInt(c.env, r[`${k}_enc`]);
        if (v == null && r[`${k}_plain`] != null) {
          const n = Number(r[`${k}_plain`]);
          if (Number.isInteger(n) && n >= 1 && n <= 5) v = n;
        }
        if (v != null) buckets[k].push(v);
      }
    }
    const averages: Record<string, number | null> = {};
    for (const k of AGG_KEYS) {
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
function serializeExpert(e: ExpertRow, opts: { include_score?: number; rating_avg?: number; rating_count?: number; breakdown?: any; services?: any[] } = {}) {
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
  return {
    uid: e.uid,
    user_id: e.user_id ?? null,
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
    hidden: !!e.hidden_by_admin,
    profile_completion_pct: Number(e.profile_completion_pct || 0),
    accepts_payments: !!(e.stripe_account_id && e.stripe_charges_enabled),
    rating_avg: opts.rating_avg ?? 0,
    rating_count: opts.rating_count ?? 0,
    match_score: opts.include_score ?? null,
    match_breakdown: opts.breakdown ?? null,
    services: opts.services ?? null,
  };
}

// Task #4 — completion %. Weighted across the fields a published expert
// needs to be useful in the directory. >=70 unlocks listing + bookings.
function computeProfileCompletion(e: ExpertRow, serviceCount: number, availabilityCount: number): number {
  const parse = (s: string | null | undefined) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  const checks: Array<{ w: number; ok: boolean }> = [
    { w: 10, ok: !!e.name },
    { w: 8,  ok: !!(e.headline && e.headline.length >= 8) },
    { w: 12, ok: !!(e.bio && e.bio.length >= 60) },
    { w: 5,  ok: !!e.photo_url },
    { w: 12, ok: parse(e.categories_json).length >= 1 },
    { w: 6,  ok: parse(e.languages_json).length >= 1 },
    { w: 6,  ok: parse(e.timezones_json).length >= 1 },
    { w: 6,  ok: parse(e.modalities_json).length >= 1 },
    { w: 5,  ok: !!e.pricing_model },
    { w: 10, ok: serviceCount >= 1 },
    { w: 10, ok: availabilityCount >= 1 || !!e.calendly_url || !!e.booking_url },
    { w: 10, ok: !!(e.stripe_account_id && e.stripe_charges_enabled) || e.pricing_model === 'free' },
  ];
  const total = checks.reduce((s, c) => s + c.w, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.w : 0), 0);
  return Math.round((got / total) * 100);
}

async function recomputeExpertCompletion(env: Env, expertId: number): Promise<number> {
  const e = await env.DB.prepare('SELECT * FROM experts WHERE id = ?').bind(expertId).first<ExpertRow>();
  if (!e) return 0;
  const svc = await env.DB.prepare('SELECT COUNT(*) AS n FROM expert_services WHERE expert_id = ? AND is_active = 1').bind(expertId).first<{ n: number }>();
  const av = await env.DB.prepare('SELECT COUNT(*) AS n FROM expert_availability WHERE expert_id = ?').bind(expertId).first<{ n: number }>();
  const pct = computeProfileCompletion(e, Number(svc?.n || 0), Number(av?.n || 0));
  await env.DB.prepare('UPDATE experts SET profile_completion_pct = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(pct, expertId).run();
  return pct;
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

    // Task #4 — directory only shows verified experts with completion >= 70
    // and not admin-hidden. Admins see everything (review surface).
    const isAdmin = role(user) === 'admin';
    const all = isAdmin
      ? await c.env.DB.prepare(`SELECT * FROM experts WHERE is_active = 1`).all<ExpertRow>()
      : await c.env.DB.prepare(
          `SELECT * FROM experts
             WHERE is_active = 1
               AND verified = 1
               AND COALESCE(hidden_by_admin, 0) = 0
               AND COALESCE(profile_completion_pct, 0) >= 70`,
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
    const limit = clampLimit(c.req.query('limit'), 6, 50);
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
        // À la carte escape hatch: an active feature unlock bypasses the tier
        // cap without requiring a Growth subscription (additive — tier OR unlock).
        const unlocked = await hasFeatureUnlock(c.env, user.id, 'wellbeing_expert_views');
        if (!unlocked) {
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
  // Task #4 — booking gated on completion >= 70 + not admin-hidden.
  if (role(user) !== 'admin') {
    if ((expert.hidden_by_admin ?? 0) === 1) return c.json({ detail: 'Expert unavailable' }, 404);
    if ((expert.profile_completion_pct ?? 0) < 70) {
      return c.json({ detail: 'Expert profile is incomplete and cannot accept bookings yet.' }, 409);
    }
  }

  const body = await c.req.json().catch(() => ({}));
  const launchUrl = expert.calendly_url || expert.booking_url || expert.website_url || null;
  const notes = typeof (body as any)?.notes === 'string' ? (body as any).notes.slice(0, 1000) : null;
  const bookerNote = typeof (body as any)?.booker_note === 'string'
    ? (body as any).booker_note.slice(0, 1000)
    : notes;
  const serviceUid = typeof (body as any)?.service_uid === 'string' ? (body as any).service_uid : null;
  const service = serviceUid
    ? await c.env.DB.prepare(
        'SELECT * FROM expert_services WHERE uid = ? AND expert_id = ? AND is_active = 1',
      ).bind(serviceUid, expert.id).first<{ id: number; uid: string; expert_id: number; title: string; duration_minutes: number; price_cents: number; currency: string }>()
    : null;
  if (serviceUid && !service) return c.json({ detail: 'Service not found' }, 404);
  const duration = service?.duration_minutes || Number((body as any)?.duration_minutes) || 30;

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
  // Task #4 — payment routing:
  //   • paid service + expert has Connect + Stripe configured → Stripe Checkout,
  //     status='pending_payment' until webhook confirms.
  //   • free service OR no Connect / no Stripe key → behave like before
  //     (status='scheduled'|'requested', no payment).
  const wantsPaid = !!service && service.price_cents > 0;
  const canChargeStripe =
    wantsPaid
    && !!c.env.STRIPE_SECRET_KEY
    && !!expert.stripe_account_id
    && (expert.stripe_charges_enabled ?? 0) === 1;
  const initialStatus = canChargeStripe
    ? 'pending_payment'
    : (usingInternal ? 'scheduled' : 'requested');
  const meetLink = scheduledAt ? `https://meet.jit.si/axal-${bookingUid}` : null;

  try {
    await c.env.DB.prepare(
      `INSERT INTO expert_bookings
         (uid, expert_id, user_id, scheduled_at, duration_minutes, status,
          booking_external_url, notes, service_id, payment_status,
          amount_total_cents, currency, meet_link, booker_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      bookingUid, expert.id, user.id,
      scheduledAt, duration,
      initialStatus,
      launchUrl, notes,
      service?.id || null,
      canChargeStripe ? 'unpaid' : (wantsPaid ? 'unpaid' : 'free'),
      service?.price_cents ?? null,
      service?.currency ?? null,
      meetLink,
      bookerNote,
    ).run();
  } catch (e: any) {
    console.warn('[wellbeing] booking insert failed:', String(e?.message || e));
    return c.json({ detail: 'Booking failed — please try again.' }, 500);
  }

  // Embedded-terminal path: create a PaymentIntent and hand back the
  // client_secret so the founder pays via Stripe Elements in-app (no Checkout
  // redirect). On failure we surface 502; the caller can retry.
  if (canChargeStripe && service) {
    try {
      const row = await c.env.DB.prepare(
        `SELECT id, uid, expert_id, user_id, service_id, scheduled_at, duration_minutes,
                status, payment_status, booker_note, notes, amount_total_cents, currency,
                stripe_session_id, stripe_payment_intent_id, meet_link
           FROM expert_bookings WHERE uid = ? LIMIT 1`,
      ).bind(bookingUid).first<any>();
      const intent = await createBookingPaymentIntent(
        c.env,
        {
          id: expert.id, uid: expert.uid, user_id: expert.user_id ?? null, name: expert.name,
          stripe_account_id: expert.stripe_account_id ?? null,
          stripe_charges_enabled: expert.stripe_charges_enabled ?? 0,
          application_fee_pct: expert.application_fee_pct ?? null,
        },
        { id: service.id, uid: service.uid, expert_id: service.expert_id, title: service.title,
          duration_minutes: service.duration_minutes, price_cents: service.price_cents,
          currency: service.currency },
        row,
        user as TierUser,
      );
      await c.env.DB.prepare(
        `UPDATE expert_bookings
            SET stripe_payment_intent_id = ?, application_fee_cents = ?
          WHERE uid = ?`,
      ).bind(intent.payment_intent_id, intent.application_fee_cents, bookingUid).run();
      return c.json({
        booking_uid: bookingUid,
        client_secret: intent.client_secret,
        payment_intent_id: intent.payment_intent_id,
        status: 'pending_payment',
        amount_cents: service.price_cents,
        currency: service.currency,
      });
    } catch (e: any) {
      console.warn('[wellbeing] stripe payment intent failed:', String(e?.message || e));
      await c.env.DB.prepare(`DELETE FROM expert_bookings WHERE uid = ?`).bind(bookingUid).run();
      return c.json({ detail: 'Payment setup failed. Please try again.' }, 502);
    }
  }

  // Free / no-Stripe path — keep legacy notify behaviour.
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
          ? `A founder booked you for ${when} (${duration} min).${bookerNote ? ` Note: ${bookerNote}` : ''}`
          : `A founder is opening your external scheduler.`,
        link: '/wellbeing/expert-dashboard',
        category: 'calendar',
        channels: ['in_app', 'email', 'slack'],
      });
    }
  } catch (e) {
    console.warn('[wellbeing] booking notify failed:', String((e as any)?.message || e));
  }

  // Free path with internal scheduling — mirror to calendar immediately.
  if (!canChargeStripe && usingInternal && scheduledAt) {
    try {
      const row = await c.env.DB.prepare('SELECT id FROM expert_bookings WHERE uid = ?').bind(bookingUid).first<{ id: number }>();
      if (row?.id) await mirrorBookingToCalendar(c.env, row.id);
    } catch (e: any) { console.warn('[wellbeing] calendar mirror failed:', String(e?.message || e)); }
  }

  return c.json({
    booking_uid: bookingUid,
    launch_url: launchUrl,
    scheduled_at: scheduledAt,
    status: initialStatus,
    meet_link: meetLink,
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

// ===========================================================================
// Task #4 — Expert self-service surface
// ===========================================================================

async function loadMyExpert(env: Env, userId: number): Promise<ExpertRow | null> {
  return await env.DB.prepare(
    'SELECT * FROM experts WHERE user_id = ? LIMIT 1',
  ).bind(userId).first<ExpertRow>();
}

function parseStringArray(v: unknown, max = 25): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 80))).slice(0, max);
}

function sanitiseExpertInput(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  const str = (k: string, max = 2000) => {
    if (typeof body[k] === 'string') out[k] = body[k].slice(0, max);
  };
  str('name', 120);
  str('headline', 240);
  str('bio', 4000);
  str('photo_url', 500);
  str('calendly_url', 500);
  str('booking_url', 500);
  str('website_url', 500);
  if (Array.isArray(body.categories)) out.categories_json = JSON.stringify(parseStringArray(body.categories));
  if (Array.isArray(body.sectors)) out.sectors_json = JSON.stringify(parseStringArray(body.sectors));
  if (Array.isArray(body.languages)) out.languages_json = JSON.stringify(parseStringArray(body.languages));
  if (Array.isArray(body.timezones)) out.timezones_json = JSON.stringify(parseStringArray(body.timezones));
  if (Array.isArray(body.modalities)) {
    const ms = parseStringArray(body.modalities).filter((m) => (VALID_MODALITIES as readonly string[]).includes(m));
    out.modalities_json = JSON.stringify(ms);
  }
  if (typeof body.pricing_model === 'string' && (VALID_PRICING_MODELS as readonly string[]).includes(body.pricing_model)) {
    out.pricing_model = body.pricing_model;
  }
  if (Number.isFinite(Number(body.hourly_rate_usd))) {
    out.hourly_rate_usd = Math.max(0, Math.min(5000, Math.round(Number(body.hourly_rate_usd))));
  }
  if (body.first_session_free != null) out.first_session_free = body.first_session_free ? 1 : 0;
  if (Number.isFinite(Number(body.application_fee_pct))) {
    out.application_fee_pct = Math.max(0, Math.min(50, Number(body.application_fee_pct)));
  }
  return out;
}

// Apply / create an expert profile bound to the calling user.
wellbeing.post('/experts/apply', async (c) => {
  const user = await requireAuth(c);
  if (role(user) === 'investor') return c.json({ detail: 'Not available for investors' }, 403);
  await ensureWellbeingSchema(c.env);

  const existing = await loadMyExpert(c.env, user.id);
  if (existing) return c.json({ detail: 'You already have an expert profile.', expert: serializeExpert(existing) }, 409);

  const body = await c.req.json().catch(() => ({}));
  const fields = sanitiseExpertInput(body);
  const name = (fields.name as string) || (user as any).name || (user as any).email || `Expert ${user.id}`;
  const newUid = uuidHex();
  try {
    await c.env.DB.prepare(
      `INSERT INTO experts (uid, user_id, name, headline, bio, photo_url,
         categories_json, sectors_json, languages_json, timezones_json, modalities_json,
         pricing_model, hourly_rate_usd, first_session_free,
         calendly_url, booking_url, website_url, application_fee_pct,
         verified, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, datetime('now'))`,
    ).bind(
      newUid, user.id, name,
      fields.headline ?? null, fields.bio ?? null, fields.photo_url ?? null,
      fields.categories_json ?? '[]', fields.sectors_json ?? '[]',
      fields.languages_json ?? '["en"]', fields.timezones_json ?? '[]',
      fields.modalities_json ?? '["video"]',
      fields.pricing_model ?? 'paid', fields.hourly_rate_usd ?? null,
      fields.first_session_free ?? 0,
      fields.calendly_url ?? null, fields.booking_url ?? null, fields.website_url ?? null,
      fields.application_fee_pct ?? null,
    ).run();
  } catch (e: any) {
    console.warn('[wellbeing] expert apply failed:', String(e?.message || e));
    return c.json({ detail: 'Could not create expert profile.' }, 500);
  }
  const row = await loadMyExpert(c.env, user.id);
  if (!row) return c.json({ detail: 'Could not create expert profile.' }, 500);
  await recomputeExpertCompletion(c.env, row.id);
  const fresh = await loadMyExpert(c.env, user.id);
  return c.json(serializeExpert(fresh!));
});

wellbeing.get('/experts/me', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  const services = await c.env.DB.prepare(
    'SELECT * FROM expert_services WHERE expert_id = ? ORDER BY sort_order, id',
  ).bind(e.id).all<any>();
  const availability = await c.env.DB.prepare(
    'SELECT * FROM expert_availability WHERE expert_id = ? ORDER BY day_of_week, start_minute',
  ).bind(e.id).all<any>();
  return c.json({
    ...serializeExpert(e, { services: services.results || [] }),
    availability: availability.results || [],
    stripe: {
      account_id: e.stripe_account_id || null,
      charges_enabled: !!e.stripe_charges_enabled,
      payouts_enabled: !!e.stripe_payouts_enabled,
    },
  });
});

wellbeing.put('/experts/me', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const fields = sanitiseExpertInput(body);
  const keys = Object.keys(fields);
  if (keys.length === 0) return c.json(serializeExpert(e));
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  try {
    await c.env.DB.prepare(
      `UPDATE experts SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
    ).bind(...values, e.id).run();
  } catch (e2: any) {
    console.warn('[wellbeing] expert update failed:', String(e2?.message || e2));
    return c.json({ detail: 'Update failed' }, 500);
  }
  await recomputeExpertCompletion(c.env, e.id);
  const fresh = await loadMyExpert(c.env, user.id);
  return c.json(serializeExpert(fresh!));
});

// --- services CRUD ---
wellbeing.get('/experts/me/services', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ services: [] });
  const rs = await c.env.DB.prepare(
    'SELECT * FROM expert_services WHERE expert_id = ? ORDER BY sort_order, id',
  ).bind(e.id).all<any>();
  return c.json({ services: rs.results || [] });
});

wellbeing.post('/experts/me/services', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').slice(0, 240);
  if (!title) return c.json({ detail: 'title required' }, 400);
  const description = typeof body?.description === 'string' ? body.description.slice(0, 2000) : null;
  const duration = Math.max(5, Math.min(480, Number(body?.duration_minutes) || 30));
  const priceCents = Math.max(0, Math.min(10_000_00, Math.round(Number(body?.price_cents) || 0)));
  const currency = String(body?.currency || 'usd').toLowerCase().slice(0, 8);
  const newUid = uuidHex();
  await c.env.DB.prepare(
    `INSERT INTO expert_services (uid, expert_id, title, description, duration_minutes, price_cents, currency, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 100)`,
  ).bind(newUid, e.id, title, description, duration, priceCents, currency).run();
  await recomputeExpertCompletion(c.env, e.id);
  const row = await c.env.DB.prepare('SELECT * FROM expert_services WHERE uid = ?').bind(newUid).first<any>();
  return c.json(row);
});

wellbeing.put('/experts/me/services/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  const uid = c.req.param('uid');
  const svc = await c.env.DB.prepare('SELECT * FROM expert_services WHERE uid = ? AND expert_id = ?').bind(uid, e.id).first<any>();
  if (!svc) return c.json({ detail: 'Not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const set: string[] = []; const vals: any[] = [];
  const push = (col: string, val: any) => { set.push(`${col} = ?`); vals.push(val); };
  if (typeof body.title === 'string') push('title', body.title.slice(0, 240));
  if (typeof body.description === 'string' || body.description === null) push('description', body.description ? String(body.description).slice(0, 2000) : null);
  if (Number.isFinite(Number(body.duration_minutes))) push('duration_minutes', Math.max(5, Math.min(480, Number(body.duration_minutes))));
  if (Number.isFinite(Number(body.price_cents))) push('price_cents', Math.max(0, Math.min(10_000_00, Math.round(Number(body.price_cents)))));
  if (typeof body.currency === 'string') push('currency', body.currency.toLowerCase().slice(0, 8));
  if (body.is_active != null) push('is_active', body.is_active ? 1 : 0);
  if (Number.isFinite(Number(body.sort_order))) push('sort_order', Number(body.sort_order));
  if (!set.length) return c.json(svc);
  await c.env.DB.prepare(`UPDATE expert_services SET ${set.join(', ')} WHERE id = ?`).bind(...vals, svc.id).run();
  await recomputeExpertCompletion(c.env, e.id);
  const row = await c.env.DB.prepare('SELECT * FROM expert_services WHERE id = ?').bind(svc.id).first<any>();
  return c.json(row);
});

wellbeing.delete('/experts/me/services/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  await c.env.DB.prepare('DELETE FROM expert_services WHERE uid = ? AND expert_id = ?').bind(c.req.param('uid'), e.id).run();
  await recomputeExpertCompletion(c.env, e.id);
  return c.json({ ok: true });
});

// --- availability CRUD ---
wellbeing.get('/experts/me/availability', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ availability: [] });
  const rs = await c.env.DB.prepare(
    'SELECT * FROM expert_availability WHERE expert_id = ? ORDER BY day_of_week, start_minute',
  ).bind(e.id).all<any>();
  return c.json({ availability: rs.results || [] });
});

wellbeing.post('/experts/me/availability', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const dow = Number(body?.day_of_week);
  const start = Number(body?.start_minute);
  const end = Number(body?.end_minute);
  const tz = String(body?.timezone || 'UTC').slice(0, 64);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return c.json({ detail: 'day_of_week 0..6' }, 400);
  if (!Number.isInteger(start) || start < 0 || start >= 1440) return c.json({ detail: 'start_minute 0..1439' }, 400);
  if (!Number.isInteger(end) || end <= start || end > 1440) return c.json({ detail: 'end_minute > start_minute and <= 1440' }, 400);
  const newUid = uuidHex();
  await c.env.DB.prepare(
    `INSERT INTO expert_availability (uid, expert_id, day_of_week, start_minute, end_minute, timezone)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(newUid, e.id, dow, start, end, tz).run();
  await recomputeExpertCompletion(c.env, e.id);
  const row = await c.env.DB.prepare('SELECT * FROM expert_availability WHERE uid = ?').bind(newUid).first<any>();
  return c.json(row);
});

wellbeing.delete('/experts/me/availability/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  await c.env.DB.prepare('DELETE FROM expert_availability WHERE uid = ? AND expert_id = ?').bind(c.req.param('uid'), e.id).run();
  await recomputeExpertCompletion(c.env, e.id);
  return c.json({ ok: true });
});

// --- Stripe Connect onboarding ---
wellbeing.post('/experts/me/stripe/connect', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ detail: 'Stripe not configured on this environment.' }, 503);
  const appUrl = c.env.APP_URL || 'https://axal.vc';
  let accountId = e.stripe_account_id || null;
  try {
    if (!accountId) {
      const acct = await stripeCall<{ id: string }>(c.env, '/accounts', {
        type: 'express',
        'capabilities[transfers][requested]': 'true',
        'capabilities[card_payments][requested]': 'true',
        email: (user as any).email || '',
        'metadata[expert_id]': String(e.id),
        'metadata[user_id]': String(user.id),
      });
      accountId = acct.id;
      await c.env.DB.prepare('UPDATE experts SET stripe_account_id = ? WHERE id = ?').bind(accountId, e.id).run();
    }
    const link = await stripeCall<{ url: string }>(c.env, '/account_links', {
      account: accountId,
      refresh_url: `${appUrl}/wellbeing/expert-dashboard?stripe=refresh`,
      return_url: `${appUrl}/wellbeing/expert-dashboard?stripe=return`,
      type: 'account_onboarding',
    });
    return c.json({ url: link.url, account_id: accountId });
  } catch (err: any) {
    console.warn('[wellbeing] connect failed:', String(err?.message || err));
    return c.json({ detail: 'Stripe Connect setup failed.' }, 502);
  }
});

wellbeing.get('/experts/me/stripe/status', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  if (!c.env.STRIPE_SECRET_KEY || !e.stripe_account_id) {
    return c.json({
      account_id: e.stripe_account_id || null,
      charges_enabled: !!e.stripe_charges_enabled,
      payouts_enabled: !!e.stripe_payouts_enabled,
    });
  }
  try {
    const key = c.env.STRIPE_SECRET_KEY;
    const res = await fetch(`https://api.stripe.com/v1/accounts/${e.stripe_account_id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`stripe_${res.status}`);
    const acct = await res.json() as { charges_enabled?: boolean; payouts_enabled?: boolean };
    const ce = acct.charges_enabled ? 1 : 0;
    const pe = acct.payouts_enabled ? 1 : 0;
    await c.env.DB.prepare(
      'UPDATE experts SET stripe_charges_enabled = ?, stripe_payouts_enabled = ? WHERE id = ?',
    ).bind(ce, pe, e.id).run();
    await recomputeExpertCompletion(c.env, e.id);
    return c.json({
      account_id: e.stripe_account_id,
      charges_enabled: !!ce,
      payouts_enabled: !!pe,
    });
  } catch (err: any) {
    console.warn('[wellbeing] connect status failed:', String(err?.message || err));
    return c.json({
      account_id: e.stripe_account_id,
      charges_enabled: !!e.stripe_charges_enabled,
      payouts_enabled: !!e.stripe_payouts_enabled,
      error: 'refresh_failed',
    });
  }
});

// --- expert-side bookings ---
wellbeing.get('/experts/me/bookings', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ bookings: [] });
  const rs = await c.env.DB.prepare(
    `SELECT b.uid, b.status, b.payment_status, b.scheduled_at, b.duration_minutes,
            b.amount_total_cents, b.currency, b.application_fee_cents,
            b.meet_link, b.booker_note, b.created_at,
            u.name AS booker_name
       FROM expert_bookings b
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.expert_id = ? AND COALESCE(b.hidden_by_admin,0) = 0
      ORDER BY b.created_at DESC
      LIMIT 100`,
  ).bind(e.id).all<any>();
  // Experts see ONLY booker_note (NOT wellbeing check-ins). Privacy contract.
  return c.json({ bookings: rs.results || [] });
});

wellbeing.patch('/experts/me/bookings/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const e = await loadMyExpert(c.env, user.id);
  if (!e) return c.json({ detail: 'No expert profile' }, 404);
  const uid = c.req.param('uid');
  const booking = await c.env.DB.prepare(
    'SELECT * FROM expert_bookings WHERE uid = ? AND expert_id = ?',
  ).bind(uid, e.id).first<any>();
  if (!booking) return c.json({ detail: 'Not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const newStatus = typeof body?.status === 'string' ? body.status : null;
  const allowed = new Set(['confirmed', 'cancelled', 'completed', 'no_show']);
  if (!newStatus || !allowed.has(newStatus)) return c.json({ detail: 'invalid status' }, 400);
  await c.env.DB.prepare('UPDATE expert_bookings SET status = ? WHERE id = ?').bind(newStatus, booking.id).run();
  if (newStatus === 'cancelled') {
    await fanoutBookingNotifications(c.env, booking.id, 'cancelled');
  }
  return c.json({ ok: true, status: newStatus });
});

// --- founder bookings ---
wellbeing.get('/bookings/mine', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const rs = await c.env.DB.prepare(
    `SELECT b.uid, b.status, b.payment_status, b.scheduled_at, b.duration_minutes,
            b.amount_total_cents, b.currency, b.meet_link, b.created_at,
            e.uid AS expert_uid, e.name AS expert_name, e.photo_url AS expert_photo
       FROM expert_bookings b
       JOIN experts e ON e.id = b.expert_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 50`,
  ).bind(user.id).all<any>();
  return c.json({ bookings: rs.results || [] });
});

// --- admin review-hide ---
wellbeing.post('/admin/experts/:uid/hide', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'admin only' }, 403);
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const hidden = body?.hidden ? 1 : 0;
  const res = await c.env.DB.prepare(
    'UPDATE experts SET hidden_by_admin = ? WHERE uid = ?',
  ).bind(hidden, c.req.param('uid')).run();
  return c.json({ ok: true, hidden: !!hidden, changes: (res.meta as any)?.changes ?? 0 });
});

wellbeing.post('/admin/experts/:uid/verify', async (c) => {
  const user = await requireAuth(c);
  if (role(user) !== 'admin') return c.json({ detail: 'admin only' }, 403);
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const verified = body?.verified ? 1 : 0;
  await c.env.DB.prepare('UPDATE experts SET verified = ? WHERE uid = ?').bind(verified, c.req.param('uid')).run();
  return c.json({ ok: true, verified: !!verified });
});

// Expose schema bootstrap for tests / admin.
export { ensureWellbeingSchema };

// Suppress unused-warning for isValidCategoryKey export consumer in future routes.
void isValidCategoryKey;

export default wellbeing;
