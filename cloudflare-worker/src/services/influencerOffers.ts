/**
 * D4293 (#4293, D4289 P4 of #4289) — influencer offers: membership discounts
 * HQ gives an influencer, applied at checkout to the members that influencer
 * referred, inside a budget.
 *
 * AN OFFER IS A PROMOTION CODE WITH AN OWNER. HQ makes the code in Promos
 * (D1270–D1275) and links it here (`linkOffer`). The code keeps its own rules:
 * plans, intervals, once per member, first purchase only, expiry, pause and
 * end. The offer adds the owner, a budget and its own status.
 *
 * AUTOMATIC AT CHECKOUT (`autoOffer`). When the member typed no code, and is
 * attributed to an influencer who holds an active offer that the code's own
 * rules accept for this plan and interval, the offer's code is applied:
 *   - never two codes: a typed code always wins, and only one offer applies;
 *   - featured first, then the oldest;
 *   - the budget is spent from the redemptions (`promo_redemptions.discount_cents`,
 *     D1274), in the budget's currency; an offer whose discount would pass its
 *     budget, or the terms' `offer_budget_cents` across all the influencer's
 *     offers, is not applied.
 *
 * WHO IS ATTRIBUTED (`attributedReferrer`). The member's active first-touch row
 * in `referral_attributions`, the store P2 (#4291) extends with handle visits
 * and its 90-day window. It is the one reader, so P2's rule changes it in one
 * place.
 *
 * Every function that decides by time takes `now` (ms).
 */
import type { Env } from '../types';
import { computeDiscount, getPromoById, planKeyOf, promoExpired, readIntervals, readProductIds, type PromoRow } from './promos';
import { canRedeemPromo } from './promoRedemption';
import { planByKey } from './planCatalogue';
import { todayUtc } from './referralPartnerTerms';

export const NOT_RECORDED = 'Not recorded';
export const OFFER_STATUSES = ['active', 'paused', 'ended'] as const;
export type OfferStatus = typeof OFFER_STATUSES[number];

export type OfferRow = {
  id: number; uid: string; influencer_user_id: number; promo_id: string; budget_cents: number; currency: string;
  status: OfferStatus; featured: number; created_at: string; updated_at: string; ended_at: string | null;
};

const newUid = () => crypto.randomUUID().replace(/-/g, '');

/** The influencer the member is attributed to today, or null. Never throws: an unreadable store applies no offer. */
export async function attributedReferrer(env: Env, userId: number, now: number = Date.now()): Promise<number | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT referrer_user_id FROM referral_attributions WHERE user_id = ? AND expires_at > ? AND referrer_user_id <> user_id LIMIT 1`,
    ).bind(userId, new Date(now).toISOString()).first<{ referrer_user_id: number }>();
    return row ? Number(row.referrer_user_id) : null;
  } catch {
    return null;
  }
}

/** What an offer's code has given, per currency, and how many uses carry no recorded discount. */
export async function offerSpend(env: Env, promoId: string): Promise<{ uses: number; unrecorded: number; given: Array<{ currency: string; cents: number }> }> {
  const rows = (await env.DB.prepare(
    `SELECT upper(currency) AS currency, COUNT(*) AS uses, SUM(discount_cents) AS cents, SUM(CASE WHEN discount_cents IS NULL OR currency IS NULL THEN 1 ELSE 0 END) AS unrecorded
       FROM promo_redemptions WHERE promo_id = ? GROUP BY upper(currency) ORDER BY upper(currency)`,
  ).bind(promoId).all<{ currency: string | null; uses: number; cents: number | null; unrecorded: number }>()).results || [];
  let uses = 0; let unrecorded = 0;
  const given: Array<{ currency: string; cents: number }> = [];
  for (const r of rows) {
    uses += Number(r.uses || 0);
    unrecorded += Number(r.unrecorded || 0);
    if (r.currency && r.cents != null) given.push({ currency: r.currency, cents: Number(r.cents) });
  }
  return { uses, unrecorded, given };
}

const givenIn = (given: Array<{ currency: string; cents: number }>, currency: string) => given.find((g) => g.currency === currency)?.cents ?? 0;

/** The terms' cap on the total discount across an influencer's offers, or null for none. */
export async function termsOfferBudget(env: Env, influencerUserId: number, today: string): Promise<{ cents: number; currency: string } | null> {
  const row = await env.DB.prepare(
    `SELECT t.offer_budget_cents, t.currency FROM referral_partner_terms t JOIN referral_partners p ON p.id = t.partner_id
      WHERE p.user_id = ? AND t.status IN ('signed', 'active') AND t.starts_on <= ? AND (t.ends_on IS NULL OR t.ends_on >= ?)
      ORDER BY t.starts_on DESC, t.id DESC LIMIT 1`,
  ).bind(influencerUserId, today, today).first<{ offer_budget_cents: number | null; currency: string }>();
  return row && row.offer_budget_cents != null ? { cents: Number(row.offer_budget_cents), currency: String(row.currency) } : null;
}

async function influencerGiven(env: Env, influencerUserId: number, currency: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(r.discount_cents), 0) AS cents FROM promo_redemptions r JOIN influencer_offers o ON o.promo_id = r.promo_id
      WHERE o.influencer_user_id = ? AND upper(r.currency) = ?`,
  ).bind(influencerUserId, currency).first<{ cents: number }>();
  return Number(row?.cents || 0);
}

/** Does the code's plan scope take this product? An empty scope takes every plan; an unreadable one takes none. */
function planInScope(promo: PromoRow, product: { metadata?: Record<string, string> | null }): boolean {
  const scope = readProductIds(promo.plan_keys_json ?? '[]');
  if (!scope.ok) return false;
  if (!scope.ids.length) return true;
  const key = planKeyOf(product);
  return !!key && scope.ids.includes(key);
}

export type AutoOffer = { offer: OfferRow; promo: PromoRow; discountCents: number };
export type OfferSkip = 'paused' | 'ended' | 'budget_used' | 'terms_budget_used' | 'currency' | 'code_refused' | 'plan_not_in_offer';

/**
 * The offer checkout applies for this member and price, or null. `skipped`
 * says why each of the influencer's offers was not applied, for the tests and
 * the quote's reason.
 */
export async function autoOffer(env: Env, buyerUserId: number, sale: {
  product: { id: string; metadata?: Record<string, string> | null };
  interval: string | null; unitAmount: number; currency: string;
}, now: number = Date.now()): Promise<{ applied: AutoOffer | null; referrer: number | null; skipped: Array<{ uid: string; why: OfferSkip }> }> {
  const skipped: Array<{ uid: string; why: OfferSkip }> = [];
  const referrer = await attributedReferrer(env, buyerUserId, now);
  // `attributedReferrer` never returns the member themselves (its SQL refuses a self-attribution).
  if (!referrer) return { applied: null, referrer: null, skipped };
  const offers = (await env.DB.prepare(
    `SELECT * FROM influencer_offers WHERE influencer_user_id = ? ORDER BY featured DESC, id ASC`,
  ).bind(referrer).all<OfferRow>()).results || [];
  const currency = String(sale.currency || '').toUpperCase();
  const cap = offers.length ? await termsOfferBudget(env, referrer, todayUtc(now)) : null;
  for (const offer of offers) {
    if (offer.status !== 'active') { skipped.push({ uid: offer.uid, why: offer.status }); continue; }
    if (offer.currency !== currency) { skipped.push({ uid: offer.uid, why: 'currency' }); continue; }
    const promo = await getPromoById(env, offer.promo_id);
    if (!promo) { skipped.push({ uid: offer.uid, why: 'code_refused' }); continue; }
    if (!planInScope(promo, sale.product)) { skipped.push({ uid: offer.uid, why: 'plan_not_in_offer' }); continue; }
    // D4855: the same rule as every checkout, so an offer the licence's ceiling cannot cover is not applied.
    const v = await canRedeemPromo(env, { code: promo.code, productId: sale.product.id, amountCents: sale.unitAmount, currency: sale.currency, buyer: {
      userId: buyerUserId, interval: (sale.interval === 'month' || sale.interval === 'year') ? sale.interval : null,
    } });
    if (!v.ok) { skipped.push({ uid: offer.uid, why: 'code_refused' }); continue; }
    const discount = computeDiscount(v.promo, sale.unitAmount).discountCents;
    const spend = await offerSpend(env, promo.id);
    if (givenIn(spend.given, currency) + discount > offer.budget_cents) { skipped.push({ uid: offer.uid, why: 'budget_used' }); continue; }
    if (cap && cap.currency === currency && (await influencerGiven(env, referrer, currency)) + discount > cap.cents) {
      skipped.push({ uid: offer.uid, why: 'terms_budget_used' }); continue;
    }
    return { applied: { offer, promo: v.promo, discountCents: discount }, referrer, skipped };
  }
  return { applied: null, referrer, skipped };
}

/** Who a code is for, in words. */
export function whoFor(promo: PromoRow): string {
  const parts: string[] = [];
  if (promo.first_purchase_only === 1) parts.push('First purchase only');
  if (promo.once_per_member === 1) parts.push('Once per member');
  return parts.length ? parts.join(' · ') : 'Every member who arrives through your handle';
}

/** The discount in words, from the code: "20% off for 3 months", "$10.00 off once". */
export function discountLine(promo: PromoRow): string {
  let amount: string;
  if (promo.percent_off != null) amount = `${promo.percent_off}% off`;
  else if (promo.amount_off != null && promo.currency) amount = `${(promo.amount_off / 100).toFixed(2)} ${promo.currency.toUpperCase()} off`;
  else return NOT_RECORDED;
  if (promo.duration === 'repeating') return promo.duration_in_months ? `${amount} for ${promo.duration_in_months} months` : `${amount} (${NOT_RECORDED.toLowerCase()} how many months)`;
  if (promo.duration === 'forever') return `${amount} every invoice`;
  return `${amount} once`;
}

/** The plans a code covers, by name; an empty scope is every plan. */
function plansOf(promo: PromoRow): { keys: string[]; names: string[] } | null {
  const scope = readProductIds(promo.plan_keys_json ?? '[]');
  if (!scope.ok) return null;
  const toCatalogue = (k: string) => k.replace(/^tier:/, 'founder:').replace(/^plan:(advisor|partner)$/, '$1:pro');
  return { keys: scope.ids, names: scope.ids.map((k) => planByKey(toCatalogue(k))?.name ?? k) };
}

/** `GET /api/influencer/me/offers`: each of the influencer's offers, as the IN3 cards read it. */
export async function offersRead(env: Env, influencerUserId: number, now: number = Date.now()) {
  const offers = (await env.DB.prepare(
    `SELECT * FROM influencer_offers WHERE influencer_user_id = ? ORDER BY featured DESC, id DESC`,
  ).bind(influencerUserId).all<OfferRow>()).results || [];
  const out = [];
  for (const o of offers) {
    const promo = await getPromoById(env, o.promo_id);
    if (!promo) {
      out.push({ uid: o.uid, status: o.status, featured: o.featured === 1, code: null, plans: NOT_RECORDED, intervals: NOT_RECORDED, discount: NOT_RECORDED, who_for: NOT_RECORDED,
        uses: NOT_RECORDED, discount_given: NOT_RECORDED, remaining_budget: NOT_RECORDED, budget: { cents: o.budget_cents, currency: o.currency }, ends_at: NOT_RECORDED, code_state: 'unreadable' });
      continue;
    }
    const spend = await offerSpend(env, promo.id);
    const plans = plansOf(promo);
    const intervals = readIntervals(promo.intervals_json);
    const given = givenIn(spend.given, o.currency);
    // A code paused, ended or expired in Promos reads as such, whatever the offer's own status.
    const codeState = promo.ended_at ? 'ended' : promo.paused_at || promo.active !== 1 ? 'paused' : promoExpired(promo.expires_at, now) ? 'expired' : 'live';
    out.push({
      uid: o.uid,
      status: o.status,
      code_state: codeState,
      featured: o.featured === 1,
      code: promo.code,
      plans: plans ? (plans.names.length ? plans.names : 'Every plan') : NOT_RECORDED,
      intervals: intervals.ok ? (intervals.intervals ?? 'Monthly and yearly') : NOT_RECORDED,
      discount: discountLine(promo),
      who_for: whoFor(promo),
      uses: spend.uses,
      discount_given: spend.given.length ? spend.given : (spend.uses ? NOT_RECORDED : []),
      // Uses from before D1274 carry no discount: the figure below leaves them out and says so.
      uses_without_recorded_discount: spend.unrecorded,
      budget: { cents: o.budget_cents, currency: o.currency },
      remaining_budget: { cents: Math.max(0, o.budget_cents - given), currency: o.currency, budget_used: given >= o.budget_cents },
      ends_at: promo.expires_at || 'No end date',
    });
  }
  return { offers: out };
}

/** The featured active offer, for P2's public @handle read; null when there is none. */
export async function featuredOffer(env: Env, influencerUserId: number, now: number = Date.now()) {
  const row = await env.DB.prepare(`SELECT * FROM influencer_offers WHERE influencer_user_id = ? AND featured = 1 AND status = 'active' LIMIT 1`)
    .bind(influencerUserId).first<OfferRow>();
  if (!row) return null;
  const promo = await getPromoById(env, row.promo_id);
  if (!promo || promo.active !== 1 || promo.paused_at || promo.ended_at || promoExpired(promo.expires_at, now)) return null;
  const plans = plansOf(promo);
  return { uid: row.uid, discount: discountLine(promo), who_for: whoFor(promo), plans: plans ? (plans.names.length ? plans.names : 'Every plan') : NOT_RECORDED, ends_at: promo.expires_at || 'No end date' };
}

export type LinkInput = { promo_id: string; budget_cents: number; currency: string; featured: boolean };
export type Refusal = { status: 400 | 404 | 409; code: string; message: string };

export function readLinkInput(body: Record<string, unknown>): LinkInput | Refusal {
  const promo = typeof body.promo_id === 'string' ? body.promo_id.trim() : '';
  if (!/^promo_[A-Za-z0-9]{1,255}$/.test(promo)) return { status: 400, code: 'promo_required', message: 'Name the promotion code from Promos (promo_…).' };
  const budget = Number(body.budget_cents);
  if (!Number.isSafeInteger(budget) || budget <= 0) return { status: 400, code: 'budget_required', message: 'Give the budget in whole cents above 0.' };
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return { status: 400, code: 'currency_required', message: 'Give the budget’s currency as three letters.' };
  return { promo_id: promo, budget_cents: budget, currency, featured: body.featured === true };
}

/** HQ links a code to an influencer. The code must exist and belong to nobody else; the terms' offer budget caps the total. */
export async function linkOffer(env: Env, adminId: number, influencerUserId: number, input: LinkInput, now: number = Date.now()): Promise<{ offer: OfferRow } | Refusal> {
  const promo = await getPromoById(env, input.promo_id);
  if (!promo) return { status: 404, code: 'promo_not_found', message: 'That code is not in Promos. Create it there first.' };
  if (promo.ended_at) return { status: 409, code: 'promo_ended', message: 'That code has ended in Promos.' };
  if (promo.amount_off != null && promo.currency && promo.currency.toUpperCase() !== input.currency) {
    return { status: 400, code: 'currency_mismatch', message: `That code takes ${promo.currency.toUpperCase()} off, so its budget is in ${promo.currency.toUpperCase()}.` };
  }
  const owned = await env.DB.prepare('SELECT influencer_user_id FROM influencer_offers WHERE promo_id = ?').bind(promo.id).first<{ influencer_user_id: number }>();
  if (owned) return { status: 409, code: 'promo_owned', message: 'That code already belongs to an influencer. A code has one owner.' };
  const cap = await termsOfferBudget(env, influencerUserId, todayUtc(now));
  if (cap && cap.currency === input.currency) {
    const linked = await env.DB.prepare(`SELECT COALESCE(SUM(budget_cents), 0) AS n FROM influencer_offers WHERE influencer_user_id = ? AND status <> 'ended' AND currency = ?`)
      .bind(influencerUserId, input.currency).first<{ n: number }>();
    if (Number(linked?.n || 0) + input.budget_cents > cap.cents) {
      return { status: 409, code: 'terms_budget_exceeded', message: `The terms allow ${(cap.cents / 100).toFixed(2)} ${cap.currency} of offers in all. Lower this budget or end another offer.` };
    }
  }
  const uid = newUid();
  const stmts = [];
  if (input.featured) stmts.push(env.DB.prepare(`UPDATE influencer_offers SET featured = 0, updated_at = datetime('now') WHERE influencer_user_id = ? AND featured = 1`).bind(influencerUserId));
  stmts.push(env.DB.prepare(
    `INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, featured, created_by) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).bind(uid, influencerUserId, promo.id, input.budget_cents, input.currency, input.featured ? 1 : 0, adminId));
  await env.DB.batch(stmts);
  const offer = await env.DB.prepare('SELECT * FROM influencer_offers WHERE uid = ?').bind(uid).first<OfferRow>();
  return { offer: offer! };
}

/** HQ pauses, resumes or ends an offer, or changes its budget or featured flag. An ended offer stays ended. */
export async function changeOffer(env: Env, influencerUserId: number, offerUid: string, body: Record<string, unknown>): Promise<{ offer: OfferRow; before: OfferRow } | Refusal> {
  const before = await env.DB.prepare('SELECT * FROM influencer_offers WHERE uid = ? AND influencer_user_id = ?').bind(offerUid, influencerUserId).first<OfferRow>();
  if (!before) return { status: 404, code: 'offer_not_found', message: 'That offer is not this influencer’s.' };
  if (before.status === 'ended') return { status: 409, code: 'offer_ended', message: 'An ended offer cannot change. Link the code again as a new offer.' };
  const status = body.status === undefined ? before.status : body.status;
  if (!(OFFER_STATUSES as readonly unknown[]).includes(status)) return { status: 400, code: 'invalid_status', message: 'An offer is active, paused or ended.' };
  const budget = body.budget_cents === undefined ? before.budget_cents : Number(body.budget_cents);
  if (!Number.isSafeInteger(budget) || budget <= 0) return { status: 400, code: 'budget_required', message: 'Give the budget in whole cents above 0.' };
  const featured = body.featured === undefined ? before.featured === 1 : body.featured === true;
  const stmts = [];
  if (featured && before.featured !== 1) stmts.push(env.DB.prepare(`UPDATE influencer_offers SET featured = 0, updated_at = datetime('now') WHERE influencer_user_id = ? AND featured = 1`).bind(influencerUserId));
  stmts.push(env.DB.prepare(
    `UPDATE influencer_offers SET status = ?, budget_cents = ?, featured = ?, ended_at = CASE WHEN ? = 'ended' THEN datetime('now') ELSE ended_at END, updated_at = datetime('now') WHERE id = ?`,
  ).bind(status, budget, featured && status !== 'ended' ? 1 : 0, status, before.id));
  await env.DB.batch(stmts);
  const offer = await env.DB.prepare('SELECT * FROM influencer_offers WHERE id = ?').bind(before.id).first<OfferRow>();
  return { offer: offer!, before };
}

/** "Ask HQ for an offer": the request is kept, and HQ is told. */
export async function requestOffer(env: Env, influencerUserId: number, message: string): Promise<{ uid: string }> {
  const uid = newUid();
  await env.DB.prepare('INSERT INTO influencer_offer_requests (uid, influencer_user_id, message) VALUES (?, ?, ?)').bind(uid, influencerUserId, message).run();
  try {
    const { notify } = await import('./notify');
    const hq = (await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>()).results || [];
    for (const r of hq) {
      await notify(env, {
        userId: Number(r.user_id), type: 'influencer_offer_requested',
        title: 'An influencer asked for an offer',
        body: message.slice(0, 280),
        link: '/admin/programs/influencer',
        payload: { request_uid: uid, influencer_user_id: influencerUserId },
      });
    }
  } catch {
    console.warn('[influencer] offer request notice not sent');
  }
  return { uid };
}
