/**
 * D4294 (#4294, D4289 P5) — when an influencer may request a payout.
 *
 * The owner's answers in #4289: identity checked (KYC) and a tax form on file
 * (W-9 or W-8BEN); a $50 minimum; monthly; payouts stay manual (the member
 * requests, the Super Admin pays through the D572 queue).
 *
 *   isInfluencer(env, userId)        an admitted influencer: a `referral_partners`
 *                                    row in the `influencers` segment (D-b; P1
 *                                    writes it on admission). Anyone else's
 *                                    payout request is unchanged.
 *   payoutReadiness(env, userId)     IN4's checklist: identity, tax form, the
 *                                    accepted terms, payout method, the minimum
 *                                    and the month. Each item says whether it
 *                                    blocks, and why, in words.
 *   payoutGate(readiness, amount)    the first item that blocks a request, as a
 *                                    named refusal (never a bare 403).
 *
 * THE FIGURES. The payable balance is the member's `accrued` commissions in
 * the terms' currency (a commission P3 holds as pending is not accrued, so it
 * never counts). A failed payout gave its commissions back, so it does not
 * use up the month; any other request does. The month is the calendar month
 * in UTC.
 *
 * NOTHING IDENTIFYING IS LOGGED, and every statement is bound.
 */
import type { Env } from '../../types';
import { isInfluencer } from './membership';

export { isInfluencer };

/** The Influencer terms in force. A new version is accepted again before the next payout. */
export const INFLUENCER_TERMS_VERSION = '2026-11-03';
/** $50, in the minor unit of the terms' currency. */
export const PAYOUT_MINIMUM_CENTS = 5000;
export const TAX_FORM_TYPES = ['w9', 'w8ben'] as const;
export type TaxFormType = typeof TAX_FORM_TYPES[number];
export type TaxFormStatus = 'missing' | 'submitted' | 'accepted' | 'rejected';

export type ReadinessKey = 'identity' | 'tax_form' | 'terms' | 'payout_method' | 'minimum' | 'monthly';
export interface ReadinessItem {
  key: ReadinessKey;
  ready: boolean;
  /** Whether this item stops a payout request. The payout method is given at the request, so it never does. */
  blocks: boolean;
  /** The refusal code a request gets while this item is not ready. */
  code: string;
  /** One sentence for IN4. */
  line: string;
  [k: string]: unknown;
}
export interface Readiness {
  influencer: boolean;
  ready: boolean;
  currency: string;
  minimum_cents: number;
  items: ReadinessItem[];
}

const FORM_WORD: Record<TaxFormType, string> = { w9: 'W-9', w8ben: 'W-8BEN' };

/** The currency of the influencer's terms: the newest signed (or later) terms, else USD. */
export async function termsCurrency(env: Env, userId: number): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT t.currency FROM referral_partner_terms t JOIN referral_partners p ON p.id = t.partner_id
      WHERE p.user_id = ? AND t.status IN ('signed', 'active')
      ORDER BY t.signed_at DESC, t.id DESC LIMIT 1`,
  ).bind(userId).first<{ currency: string }>();
  return row?.currency || 'USD';
}

/** The newest tax form, or null for none. */
export async function latestTaxForm(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT uid, form_type, status, submitted_at, decided_at, decision_reason
       FROM influencer_tax_forms WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(userId).first<{ uid: string; form_type: TaxFormType; status: Exclude<TaxFormStatus, 'missing'>; submitted_at: string; decided_at: string | null; decision_reason: string | null }>();
}

/** The first day of `now`'s calendar month in UTC, as SQLite writes a timestamp. */
export function monthStart(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01 00:00:00`;
}
/** The first day of the next calendar month in UTC, as a date. */
export function nextMonthStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

export async function payoutReadiness(env: Env, userId: number, now: Date = new Date()): Promise<Readiness> {
  const influencer = await isInfluencer(env, userId);
  const currency = await termsCurrency(env, userId);
  const [user, form, accepted, balance, thisMonth, lastDestination] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(kyc_status, 'not_started') AS kyc_status FROM users WHERE id = ?`).bind(userId).first<{ kyc_status: string }>(),
    latestTaxForm(env, userId),
    env.DB.prepare(`SELECT accepted_at FROM influencer_terms_acceptances WHERE user_id = ? AND version = ?`).bind(userId, INFLUENCER_TERMS_VERSION).first<{ accepted_at: string }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM commissions WHERE user_id = ? AND status = 'accrued' AND COALESCE(currency, 'USD') = ?`,
    ).bind(userId, currency).first<{ cents: number }>(),
    env.DB.prepare(
      `SELECT created_at FROM payouts WHERE user_id = ? AND status <> 'failed' AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId, monthStart(now)).first<{ created_at: string }>(),
    env.DB.prepare(
      `SELECT destination_label, destination_last4 FROM payouts WHERE user_id = ? AND destination_last4 IS NOT NULL ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<{ destination_label: string; destination_last4: string }>(),
  ]);

  const kyc = user?.kyc_status || 'not_started';
  const formStatus: TaxFormStatus = form?.status ?? 'missing';
  const payable = Number(balance?.cents) || 0;
  const items: ReadinessItem[] = [
    {
      key: 'identity', ready: kyc === 'approved', blocks: true, code: 'kyc_required', status: kyc,
      line: kyc === 'approved' ? 'Your identity is verified.'
        : kyc === 'pending' ? 'Your identity check is with Axal compliance. Payouts open once it is approved.'
          : 'Verify your identity before you request a payout.',
    },
    {
      key: 'tax_form', ready: formStatus === 'accepted', blocks: true, code: 'tax_form_required', status: formStatus,
      form_type: form?.form_type ?? null,
      reason: formStatus === 'rejected' ? form?.decision_reason ?? null : null,
      line: formStatus === 'accepted' ? `Your ${FORM_WORD[form!.form_type]} is on file.`
        : formStatus === 'submitted' ? `Your ${FORM_WORD[form!.form_type]} is with HQ for review.`
          : formStatus === 'rejected' ? 'HQ could not accept your tax form. Upload a corrected W-9 or W-8BEN.'
            : 'Upload a W-9 (US persons) or a W-8BEN (everyone else) before you request a payout.',
    },
    {
      key: 'terms', ready: !!accepted, blocks: true, code: 'terms_acceptance_required', version: INFLUENCER_TERMS_VERSION,
      accepted_at: accepted?.accepted_at ?? null,
      line: accepted ? 'You accepted the current Influencer terms.' : 'The Influencer terms have changed. Accept the current version before your next payout.',
    },
    {
      key: 'payout_method', ready: !!lastDestination, blocks: false, code: 'payout_method_missing',
      label: lastDestination?.destination_label ?? null, last4: lastDestination?.destination_last4 ?? null,
      line: lastDestination ? `Paid to ${lastDestination.destination_label} ···· ${lastDestination.destination_last4}.`
        : 'Name where to send it when you request your first payout.',
    },
    {
      key: 'minimum', ready: payable >= PAYOUT_MINIMUM_CENTS, blocks: true, code: 'below_payout_minimum',
      payable_cents: payable, currency,
      line: payable >= PAYOUT_MINIMUM_CENTS ? 'Your payable balance is over the minimum.'
        : `A payout needs at least ${(PAYOUT_MINIMUM_CENTS / 100).toFixed(2)} ${currency} payable.`,
    },
    {
      key: 'monthly', ready: !thisMonth, blocks: true, code: 'payout_already_requested_this_month',
      next_on: thisMonth ? nextMonthStart(now) : null,
      line: thisMonth ? `You requested a payout this month. The next one opens on ${nextMonthStart(now)}.` : 'One payout a month.',
    },
  ];
  return { influencer, ready: items.every((i) => i.ready || !i.blocks), currency, minimum_cents: PAYOUT_MINIMUM_CENTS, items };
}

/**
 * The refusal for an influencer's payout request, or null when it may go
 * ahead. `amountCents` and `currency` are the request's: a payout under the
 * minimum, or in a currency other than the terms', is refused too.
 */
export function payoutGate(r: Readiness, amountCents: number, currency: string):
  { status: number; code: string; message: string; extra: Record<string, unknown> } | null {
  if (!r.influencer) return null;
  for (const item of r.items) {
    if (!item.blocks || item.ready) continue;
    return { status: item.key === 'minimum' ? 400 : 403, code: item.code, message: item.line, extra: { readiness: item.key } };
  }
  if (currency !== r.currency) {
    return { status: 400, code: 'payout_currency_not_terms', message: `Your Influencer terms pay in ${r.currency}. Request the payout in ${r.currency}.`, extra: { readiness: 'minimum', currency: r.currency } };
  }
  if (amountCents < r.minimum_cents) {
    return { status: 400, code: 'below_payout_minimum', message: `A payout is at least ${(r.minimum_cents / 100).toFixed(2)} ${r.currency}.`, extra: { readiness: 'minimum' } };
  }
  return null;
}
