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
 *   • Admin/partner/investor/advisor bypass the cap.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin, requireBranchNotSuspended } from '../auth';
import { decryptInt, decryptString } from '../services/cryptoBox';
import {
  weekSpan, validateDailyBody, encryptOrFallback,
} from './wellbeing.helpers';
import { notify } from '../services/notify';
import { refuse } from '../util/refusal';
import {
  EXPERT_CATEGORIES, EXPERT_CATEGORY_FAMILIES,
  isValidCategoryKey, VALID_MODALITIES, VALID_PRICING_MODELS,
} from '../data/expertCategories';
import {
  applyFilters, loadRatingAggregates, rankExperts,
  type ExpertRow, type MatchPrefs,
} from '../services/wellbeing/match';
import { ensureSeededExperts, isSampleExpert, SAMPLE_EXPERT_UID_PREFIX } from '../services/wellbeing/seedExperts';
import { offeredSlots, type AvailabilityWindow } from '../services/wellbeing/slots';
import {
  RESOURCE_FILE_MAX_BYTES, RESOURCE_FILE_TYPES, mediaType, newResourceFileKey, resourceFilePath,
} from '../services/wellbeing/resourceFiles';
import { parseRange } from '../services/learningVideo';
import { userMeetsTier, tierUpsell, type TierUser } from '../middleware/requireTier';
import {
  createBookingPaymentIntent, mirrorBookingToCalendar, fanoutBookingNotifications,
} from '../services/wellbeing/bookings';
import { hasFeatureUnlock } from '../services/featureUnlocks';
import { stripeCall } from './billing';
import { clampLimit } from '../util/pagination';
import { bindingKey } from '../util/schemaBootstrap';
import { ensureAdminAuditLogTable } from './admin';

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

// D303 — the admin routes below used to check `role(user) === 'admin'`
// directly off `requireAuth`, which is what the HQ compliance freeze
// (`requireAdmin`'s `refuseWhileFrozen`, D135) and the branch-suspension gate
// (`requireBranchNotSuspended`, D142) both attach to. Neither freeze reached
// Wellbeing before this: an admin under an overdue HQ notice, or a suspended
// branch, could still publish a resource or verify/un-hide an expert here
// while every other Admin · Community console already refused. `admin(c)`
// mirrors the `admin_jobs.ts` / `admin_circles.ts` helper shape so a caller
// gets the same 401-vs-403 split those consoles give.
async function admin(c: any) {
  try {
    return await requireAdmin(c);
  } catch (e) {
    const msg = (e as Error)?.message;
    return c.json({ detail: msg || 'Admin required' }, msg === 'Unauthorized' ? 401 : 403);
  }
}

// --------------------------------------------------------------------------
// Lazy schema bootstrap.
// 034_unmounted_routes.sql failed to apply remotely (see replit.md gotcha)
// so wellbeing tables may not exist on prod D1. This function self-heals on
// the first request and is cheap thereafter (CREATE IF NOT EXISTS).
// --------------------------------------------------------------------------
const SCHEMA_READY = new WeakMap<object, boolean>();
async function ensureWellbeingSchema(env: Env): Promise<void> {
  if (SCHEMA_READY.get(bindingKey(env))) return;
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
    // D574 — migration 395.
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN support_enc TEXT`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN decisions_enc TEXT`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN support_plain INTEGER`,
    `ALTER TABLE wellbeing_daily_pulses ADD COLUMN decisions_plain INTEGER`,
    `ALTER TABLE wellbeing_resources ADD COLUMN kind TEXT`,
    `ALTER TABLE wellbeing_resources ADD COLUMN topic TEXT`,
    `ALTER TABLE wellbeing_resources ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`,
    `ALTER TABLE wellbeing_resources ADD COLUMN edited_at TEXT`,
    `ALTER TABLE wellbeing_resources ADD COLUMN file_key TEXT`,
    `ALTER TABLE wellbeing_resources ADD COLUMN file_type TEXT`,
    `ALTER TABLE wellbeing_resources ADD COLUMN file_size INTEGER`,
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
  SCHEMA_READY.set(bindingKey(env), true);
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

  // D574 — ONE CHECK-IN PER WEEK, kept by the route. The week is Monday to
  // Sunday, UTC. A save in a week that already has a row replaces that row
  // (the latest, if the daily era left several), on its own day; it is never
  // refused, because "Update this week" is the canvas's own action. Not an
  // index: rows saved before D574 were one per day, and a unique week index
  // would refuse the migration wherever a member checked in twice in a week.
  const week = weekSpan(v.day);
  const existing = await env.DB.prepare(
    `SELECT day FROM wellbeing_daily_pulses WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC LIMIT 1`,
  ).bind(userId, week.start, week.end).first<{ day: string }>();
  const day = existing?.day ?? v.day;

  const [m, s, sl, en, fo, so, su, de] = await Promise.all([
    encryptOrFallback(env, v.values.mood),
    encryptOrFallback(env, v.values.stress),
    encryptOrFallback(env, v.values.sleep),
    encryptOrFallback(env, v.values.energy),
    encryptOrFallback(env, v.values.focus),
    encryptOrFallback(env, v.values.social),
    encryptOrFallback(env, v.values.support),
    encryptOrFallback(env, v.values.decisions),
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
          support_enc, decisions_enc, support_plain, decisions_plain,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, day) DO UPDATE SET
         mood_enc = excluded.mood_enc, stress_enc = excluded.stress_enc,
         sleep_enc = excluded.sleep_enc, energy_enc = excluded.energy_enc,
         focus_enc = excluded.focus_enc, social_enc = excluded.social_enc,
         free_text_enc = excluded.free_text_enc, tags_enc = excluded.tags_enc,
         mood_plain = excluded.mood_plain, stress_plain = excluded.stress_plain,
         sleep_plain = excluded.sleep_plain, energy_plain = excluded.energy_plain,
         focus_plain = excluded.focus_plain, social_plain = excluded.social_plain,
         free_text_plain = excluded.free_text_plain, tags_plain = excluded.tags_plain,
         support_enc = excluded.support_enc, decisions_enc = excluded.decisions_enc,
         support_plain = excluded.support_plain, decisions_plain = excluded.decisions_plain,
         created_at = excluded.created_at`,
    ).bind(
      newUid, userId, day,
      m.enc, s.enc, sl.enc, en.enc, fo.enc, so.enc,
      ft.enc, tg.enc,
      m.plain, s.plain, sl.plain, en.plain, fo.plain, so.plain,
      ft.plain, tg.plain,
      su.enc, de.enc, su.plain, de.plain,
    ).run();
  } catch (e: any) {
    console.warn('[wellbeing] /checkins insert failed:', String(e?.message || e));
    return { status: 500, body: { error: "Couldn't save — try again. If this persists, contact support." } };
  }

  const row = await env.DB.prepare(
    'SELECT * FROM wellbeing_daily_pulses WHERE user_id = ? AND day = ?',
  ).bind(userId, day).first<DailyRow>();
  if (!row) {
    return { status: 500, body: { error: "Couldn't save — try again. If this persists, contact support." } };
  }
  const serialized = await serializeDaily(env, row as any);
  // D574 — whether THIS save was stored encrypted. When the cipher fails the
  // form still saves (Task #33) into the plain backstop, and the page must not
  // then say "Stored encrypted".
  const storedEncrypted = ![m, s, sl, en, fo, so, su, de, ft, tg].some((x) => x.fellBack);
  return {
    status: 201,
    body: {
      ok: true, captured_at: row.created_at, ...serialized, id: row.id, stored_encrypted: storedEncrypted,
      // D574 — the week this check-in covers, and whether it replaced one.
      week_start: week.start, replaced: !!existing,
    },
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

/**
 * D574 — A READ THAT FAILED IS NOT AN EMPTY ONE. These four reads used to
 * answer 200 with an empty list (or, for the pulse, the small-cohort shape),
 * so the screens said "nothing yet" — and the admin pulse "Fewer than 5" —
 * when nothing had been read at all. A failure is now a 503 refusal with its
 * code, which the client reads as Unreadable. The raw error is logged, never
 * returned.
 */
function unreadable(c: any, code: string, message: string, raw: unknown, extra?: Record<string, unknown>) {
  return refuse(c, 503, { code, message, raw, extra });
}

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
    return unreadable(c, 'checkins_unreadable', 'Your check-ins could not be read. This is not a claim that you have none.', e);
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
  support_enc?: string | null; decisions_enc?: string | null;
  support_plain?: number | null; decisions_plain?: number | null;
}) {
  // Task #33 — plaintext fallback columns win when ciphertext is missing
  // or fails to decrypt (e.g. JWT_SECRET was rotated mid-flight).
  const pick = async (enc: string | null, plain: number | null | undefined) => {
    if (enc) {
      try { const v = await decryptInt(env, enc); if (v != null) return v; } catch { /* fall through */ }
    }
    return plain ?? null;
  };
  const [mood, stress, sleep, energy, focus, social, support, decisions] = await Promise.all([
    pick(row.mood_enc, row.mood_plain),
    pick(row.stress_enc, row.stress_plain),
    pick(row.sleep_enc, row.sleep_plain),
    pick(row.energy_enc, row.energy_plain),
    pick(row.focus_enc, row.focus_plain),
    pick(row.social_enc, row.social_plain),
    pick(row.support_enc ?? null, row.support_plain),
    pick(row.decisions_enc ?? null, row.decisions_plain),
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
    mood, stress, sleep, energy, focus, social, support, decisions,
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
  const a = await admin(c);
  if (a instanceof Response) return a;
  // A read — D135's freeze and D142's suspension gate both never gate a
  // read, and an aggregate an admin cannot see is worse than a stale one.
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
          WHERE datetime(created_at) >= datetime(?)`,
      ).bind(cutoff).all<any>();
    } catch (e: any) {
      if (/no such column/i.test(String(e?.message || ''))) {
        res = await c.env.DB.prepare(
          `SELECT ${cols}
             FROM wellbeing_daily_pulses
            WHERE datetime(created_at) >= datetime(?)`,
        ).bind(cutoff).all<any>();
      } else { throw e; }
    }
    const rows = res.results || [];
    const distinct = new Set(rows.map((r: any) => r.user_id));
    const cohort = distinct.size;

    console.info(
      `wellbeing aggregate access by admin user_id=${a.id} window_days=${days} cohort=${cohort}`,
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
    return unreadable(c, 'aggregate_unreadable', 'The wellbeing pulse could not be read. This is not a claim that the cohort is small.', e, { window_days: days });
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
  // D574 — migration 395.
  kind?: string | null; topic?: string | null; status?: string | null; edited_at?: string | null;
  file_key?: string | null; file_type?: string | null; file_size?: number | null;
};

/** D574 — the canvas's formats, the two states, and the topic's length. */
export const RESOURCE_KINDS = ['article', 'audio', 'video', 'link'] as const;
export const RESOURCE_STATUSES = ['draft', 'published'] as const;
export const RESOURCE_TOPIC_MAX = 60;

/**
 * D574 — the resource fields a write may set, checked. `partial` is a PATCH:
 * a field left out keeps its value. A link must be http(s), so a stored
 * `javascript:` can never reach a member's href.
 */
export function resourceFields(body: any, partial: boolean):
  | { ok: true; set: Record<string, unknown> }
  | { ok: false; code: string; message: string } {
  const set: Record<string, unknown> = {};
  const has = (k: string) => body != null && Object.prototype.hasOwnProperty.call(body, k);
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (!partial || has('category')) {
    const category = text(body?.category);
    if (!ALLOWED_RESOURCE_CATEGORIES.has(category)) {
      return { ok: false, code: 'invalid_category', message: `category must be one of ${[...ALLOWED_RESOURCE_CATEGORIES].sort().join(', ')}` };
    }
    set.category = category;
  }
  if (!partial || has('name')) {
    const name = text(body?.name);
    if (!name) return { ok: false, code: 'name_required', message: 'name is required' };
    set.name = name.slice(0, 200);
  }
  if (has('description')) set.description = text(body.description) ? text(body.description).slice(0, 2000) : null;
  if (has('url')) {
    const url = text(body.url);
    if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, code: 'invalid_url', message: 'url must be an http(s) link' };
    set.url = url || null;
  }
  if (has('region')) set.region = text(body.region) || null;
  if (has('is_24_7')) set.is_24_7 = body.is_24_7 ? 1 : 0;
  if (has('is_free')) set.is_free = body.is_free ? 1 : 0;
  if (has('sort_order')) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n)) return { ok: false, code: 'invalid_sort_order', message: 'sort_order must be a whole number' };
    set.sort_order = n;
  }
  if (has('kind')) {
    const kind = body.kind == null || body.kind === '' ? null : text(body.kind);
    if (kind !== null && !(RESOURCE_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, code: 'invalid_kind', message: `kind must be one of ${RESOURCE_KINDS.join(', ')}` };
    }
    set.kind = kind;
  }
  if (has('topic')) {
    const topic = text(body.topic);
    if (topic.length > RESOURCE_TOPIC_MAX) return { ok: false, code: 'topic_too_long', message: `topic must be at most ${RESOURCE_TOPIC_MAX} characters` };
    set.topic = topic || null;
  }
  if (has('status')) {
    const status = text(body.status);
    if (!(RESOURCE_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, code: 'invalid_status', message: 'status must be draft or published' };
    }
    set.status = status;
  }
  return { ok: true, set };
}

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
    // D574 — null on rows written before migration 395, read as not recorded.
    kind: r.kind ?? null, topic: r.topic ?? null,
    status: r.status === 'draft' ? 'draft' : 'published',
    edited_at: r.edited_at ?? null,
    // D574 part 4 — the file's type, size and the gated path that reads it;
    // never its bucket key.
    file: r.file_key ? { type: r.file_type ?? null, size: r.file_size ?? null, url: resourceFilePath(r.uid) } : null,
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
  const user = await requireAuth(c);
  try {
    await ensureWellbeingSchema(c.env);
    await ensureDefaultResources(c.env);
    const category = c.req.query('category');
    const region = c.req.query('region');
    let sql = 'SELECT * FROM wellbeing_resources WHERE 1=1';
    const params: any[] = [];
    // D574 — a draft is the admins' alone; members read published rows only.
    if (role(user) !== 'admin') sql += " AND COALESCE(status, 'published') = 'published'";
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (region) { sql += ' AND (region = ? OR region = ?)'; params.push(region, 'global'); }
    sql += ' ORDER BY sort_order ASC';
    const res = await c.env.DB.prepare(sql).bind(...params).all<ResourceRow>();
    return c.json({ resources: (res.results || []).map((r: any) => serializeResource(r)) });
  } catch (e: any) {
    return unreadable(c, 'resources_unreadable', 'The resource library could not be read. This is not a claim that it is empty.', e);
  }
});

wellbeing.post('/resources', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const user = a;
  await ensureWellbeingSchema(c.env);
  // D142 — a suspended branch cannot put anything NEW under the brand. The
  // gate is after the admin check, so an anonymous caller still gets 401
  // rather than learning the licence state.
  await requireBranchNotSuspended(c);
  const body = await c.req.json().catch(() => ({}));
  const f = resourceFields(body, false);
  if (!f.ok) return refuse(c, 400, { code: f.code, message: f.message });
  const v = f.set as any;
  const uid = uuidHex();
  try {
    await c.env.DB.prepare(
      `INSERT INTO wellbeing_resources
         (uid, category, name, description, url, region, is_24_7, is_free, sort_order, created_by_user_id,
          kind, topic, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid, v.category, v.name,
      v.description ?? null, v.url ?? null, v.region ?? null,
      v.is_24_7 ?? 0, v.is_free ?? 0, v.sort_order ?? 100, user.id,
      v.kind ?? null, v.topic ?? null, v.status ?? 'published',
    ).run();
  } catch (e: any) {
    if (/UNIQUE/i.test(String(e?.message || ''))) {
      return refuse(c, 409, { code: 'resource_exists', message: 'A resource with this category and title already exists.' });
    }
    throw e;
  }
  const row = await c.env.DB.prepare(
    'SELECT * FROM wellbeing_resources WHERE uid = ?',
  ).bind(uid).first<ResourceRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(serializeResource(row));
});

/**
 * D574 — an admin edits a resource. Any field left out keeps its value; the
 * row records when it was last edited. Publishing, or changing anything a
 * member reads, is a new thing under the brand, so it waits for an
 * unsuspended branch (D142); moving a row back to draft is a takedown and
 * does not.
 */
wellbeing.patch('/resources/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  await ensureWellbeingSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return refuse(c, 400, { code: 'invalid_id', message: 'Invalid id' });
  const body = await c.req.json().catch(() => ({}));
  const f = resourceFields(body, true);
  if (!f.ok) return refuse(c, 400, { code: f.code, message: f.message });
  const keys = Object.keys(f.set);
  if (!keys.length) return refuse(c, 400, { code: 'nothing_to_change', message: 'Name at least one field to change.' });
  const takedownOnly = keys.length === 1 && f.set.status === 'draft';
  if (!takedownOnly) await requireBranchNotSuspended(c);
  const row = await c.env.DB.prepare('SELECT * FROM wellbeing_resources WHERE id = ?').bind(id).first<ResourceRow>();
  if (!row) return refuse(c, 404, { code: 'resource_not_found', message: 'Resource not found' });
  const next = { ...row, ...f.set } as any;
  try {
    await c.env.DB.prepare(
      `UPDATE wellbeing_resources
          SET category = ?, name = ?, description = ?, url = ?, region = ?, is_24_7 = ?, is_free = ?,
              sort_order = ?, kind = ?, topic = ?, status = ?, edited_at = ?
        WHERE id = ?`,
    ).bind(
      next.category, next.name, next.description ?? null, next.url ?? null, next.region ?? null,
      next.is_24_7 ? 1 : 0, next.is_free ? 1 : 0, Number(next.sort_order ?? 100),
      next.kind ?? null, next.topic ?? null, next.status === 'draft' ? 'draft' : 'published',
      new Date().toISOString(), id,
    ).run();
  } catch (e: any) {
    if (/UNIQUE/i.test(String(e?.message || ''))) {
      return refuse(c, 409, { code: 'resource_exists', message: 'A resource with this category and title already exists.' });
    }
    throw e;
  }
  const saved = await c.env.DB.prepare('SELECT * FROM wellbeing_resources WHERE id = ?').bind(id).first<ResourceRow>();
  return c.json(serializeResource(saved as ResourceRow));
});

wellbeing.delete('/resources/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  // A takedown, not a publish — D142's FREEZE_RULE lets a suspended branch
  // still remove something under its own brand, so no suspension gate here.
  await ensureWellbeingSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT id FROM wellbeing_resources WHERE id = ?',
  ).bind(id).first<{ id: number }>();
  if (!row) return c.json({ detail: 'Resource not found' }, 404);
  const file = await c.env.DB.prepare('SELECT file_key FROM wellbeing_resources WHERE id = ?').bind(id).first<{ file_key: string | null }>();
  await c.env.DB.prepare('DELETE FROM wellbeing_resources WHERE id = ?').bind(id).run();
  // D574 part 4 — the resource's file goes with it. A failed delete leaves an
  // object nothing points at, which costs storage and exposes nothing: the
  // read route finds the file through the row.
  if (file?.file_key && c.env.FILES) {
    try { await c.env.FILES.delete(file.file_key); } catch (e) { console.warn('[wellbeing] resource file delete failed', (e as Error).message); }
  }
  return c.json({ deleted: true });
});

/**
 * D574 part 4 — an admin attaches a file to a resource: one PUT, the raw
 * bytes, a declared type from `RESOURCE_FILE_TYPES` and a Content-Length of
 * at most 95 MB that the body must match. It goes to a fresh key, the row
 * points at it, and the previous file, if any, is deleted after. Publishing
 * new content under the brand waits for an unsuspended branch (D142).
 */
wellbeing.put('/resources/:id/file', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  await ensureWellbeingSchema(c.env);
  await requireBranchNotSuspended(c);
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'File storage is not configured, so nothing can be uploaded.' });
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return refuse(c, 400, { code: 'invalid_id', message: 'Invalid id' });
  const type = mediaType(c.req.header('content-type'));
  if (!Object.prototype.hasOwnProperty.call(RESOURCE_FILE_TYPES, type)) {
    return refuse(c, 415, { code: 'unsupported_type', message: `A library file is a PDF, an audio file (MP3, M4A) or a video (MP4, WebM).`, extra: { allowed: Object.keys(RESOURCE_FILE_TYPES) } });
  }
  const declared = Number(c.req.header('content-length'));
  if (!Number.isInteger(declared) || declared <= 0) {
    return refuse(c, 411, { code: 'length_required', message: 'The upload must say its size (Content-Length).' });
  }
  if (declared > RESOURCE_FILE_MAX_BYTES) {
    return refuse(c, 413, { code: 'file_too_large', message: `A library file is at most ${RESOURCE_FILE_MAX_BYTES / (1024 * 1024)} MB.`, extra: { max_bytes: RESOURCE_FILE_MAX_BYTES } });
  }
  const row = await c.env.DB.prepare('SELECT uid, file_key FROM wellbeing_resources WHERE id = ?').bind(id).first<{ uid: string; file_key: string | null }>();
  if (!row) return refuse(c, 404, { code: 'resource_not_found', message: 'Resource not found' });
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength !== declared) {
    return refuse(c, 400, { code: 'length_mismatch', message: 'The upload was not the size it declared, so nothing was stored.' });
  }
  const key = newResourceFileKey(row.uid, type);
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare(
    'UPDATE wellbeing_resources SET file_key = ?, file_type = ?, file_size = ?, edited_at = ? WHERE id = ?',
  ).bind(key, type, bytes.byteLength, new Date().toISOString(), id).run();
  if (row.file_key && row.file_key !== key) {
    try { await c.env.FILES.delete(row.file_key); } catch (e) { console.warn('[wellbeing] old resource file delete failed', (e as Error).message); }
  }
  const saved = await c.env.DB.prepare('SELECT * FROM wellbeing_resources WHERE id = ?').bind(id).first<ResourceRow>();
  return c.json(serializeResource(saved as ResourceRow));
});

/** D574 part 4 — an admin removes a resource's file. A takedown: no suspension gate. */
wellbeing.delete('/resources/:id/file', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  await ensureWellbeingSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return refuse(c, 400, { code: 'invalid_id', message: 'Invalid id' });
  const row = await c.env.DB.prepare('SELECT file_key FROM wellbeing_resources WHERE id = ?').bind(id).first<{ file_key: string | null }>();
  if (!row) return refuse(c, 404, { code: 'resource_not_found', message: 'Resource not found' });
  await c.env.DB.prepare(
    'UPDATE wellbeing_resources SET file_key = NULL, file_type = NULL, file_size = NULL, edited_at = ? WHERE id = ?',
  ).bind(new Date().toISOString(), id).run();
  if (row.file_key && c.env.FILES) {
    try { await c.env.FILES.delete(row.file_key); } catch (e) { console.warn('[wellbeing] resource file delete failed', (e as Error).message); }
  }
  const saved = await c.env.DB.prepare('SELECT * FROM wellbeing_resources WHERE id = ?').bind(id).first<ResourceRow>();
  return c.json(serializeResource(saved as ResourceRow));
});

/**
 * D574 part 4 — a resource's file, read by any signed-in user who may read
 * the resource: a published one, or a draft for an admin. A draft, a missing
 * resource and a resource with no file all answer 404, so the route never
 * confirms that a draft exists. One byte range is answered with 206.
 */
wellbeing.get('/resources/:uid/file', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const row = await c.env.DB.prepare(
    'SELECT status, file_key, file_type FROM wellbeing_resources WHERE uid = ?',
  ).bind(c.req.param('uid')).first<{ status: string | null; file_key: string | null; file_type: string | null }>();
  const missing = () => refuse(c, 404, { code: 'file_not_found', message: 'No such file.' });
  if (!row || !row.file_key) return missing();
  if (row.status === 'draft' && role(user) !== 'admin') return missing();
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'File storage is not configured.' });
  const head = await c.env.FILES.head(row.file_key);
  if (!head) return missing();
  const size = head.size;
  const range = parseRange(c.req.header('range'), size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': row.file_type || head.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const obj = await c.env.FILES.get(row.file_key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) return missing();
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  return new Response(obj.body, { status: 200, headers });
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
    // D643 — a sample from the development seed, never a real person.
    is_sample: isSampleExpert(e.uid),
    profile_completion_pct: Number(e.profile_completion_pct || 0),
    accepts_payments: !!(e.stripe_account_id && e.stripe_charges_enabled),
    rating_avg: opts.rating_avg ?? 0,
    rating_count: opts.rating_count ?? 0,
    match_score: opts.include_score ?? null,
    match_breakdown: opts.breakdown ?? null,
    services: opts.services ?? null,
  };
}

/**
 * D574 — each expert's ACTIVE services as a member sees them: what to book,
 * how long, and its price. Ids stay server-side; a booking names the uid.
 */
async function activeServices(env: Env, expertIds: number[]) {
  const out = new Map<number, Array<{ uid: string; title: string; description: string | null; duration_minutes: number; price_cents: number; currency: string }>>();
  const ids = [...new Set(expertIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return out;
  const rs = await env.DB.prepare(
    `SELECT expert_id, uid, title, description, duration_minutes, price_cents, currency
       FROM expert_services
      WHERE is_active = 1 AND expert_id IN (SELECT value FROM json_each(?))
      ORDER BY expert_id, sort_order ASC, id ASC`,
  ).bind(JSON.stringify(ids)).all<any>();
  for (const r of rs.results || []) {
    const list = out.get(Number(r.expert_id)) ?? [];
    list.push({
      uid: r.uid, title: r.title, description: r.description ?? null,
      duration_minutes: Number(r.duration_minutes), price_cents: Number(r.price_cents), currency: r.currency,
    });
    out.set(Number(r.expert_id), list);
  }
  return out;
}

/** D574 — the reader's own rating of an expert, or null when they have given none. */
async function myRating(env: Env, expertId: number, userId: number) {
  const r = await env.DB.prepare(
    'SELECT stars, review, created_at FROM expert_ratings WHERE expert_id = ? AND user_id = ?',
  ).bind(expertId, userId).first<{ stars: number; review: string | null; created_at: string }>();
  return r ? { stars: Number(r.stars), review: r.review ?? null, rated_at: r.created_at } : null;
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
      WHERE user_id = ? AND datetime(viewed_at) >= datetime(?)`,
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
    // and not admin-hidden. Admins see everything (review surface), samples
    // included and marked; D643 — a member is never shown or counted one.
    const isAdmin = role(user) === 'admin';
    const all = isAdmin
      ? await c.env.DB.prepare(`SELECT * FROM experts WHERE is_active = 1`).all<ExpertRow>()
      : await c.env.DB.prepare(
          `SELECT * FROM experts
             WHERE is_active = 1
               AND substr(uid, 1, ?) <> ?
               AND verified = 1
               AND COALESCE(hidden_by_admin, 0) = 0
               AND COALESCE(profile_completion_pct, 0) >= 70`,
        ).bind(SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX).all<ExpertRow>();
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

    const services = await activeServices(c.env, ranked.map((s) => s.expert.id));
    return c.json({
      matches: ranked.map((s) => serializeExpert(s.expert, {
        include_score: Math.round(s.score * 100) / 100,
        rating_avg: s.rating_avg, rating_count: s.rating_count,
        breakdown: s.breakdown,
        services: services.get(s.expert.id) ?? [],
      })),
      total_active: experts.length,
      filtered_count: filtered.length,
      view_budget: viewBudget,
    });
  } catch (e: any) {
    return unreadable(c, 'experts_unreadable', 'The expert directory could not be read. This is not a claim that no expert is listed.', e);
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
  // D643 — a sample is not an expert a member can open.
  if (role(user) !== 'admin' && isSampleExpert(expert.uid)) return c.json({ detail: 'Expert not found' }, 404);

  // Tier gate: free founders can view at most N distinct experts/month.
  if (role(user) === 'founder' && !userMeetsTier(user as TierUser, 'growth')) {
    // Has the user already viewed THIS expert this month? If so, allow.
    const monthStart = (() => {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    })();
    const seen = await c.env.DB.prepare(
      `SELECT 1 FROM expert_profile_views
        WHERE user_id = ? AND expert_id = ? AND datetime(viewed_at) >= datetime(?) LIMIT 1`,
    ).bind(user.id, expert.id, monthStart).first();
    if (!seen) {
      const used = await countMonthlyProfileViews(c.env, user.id);
      if (used >= FREE_TIER_PROFILE_VIEWS_PER_MONTH) {
        // À la carte escape hatch: an active feature unlock bypasses the tier
        // cap without requiring a Validate + Build subscription (additive — tier OR unlock).
        const unlocked = await hasFeatureUnlock(c.env, user.id, 'wellbeing_expert_views');
        if (!unlocked) {
          return c.json({
            error: 'tier_required',
            required: 'growth',
            message: `Free tier is capped at ${FREE_TIER_PROFILE_VIEWS_PER_MONTH} matched expert profile views per month. Upgrade to Validate + Build for unlimited matches.`,
            plan: tierUpsell('growth').plan,
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
  // D574 — the expert's active services, which a member books against, and
  // the reader's own rating, so a page can say what they gave after a reload.
  const services = await activeServices(c.env, [expert.id]);
  return c.json({
    ...serializeExpert(expert, {
      rating_avg: agg?.avg_stars ?? 0,
      rating_count: agg?.count ?? 0,
      services: services.get(expert.id) ?? [],
    }),
    my_rating: await myRating(c.env, expert.id, user.id),
  });
});

/** D574 — the expert's weekly grid, the windows the slots are cut from. */
async function loadAvailability(env: Env, expertId: number): Promise<AvailabilityWindow[]> {
  const rs = await env.DB.prepare(
    'SELECT day_of_week, start_minute, end_minute, timezone FROM expert_availability WHERE expert_id = ?',
  ).bind(expertId).all<AvailabilityWindow>();
  return (rs.results || []).map((w) => ({
    day_of_week: Number(w.day_of_week), start_minute: Number(w.start_minute),
    end_minute: Number(w.end_minute), timezone: w.timezone,
  }));
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

  // D574 — cut from the expert's weekly grid, each window in its own zone;
  // an expert with no grid keeps the default hours, and `source` says which.
  const offered = offeredSlots(await loadAvailability(c.env, expert.id));
  const slots = offered.slots.filter((s) => !takenSet.has(s));
  return c.json({ external: false, launch_url: null, slots, source: offered.source });
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
    // D643 — a sample cannot be booked; its booking link was made up.
    if (isSampleExpert(expert.uid)) return c.json({ detail: 'Expert not found' }, 404);
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

  // D574 — an internal booking must be a slot the grid offers (or, with no
  // grid, the default hours): the time is checked against the whole set, not
  // the listed page of it, so a member cannot book an hour the expert never
  // opened.
  if (usingInternal && scheduledAt) {
    const offered = offeredSlots(await loadAvailability(c.env, expert.id), new Date(), Infinity);
    if (!offered.slots.includes(scheduledAt)) {
      return refuse(c, 409, {
        code: 'slot_not_offered',
        message: 'That time is not one of the expert\'s open slots. Pick one from the list.',
        extra: { slots_endpoint: `/api/wellbeing/experts/${uid}/slots` },
      });
    }
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
  // D574 — the rating as stored, so the page shows what was kept.
  return c.json({ ok: true, my_rating: await myRating(c.env, expert.id, user.id) });
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
            u.name AS booker_name,
            s.uid AS service_uid, s.title AS service_title
       FROM expert_bookings b
       LEFT JOIN users u ON u.id = b.user_id
       LEFT JOIN expert_services s ON s.id = b.service_id
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
            e.uid AS expert_uid, e.name AS expert_name, e.photo_url AS expert_photo,
            s.uid AS service_uid, s.title AS service_title,
            r.stars AS my_stars
       FROM expert_bookings b
       JOIN experts e ON e.id = b.expert_id
       LEFT JOIN expert_services s ON s.id = b.service_id
       LEFT JOIN expert_ratings r ON r.expert_id = b.expert_id AND r.user_id = b.user_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 50`,
  ).bind(user.id).all<any>();
  return c.json({ bookings: rs.results || [] });
});

/**
 * D574 — a member cancels their own booking.
 *
 * Only the booker, only a booking still open (requested, scheduled, awaiting
 * payment or confirmed) and only before it starts. A PAID booking is refused
 * with `paid_booking`: its refund is the expert's to make through Stripe, so
 * cancelling here would leave the money taken and the session gone. The
 * update is conditioned on the status it read, so a cancel racing the expert's
 * own change cannot overwrite it. The expert is told, as when they cancel.
 */
const MEMBER_CANCELLABLE = ['requested', 'scheduled', 'pending_payment', 'confirmed'];
wellbeing.post('/bookings/:uid/cancel', async (c) => {
  const user = await requireAuth(c);
  await ensureWellbeingSchema(c.env);
  const booking = await c.env.DB.prepare(
    'SELECT id, status, payment_status, scheduled_at FROM expert_bookings WHERE uid = ? AND user_id = ?',
  ).bind(c.req.param('uid'), user.id).first<{ id: number; status: string; payment_status: string | null; scheduled_at: string | null }>();
  if (!booking) return refuse(c, 404, { code: 'booking_not_found', message: 'No booking of yours has that id.' });
  if (!MEMBER_CANCELLABLE.includes(booking.status)) {
    return refuse(c, 409, { code: 'booking_not_open', message: `This booking is ${booking.status}, so it cannot be cancelled.`, extra: { status: booking.status } });
  }
  if (booking.scheduled_at && Date.parse(booking.scheduled_at) <= Date.now()) {
    return refuse(c, 409, { code: 'booking_started', message: 'This session has already started, so it cannot be cancelled here.' });
  }
  if (booking.payment_status === 'paid') {
    return refuse(c, 409, { code: 'paid_booking', message: 'This session is paid for. Ask the expert to cancel it, so the payment is refunded with it.' });
  }
  const r = await c.env.DB.prepare(
    `UPDATE expert_bookings SET status = 'cancelled' WHERE id = ? AND status = ?`,
  ).bind(booking.id, booking.status).run();
  if (Number(r?.meta?.changes ?? 0) !== 1) {
    return refuse(c, 409, { code: 'booking_changed', message: 'This booking changed while you were cancelling it. Reload and try again.' });
  }
  await fanoutBookingNotifications(c.env, booking.id, 'cancelled');
  return c.json({ ok: true, status: 'cancelled' });
});

/**
 * D932 (#2716) — an admin's verify or hide, recorded so Admin · Community's
 * Recent activity can say "An admin verified a wellbeing expert". The row
 * carries the expert's uid for the governance feed and nothing that names
 * them. Best-effort, as every audit write here: the act has happened.
 */
async function auditExpert(env: Env, adminId: number, action: string, uid: string) {
  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json) VALUES (?, ?, 'wellbeing', ?)`,
    ).bind(adminId, action, JSON.stringify({ expert_uid: uid })).run();
  } catch (e) {
    console.warn('[wellbeing] audit write failed', action, (e as Error).message);
  }
}

// --- admin review-hide ---
wellbeing.post('/admin/experts/:uid/hide', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const hidden = body?.hidden ? 1 : 0;
  // D142 — `hidden: true` is a takedown (stays open on a suspended branch);
  // `hidden: false` restores the expert to the directory, which is the "put
  // something NEW under the brand" case FREEZE_RULE gates.
  if (!hidden) await requireBranchNotSuspended(c);
  const res = await c.env.DB.prepare(
    'UPDATE experts SET hidden_by_admin = ? WHERE uid = ?',
  ).bind(hidden, c.req.param('uid')).run();
  const changes = (res.meta as any)?.changes ?? 0;
  if (changes) await auditExpert(c.env, a.id, hidden ? 'expert_hidden' : 'expert_restored', c.req.param('uid'));
  return c.json({ ok: true, hidden: !!hidden, changes });
});

wellbeing.post('/admin/experts/:uid/verify', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  await ensureWellbeingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const verified = body?.verified ? 1 : 0;
  // D142 — verifying is what unlocks an expert's directory listing, so it is
  // the publish-shaped write; removing verification is a takedown and stays
  // open on a suspended branch.
  if (verified) await requireBranchNotSuspended(c);
  const res = await c.env.DB.prepare('UPDATE experts SET verified = ? WHERE uid = ?').bind(verified, c.req.param('uid')).run();
  if ((res.meta as any)?.changes) await auditExpert(c.env, a.id, verified ? 'expert_verified' : 'expert_unverified', c.req.param('uid'));
  return c.json({ ok: true, verified: !!verified });
});

// Expose schema bootstrap for tests / admin.
export { ensureWellbeingSchema };

// Suppress unused-warning for isValidCategoryKey export consumer in future routes.
void isValidCategoryKey;

export default wellbeing;
