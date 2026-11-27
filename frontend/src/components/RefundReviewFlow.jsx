/**
 * D5037 (#5037) — the one way HQ issues a refund: Lookup → Review → Confirm → Step-up → Refund.
 *
 * Revenue's Billing exceptions and the Billing console both mount this. Before D5037 each had a raw form (paste an id,
 * type an amount and a reason, press Refund) and the operator never saw the payment before money moved. Now:
 *
 *   Lookup    the id and an optional amount go to `POST /api/admin/billing/refund/review`, which moves no money;
 *   Review    the payment as Stripe holds it: gross, refunded to date, what is left, the amount asked and whether it is
 *             the whole of it, the customer and account, the product policy and its note, the clawback it would cause;
 *   Confirm   enabled only once a written reason is typed and, when the policy is blocked or UNAVAILABLE, the override
 *             is ticked with its own written reason. One click: the review's token is spent on it and the button stays
 *             disabled while the request runs, and the Worker keys the refund on the review, so a double click is one;
 *   Step-up   the request helper runs the second-factor challenge the Worker asks for;
 *   Refund    the Worker re-reads the payment and refuses when it changed since the review.
 */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { adminRefundsApi } from '../lib/api/adminRefunds.js';
import { formatMinor, parseMinor } from '../lib/money';
import { REFUND_REASON_MIN, refundReasonOk } from '../lib/refundReason';

/** The refund amount as typed, checked for shape only (positive, digits and a point); the charge's currency decides the rest. */
export function refundAmountShape(text) {
  const r = parseMinor(text, 'KWD'); // the widest exponent: a shape check, never the conversion
  if (!r.ok && r.reason !== 'decimals') return { ok: false, message: 'Enter the amount as a positive figure, such as 25 or 25.50.' };
  if (r.ok && r.minor <= 0) return { ok: false, message: 'The amount must be a positive figure.' };
  return { ok: true, text: String(text).trim() };
}

/** What the lookup sends, or why it will not. The amount is sent as typed: the Worker converts it in the charge's currency. */
export function reviewLookupBody({ target, amount }) {
  const t = String(target ?? '').trim();
  if (!/^(pi|ch)_[A-Za-z0-9_]+$/.test(t)) return { error: 'Enter a PaymentIntent (pi_…) or Charge (ch_…) id.' };
  const body = t.startsWith('ch_') ? { charge: t } : { payment_intent: t };
  const a = String(amount ?? '').trim();
  if (a !== '') {
    const shape = refundAmountShape(a);
    if (!shape.ok) return { error: shape.message };
    body.amount_major = shape.text;
  }
  return { body };
}

/** What the confirmation sends, or why it will not. Never a target or an amount: those are the review's. */
export function confirmBody({ token, review, reason, override, overrideReason, stripeReason, targetUserId }) {
  if (!token || !review) return { error: 'Look the payment up and check the review first.' };
  if (!refundReasonOk(reason)) return { error: `Write why this money goes back, in at least ${REFUND_REASON_MIN} characters.` };
  const body = { review_token: token, reason: String(reason).trim() };
  if (review.policy?.override_required) {
    if (!override) {
      return { error: review.policy.state === 'unavailable'
        ? 'The refund policy for this payment could not be resolved. Tick the override and say why to refund it anyway.'
        : 'The product policy blocks this refund. Tick the override and say why to refund it anyway.' };
    }
    if (!refundReasonOk(overrideReason)) return { error: `Say why the policy is overridden, in at least ${REFUND_REASON_MIN} characters.` };
    body.override_policy = true;
    body.override_reason = String(overrideReason).trim();
  }
  if (stripeReason) body.stripe_reason = stripeReason;
  const uid = Number(targetUserId);
  if (String(targetUserId ?? '').trim() !== '' && Number.isSafeInteger(uid) && uid > 0) body.target_user_id = uid;
  return { body };
}

export const POLICY_STATE_LABEL = Object.freeze({
  allowed: 'Allowed by the product policy',
  blocked: 'Blocked by the product policy',
  unavailable: 'Policy unavailable',
});

const CLAWBACK_LABEL = {
  no_commission: 'No referral commission was earned on this payment.',
  already_reversed: 'The referral commission is already fully reversed.',
  unknown: 'The referral commission ledger could not be read, so the clawback is not known.',
};

const amt = (cents, currency) => (cents === null || cents === undefined ? null : (formatMinor(Number(cents), currency) ?? `${Number(cents).toLocaleString()} minor units (currency not recorded)`));

/** The review as labelled rows. Pure, so a test can hold every fact the operator sees to the payload. */
export function reviewRows(r) {
  if (!r) return [];
  const c = r.currency;
  const account = r.account?.known
    ? `Account #${r.account.user_id}${r.account.name ? ` · ${r.account.name}` : ''}${r.account.email ? ` · ${r.account.email}` : ''}`
    : `Not linked — ${r.account?.reason || 'no account is recorded'}`;
  const cb = r.clawback || {};
  const clawback = cb.outcome === 'would_reverse'
    ? `${amt(cb.amount_cents, cb.currency)} of referral commission #${cb.commission_id} will be reversed${cb.full ? ' (all of it)' : ''}.`
    : (CLAWBACK_LABEL[cb.outcome] || 'Not known.');
  return [
    ['Payment', [r.payment_intent, r.charge].filter(Boolean).join(' · ')],
    ['Customer', r.customer || 'Not recorded'],
    ['Account', account],
    ['Product kind', r.policy?.kind || 'unknown'],
    ['Currency', c || 'Not one StudioOS can price in'],
    ['Original amount', amt(r.gross_cents, c)],
    ['Refunded to date', amt(r.refunded_cents, c)],
    ['Left to refund', amt(r.remaining_cents, c)],
    ['This refund', `${amt(r.requested_cents, c)} · ${r.full ? 'full: everything left' : 'partial'}`],
    ['Policy', `${POLICY_STATE_LABEL[r.policy?.state] || r.policy?.state} — ${r.policy?.note || ''}`.trim()],
    ['Override', r.policy?.override_required ? 'Required: tick it and say why below' : 'Not needed'],
    ['Referral clawback', clawback],
  ];
}

/** Worker codes that mean "the review no longer holds": start again from the lookup. */
const RESTART = new Set(['review_stale', 'review_expired', 'review_invalid', 'review_required']);

export default function RefundReviewFlow({ onDone, showStripeFields = false }) {
  const [look, setLook] = useState({ target: '', amount: '' });
  const [rev, setRev] = useState(null); // { review, token }
  const [f, setF] = useState({ reason: '', override: false, overrideReason: '', stripeReason: '', targetUserId: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const lookup = async (e) => {
    e.preventDefault();
    if (busy) return;
    const p = reviewLookupBody(look);
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    setBusy(true); setMsg(null); setRev(null);
    try {
      const r = await adminRefundsApi.review(p.body);
      setRev({ review: r.review, token: r.review_token });
      setF({ reason: '', override: false, overrideReason: '', stripeReason: '', targetUserId: r.review?.account?.known ? String(r.review.account.user_id) : '' });
    } catch (err) {
      const d = err?.data || {};
      setMsg({ err: true, text: d.error || err.message || 'The payment could not be looked up. Nothing was refunded.' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (busy || !rev) return;
    const p = confirmBody({ token: rev.token, review: rev.review, ...f });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.adminBillingRefund(p.body);
      const claw = r.clawback?.outcome && r.clawback.outcome !== 'no_commission' ? ` · clawback ${r.clawback.outcome}` : '';
      setMsg({ err: false, text: `Refund ${r.refund?.id || ''} ${r.refund?.status || 'issued'}${claw}.`.replace(/\s+/g, ' ') });
      setRev(null); // the review is spent
      setLook({ target: '', amount: '' });
      onDone?.(r);
    } catch (err) {
      const d = err?.data || {};
      if (RESTART.has(d.code)) setRev(null);
      setMsg({ err: true, text: d.error || err.message || 'The refund was not issued.' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] dark:text-gray-100';
  const review = rev?.review;
  const needsOverride = Boolean(review?.policy?.override_required);
  const canConfirm = Boolean(rev) && !confirmBody({ token: rev?.token, review, ...f }).error;
  return (
    <div className="mt-4 border-t border-axal-hairline pt-3" data-testid="refund-review-flow">
      <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Issue a refund · look up, review, confirm · step-up</div>
      <form onSubmit={lookup} className="mt-2 grid gap-2 sm:grid-cols-3" data-testid="refund-lookup">
        <input className={input} placeholder="pi_… or ch_…" value={look.target} onChange={(e) => { setLook((x) => ({ ...x, target: e.target.value })); setRev(null); }} aria-label="PaymentIntent or Charge id" data-testid="refund-target" />
        <input className={input} type="text" inputMode="decimal" autoComplete="off" placeholder="Amount (blank refunds all that is left)" value={look.amount} onChange={(e) => { setLook((x) => ({ ...x, amount: e.target.value })); setRev(null); }} aria-label="Amount" data-testid="refund-amount" />
        <button type="submit" disabled={busy} className="rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-bold disabled:opacity-50 dark:text-gray-100" data-testid="refund-lookup-submit">
          {busy && !rev ? 'Looking up…' : 'Look up and review'}
        </button>
      </form>
      <p className="mt-1 text-[10.5px] text-axal-faint">Looking up moves no money. Nothing is refunded until you confirm the review.</p>

      {review && (
        <form onSubmit={confirm} className="mt-3 rounded-xl border border-axal-hairline p-3" data-testid="refund-review">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Review</div>
            <span className={`text-[10.5px] font-bold ${review.policy?.state === 'allowed' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="refund-policy-state">
              {POLICY_STATE_LABEL[review.policy?.state] || review.policy?.state}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[max-content_1fr]">
            {reviewRows(review).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-axal-faint">{k}</dt>
                <dd className="tabular-nums text-axal-ink dark:text-gray-100">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
          <textarea className={`${input} mt-3`} rows={2} placeholder={`Why this money goes back, at least ${REFUND_REASON_MIN} characters — read by whoever audits it`} value={f.reason} onChange={(e) => set('reason', e.target.value)} aria-label="Reason" data-testid="refund-reason" />
          {needsOverride && (
            <div className="mt-2 rounded-lg border border-red-300 p-2 dark:border-red-500/40" data-testid="refund-override">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-red-800 dark:text-red-300">
                <input type="checkbox" checked={f.override} onChange={(e) => set('override', e.target.checked)} data-testid="refund-override-box" />
                {review.policy.state === 'unavailable'
                  ? 'Override: refund although the policy could not be resolved'
                  : 'Override: refund although the policy blocks it'}
              </label>
              <textarea className={`${input} mt-2`} rows={2} placeholder={`Why the policy is overridden, at least ${REFUND_REASON_MIN} characters — recorded in Stripe and the audit row`} value={f.overrideReason} onChange={(e) => set('overrideReason', e.target.value)} aria-label="Override reason" data-testid="refund-override-reason" />
            </div>
          )}
          {showStripeFields && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select className={input} value={f.stripeReason} onChange={(e) => set('stripeReason', e.target.value)} aria-label="Stripe category">
                <option value="">Stripe category (optional)</option>
                <option value="requested_by_customer">Requested by customer</option>
                <option value="duplicate">Duplicate</option>
                <option value="fraudulent">Fraudulent</option>
              </select>
              <input className={input} type="text" inputMode="numeric" placeholder="Account id for the audit (optional)" value={f.targetUserId} onChange={(e) => set('targetUserId', e.target.value)} aria-label="Account id" />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !canConfirm} className="rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50" data-testid="refund-confirm">
              {busy ? 'Refunding…' : `Confirm refund of ${amt(review.requested_cents, review.currency)}`}
            </button>
            <button type="button" disabled={busy} onClick={() => { setRev(null); setMsg(null); }} className="text-[11.5px] underline text-axal-muted">Start over</button>
            <span className="text-[11px] text-axal-faint">Asks for your second factor, then writes one audit row. The review expires {String(review.expires_at || '').slice(11, 16)} UTC.</span>
          </div>
        </form>
      )}
      {msg && <p className={`mt-2 text-[11.5px] ${msg.err ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</p>}
    </div>
  );
}
