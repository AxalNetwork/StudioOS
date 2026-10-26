/**
 * D1274 (#3300) — Promo codes part 4: what HQ reads about redemptions.
 *
 *   · `recordInvoiceRedemption` — the billing webhook's record of a
 *     subscription's redemption, from its first paid invoice;
 *   · `usageRead` — the Usage tab (PRM7): redemptions per week by source,
 *     the discount given per currency, top codes, plans and products, and
 *     codes near their end;
 *   · `codeRedemptions` — one code's redemptions (PRM2b), with Stripe's own
 *     count beside the list;
 *   · `codeHistory` — one code's create, pause and end, from `admin_audit_log`;
 *   · `exportRows` — the CSV export's rows.
 *
 * NEVER A ZERO FOR A MISSING VALUE. Every block carries `available` and a
 * `reason`: `unreadable` (its query failed), `no_redemptions` (the range has
 * none, so there is nothing to divide or rank) or `not_recorded` (there are
 * redemptions, but none made since migration 631 carries the detail). A
 * redemption made before 631 has no source, product or amount and is counted
 * as `not_recorded`, never as 0 or as a guessed source.
 *
 * Every statement is bound. Nothing here logs a code, an id or an amount.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { ensureCatalogSchema } from './catalog';
import {
  ensurePromoSchema,
  getPromoById,
  promoExpired,
  promoState,
  recordSubscriptionRedemption,
  REDEMPTION_SOURCES,
} from './promos';

const SUB_RE = /^sub_[A-Za-z0-9]{1,255}$/;
const PROMO_RE = /^promo_[A-Za-z0-9]{1,255}$/;

/** A Stripe reference that is either the id or the expanded object. */
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;

type Obj = Record<string, any>;

/** What the first invoice took off, from Stripe's own discount lines. */
function invoiceDiscount(inv: Obj): number | null {
  const lines = inv.total_discount_amounts;
  if (!Array.isArray(lines)) return null;
  let sum = 0;
  for (const l of lines) {
    if (!Number.isSafeInteger(l?.amount) || l.amount < 0) return null;
    sum += l.amount;
  }
  return sum;
}

/**
 * D1274: the billing webhook's `invoice.paid` hands every paid invoice here.
 * Only a subscription's first invoice (`billing_reason: subscription_create`)
 * that took a discount is a redemption. Its code is the subscription's
 * `promo_code_id`, stamped at checkout (`routes/payments.ts`); the invoice
 * carries the subscription's metadata on current API versions, and the
 * subscription is read from Stripe when it does not.
 *
 * Never fails the webhook: the invoice's other work (alerts, receipts) must
 * not wait on a usage record, and Stripe's own `times_redeemed` still counts
 * the redemption if this one is lost.
 */
export async function recordInvoiceRedemption(env: Env, inv: Obj): Promise<void> {
  try {
    if (inv?.billing_reason !== 'subscription_create') return;
    const discount = invoiceDiscount(inv);
    if (!discount && !inv.discount && !(Array.isArray(inv.discounts) && inv.discounts.length)) return;
    const parentSub = inv.parent?.subscription_details;
    const subId = idOf(inv.subscription) ?? idOf(parentSub?.subscription);
    if (!subId || !SUB_RE.test(subId)) return;
    let md: Obj | null =
      inv.subscription_details?.metadata ?? parentSub?.metadata
      ?? (inv.subscription && typeof inv.subscription === 'object' ? inv.subscription.metadata : null);
    if (!md?.promo_code_id) {
      const sub = await stripeCall<{ metadata?: Obj }>(env, `/subscriptions/${subId}`, {}, { method: 'GET' });
      md = sub.metadata ?? null;
    }
    const promoId = typeof md?.promo_code_id === 'string' ? md.promo_code_id.trim() : '';
    const userId = Number(md?.user_id);
    if (!PROMO_RE.test(promoId) || !Number.isSafeInteger(userId) || userId <= 0) return;
    if (!(await getPromoById(env, promoId))) return;
    const line = Array.isArray(inv.lines?.data) ? inv.lines.data[0] : null;
    const price = line?.price && typeof line.price === 'object' ? line.price : null;
    const details = line?.pricing?.price_details;
    await recordSubscriptionRedemption(env, {
      promoId,
      userId,
      subscriptionId: subId,
      detail: {
        productId: idOf(price?.product) ?? idOf(details?.product),
        priceId: idOf(price) ?? idOf(details?.price),
        interval: price?.recurring?.interval ?? null,
        amountBeforeCents: Number.isSafeInteger(inv.subtotal) ? inv.subtotal : null,
        discountCents: discount,
        currency: typeof inv.currency === 'string' ? inv.currency : null,
      },
    });
  } catch {
    console.warn('[promos] subscription redemption not recorded');
  }
}

// ---------------------------------------------------------------------------
// The range every read and the export take.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
export const DEFAULT_DAYS = 84; // twelve weeks, the Usage tab's default
export const MAX_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface UsageRange {
  from: string;
  to: string;
  promoId: string | null;
}

/** `from` and `to` are whole UTC days, both included. A bad or too-long range is refused, never clamped. */
export function parseRange(q: { from?: string; to?: string; promo?: string }, now = new Date()):
  { ok: true; range: UsageRange } | { ok: false; code: 'invalid_range' | 'invalid_promo' } {
  const day = (s: string) => (DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null);
  const today = now.toISOString().slice(0, 10);
  const to = q.to ? day(q.to) : today;
  const from = q.from ? day(q.from) : to && new Date(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  if (!from || !to || from > to) return { ok: false, code: 'invalid_range' };
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1 > MAX_DAYS) return { ok: false, code: 'invalid_range' };
  const promo = q.promo?.trim() || null;
  if (promo && !PROMO_RE.test(promo)) return { ok: false, code: 'invalid_promo' };
  return { ok: true, range: { from, to, promoId: promo } };
}

/** The bound values of the range predicate, in its order. */
const rangeBinds = (r: UsageRange) => [`${r.from} 00:00:00`, nextDay(r.to), r.promoId, r.promoId];
const nextDay = (d: string) => `${new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)} 00:00:00`;
// Every ranged query writes its predicate out in full, in this order:
//   r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?)
// (a literal, so the statement is read by the schema guard, never spliced).

/** Monday of a day's ISO week, as SQLite's `date(x, '-6 days', 'weekday 1')` gives it. */
export function weekOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday 0
  return new Date(t - dow * DAY_MS).toISOString().slice(0, 10);
}

const unreadable = { available: false as const, reason: 'unreadable' as const };

/** One block: what `fn` reads, or `unreadable` when its query fails. Every block's shape is `{ available, reason, ... }`. */
async function block<R extends { available: boolean; reason: string | null }>(fn: () => Promise<R>): Promise<R | typeof unreadable> {
  try {
    return await fn();
  } catch {
    console.warn('[promos] a usage block could not be read');
    return unreadable;
  }
}

const NEAR_END_DAYS = 14;

/** The Usage tab's five blocks. One failed block never blanks the others. */
export async function usageRead(env: Env, range: UsageRange, now = new Date()) {
  await ensurePromoSchema(env);
  const binds = rangeBinds(range);

  // The total is read once; the derived blocks say `no_redemptions` from it.
  let total: number | null = null;
  const redemptions = await block(async () => {
    const t = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT r.user_id) AS members FROM promo_redemptions r WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?)`,
    ).bind(...binds).first<{ n: number; members: number }>();
    const rows = await env.DB.prepare(
      `SELECT date(r.created_at, '-6 days', 'weekday 1') AS week, r.source AS source, COUNT(*) AS n
         FROM promo_redemptions r WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?)
        GROUP BY week, r.source`,
    ).bind(...binds).all<{ week: string; source: string | null; n: number }>();
    const since = await env.DB.prepare(
      'SELECT MIN(created_at) AS at FROM promo_redemptions WHERE source IS NOT NULL',
    ).first<{ at: string | null }>();
    total = Number(t?.n ?? 0);
    // Every week of the range is listed, so a week with none is a measured 0.
    const weeks = new Map<string, Record<string, number>>();
    for (let w = weekOf(range.from); w <= range.to; w = new Date(Date.parse(`${w}T00:00:00Z`) + 7 * DAY_MS).toISOString().slice(0, 10)) {
      weeks.set(w, Object.fromEntries([...REDEMPTION_SOURCES, 'not_recorded'].map((s) => [s, 0])));
    }
    for (const row of rows.results ?? []) {
      const w = weeks.get(row.week);
      if (!w) continue;
      const key = row.source && (REDEMPTION_SOURCES as readonly string[]).includes(row.source) ? row.source : 'not_recorded';
      w[key] += Number(row.n);
    }
    return {
      available: true as const,
      reason: null,
      total,
      members: Number(t?.members ?? 0),
      weeks: [...weeks].map(([week, n]) => ({ week, ...n })),
      // Before this, no redemption has a source; the page says so.
      detail_recorded_from: since?.at ?? null,
    };
  });

  const discount = await block(async () => {
    if (total === null) return unreadable;
    if (total === 0) return { available: false as const, reason: 'no_redemptions' as const };
    const rows = await env.DB.prepare(
      `SELECT r.currency AS currency, COUNT(*) AS n, SUM(r.discount_cents) AS cents
         FROM promo_redemptions r
        WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?) AND r.discount_cents IS NOT NULL AND r.currency IS NOT NULL
        GROUP BY r.currency ORDER BY cents DESC`,
    ).bind(...binds).all<{ currency: string; n: number; cents: number }>();
    const list = rows.results ?? [];
    if (!list.length) return { available: false as const, reason: 'not_recorded' as const };
    const recorded = list.reduce((s, r) => s + Number(r.n), 0);
    return {
      available: true as const,
      reason: null,
      // Each currency on its own: amounts in two currencies are never added.
      currencies: list.map((r) => ({
        currency: r.currency,
        redemptions: Number(r.n),
        discount_cents: Number(r.cents),
        average_cents: Math.round(Number(r.cents) / Number(r.n)),
      })),
      not_recorded: total - recorded,
    };
  });

  const topCodes = await block(async () => {
    if (total === null) return unreadable;
    if (total === 0) return { available: false as const, reason: 'no_redemptions' as const };
    const rows = await env.DB.prepare(
      `SELECT r.promo_id AS promo_id, p.code AS code, p.max_redemptions AS max_redemptions,
              p.times_redeemed AS times_redeemed, COUNT(*) AS n
         FROM promo_redemptions r LEFT JOIN promo_codes p ON p.id = r.promo_id
        WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?)
        GROUP BY r.promo_id ORDER BY n DESC, r.promo_id LIMIT 10`,
    ).bind(...binds).all<{ promo_id: string; code: string | null; max_redemptions: number | null; times_redeemed: number | null; n: number }>();
    return {
      available: true as const,
      reason: null,
      codes: (rows.results ?? []).map((r) => ({
        promo_id: r.promo_id,
        code: r.code,
        redeemed: Number(r.n),
        max_redemptions: r.max_redemptions,
        // The mirror's count: a lower bound, because Stripe counts subscriptions itself.
        mirror_redeemed: r.times_redeemed,
      })),
    };
  });

  const products = await block(async () => {
    if (total === null) return unreadable;
    if (total === 0) return { available: false as const, reason: 'no_redemptions' as const };
    await ensureCatalogSchema(env);
    const rows = await env.DB.prepare(
      `SELECT r.product_id AS product_id, r.price_id AS price_id, r.billing_interval AS interval,
              sp.name AS name, COUNT(*) AS n
         FROM promo_redemptions r LEFT JOIN stripe_products sp ON sp.id = r.product_id
        WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?) AND r.product_id IS NOT NULL
        GROUP BY r.product_id, r.price_id, r.billing_interval ORDER BY n DESC, r.product_id LIMIT 20`,
    ).bind(...binds).all<{ product_id: string; price_id: string | null; interval: string | null; name: string | null; n: number }>();
    const list = rows.results ?? [];
    if (!list.length) return { available: false as const, reason: 'not_recorded' as const };
    const counted = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM promo_redemptions r WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?) AND r.product_id IS NOT NULL`,
    ).bind(...binds).first<{ n: number }>();
    return {
      available: true as const,
      reason: null,
      rows: list.map((r) => ({ product_id: r.product_id, name: r.name, price_id: r.price_id, interval: r.interval, redemptions: Number(r.n) })),
      // A cart of several products, and every redemption before 631, names none.
      not_recorded: total - Number(counted?.n ?? 0),
    };
  });

  const nearEnd = await block(async () => {
    const rows = await env.DB.prepare(
      `SELECT id, code, active, expires_at, max_redemptions, times_redeemed FROM promo_codes
        WHERE active = 1 AND (? IS NULL OR id = ?)`,
    ).bind(range.promoId, range.promoId).all<{ id: string; code: string; active: number; expires_at: string | null; max_redemptions: number | null; times_redeemed: number }>();
    const nowMs = now.getTime();
    const codes = [];
    for (const r of rows.results ?? []) {
      // Paused codes are left out by the query; an expired one is neither soon nor at its cap.
      const state = promoState(r, Number(r.times_redeemed), nowMs);
      const ends = r.expires_at && !promoExpired(r.expires_at, nowMs) ? Date.parse(/Z$|[+-]\d\d:\d\d$/.test(r.expires_at) ? r.expires_at : `${r.expires_at.replace(' ', 'T')}Z`) : NaN;
      const endsInDays = Number.isFinite(ends) ? Math.ceil((ends - nowMs) / DAY_MS) : null;
      const soon = endsInDays !== null && endsInDays <= NEAR_END_DAYS;
      // At its cap by the mirror's count alone: sound, because the mirror is a lower bound.
      const atCap = state === 'exhausted';
      if (!soon && !atCap) continue;
      codes.push({ promo_id: r.id, code: r.code, expires_at: r.expires_at, ends_in_days: soon ? endsInDays : null, at_cap: atCap, mirror_redeemed: r.times_redeemed, max_redemptions: r.max_redemptions });
    }
    codes.sort((a, b) => Number(b.at_cap) - Number(a.at_cap) || (a.ends_in_days ?? 1e9) - (b.ends_in_days ?? 1e9));
    return { available: true as const, reason: null, within_days: NEAR_END_DAYS, codes };
  });

  return { range, redemptions, discount, top_codes: topCodes, products, near_end: nearEnd };
}

// ---------------------------------------------------------------------------
// One code: its redemptions and its history.
// ---------------------------------------------------------------------------

/** A code's recorded redemptions, newest first, with Stripe's own count beside them. */
export async function codeRedemptions(env: Env, promoId: string, limit = 100) {
  await ensurePromoSchema(env);
  const list = await block(async () => {
    const rows = await env.DB.prepare(
      `SELECT r.created_at, r.user_id, u.name AS member, r.source, r.product_id, r.price_id,
              r.billing_interval AS interval, r.amount_before_cents, r.discount_cents, r.currency
         FROM promo_redemptions r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.promo_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    ).bind(promoId, limit).all();
    return { available: true as const, reason: null, rows: rows.results ?? [] };
  });
  // Subscriptions redeemed before 631 are only in Stripe's count, so the
  // drawer's count is Stripe's, never the list's length.
  let stripe: { available: true; reason: null; times_redeemed: number } | { available: false; reason: 'unreadable' | 'stripe_not_configured' };
  if (!env.STRIPE_SECRET_KEY) stripe = { available: false, reason: 'stripe_not_configured' };
  else {
    try {
      const pc = await stripeCall<{ times_redeemed?: unknown }>(env, `/promotion_codes/${promoId}`, {}, { method: 'GET' });
      stripe = Number.isSafeInteger(pc.times_redeemed)
        ? { available: true, reason: null, times_redeemed: pc.times_redeemed as number }
        : { available: false, reason: 'unreadable' };
    } catch {
      stripe = { available: false, reason: 'unreadable' };
    }
  }
  return { redemptions: list, stripe };
}

const HISTORY_ACTIONS = ['promo_create', 'promo_update', 'promo_delete'] as const;
/** The audit payload's fields a history row may show: never anything else that was logged. */
const HISTORY_FIELDS = ['code', 'type', 'percent_off', 'amount_off', 'currency', 'product_ids', 'max_redemptions', 'expires_at', 'active'] as const;

/** A code's create, pause, resume and end, oldest first, from `admin_audit_log`. */
export async function codeHistory(env: Env, promoId: string) {
  return block(async () => {
    const rows = await env.DB.prepare(
      `SELECT a.id, a.action, a.admin_user_id, u.name AS admin_name, a.exported_at AS at, a.filters_json
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.action IN (?, ?, ?) AND a.report_type = 'billing'
          AND json_valid(a.filters_json) AND json_extract(a.filters_json, '$.promo_id') = ?
        ORDER BY a.id`,
    ).bind(...HISTORY_ACTIONS, promoId).all<{ id: number; action: string; admin_user_id: number; admin_name: string | null; at: string; filters_json: string }>();
    return {
      available: true as const,
      reason: null,
      events: (rows.results ?? []).map((r) => {
        let payload: Obj = {};
        try { payload = JSON.parse(r.filters_json) ?? {}; } catch { /* json_valid filtered it */ }
        const change = Object.fromEntries(HISTORY_FIELDS.filter((k) => k in payload).map((k) => [k, payload[k]]));
        return { at: r.at, action: r.action, by: { id: r.admin_user_id, name: r.admin_name }, change };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// The CSV export.
// ---------------------------------------------------------------------------

export const EXPORT_LIMIT = 20_000;
export const EXPORT_HEADER = ['redeemed_at', 'code', 'promo_id', 'member_id', 'source', 'product_id', 'price_id', 'interval', 'amount_before_cents', 'discount_cents', 'currency'] as const;

/** The range's redemptions, oldest first. One more row than the limit is read, so a cut export says so. */
export async function exportRows(env: Env, range: UsageRange) {
  await ensurePromoSchema(env);
  const rows = await env.DB.prepare(
    `SELECT r.created_at, p.code, r.promo_id, r.user_id, r.source, r.product_id, r.price_id,
            r.billing_interval, r.amount_before_cents, r.discount_cents, r.currency
       FROM promo_redemptions r LEFT JOIN promo_codes p ON p.id = r.promo_id
      WHERE r.created_at >= ? AND r.created_at < ? AND (? IS NULL OR r.promo_id = ?)
      ORDER BY r.created_at, r.id LIMIT ?`,
  ).bind(...rangeBinds(range), EXPORT_LIMIT + 1).all<Obj>();
  const all = rows.results ?? [];
  return {
    truncated: all.length > EXPORT_LIMIT,
    rows: all.slice(0, EXPORT_LIMIT).map((r) => [r.created_at, r.code, r.promo_id, r.user_id, r.source, r.product_id, r.price_id,
      r.billing_interval, r.amount_before_cents, r.discount_cents, r.currency]),
  };
}
