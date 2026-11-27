import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { stripeCall } from './billing';
import { ensureAdminAuditLogTable } from './admin';
import {
  mirrorPromo,
  getPromoById,
  normalizeCode,
  readProductIds,
  listPromoPage,
  rowToView,
  readReason,
  readNameNote,
  markPaused,
  markResumed,
  markEnded,
  setNameNote,
  PromoInputError,
  planKeyOf,
  PROMO_INTERVALS,
  DEFAULT_PROMO_INTERVALS,
  type PromoInterval,
} from '../services/promos';
import { getCatalog } from '../services/catalog';
import { isTokenPackProduct } from '../services/aiCredits';
import { refusalBody } from '../util/refusal';
import { codeHistory, codeRedemptions, EXPORT_HEADER, exportRows, parseRange, usageRead } from '../services/promoUsage';
import { csvResponse, stamp, toCsv } from '../services/csv';

// Task #9 — Promo Code admin CRUD. Mounted at `/api/admin/promos` BEFORE the
// catch-all `/api/admin` in index.ts so the nested routes resolve here (same
// mount-precedence trick as `/api/admin/billing`). D1271: reads require the
// HQ Super Admin; each mutation takes `requireSuperAdminWriteBar` — creating a
// 100%-off code is money-adjacent, so it needs a RECENT strong-factor re-auth,
// not just a long-lived admin JWT. `/api/admin/promos` is also in index.ts's
// COOL_OFF_PREFIXES so a freshly-recovered admin can't mint promos during
// cool-off.
//
// Stripe Coupons + Promotion Codes are the source of truth. Each promo =
// exactly one Coupon (percent_off XOR amount_off) + one Promotion Code (the
// redeemable string). The product allow-list is stamped BOTH natively
// (`applies_to[products][]`, which Stripe enforces on subscription/invoice
// flows) AND in `metadata.product_ids` (read by the embedded one-time checkout
// path, which redeems out-of-band). The D1 `promo_codes` mirror is for cheap
// admin lookup + usage accounting.

const adminPromos = new Hono<{ Bindings: Env }>();

interface StripeCoupon {
  id: string;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
}
interface StripePromotionCode {
  id: string;
  code: string;
  coupon: StripeCoupon | string;
  active: boolean;
  max_redemptions: number | null;
  expires_at: number | null;
  times_redeemed?: number;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/; // 3–64 chars, alphanumeric + _ -
const PLAN_KEY_RE = /^(tier|investor|plan|mi):[a-z0-9_-]{1,64}$/;
const PRODUCT_RE = /^prod_[A-Za-z0-9]+$/;
const CURRENCY_RE = /^[a-z]{3}$/;

function stripeErr(e: unknown) {
  const msg = (e as Error).message || 'stripe_error';
  if (msg === 'stripe_not_configured') {
    return { body: { error: 'Stripe is not configured', code: 'stripe_not_configured' }, status: 503 as const };
  }
  const m = /^stripe_error:(\d+):([\s\S]*)$/.exec(msg);
  const upstream = m ? Number(m[1]) : 502;
  const status: 400 | 502 = upstream >= 400 && upstream < 500 ? 400 : 502;
  // D278 — Stripe's JSON is the admin's to read on `upstream`, never `detail`.
  return {
    body: refusalBody({
      code: 'stripe_error',
      message: 'Stripe did not accept the request. Nothing changed; the upstream field says why.',
      raw: m ? m[2] : msg,
      audience: 'admin',
      extra: { code: 'stripe_error', upstream_status: upstream },
    }),
    status,
  };
}

async function audit(
  env: Env,
  adminId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
       VALUES (?, ?, 'billing', NULL, ?)`,
    )
      .bind(adminId, action, JSON.stringify(payload))
      .run();
  } catch (e) {
    console.error('[admin/promos] audit insert failed', action, (e as Error).message);
  }
}

// Our own sentence for an input the routes refuse; `code` stays beside `error` for callers that read it.
const inputRefusal = (e: PromoInputError) => refusalBody({ code: e.code, message: e.message, extra: { code: e.code } });
const refused = (c: any, e: PromoInputError) => c.json(inputRefusal(e), e.status);

/**
 * GET /api/admin/promos?q=&state=&applies=&sort=&page=&page_size= — one page
 * of the mirror (Super Admin read; no step-up needed), D1272 (#3298):
 *   q          the code or the name, from two characters
 *   state      active, paused, ended, expired, at_cap or off (`LIST_STATES`)
 *   applies    all (every product) or products (a named list); `plans` waits for part 3
 *   sort       newest (default), oldest, code or redeemed
 * → { promos, total, page, page_size, sort, counts }. A D1 error is a 503, never an empty list.
 */
adminPromos.get('/', async (c) => {
  await requireSuperAdmin(c);
  const q = (k: string) => c.req.query(k);
  try {
    return c.json(await listPromoPage(c.env, { q: q('q'), state: q('state'), applies: q('applies'), sort: q('sort'), page: q('page'), page_size: q('page_size') }));
  } catch (e) {
    if (e instanceof PromoInputError) return refused(c, e);
    console.error('[admin/promos] list read failed');
    return c.json({ error: 'The promo codes could not be read. That is not the same as none.', code: 'promos_unreadable' }, 503);
  }
});

type Created = { ok: true; promoId: string; code: string; couponId: string } | { ok: false; response: Response };
// D1274 (#3300): the reads HQ's Usage tab and a code's drawer draw. Super
// Admin, as the list above; the export is the one read that leaves the
// console, so it is audited. Registered before `/:id` so `usage` and
// `export.csv` are never taken for an id.
const RANGE_REFUSAL = {
  invalid_range: 'The range must be two dates, YYYY-MM-DD, the first not after the second, at most 366 days apart.',
  invalid_promo: 'That is not a promo code id.',
} as const;

adminPromos.get('/usage', async (c) => {
  await requireSuperAdmin(c);
  const r = parseRange({ from: c.req.query('from'), to: c.req.query('to'), promo: c.req.query('promo') });
  if (!r.ok) return c.json({ error: RANGE_REFUSAL[r.code], code: r.code }, 400);
  return c.json(await usageRead(c.env, r.range));
});

adminPromos.get('/export.csv', async (c) => {
  const admin = await requireSuperAdmin(c);
  const r = parseRange({ from: c.req.query('from'), to: c.req.query('to'), promo: c.req.query('promo') });
  if (!r.ok) return c.json({ error: RANGE_REFUSAL[r.code], code: r.code }, 400);
  const { rows, truncated } = await exportRows(c.env, r.range);
  await audit(c.env, admin.id, 'promo_export', {
    from: r.range.from, to: r.range.to, promo_id: r.range.promoId, rows: rows.length, truncated,
  });
  return csvResponse(toCsv(EXPORT_HEADER, rows), `promo-redemptions-${r.range.from}-${r.range.to}-${stamp()}.csv`,
    truncated ? { 'X-Export-Truncated': 'true' } : {});
});

adminPromos.get('/:id/redemptions', async (c) => {
  await requireSuperAdmin(c);
  const promo = await getPromoById(c.env, c.req.param('id'));
  if (!promo) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);
  return c.json({ promo_id: promo.id, mirror_redeemed: promo.times_redeemed, ...await codeRedemptions(c.env, promo.id) });
});

adminPromos.get('/:id/history', async (c) => {
  await requireSuperAdmin(c);
  const promo = await getPromoById(c.env, c.req.param('id'));
  if (!promo) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);
  return c.json({ promo_id: promo.id, history: await codeHistory(c.env, promo.id) });
});

// D1275: one code, for its drawer at its own address when it is not on the list's page.
adminPromos.get('/:id', async (c) => {
  await requireSuperAdmin(c);
  const promo = await getPromoById(c.env, c.req.param('id'));
  if (!promo) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);
  return c.json({ promo: rowToView(promo) });
});


/**
 * One Coupon + one Promotion Code, mirrored and audited (`promo_create`). Shared
 * by POST and Replace; `replaces` names the code a Replace will end.
 */
async function createPromo(c: any, admin: { id: number }, body: Record<string, unknown>, replaces: string | null = null): Promise<Created> {
  const fail = (b: Record<string, unknown>, status: number): Created => ({ ok: false, response: c.json(b, status) });
  const type = typeof body.type === 'string' ? body.type.trim() : '';

  // free-trial-days is DESCOPED: Stripe coupons require percent_off XOR
  // amount_off — a $0/0% coupon cannot exist, so a trial promo can't be
  // coupon-backed. Reject explicitly rather than silently degrade.
  if (type === 'trial') {
    return fail({ error: 'Free-trial-days promos are not supported', code: 'trial_not_supported' }, 400);
  }
  if (type !== 'percent' && type !== 'fixed') {
    return fail({ error: 'type must be "percent" or "fixed"', code: 'invalid_type' }, 400);
  }

  const rawCode = typeof body.code === 'string' ? normalizeCode(body.code) : '';
  if (!CODE_RE.test(rawCode)) {
    return fail({ error: 'code must be 3–64 chars: letters, digits, _ or -', code: 'invalid_code' }, 400);
  }

  // Discount shape.
  const couponForm: Record<string, string> = {};
  let percentOff: number | null = null;
  let amountOff: number | null = null;
  let currency: string | null = null;
  if (type === 'percent') {
    const pct = Number(body.percent_off);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return fail({ error: 'percent_off must be in (0, 100]', code: 'invalid_percent' }, 400);
    }
    percentOff = pct;
    couponForm.percent_off = String(pct);
  } else {
    const amt = Number(body.amount_off);
    if (!Number.isInteger(amt) || amt <= 0) {
      return fail({ error: 'amount_off must be a positive integer (minor units)', code: 'invalid_amount' }, 400);
    }
    currency = typeof body.currency === 'string' ? body.currency.trim().toLowerCase() : '';
    if (!CURRENCY_RE.test(currency)) {
      return fail({ error: 'currency must be a 3-letter ISO code for a fixed-amount promo', code: 'invalid_currency' }, 400);
    }
    amountOff = amt;
    couponForm.amount_off = String(amt);
    couponForm.currency = currency;
  }

  // Duration (defaults to once = first invoice only on subscriptions; ignored
  // for one-time charges which are inherently single-shot).
  const duration = typeof body.duration === 'string' && ['once', 'forever', 'repeating'].includes(body.duration)
    ? body.duration
    : 'once';
  couponForm.duration = duration;
  // D1272: the months are stored on the mirror too, so the list and the drawer can say them.
  let durationInMonths: number | null = null;
  if (duration === 'repeating') {
    const months = Number(body.duration_in_months);
    if (!Number.isInteger(months) || months <= 0) {
      return fail({ error: 'duration_in_months required for repeating promos', code: 'invalid_duration' }, 400);
    }
    couponForm.duration_in_months = String(months);
    durationInMonths = months;
  }

  // D1272: HQ's own name and note, optional, stored here and on the promotion code's metadata.
  let words: { name?: string | null; note?: string | null };
  try { words = readNameNote(body); } catch (e) {
    if (e instanceof PromoInputError) return fail(inputRefusal(e), e.status);
    throw e;
  }

  // Product allow-list. Absent means every product. Present but not a
  // JSON array of strings is refused — dropping the bad entries used to
  // store [] and apply the code to every product.
  let productIds: string[] = [];
  if (body.product_ids !== undefined) {
    const parsed = readProductIds(JSON.stringify(body.product_ids));
    if (!parsed.ok) {
      return fail({ error: 'product_ids must be an array of product id strings', code: 'invalid_product_ids' }, 400);
    }
    productIds = parsed.ids;
  }
  for (const pid of productIds) {
    if (!PRODUCT_RE.test(pid)) {
      return fail({ error: `invalid product id: ${pid}`, code: 'invalid_product' }, 400);
    }
  }

  // D1273 (#3299): plan and interval scope, and the per-member limits.
  // A plan is chosen by its key and resolves to the catalog's live products
  // that sell it; they join the product list, so Stripe's `applies_to` and
  // checkout's product check enforce the plan.
  let planKeys: string[] = [];
  if (body.plan_keys !== undefined) {
    const parsed = readProductIds(JSON.stringify(body.plan_keys));
    if (!parsed.ok || parsed.ids.some((k) => !PLAN_KEY_RE.test(k))) {
      return fail({ error: 'plan_keys must be plan keys such as "tier:growth"', code: 'invalid_plan_keys' }, 400);
    }
    planKeys = [...new Set(parsed.ids)];
  }
  // #2381 owner question 3: monthly only unless HQ chooses yearly too.
  let intervals: PromoInterval[] = [...DEFAULT_PROMO_INTERVALS];
  if (body.intervals !== undefined) {
    const list = Array.isArray(body.intervals) ? body.intervals : null;
    if (!list || !list.length || list.some((x) => !(PROMO_INTERVALS as readonly unknown[]).includes(x))) {
      return fail({ error: 'intervals must list "month", "year" or both', code: 'invalid_intervals' }, 400);
    }
    intervals = [...new Set(list as PromoInterval[])];
  }
  for (const [field, value] of [['once_per_member', body.once_per_member], ['first_purchase_only', body.first_purchase_only]] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      return fail({ error: `${field} must be true or false`, code: `invalid_${field}` }, 400);
    }
  }
  const oncePerMember = body.once_per_member === true;
  const firstPurchaseOnly = body.first_purchase_only === true;

  // Every product the code names, chosen or through a plan, must be a live
  // catalog product, and never a token pack (D755 §5). Refused before Stripe.
  if (productIds.length || planKeys.length) {
    const catalog = await getCatalog(c.env);
    const byId = new Map(catalog.map((p) => [p.id, p]));
    for (const key of planKeys) {
      const selling = catalog.filter((p) => p.active && planKeyOf(p) === key).map((p) => p.id);
      if (!selling.length) {
        return fail({ error: `No live product sells the plan ${key}.`, code: 'unknown_plan' }, 400);
      }
      for (const pid of selling) if (!productIds.includes(pid)) productIds.push(pid);
    }
    for (const pid of productIds) {
      const product = byId.get(pid);
      if (!product) return fail({ error: `${pid} is not in the catalog. Sync the catalog, then try again.`, code: 'unknown_product' }, 400);
      if (!product.active) return fail({ error: `${product.name} is archived, so a code cannot apply to it.`, code: 'product_archived' }, 400);
      if (await isTokenPackProduct(c.env, pid)) {
        return fail({ error: `${product.name} is a token pack, which is never discounted.`, code: 'token_pack_not_discountable' }, 400);
      }
    }
  }
  productIds.forEach((pid, i) => {
    couponForm[`applies_to[products][${i}]`] = pid;
  });
  couponForm['metadata[product_ids]'] = JSON.stringify(productIds);
  couponForm['metadata[created_by]'] = String(admin.id);
  couponForm.name = rawCode;

  // Usage limit + expiry live on the Promotion Code.
  let maxRedemptions: number | null = null;
  if (body.max_redemptions != null) {
    const n = Number(body.max_redemptions);
    if (!Number.isInteger(n) || n <= 0) {
      return fail({ error: 'max_redemptions must be a positive integer', code: 'invalid_max' }, 400);
    }
    maxRedemptions = n;
  }
  let expiresAtIso: string | null = null;
  let expiresAtEpoch: number | null = null;
  if (body.expires_at != null && body.expires_at !== '') {
    const t = new Date(body.expires_at as string).getTime();
    if (!Number.isFinite(t) || t <= Date.now()) {
      return fail({ error: 'expires_at must be a future date', code: 'invalid_expiry' }, 400);
    }
    expiresAtIso = new Date(t).toISOString();
    expiresAtEpoch = Math.floor(t / 1000);
  }

  // 1) Coupon.
  let coupon: StripeCoupon;
  try {
    coupon = await stripeCall<StripeCoupon>(c.env, '/coupons', couponForm);
  } catch (e) {
    const { body: eb, status } = stripeErr(e);
    return fail(eb, status);
  }

  // 2) Promotion Code (the redeemable string).
  const promoForm: Record<string, string> = {
    coupon: coupon.id,
    code: rawCode,
    'metadata[product_ids]': JSON.stringify(productIds),
    'metadata[plan_keys]': JSON.stringify(planKeys),
    'metadata[intervals]': JSON.stringify(intervals),
    'metadata[once_per_member]': String(oncePerMember),
  };
  // D1273: Stripe enforces a first purchase itself on a subscription; the Worker checks every path.
  if (firstPurchaseOnly) promoForm['restrictions[first_time_transaction]'] = 'true';
  if (maxRedemptions != null) promoForm.max_redemptions = String(maxRedemptions);
  if (expiresAtEpoch != null) promoForm.expires_at = String(expiresAtEpoch);
  if (words.name) promoForm['metadata[name]'] = words.name;
  if (words.note) promoForm['metadata[note]'] = words.note;
  if (replaces) promoForm['metadata[replaces]'] = replaces;

  let promo: StripePromotionCode;
  try {
    promo = await stripeCall<StripePromotionCode>(c.env, '/promotion_codes', promoForm);
  } catch (e) {
    // Coupon was created but the promotion code failed — clean up the orphan
    // coupon so a retry with the same code doesn't accrete dead coupons.
    try {
      await stripeCall(c.env, `/coupons/${coupon.id}`, {}, { method: 'DELETE' });
    } catch { /* best-effort */ }
    const { body: eb, status } = stripeErr(e);
    return fail(eb, status);
  }

  await mirrorPromo(c.env, {
    id: promo.id,
    code: promo.code || rawCode,
    coupon_id: coupon.id,
    percent_off: percentOff,
    amount_off: amountOff,
    currency,
    duration,
    product_ids: productIds,
    max_redemptions: maxRedemptions,
    times_redeemed: 0,
    active: promo.active !== false,
    expires_at: expiresAtIso,
    created_by: admin.id,
    name: words.name ?? null,
    note: words.note ?? null,
    duration_in_months: durationInMonths,
    plan_keys: planKeys,
    intervals,
    once_per_member: oncePerMember,
    first_purchase_only: firstPurchaseOnly,
  });

  await audit(c.env, admin.id, 'promo_create', {
    promo_id: promo.id,
    coupon_id: coupon.id,
    code: rawCode,
    type,
    percent_off: percentOff,
    amount_off: amountOff,
    currency,
    product_ids: productIds,
    max_redemptions: maxRedemptions,
    expires_at: expiresAtIso,
    duration_in_months: durationInMonths,
    ...(replaces ? { replaces } : {}),
    plan_keys: planKeys,
    intervals,
    once_per_member: oncePerMember,
    first_purchase_only: firstPurchaseOnly,
  });

  return { ok: true, promoId: promo.id, code: rawCode, couponId: coupon.id };
}

/** Stripe and the step-up gate, in the order every write checks them. */
async function writer(c: any) {
  const admin = await requireSuperAdminWriteBar(c);
  if (!c.env.STRIPE_SECRET_KEY) return { admin, stop: c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503) };
  return { admin, stop: null as Response | null };
}

// POST /api/admin/promos — create a Coupon + Promotion Code, mirror to D1.
adminPromos.post('/', async (c) => {
  const { admin, stop } = await writer(c);
  if (stop) return stop;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const made = await createPromo(c, admin, body);
  if (!made.ok) return made.response;
  return c.json({ ok: true, promo_id: made.promoId, code: made.code });
});

/**
 * PATCH /api/admin/promos/:id — D1272 (#3298):
 *   { action: 'pause' | 'resume' | 'end', reason }  pause and end need the reason;
 *                                                   an ended code never resumes (409 promo_ended)
 *   { active: boolean, reason? }                    today's toggle: false pauses, true resumes
 *   { name?, note? }                                HQ's words, here and on Stripe's metadata
 * The discount, the cap and the expiry are Stripe's, fixed once made: a changed
 * term is a new code (Replace). Each change is one audit row.
 */
adminPromos.patch('/:id', async (c) => {
  const { admin, stop } = await writer(c);
  if (stop) return stop;
  const id = c.req.param('id');
  const existing = await getPromoById(c.env, id);
  if (!existing) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let action: 'pause' | 'resume' | 'end' | null = null;
  if (body.action != null) {
    if (body.action !== 'pause' && body.action !== 'resume' && body.action !== 'end') {
      return c.json({ error: 'action is pause, resume or end', code: 'invalid_action' }, 400);
    }
    action = body.action;
  } else if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return c.json({ error: 'active (boolean) is required', code: 'invalid_active' }, 400);
    action = body.active ? 'resume' : 'pause';
  }
  let reason: string | null;
  let words: { name?: string | null; note?: string | null };
  try {
    // The toggle keeps working without a reason; the named actions that stop a code need one.
    reason = readReason(body.reason, (action === 'pause' && body.action != null) || action === 'end');
    words = readNameNote(body);
  } catch (e) {
    if (e instanceof PromoInputError) return refused(c, e);
    throw e;
  }
  if (!action && !('name' in words) && !('note' in words)) {
    return c.json({ error: 'Send an action, the active toggle, or a name or note to change.', code: 'nothing_to_change' }, 400);
  }
  if (existing.ended_at && action) {
    return c.json({ error: 'This code was ended, so it cannot be paused or resumed. Make a new code instead.', code: 'promo_ended' }, 409);
  }
  if (action === 'pause' && existing.paused_at) return c.json({ error: 'This code is already paused.', code: 'already_paused' }, 409);

  // Stripe first, then the mirror: Stripe is the source of truth.
  const form: Record<string, string> = {};
  if (action) form.active = String(action === 'resume');
  if ('name' in words) form['metadata[name]'] = words.name ?? '';
  if ('note' in words) form['metadata[note]'] = words.note ?? '';
  try {
    await stripeCall(c.env, `/promotion_codes/${id}`, form);
  } catch (e) {
    const { body: eb, status } = stripeErr(e);
    return c.json(eb, status);
  }
  let changed = true;
  if (action === 'pause') changed = await markPaused(c.env, id, admin.id, reason);
  else if (action === 'resume') changed = await markResumed(c.env, id, reason);
  else if (action === 'end') changed = await markEnded(c.env, id, admin.id, reason);
  if ('name' in words || 'note' in words) await setNameNote(c.env, id, words);
  if (!changed) {
    // Another write got there between the read and this one; Stripe holds the newer state.
    return c.json({ error: 'This code changed while you were editing it. Reload to see where it stands.', code: 'promo_changed' }, 409);
  }
  await audit(c.env, admin.id, action ? `promo_${action}` : 'promo_update', {
    promo_id: id,
    ...(action ? { action, reason } : {}),
    ...('name' in words ? { name: words.name } : {}),
    ...('note' in words ? { note_changed: true } : {}),
  });
  const after = await getPromoById(c.env, id);
  return c.json({ ok: true, promo_id: id, active: after?.active === 1, paused_at: after?.paused_at ?? null, ended_at: after?.ended_at ?? null });
});

/**
 * DELETE /api/admin/promos/:id — Stripe Promotion Codes CANNOT be deleted, so
 * "delete" = deactivate the promotion code AND delete the backing coupon
 * (best-effort) so it can never be redeemed again. D1272: it is recorded as
 * ended, with an optional `reason`, so it never resumes.
 */
adminPromos.delete('/:id', async (c) => {
  const { admin, stop } = await writer(c);
  if (stop) return stop;
  const id = c.req.param('id');
  const existing = await getPromoById(c.env, id);
  if (!existing) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let reason: string | null;
  try { reason = readReason(body.reason, false); } catch (e) {
    if (e instanceof PromoInputError) return refused(c, e);
    throw e;
  }

  try {
    await stripeCall(c.env, `/promotion_codes/${id}`, { active: 'false' });
  } catch (e) {
    const { body: eb, status } = stripeErr(e);
    return c.json(eb, status);
  }
  // Deleting the coupon also disables the promotion code permanently; ignore
  // errors (already-deleted coupon, etc.) — the deactivation above is the
  // authoritative kill-switch.
  try {
    await stripeCall(c.env, `/coupons/${existing.coupon_id}`, {}, { method: 'DELETE' });
  } catch { /* best-effort coupon delete */ }
  if (!existing.ended_at) await markEnded(c.env, id, admin.id, reason);
  await audit(c.env, admin.id, 'promo_delete', { promo_id: id, coupon_id: existing.coupon_id, reason });
  return c.json({ ok: true, promo_id: id });
});

/**
 * POST /api/admin/promos/:id/replace — D1272 (#3298). Stripe keeps a code's
 * discount, cap and expiry fixed, so a changed term is a new code. The body is
 * the new code's, as POST takes it, plus `reason` (required). The new code is
 * made first; then the old one is ended with `replaced_by`, in Stripe and here.
 * Both are audited: `promo_create` with `replaces`, then `promo_end` with
 * `replaced_by`. When the old one cannot be ended, the new one stands and the
 * answer says so (`old_ended: false`), with nothing undone behind the admin.
 */
adminPromos.post('/:id/replace', async (c) => {
  const { admin, stop } = await writer(c);
  if (stop) return stop;
  const id = c.req.param('id');
  const existing = await getPromoById(c.env, id);
  if (!existing) return c.json({ error: 'Promo not found', code: 'not_found' }, 404);
  if (existing.ended_at) return c.json({ error: 'This code was already ended, so there is nothing to replace.', code: 'promo_ended' }, 409);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let reason: string | null;
  try { reason = readReason(body.reason, true); } catch (e) {
    if (e instanceof PromoInputError) return refused(c, e);
    throw e;
  }
  if (normalizeCode(String(body.code ?? '')) === existing.code_normalized) {
    return c.json({ error: 'The new code needs a different code from the one it replaces.', code: 'same_code' }, 400);
  }
  const made = await createPromo(c, admin, body, id);
  if (!made.ok) return made.response;

  try {
    await stripeCall(c.env, `/promotion_codes/${id}`, { active: 'false', 'metadata[replaced_by]': made.promoId });
  } catch (e) {
    const { body: eb } = stripeErr(e);
    return c.json({ ok: false, promo_id: made.promoId, code: made.code, old_ended: false, old_promo_id: id,
      error: 'The new code was made, but the old one could not be ended in Stripe. It is still on: end it from its row.', upstream: eb }, 502);
  }
  await markEnded(c.env, id, admin.id, reason, made.promoId);
  await audit(c.env, admin.id, 'promo_end', { promo_id: id, reason, replaced_by: made.promoId });
  return c.json({ ok: true, promo_id: made.promoId, code: made.code, old_ended: true, old_promo_id: id });
});

export default adminPromos;
