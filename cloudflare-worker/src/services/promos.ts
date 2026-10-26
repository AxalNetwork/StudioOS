/**
 * Task #9 — Promo Code service.
 *
 * D1 mirror + validation/redemption logic for promo codes. Stripe Coupons +
 * Promotion Codes are the source of truth (created via /api/admin/promos); this
 * service mirrors them into `promo_codes` (migration 099) and owns the
 * out-of-band redemption accounting that Stripe can't do for embedded one-time
 * PaymentIntents.
 *
 * KEY FACTS that shape this module:
 *   - One-time PaymentIntents do NOT natively redeem coupons/promotion codes —
 *     coupons only apply to Invoice/Subscription/Checkout. So for embedded
 *     one-time purchases we recompute the discount from the mirrored catalog
 *     amount (NEVER trust the client) and track redemptions ourselves.
 *   - usage_limit is therefore enforced via `promo_redemptions` (UNIQUE on
 *     payment_intent_id) + a denormalized `times_redeemed` mirror counter that
 *     only bumps when a redemption row is genuinely inserted.
 *   - Subscription redemptions go through Stripe natively (discounts[0]
 *     [promotion_code]) and bump Stripe's own times_redeemed; validation sums
 *     the live Stripe counter + our mirror counter against max_redemptions.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { writeFeatureUnlock } from './featureUnlocks';
import { bindingKey } from '../util/schemaBootstrap';
import { likeNeedle } from '../util/likeSearch';

// Stripe rejects PaymentIntents below the per-currency minimum (~50 cents for
// USD). A discount that drops a one-time charge below this is treated as "free"
// where a fulfilment hook exists (à la carte) and rejected otherwise.
export const STRIPE_MIN_CHARGE_CENTS = 50;

export interface PromoRow {
  id: string;
  code: string;
  code_normalized: string;
  coupon_id: string;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  product_ids_json: string;
  max_redemptions: number | null;
  times_redeemed: number;
  active: number;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
  synced_at: string;
  // D1272 (#3298), migration 629. Absent on a row read before 629 reached the database.
  paused_at?: string | null;
  paused_by?: number | null;
  ended_at?: string | null;
  ended_by?: number | null;
  reason?: string | null;
  name?: string | null;
  note?: string | null;
  duration_in_months?: number | null;
  replaced_by?: string | null;
}

export interface PromoView {
  id: string;
  code: string;
  coupon_id: string;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  product_ids: string[];
  /** False when product_ids_json is not a JSON array of strings. [] is readable and means every product. */
  product_ids_readable: boolean;
  max_redemptions: number | null;
  times_redeemed: number;
  active: boolean;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
  /** D1272: the page's state, in `promoState`'s order with paused and ended first (`LIST_STATES`). */
  state: ListState;
  paused_at: string | null;
  paused_by: number | null;
  ended_at: string | null;
  ended_by: number | null;
  reason: string | null;
  name: string | null;
  note: string | null;
  /** The months a `repeating` coupon runs; null for once or forever, and for codes made before migration 629. */
  duration_in_months: number | null;
  replaced_by: string | null;
}

const SCHEMA_READY = new WeakMap<object, boolean>();

/** Idempotent schema bootstrap — mirrors migration 099_promo_codes.sql. */
export async function ensurePromoSchema(env: Env): Promise<void> {
  if (SCHEMA_READY.get(bindingKey(env))) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS promo_codes (' +
        'id TEXT PRIMARY KEY, ' +
        'code TEXT NOT NULL, ' +
        'code_normalized TEXT NOT NULL, ' +
        'coupon_id TEXT NOT NULL, ' +
        'percent_off REAL, ' +
        'amount_off INTEGER, ' +
        'currency TEXT, ' +
        "duration TEXT NOT NULL DEFAULT 'once', " +
        "product_ids_json TEXT NOT NULL DEFAULT '[]', " +
        'max_redemptions INTEGER, ' +
        'times_redeemed INTEGER NOT NULL DEFAULT 0, ' +
        'active INTEGER NOT NULL DEFAULT 1, ' +
        'expires_at TEXT, ' +
        'created_by INTEGER, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        "synced_at TEXT NOT NULL DEFAULT (datetime('now'))" +
        ')',
    );
    // D1272 (#3298) — migration 629's columns. On a database that has 629 these
    // fail as duplicates, and each failure is left alone.
    for (const col of [
      'paused_at TEXT', 'paused_by INTEGER', 'ended_at TEXT', 'ended_by INTEGER', 'reason TEXT',
      'name TEXT', 'note TEXT', 'duration_in_months INTEGER', 'replaced_by TEXT',
    ]) {
      try { await env.DB.exec(`ALTER TABLE promo_codes ADD COLUMN ${col}`); } catch { /* already there */ }
    }
    await env.DB.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_normalized ON promo_codes(code_normalized)',
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(active)');
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS promo_redemptions (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'promo_id TEXT NOT NULL, ' +
        'user_id INTEGER NOT NULL, ' +
        'payment_intent_id TEXT NOT NULL, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
        ')',
    );
    await env.DB.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_pi ON promo_redemptions(payment_intent_id)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON promo_redemptions(promo_id)',
    );
    SCHEMA_READY.set(bindingKey(env), true);
  } catch (e) {
    console.warn('[promos] ensurePromoSchema failed:', (e as Error).message);
  }
}

/** Normalize a code for case-insensitive lookup + uniqueness. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * The one reading of a product allow-list.
 *
 * A JSON array of strings is readable. `[]` is readable and means every
 * product (migration 099). Anything else — bad JSON, an object, a number,
 * a mixed array — is not a list, and it is not "every product".
 */
export function readProductIds(json: string): { ok: true; ids: string[] } | { ok: false } {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return { ok: false };
  return { ok: true, ids: v };
}

export function rowToView(row: PromoRow, nowMs: number = Date.now()): PromoView {
  const products = readProductIds(row.product_ids_json);
  return {
    id: row.id,
    code: row.code,
    coupon_id: row.coupon_id,
    percent_off: row.percent_off,
    amount_off: row.amount_off,
    currency: row.currency,
    duration: row.duration,
    product_ids: products.ok ? products.ids : [],
    product_ids_readable: products.ok,
    max_redemptions: row.max_redemptions,
    times_redeemed: row.times_redeemed,
    active: row.active === 1,
    expires_at: row.expires_at,
    created_by: row.created_by,
    created_at: row.created_at,
    state: listState(row, nowMs),
    paused_at: row.paused_at ?? null,
    paused_by: row.paused_by ?? null,
    ended_at: row.ended_at ?? null,
    ended_by: row.ended_by ?? null,
    reason: row.reason ?? null,
    name: row.name ?? null,
    note: row.note ?? null,
    duration_in_months: row.duration_in_months ?? null,
    replaced_by: row.replaced_by ?? null,
  };
}

/** Upsert a promo into the mirror (Stripe remains the source of truth). */
export async function mirrorPromo(
  env: Env,
  p: {
    id: string;
    code: string;
    coupon_id: string;
    percent_off: number | null;
    amount_off: number | null;
    currency: string | null;
    duration: string;
    product_ids: string[];
    max_redemptions: number | null;
    times_redeemed?: number;
    active: boolean;
    expires_at: string | null;
    created_by: number | null;
    /** D1272: stored on create; Stripe keeps them on the promotion code's metadata too. */
    name?: string | null;
    note?: string | null;
    duration_in_months?: number | null;
  },
): Promise<void> {
  await ensurePromoSchema(env);
  await env.DB.prepare(
    `INSERT INTO promo_codes
       (id, code, code_normalized, coupon_id, percent_off, amount_off, currency,
        duration, product_ids_json, max_redemptions, times_redeemed, active,
        expires_at, created_by, name, note, duration_in_months, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       code = excluded.code,
       code_normalized = excluded.code_normalized,
       coupon_id = excluded.coupon_id,
       percent_off = excluded.percent_off,
       amount_off = excluded.amount_off,
       currency = excluded.currency,
       duration = excluded.duration,
       product_ids_json = excluded.product_ids_json,
       max_redemptions = excluded.max_redemptions,
       active = excluded.active,
       expires_at = excluded.expires_at,
       name = excluded.name,
       note = excluded.note,
       duration_in_months = excluded.duration_in_months,
       synced_at = datetime('now')`,
  )
    .bind(
      p.id,
      p.code,
      normalizeCode(p.code),
      p.coupon_id,
      p.percent_off,
      p.amount_off,
      p.currency,
      p.duration,
      JSON.stringify(p.product_ids),
      p.max_redemptions,
      p.times_redeemed ?? 0,
      p.active ? 1 : 0,
      p.expires_at,
      p.created_by,
      p.name ?? null,
      p.note ?? null,
      p.duration_in_months ?? null,
    )
    .run();
}

export async function listPromos(env: Env): Promise<PromoView[]> {
  await ensurePromoSchema(env);
  const res = await env.DB.prepare(
    'SELECT * FROM promo_codes ORDER BY created_at DESC',
  ).all<PromoRow>();
  return (res.results ?? []).map((r) => rowToView(r));
}

export async function getPromoById(env: Env, id: string): Promise<PromoRow | null> {
  await ensurePromoSchema(env);
  return env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first<PromoRow>();
}

export async function getPromoByCode(env: Env, code: string): Promise<PromoRow | null> {
  await ensurePromoSchema(env);
  return env.DB
    .prepare('SELECT * FROM promo_codes WHERE code_normalized = ?')
    .bind(normalizeCode(code))
    .first<PromoRow>();
}

/**
 * D213 — THE ONE DEFINITION OF EXPIRED, read by checkout, by HQ · Platform and
 * by Revenue's count. Before it, checkout checked expiry inline and Revenue
 * counted every `active = 1` code as "redeemable now", expired ones included.
 *
 * `expires_at` is written as an ISO string by `routes/admin_promos.ts`. A
 * SQL-format stamp (`YYYY-MM-DD HH:MM:SS`) is read as UTC rather than left to
 * the runtime's local zone. An expiry that does not parse is not treated as
 * expired — checkout's behaviour before this helper, kept rather than changed.
 */
export function promoExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const raw = String(expiresAt).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

export type PromoState = 'inactive' | 'expired' | 'exhausted' | 'active';

/**
 * A code's one state, checked in this order: switched off, then past its
 * expiry, then at its cap, then active.
 *
 * `redeemed` IS THE CALLER'S COUNT AND THE CALLER SAYS WHICH. Checkout adds
 * Stripe's live counter to the mirror's (`totalRedeemed`); a page load may not
 * call Stripe, so HQ passes the mirror's `times_redeemed` alone — a lower bound,
 * because subscription redemptions are counted by Stripe and not mirrored. So
 * `exhausted` is claimed only when the mirror alone reaches the cap, which is
 * sound: a code the mirror calls exhausted is exhausted. `>=`, as checkout
 * refuses at the cap.
 */
export function promoState(
  row: { active: number | boolean; expires_at: string | null; max_redemptions: number | null },
  redeemed: number,
  nowMs: number,
): PromoState {
  if (!(row.active === 1 || row.active === true)) return 'inactive';
  if (promoExpired(row.expires_at, nowMs)) return 'expired';
  if (row.max_redemptions != null && redeemed >= row.max_redemptions) return 'exhausted';
  return 'active';
}

// ───────────────────────────────────────────────────────────────────────────
// D1272 (#3298) — the list read, and paused, resumed and ended recorded
// ───────────────────────────────────────────────────────────────────────────

/**
 * The page's states (D1270's `promoModel.js` `STATE_WORD`): ended and paused
 * are recorded facts and come first; then `promoState`'s order with its words
 * as the page says them: switched off (`inactive`), expired, at its cap
 * (`exhausted`), active. A code switched off before migration 629, with
 * neither fact recorded, is `off`.
 */
export const LIST_STATES = ['active', 'paused', 'ended', 'expired', 'at_cap', 'off'] as const;
export type ListState = (typeof LIST_STATES)[number];
const STATE_OF: Record<PromoState, ListState> = { inactive: 'off', expired: 'expired', exhausted: 'at_cap', active: 'active' };

/** One row's state, as `LIST_SQL` computes it; the mirror's count is the lower bound HQ reads (see `promoState`). */
export function listState(row: Pick<PromoRow, 'active' | 'expires_at' | 'max_redemptions' | 'times_redeemed' | 'paused_at' | 'ended_at'>, nowMs: number): ListState {
  if (row.ended_at) return 'ended';
  if (row.paused_at) return 'paused';
  return STATE_OF[promoState(row, Number(row.times_redeemed) || 0, nowMs)];
}

export const LIST_SORTS = ['newest', 'oldest', 'code', 'redeemed'] as const;
export const LIST_APPLIES = ['all', 'products', 'plans'] as const;
export const LIST_PAGE_SIZE = 25;
export const LIST_PAGE_MAX = 100;
export const NAME_MAX = 80;
export const NOTE_MAX = 500;
export const REASON_MAX = 280;

/** A refusal of a list query or a write: a code, a sentence and a status. */
export class PromoInputError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;
  constructor(code: string, sentence: string, status: 400 | 404 | 409 = 400) {
    super(sentence);
    this.code = code; this.status = status;
  }
}

/**
 * The state in SQL, the same order as `listState`. Expiry compares as a time
 * (`julianday`), so an ISO stamp and a SQL stamp read alike; one that does not
 * parse is not expired, as `promoExpired` says.
 */
const STATE_SQL = `CASE
    WHEN ended_at IS NOT NULL THEN 'ended'
    WHEN paused_at IS NOT NULL THEN 'paused'
    WHEN active <> 1 THEN 'off'
    WHEN expires_at IS NOT NULL AND julianday(expires_at) <= julianday(?) THEN 'expired'
    WHEN max_redemptions IS NOT NULL AND times_redeemed >= max_redemptions THEN 'at_cap'
    ELSE 'active' END`;
const LIST_FROM = `FROM (SELECT p.*, ${STATE_SQL} AS list_state FROM promo_codes p) x
  WHERE (? IS NULL OR x.code_normalized LIKE ? ESCAPE '\\' OR x.name LIKE ? ESCAPE '\\')
    AND (? IS NULL OR (? = 'all' AND x.product_ids_json = '[]') OR (? = 'products' AND x.product_ids_json <> '[]'))`;
const LIST_WHERE_STATE = `AND (? IS NULL OR x.list_state = ?)`;
// Every order ends on the id, so a page never shifts between two reads of the same rows.
const LIST_ORDER: Record<(typeof LIST_SORTS)[number], string> = {
  newest: 'ORDER BY x.created_at DESC, x.id DESC',
  oldest: 'ORDER BY x.created_at ASC, x.id ASC',
  code: 'ORDER BY x.code_normalized ASC, x.id ASC',
  redeemed: 'ORDER BY x.times_redeemed DESC, x.id ASC',
};

export type ListQuery = { q?: unknown; state?: unknown; applies?: unknown; sort?: unknown; page?: unknown; page_size?: unknown };

/**
 * `GET /api/admin/promos`: one page of codes, filtered and sorted, with the
 * total the filters keep and a count per state under the other filters (so
 * the page's chips add up). Every value is bound; the statement text changes
 * only with the sort, picked from `LIST_ORDER`.
 */
export async function listPromoPage(env: Env, query: ListQuery = {}, nowMs: number = Date.now()) {
  const str = (v: unknown) => (v == null ? '' : String(v).trim());
  const page = str(query.page) ? Number(query.page) : 1;
  const size = str(query.page_size) ? Number(query.page_size) : LIST_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1) throw new PromoInputError('invalid_page', 'page is a whole number from 1.');
  if (!Number.isSafeInteger(size) || size < 1 || size > LIST_PAGE_MAX) throw new PromoInputError('invalid_page_size', `page_size is a whole number from 1 to ${LIST_PAGE_MAX}.`);
  const state = str(query.state) || null;
  if (state && !(LIST_STATES as readonly string[]).includes(state)) throw new PromoInputError('invalid_state', `state is one of: ${LIST_STATES.join(', ')}.`);
  const applies = str(query.applies) || null;
  if (applies && !(LIST_APPLIES as readonly string[]).includes(applies)) throw new PromoInputError('invalid_applies', `applies is one of: ${LIST_APPLIES.join(', ')}.`);
  // Plan and interval scope is part 3's (migration 630): nothing records it yet, so no list can be filtered by it.
  if (applies === 'plans') throw new PromoInputError('applies_not_recorded', 'Plan scope is not recorded yet, so codes cannot be filtered by it. That is not a claim that none applies to plans.');
  const sort = (str(query.sort) || 'newest') as (typeof LIST_SORTS)[number];
  if (!(LIST_SORTS as readonly string[]).includes(sort)) throw new PromoInputError('invalid_sort', `sort is one of: ${LIST_SORTS.join(', ')}.`);
  const rawQ = str(query.q);
  const needle = rawQ ? likeNeedle(rawQ.toUpperCase()) : null;
  if (rawQ && !needle) throw new PromoInputError('invalid_q', 'Search with at least two characters.');
  const nameNeedle = rawQ ? likeNeedle(rawQ) : null;

  await ensurePromoSchema(env);
  const now = new Date(nowMs).toISOString();
  const base = [now, needle, needle, nameNeedle, applies, applies, applies];
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n ${LIST_FROM} ${LIST_WHERE_STATE}`)
    .bind(...base, state, state).first<{ n: number }>();
  const rows = await env.DB.prepare(`SELECT x.* ${LIST_FROM} ${LIST_WHERE_STATE} ${LIST_ORDER[sort]} LIMIT ? OFFSET ?`)
    .bind(...base, state, state, size, (page - 1) * size).all<PromoRow>();
  const byState = await env.DB.prepare(`SELECT x.list_state AS state, COUNT(*) AS n ${LIST_FROM} GROUP BY x.list_state`)
    .bind(...base).all<{ state: string; n: number }>();
  const counts = Object.fromEntries(LIST_STATES.map((st) => [st, Number((byState.results ?? []).find((r) => r.state === st)?.n ?? 0)]));
  return {
    promos: (rows.results ?? []).map((r) => rowToView(r, nowMs)),
    total: Number(total?.n ?? 0), page, page_size: size, sort, counts,
  };
}

/** A reason as stored: one line, bounded; required where `need` says so. */
export function readReason(raw: unknown, need: boolean): string | null {
  const v = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!v) {
    if (need) throw new PromoInputError('reason_required', 'Give the reason. It is recorded with the change.');
    return null;
  }
  if (v.length > REASON_MAX) throw new PromoInputError('invalid_reason', `The reason is at most ${REASON_MAX} characters.`);
  return v;
}

/** Name and note as stored: trimmed, bounded, an empty string clears. `undefined` is "not sent". */
export function readNameNote(body: Record<string, unknown>): { name?: string | null; note?: string | null } {
  const out: { name?: string | null; note?: string | null } = {};
  for (const [k, max] of [['name', NAME_MAX], ['note', NOTE_MAX]] as const) {
    if (!(k in body)) continue;
    const raw = body[k];
    if (raw !== null && typeof raw !== 'string') throw new PromoInputError(`invalid_${k}`, `${k} is text, or null to clear it.`);
    const v = typeof raw === 'string' ? (k === 'name' ? raw.replace(/\s+/g, ' ') : raw).trim() : '';
    if (v.length > max) throw new PromoInputError(`invalid_${k}`, `The ${k} is at most ${max} characters.`);
    out[k] = v || null;
  }
  return out;
}

/** Pause: switched off in Stripe and here, with who, when and why. Guarded on not ended and not already paused. */
export async function markPaused(env: Env, id: string, by: number, reason: string | null): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE promo_codes SET active = 0, paused_at = datetime('now'), paused_by = ?, reason = ?, synced_at = datetime('now')
      WHERE id = ? AND ended_at IS NULL AND paused_at IS NULL`,
  ).bind(by, reason, id).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

/** Resume: the pause cleared and the code on again. An ended code is never resumed (the WHERE). */
export async function markResumed(env: Env, id: string, reason: string | null): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE promo_codes SET active = 1, paused_at = NULL, paused_by = NULL, reason = ?, synced_at = datetime('now')
      WHERE id = ? AND ended_at IS NULL`,
  ).bind(reason, id).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

/** End: off for good, with who, when and why, and what replaced it. Guarded on not already ended. */
export async function markEnded(env: Env, id: string, by: number, reason: string | null, replacedBy: string | null = null): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE promo_codes SET active = 0, ended_at = datetime('now'), ended_by = ?, reason = ?, replaced_by = ?, synced_at = datetime('now')
      WHERE id = ? AND ended_at IS NULL`,
  ).bind(by, reason, replacedBy, id).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

/** Name and note on the mirror; only the fields sent change. */
export async function setNameNote(env: Env, id: string, fields: { name?: string | null; note?: string | null }): Promise<void> {
  const has = (k: 'name' | 'note') => (k in fields ? 1 : 0);
  await env.DB.prepare(
    `UPDATE promo_codes SET name = CASE WHEN ? THEN ? ELSE name END, note = CASE WHEN ? THEN ? ELSE note END, synced_at = datetime('now')
      WHERE id = ?`,
  ).bind(has('name'), fields.name ?? null, has('note'), fields.note ?? null, id).run();
}

/** Reflect an active toggle into the mirror. */
export async function setPromoActiveMirror(env: Env, id: string, active: boolean): Promise<void> {
  await ensurePromoSchema(env);
  await env.DB.prepare(
    "UPDATE promo_codes SET active = ?, synced_at = datetime('now') WHERE id = ?",
  )
    .bind(active ? 1 : 0, id)
    .run();
}

/**
 * Compute the discounted total (minor units) for a base amount under a promo.
 * percent_off rounds to the nearest cent; amount_off is capped at the base so
 * the total never goes negative. Returns both the new total and the saved
 * amount for UI display.
 */
export function computeDiscount(
  promo: Pick<PromoRow, 'percent_off' | 'amount_off'>,
  amountCents: number,
): { discountedAmount: number; discountCents: number } {
  let discount = 0;
  if (promo.percent_off != null) {
    discount = Math.round((amountCents * promo.percent_off) / 100);
  } else if (promo.amount_off != null) {
    discount = Math.min(promo.amount_off, amountCents);
  }
  discount = Math.max(0, Math.min(discount, amountCents));
  return { discountedAmount: amountCents - discount, discountCents: discount };
}

export type PromoRejectReason =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'product_not_eligible'
  | 'product_list_unreadable'
  | 'usage_limit_reached'
  | 'currency_mismatch';

export interface PromoValidation {
  ok: boolean;
  reason?: PromoRejectReason;
  promo?: PromoRow;
  discountedAmount?: number;
  discountCents?: number;
  /** True when the discounted total is 0 or below Stripe's chargeable minimum. */
  free?: boolean;
}

/**
 * Live redemption count = Stripe's native counter (subscription/checkout
 * redemptions) + our out-of-band mirror counter (embedded one-time + free
 * grants). Best-effort: if the live fetch fails, fall back to the mirror.
 */
async function totalRedeemed(env: Env, promo: PromoRow): Promise<number> {
  let stripeCount = 0;
  try {
    const pc = await stripeCall<{ times_redeemed?: number }>(
      env,
      `/promotion_codes/${promo.id}`,
      {},
      { method: 'GET' },
    );
    stripeCount = Number(pc.times_redeemed) || 0;
  } catch {
    /* live fetch failed → mirror-only count */
  }
  return stripeCount + promo.times_redeemed;
}

/**
 * Validate a code for a specific product + base amount. Recomputes the discount
 * server-side (never trusts a client-supplied amount). Returns the rejection
 * reason on failure so the UI can render a precise message.
 */
export async function validatePromoForProduct(
  env: Env,
  code: string,
  productId: string,
  amountCents: number,
  currency?: string,
): Promise<PromoValidation> {
  const promo = await getPromoByCode(env, code);
  if (!promo) return { ok: false, reason: 'not_found' };
  if (promo.active !== 1) return { ok: false, reason: 'inactive' };
  if (promoExpired(promo.expires_at, Date.now())) {
    return { ok: false, reason: 'expired' };
  }
  // amount_off coupons are currency-scoped; a USD coupon can't discount a EUR
  // price. percent_off is currency-agnostic.
  if (
    promo.amount_off != null &&
    promo.currency &&
    currency &&
    promo.currency.toLowerCase() !== currency.toLowerCase()
  ) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  const allow = readProductIds(promo.product_ids_json);
  if (!allow.ok) return { ok: false, reason: 'product_list_unreadable' };
  if (allow.ids.length > 0 && !allow.ids.includes(productId)) {
    return { ok: false, reason: 'product_not_eligible' };
  }
  // D755 §5: a token pack is never discounted.
  const { isTokenPackProduct } = await import('./aiCredits');
  if (await isTokenPackProduct(env, productId)) return { ok: false, reason: 'product_not_eligible' };
  if (promo.max_redemptions != null) {
    const used = await totalRedeemed(env, promo);
    if (used >= promo.max_redemptions) return { ok: false, reason: 'usage_limit_reached' };
  }
  const { discountedAmount, discountCents } = computeDiscount(promo, amountCents);
  return {
    ok: true,
    promo,
    discountedAmount,
    discountCents,
    free: discountedAmount <= 0 || discountedAmount < STRIPE_MIN_CHARGE_CENTS,
  };
}

/**
 * Free (100%-off / sub-minimum) fulfilment for an à la carte unlock — there's
 * no PaymentIntent to charge, so we grant access directly. Idempotent per user
 * via the synthetic redemption id; enforces the global usage cap atomically.
 * Returns false (without granting) when the usage limit is already reached.
 */
export async function fulfilFreeUnlock(
  env: Env,
  args: {
    promo: PromoRow;
    userId: number;
    featureKey: string;
    unlockDays?: number | null;
  },
): Promise<boolean> {
  await ensurePromoSchema(env);
  const syntheticPi = `promo:${args.promo.id}:${args.userId}`;
  // Reserve this user's slot. INSERT OR IGNORE is the idempotency anchor:
  // a re-entry (changes=0) means the user already redeemed — re-ensure the
  // unlock without double-counting.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, payment_intent_id)
     VALUES (?, ?, ?)`,
  )
    .bind(args.promo.id, args.userId, syntheticPi)
    .run();
  const inserted = (ins.meta?.changes ?? 0) === 1;
  if (inserted && args.promo.max_redemptions != null) {
    // Atomic global cap: only succeeds while under the limit.
    const upd = await env.DB.prepare(
      `UPDATE promo_codes SET times_redeemed = times_redeemed + 1
        WHERE id = ? AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)`,
    )
      .bind(args.promo.id)
      .run();
    if ((upd.meta?.changes ?? 0) !== 1) {
      // Limit hit between validate and reserve — roll back the slot.
      await env.DB.prepare('DELETE FROM promo_redemptions WHERE payment_intent_id = ?')
        .bind(syntheticPi)
        .run();
      return false;
    }
  } else if (inserted) {
    // Unlimited promo — still keep the mirror counter meaningful.
    await env.DB.prepare(
      'UPDATE promo_codes SET times_redeemed = times_redeemed + 1 WHERE id = ?',
    )
      .bind(args.promo.id)
      .run();
  }
  await writeFeatureUnlock(env, {
    userId: args.userId,
    featureKey: args.featureKey,
    paymentIntentId: syntheticPi,
    unlockDays: args.unlockDays ?? null,
  });
  return true;
}

/**
 * Record a paid redemption from the billing webhook. Idempotent on the
 * PaymentIntent id; bumps the mirror counter only when a row is genuinely
 * inserted (so re-delivered webhooks don't over-count).
 */
export async function recordPaidRedemption(
  env: Env,
  args: { promoId: string; userId: number; paymentIntentId: string },
): Promise<void> {
  await ensurePromoSchema(env);
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, payment_intent_id)
     VALUES (?, ?, ?)`,
  )
    .bind(args.promoId, args.userId, args.paymentIntentId)
    .run();
  if ((ins.meta?.changes ?? 0) === 1) {
    await env.DB.prepare(
      'UPDATE promo_codes SET times_redeemed = times_redeemed + 1 WHERE id = ?',
    )
      .bind(args.promoId)
      .run();
  }
}
