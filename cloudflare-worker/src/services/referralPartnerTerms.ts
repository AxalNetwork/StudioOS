/**
 * D958 (#2791, Programs part 5 of #2371) — referral partners' custom terms:
 * what state a terms row is in today, which terms pay a commission, and what
 * a signature does. Routes live in routes/admin_referral_partners.ts; the
 * commission engine (`fireCommissionEvent`, routes/network.ts) reads
 * `termsPayment` before it looks for a standard rule.
 *
 * STATE IS READ, NOT SWEPT. Terms are stored as draft, submitted, approved,
 * sent, signed or ended. A signed row reads `active` from its `starts_on` and
 * `expired` after its `ends_on`; every reader, the engine included, uses
 * `effectiveState` or the same CASE in SQL, so a read and a payment never
 * disagree and nothing has to run at midnight.
 */
import type { Env } from '../types';

export const SEGMENTS = ['event_organisers', 'venture_scouts', 'deal_makers'] as const;
export type Segment = typeof SEGMENTS[number];
export const SEGMENT_LABEL: Record<Segment, string> = {
  event_organisers: 'Event organisers', venture_scouts: 'Venture scouts', deal_makers: 'Deal makers',
};
export const isSegment = (v: unknown): v is Segment => typeof v === 'string' && (SEGMENTS as readonly string[]).includes(v);

export const STORED_STATES = ['draft', 'submitted', 'approved', 'sent', 'signed', 'ended'] as const;
export const READ_STATES = ['draft', 'submitted', 'approved', 'sent', 'signed', 'active', 'ended', 'expired'] as const;
export type ReadState = typeof READ_STATES[number];

/**
 * The standard rules an event pays today (OD4 is open). Only KYC approval
 * calls the engine (routes/kyc.ts); the other four seeded rules have no
 * caller, so terms may not name them and the rules read says `fires: false`.
 */
export const FIRING_RULES: ReadonlySet<string> = new Set(['referral_kyc_approved']);

/** The facts strip's words for Referral partners, in OD3's terms. Part 10 draws them. */
export const FACTS = {
  who: 'Members HQ adds as referral partners, in one of three segments: Event organisers, Venture scouts and Deal makers.',
  join: 'By invitation. HQ adds the partner; their own referral code earns.',
  terms: 'Standard commission rules, or custom terms the Super Admin approves and the partner signs.',
};

export const todayUtc = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** A stored row's state today. */
export function effectiveState(row: { status: string; starts_on: string; ends_on: string | null }, today: string = todayUtc()): ReadState {
  if (row.status === 'signed' || row.status === 'active') {
    if (row.ends_on && row.ends_on < today) return 'expired';
    return row.starts_on <= today ? 'active' : 'signed';
  }
  return row.status as ReadState;
}

// The same rule is written out in SQL where a read filters or counts by state
// (routes/admin_referral_partners.ts), as a CASE over `starts_on` and `ends_on`
// with today bound, never interpolated.

/** The states that hold a partner's dates: a second such row may not overlap them. */
export const LIVE_STATES = ['submitted', 'approved', 'sent', 'signed', 'active'] as const;

/** Do two date ranges overlap? A null end runs on. */
export function rangesOverlap(a: { starts_on: string; ends_on: string | null }, b: { starts_on: string; ends_on: string | null }): boolean {
  const aEnd = a.ends_on ?? '9999-12-31';
  const bEnd = b.ends_on ?? '9999-12-31';
  return a.starts_on <= bEnd && b.starts_on <= aEnd;
}

export type TermsPayment = {
  terms_id: number;
  amount_cents: number;
  currency: string;
  /** Why the amount is what it is, for the commission's description. */
  capped: 'none' | 'per_intro' | 'overall';
};

/**
 * What a referrer's active terms pay for one firing of `ruleKey`, or null when
 * they hold no active terms with that trigger, in which case the standard
 * rule pays. Pure arithmetic over what the caller read:
 *
 *   1. the trigger's flat amount, or its share of `amountForBps`;
 *   2. capped at `cap_per_intro_cents`;
 *   3. capped at what `overall_cap_cents` has left after every commission these
 *      terms already paid, less what refunds reversed.
 *
 * An amount that comes to 0 pays nothing: a spent cap is the terms working.
 */
export function termsAmount(t: {
  terms_id: number; currency: string; amount_cents: number | null; percentage_bps: number | null;
  cap_per_intro_cents: number | null; overall_cap_cents: number | null; paid_so_far_cents: number;
}, amountForBps: number): TermsPayment {
  let amount = t.amount_cents != null ? t.amount_cents : Math.round((Math.max(0, amountForBps) * Number(t.percentage_bps || 0)) / 10000);
  let capped: TermsPayment['capped'] = 'none';
  if (t.cap_per_intro_cents != null && amount > t.cap_per_intro_cents) { amount = t.cap_per_intro_cents; capped = 'per_intro'; }
  if (t.overall_cap_cents != null) {
    const left = Math.max(0, t.overall_cap_cents - Math.max(0, t.paid_so_far_cents));
    if (amount > left) { amount = left; capped = 'overall'; }
  }
  return { terms_id: t.terms_id, amount_cents: Math.max(0, amount), currency: t.currency, capped };
}

/** The referrer's active terms carrying `ruleKey`, with what they have paid so far; null when there are none. */
export async function activeTermsFor(env: Env, referrerUserId: number, ruleKey: string, today: string = todayUtc()) {
  const row = await env.DB.prepare(
    `SELECT t.id AS terms_id, t.currency, t.cap_per_intro_cents, t.overall_cap_cents, g.amount_cents, g.percentage_bps,
            (SELECT COALESCE(SUM(c.amount_cents - COALESCE(c.reversed_amount_cents, 0)), 0) FROM commissions c WHERE c.terms_id = t.id) AS paid_so_far_cents
       FROM referral_partner_terms t
       JOIN referral_partners p ON p.id = t.partner_id
       JOIN referral_partner_term_triggers g ON g.terms_id = t.id AND g.rule_key = ?
      WHERE p.user_id = ? AND t.status IN ('signed', 'active') AND t.starts_on <= ? AND (t.ends_on IS NULL OR t.ends_on >= ?)
      ORDER BY t.starts_on DESC, t.id DESC LIMIT 1`,
  ).bind(ruleKey, referrerUserId, today, today).first<any>();
  if (!row) return null;
  return {
    terms_id: Number(row.terms_id), currency: String(row.currency || 'USD'),
    amount_cents: row.amount_cents == null ? null : Number(row.amount_cents),
    percentage_bps: row.percentage_bps == null ? null : Number(row.percentage_bps),
    cap_per_intro_cents: row.cap_per_intro_cents == null ? null : Number(row.cap_per_intro_cents),
    overall_cap_cents: row.overall_cap_cents == null ? null : Number(row.overall_cap_cents),
    paid_so_far_cents: Number(row.paid_so_far_cents || 0),
  };
}

/** What the engine pays under terms for one firing, or null to fall back to the standard rule. */
export async function termsPayment(env: Env, referrerUserId: number, ruleKey: string, amountForBps: number, today: string = todayUtc()): Promise<TermsPayment | null> {
  const t = await activeTermsFor(env, referrerUserId, ruleKey, today);
  return t ? termsAmount(t, amountForBps) : null;
}

/**
 * The e-sign completion hook (routes/esign.ts): the terms row that names this
 * envelope records its signature and reads `signed`, then `active` from its
 * `starts_on`. Idempotent: a second completion changes nothing.
 */
export async function onReferralTermsEnvelopeCompleted(env: Env, envelopeId: number): Promise<{ changed: boolean; uid: string | null }> {
  const row = await env.DB.prepare(
    `UPDATE referral_partner_terms SET status = 'signed', signed_at = datetime('now'), updated_at = datetime('now')
      WHERE envelope_id = ? AND status = 'sent' RETURNING uid`,
  ).bind(envelopeId).first<{ uid: string }>();
  return { changed: !!row, uid: row?.uid ?? null };
}
