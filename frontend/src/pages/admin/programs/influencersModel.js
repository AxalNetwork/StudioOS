/**
 * D4298 (#4298, D4289 P9) — Admin › Programs › Influencers (IN11), its words
 * and its arithmetic. Pure: no React, no request.
 *
 * MONEY IS THE SUPER ADMIN'S (O-MONEY A). The Worker answers every money
 * figure an admin may not read as `{ available: false, reason: 'hq_reads' }`,
 * and this page draws that as "HQ reads", never as a zero. Each currency is
 * its own line, never summed across currencies (in11d).
 *
 * A figure nothing stores yet (`not_recorded`) reads "Not recorded"; one that
 * failed to read reads "Could not be read". A count under 5 the Worker masked
 * (`{ fewer_than: 5 }`) reads "Fewer than 5".
 *
 * EVERY ACTION ASKS FOR A REASON of at least REASON_MIN characters: admit is
 * the one decision that names a tier instead.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };
export const HQ_READS = 'HQ reads';
export const COULD_NOT_READ = 'Could not be read';
export const FEWER_THAN = (n) => `Fewer than ${n}`;
/** The Worker's own floor (services/influencers.ts REASON_MIN). */
export const REASON_MIN = 10;
export const REASON_MAX = 2000;

export const KEY = 'influencer';
export const BASE = '/admin/programs/influencer';
export const TABS = Object.freeze([
  { key: 'how', label: 'How it runs', path: `${BASE}/how-it-runs` },
  { key: 'applications', label: 'Applications', path: `${BASE}/applications` },
  { key: 'influencers', label: 'Influencers', path: `${BASE}/influencers` },
  { key: 'offers', label: 'Offers', path: `${BASE}/offers` },
  { key: 'payouts', label: 'Payouts', path: `${BASE}/payouts` },
  { key: 'activity', label: 'Activity', path: `${BASE}/activity` },
  { key: 'settings', label: 'Settings', path: `${BASE}/settings` },
]);
/** The program's own address opens Applications, where the work waits. */
export const LANDING = 'applications';
/**
 * Payouts are the existing queue (D-j): Commissions, opened on the
 * subscription commissions P3 writes. Bonuses are `influencer_bonus` there.
 */
export const PAYOUTS_LINK = '/admin/commissions?source=subscription_invoice';
export const BONUSES_LINK = '/admin/commissions?source=influencer_bonus';
/** HQ makes the code in Promos (D-g), then links it to its owner here. */
export const PROMOS_LINK = '/admin/platform/promo-codes';

export const TIER_ORDER = ['affiliate_creator', 'verified_influencer', 'strategic_creator', 'strategic_partner'];
/** The tiers HQ admits at (in11a). Strategic Partner is agreed per contract, not by admission. */
export const ADMIT_TIERS = ['affiliate_creator', 'verified_influencer', 'strategic_creator'];
export const TIER_LABEL = Object.freeze({
  affiliate_creator: 'Affiliate Creator', verified_influencer: 'Verified Influencer',
  strategic_creator: 'Strategic Creator', strategic_partner: 'Strategic Partner',
});
export const STATUS_WORD = Object.freeze({ active: 'Active', paused: 'Paused', ended: 'Ended' });
export const APPLICATION_WORD = Object.freeze({
  applied: 'New', more_requested: 'More needed', admitted: 'Admitted', declined: 'Declined', withdrawn: 'Withdrawn',
});
export const FLAG_WORD = Object.freeze({
  self_account: 'Possible self-referral',
  self_email_domain: 'Same email domain as the influencer',
  self_card: 'Same card as the influencer’s account',
  loop: 'Referral loop',
  velocity: 'Sign-up velocity',
});

const nf = (n) => Number(n).toLocaleString('en-US');

/** A count the Worker sent: a number, a masked group, or an absence. */
export function countWord(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return nf(v);
  if (v && typeof v === 'object') {
    if (Number.isFinite(Number(v.fewer_than))) return FEWER_THAN(Number(v.fewer_than));
    if (v.available === false) return absenceWord(v.reason);
  }
  return NOT_RECORDED;
}

/** Why a figure is not drawn, in the page's words. */
export function absenceWord(reason) {
  if (reason === 'hq_reads') return HQ_READS;
  if (reason === 'unreadable') return COULD_NOT_READ;
  return NOT_RECORDED;
}

/** Cents in one currency: "$12.50", "€16.00"; a code the browser does not know reads "12.50 XYZ". */
export function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return NOT_RECORDED;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || '').toUpperCase() }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * A money column's lines (in11d): one per currency, never summed; "HQ reads"
 * for an admin; "None yet" when the Super Admin reads an empty list, which is
 * a recorded none, not a missing figure.
 */
export function moneyLines(field, key = 'earned_cents') {
  if (!field || typeof field !== 'object') return [NOT_RECORDED];
  if (field.available === false) return [absenceWord(field.reason)];
  const list = Array.isArray(field.by_currency) ? field.by_currency : null;
  if (!list) return [NOT_RECORDED];
  if (!list.length) return ['None yet'];
  return list.map((m) => money(m[key], m.currency));
}

/** Whether the viewer reads money at all: a field that is not `hq_reads`. */
export const readsMoney = (field) => !(field && field.available === false && field.reason === 'hq_reads');

/** A reason the Worker will take: trimmed, REASON_MIN to REASON_MAX characters. Returns the error, or null. */
export function reasonError(text) {
  const t = String(text || '').trim();
  if (t.length < REASON_MIN) return `Say why, in at least ${REASON_MIN} characters.`;
  if (t.length > REASON_MAX) return `Keep the reason under ${nf(REASON_MAX)} characters.`;
  return null;
}

/**
 * The row actions (in11b), each with the PATCH body it sends. A paused member
 * resumes; an ended one has none. Take down appears only while a handle exists.
 */
export function rowActions(m) {
  if (!m || m.status === 'ended') return [];
  const out = [{ key: 'tier', label: 'Change tier…' }];
  out.push(m.status === 'paused' ? { key: 'resume', label: 'Resume…' } : { key: 'pause', label: 'Pause…' });
  out.push({ key: 'end', label: 'End…', danger: true });
  if (m.handle) out.push({ key: 'takedown', label: 'Take down handle…', danger: true });
  return out;
}

/** The PATCH body for a row action, or an error sentence. */
export function changeBody(action, { tier = null, reason = '' } = {}) {
  const err = reasonError(reason);
  if (err) return { error: err };
  const r = String(reason).trim();
  if (action === 'tier') {
    if (!TIER_ORDER.includes(tier)) return { error: 'Choose the new tier.' };
    return { body: { tier, reason: r } };
  }
  if (action === 'pause') return { body: { status: 'paused', reason: r } };
  if (action === 'resume') return { body: { status: 'active', reason: r } };
  if (action === 'end') return { body: { status: 'ended', reason: r } };
  if (action === 'takedown') return { body: { handle_takedown: true, reason: r } };
  return { error: 'That action is not known.' };
}

/** The decision body (in11a): admit names a tier; decline and ask for more carry the words the applicant reads. */
export function decisionBody(kind, { tier = null, text = '' } = {}) {
  if (kind === 'admit') return ADMIT_TIERS.includes(tier) ? { body: { admit: tier } } : { error: 'Choose the tier to admit at.' };
  const err = reasonError(text);
  if (err) return { error: err };
  if (kind === 'decline') return { body: { decline: String(text).trim() } };
  if (kind === 'more') return { body: { more: String(text).trim() } };
  return { error: 'That decision is not known.' };
}

/** An application's channels, in the queue's words: kind, link, audience (or "Not given"). */
export function channelsOf(app) {
  const list = Array.isArray(app?.answers?.channels) ? app.answers.channels : [];
  return list.map((c) => ({
    kind: String(c?.kind || 'Other'),
    url: String(c?.url || ''),
    audience: Number.isFinite(Number(c?.audience)) && c?.audience !== null ? nf(c.audience) : 'Not given',
  }));
}

/** The queue's audience column: the sum of the channels' stated audiences, or "Not given" when none was stated. */
export function audienceOf(app) {
  const list = Array.isArray(app?.answers?.channels) ? app.answers.channels : [];
  const given = list.map((c) => Number(c?.audience)).filter((n) => Number.isFinite(n) && n >= 0);
  return given.length ? nf(given.reduce((a, b) => a + b, 0)) : 'Not given';
}

const join = (v) => (Array.isArray(v) && v.length ? v.map(String).join(', ') : 'Not given');
export const regionsOf = (app) => join(app?.answers?.regions);
export const topicsOf = (app) => join(app?.answers?.topics);

/** A day in the page's words: "20 Oct 2026"; nothing reads "Not recorded". */
export function dayWord(iso) {
  if (!iso) return NOT_RECORDED;
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).length <= 19 ? 'Z' : ''));
  if (Number.isNaN(d.getTime())) return NOT_RECORDED;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A tier default's cells (in11c): rate, duration and budget, or "Set per agreement" when the tier leaves it to terms. */
export function defaultCells(t) {
  const rate = t?.percentage_bps == null ? 'Set per agreement' : `${(Number(t.percentage_bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  const duration = t?.duration_invoices == null ? 'Set per agreement' : `${nf(t.duration_invoices)} ${Number(t.duration_invoices) === 1 ? 'invoice' : 'invoices'}`;
  const budget = t?.offer_budget_cents == null ? 'Not set' : money(t.offer_budget_cents, t.currency);
  return { rate, duration, budget };
}

/**
 * The Settings form's body for one tier: a percent becomes basis points, a
 * budget becomes cents, and an empty field is null ("Not set"). Returns the
 * body or an error sentence.
 */
export function defaultsBody({ rate = '', invoices = '', budget = '', currency = 'USD' }) {
  const body = {};
  const r = String(rate).trim();
  if (r === '') body.percentage_bps = null;
  else {
    const n = Number(r);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return { error: 'A rate is a percent above 0 and at most 100.' };
    body.percentage_bps = Math.round(n * 100);
  }
  const i = String(invoices).trim();
  if (i === '') body.duration_invoices = null;
  else {
    const n = Number(i);
    if (!Number.isInteger(n) || n < 1 || n > 120) return { error: 'A duration is from 1 to 120 paid invoices.' };
    body.duration_invoices = n;
  }
  const b = String(budget).trim();
  if (b === '') body.offer_budget_cents = null;
  else {
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return { error: 'An offer budget is an amount above 0.' };
    body.offer_budget_cents = Math.round(n * 100);
  }
  const c = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return { error: 'The currency is a three-letter code, such as USD.' };
  body.currency = c;
  return { body };
}

/** An offer row (in11c), from P4's read: its budget, uses and discount given, each currency on its own line. */
export function offerRow(o) {
  const given = Array.isArray(o?.discount_given) ? o.discount_given.map((g) => money(g.cents, g.currency)) : [typeof o?.discount_given === 'string' ? o.discount_given : NOT_RECORDED];
  return {
    uid: o?.uid,
    discount: o?.discount || NOT_RECORDED,
    plans: Array.isArray(o?.plans) ? o.plans.join(', ') : (o?.plans || NOT_RECORDED),
    budget: o?.budget ? money(o.budget.cents, o.budget.currency) : NOT_RECORDED,
    uses: countWord(o?.uses),
    given: given.length ? given : ['None yet'],
    status: STATUS_WORD[o?.status] || NOT_RECORDED,
    code: o?.code || NOT_RECORDED,
  };
}
