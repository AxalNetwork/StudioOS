/**
 * D5037 — HQ reviews a refund before money moves: Lookup → Review → Confirm → Step-up → Refund.
 *
 * `RefundReviewFlow` is the one refund form, on Revenue and on the Billing tab. Its pure parts are held here: what the
 * lookup sends, what the confirmation sends (never a target or an amount; an override only with its own reason), and
 * every fact the review shows. The confirmation is only reachable with a review in hand.
 *
 * Mutations checked: the override reason not required; the target sent with the confirmation; "Policy unavailable"
 * drawn as allowed; refunded-to-date dropped from the review; the raw form put back on either page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  confirmBody, reviewLookupBody, reviewRows, POLICY_STATE_LABEL, refundAmountShape,
} from '../src/components/RefundReviewFlow.jsx';
import { REFUND_REASON_MIN } from '../src/lib/refundReason.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const FLOW = codeOnly(raw('frontend/src/components/RefundReviewFlow.jsx'));
const PAGE = codeOnly(raw('frontend/src/pages/hq/RevenuePage.jsx'));
const CONSOLE = codeOnly(raw('frontend/src/pages/admin/consoles/BillingConsole.jsx'));
const REASON = 'Charged twice for the March seat';
const OVERRIDE = 'Owner approved the exception in writing';

/** The Worker's `review` payload (services/refundReview.ts). */
const REVIEW = (o = {}) => ({
  payment_intent: 'pi_1', charge: 'ch_1', currency: 'EUR', customer: 'cus_40',
  account: { known: true, user_id: 40, name: 'Fay', email: 'fay@example.test' },
  gross_cents: 10_000, refunded_cents: 2_000, remaining_cents: 8_000, requested_cents: 3_000, full: false,
  policy: { state: 'allowed', kind: 'tier', reason: null, note: 'A subscription refund should be prorated.', override_required: false },
  clawback: { outcome: 'would_reverse', commission_id: 1, amount_cents: 500, currency: 'EUR', full: false },
  expires_at: '2026-11-08T12:10:00.000Z', ...o,
});

test('the lookup sends one id and the amount as typed, and refuses a malformed one', () => {
  assert.deepEqual(reviewLookupBody({ target: ' pi_123 ', amount: '' }), { body: { payment_intent: 'pi_123' } });
  assert.deepEqual(reviewLookupBody({ target: 'ch_9', amount: '25.50' }), { body: { charge: 'ch_9', amount_major: '25.50' } });
  for (const target of ['', '123', 're_1', 'pi_ x']) assert.ok(reviewLookupBody({ target }).error, target);
  assert.ok(reviewLookupBody({ target: 'pi_1', amount: '-5' }).error);
  assert.equal(refundAmountShape('25.50').ok, true);
});

test('the confirmation carries the review token and the reason, never a target or an amount', () => {
  const { body } = confirmBody({ token: 'tok', review: REVIEW(), reason: ` ${REASON} ` });
  assert.deepEqual(body, { review_token: 'tok', reason: REASON });
  for (const k of ['payment_intent', 'charge', 'amount', 'amount_major']) assert.equal(k in body, false, k);
  assert.ok(confirmBody({ token: null, review: REVIEW(), reason: REASON }).error, 'confirmed without a review');
  assert.ok(confirmBody({ token: 'tok', review: REVIEW(), reason: 'x'.repeat(REFUND_REASON_MIN - 1) }).error);
  const linked = confirmBody({ token: 'tok', review: REVIEW(), reason: REASON, stripeReason: 'duplicate', targetUserId: '40' }).body;
  assert.equal(linked.stripe_reason, 'duplicate');
  assert.equal(linked.target_user_id, 40);
});

test('a blocked or unavailable policy needs the override ticked and its own written reason', () => {
  for (const state of ['blocked', 'unavailable']) {
    const review = REVIEW({ policy: { state, kind: 'incorporation', reason: 'x', note: 'n', override_required: true } });
    const none = confirmBody({ token: 'tok', review, reason: REASON });
    assert.ok(none.error, `${state}: confirmed without an override`);
    if (state === 'unavailable') assert.match(none.error, /could not be resolved/);
    assert.ok(confirmBody({ token: 'tok', review, reason: REASON, override: true, overrideReason: 'short' }).error, `${state}: an override with no reason`);
    const { body } = confirmBody({ token: 'tok', review, reason: REASON, override: true, overrideReason: OVERRIDE });
    assert.equal(body.override_policy, true);
    assert.equal(body.override_reason, OVERRIDE);
  }
  assert.equal('override_policy' in confirmBody({ token: 'tok', review: REVIEW(), reason: REASON, override: true }).body, false,
    'an override was sent for a policy that allows the refund');
});

test('the review shows amount, currency, refunded to date, what is left, the policy and the clawback', () => {
  const rows = Object.fromEntries(reviewRows(REVIEW()));
  assert.equal(rows.Currency, 'EUR');
  assert.equal(rows['Original amount'], '€100.00');
  assert.equal(rows['Refunded to date'], '€20.00');
  assert.equal(rows['Left to refund'], '€80.00');
  assert.equal(rows['This refund'], '€30.00 · partial');
  assert.equal(rows['Product kind'], 'tier');
  assert.match(rows.Policy, /^Allowed by the product policy — A subscription refund should be prorated/);
  assert.equal(rows.Override, 'Not needed');
  assert.equal(rows.Account, 'Account #40 · Fay · fay@example.test');
  assert.match(rows['Referral clawback'], /€5\.00 of referral commission #1 will be reversed/);
  const un = Object.fromEntries(reviewRows(REVIEW({ full: true, requested_cents: 8_000, account: { known: false, reason: 'No account records this Stripe customer.' }, clawback: { outcome: 'unknown' }, policy: { state: 'unavailable', kind: 'incorporation', note: 'No incorporation is recorded.', override_required: true } })));
  assert.equal(un['This refund'], '€80.00 · full: everything left');
  assert.match(un.Policy, /^Policy unavailable — /);
  assert.equal(POLICY_STATE_LABEL.unavailable, 'Policy unavailable');
  assert.match(un.Override, /^Required/);
  assert.match(un.Account, /^Not linked — No account records/);
  assert.match(un['Referral clawback'], /could not be read/);
});

test('both pages refund through the review flow, and no raw refund form is left', () => {
  assert.match(PAGE, /<RefundReviewFlow onDone=\{loadRefunds\} \/>/);
  assert.match(CONSOLE, /<RefundReviewFlow showStripeFields/);
  for (const src of [PAGE, CONSOLE]) {
    assert.doesNotMatch(src, /api\.adminBillingRefund\(/, 'a page issues a refund without a review');
  }
  // The confirm button exists only inside the review, and is disabled until the review's checks pass.
  assert.match(FLOW, /\{review && \(\s*<form onSubmit=\{confirm\}/);
  assert.match(FLOW, /disabled=\{busy \|\| !canConfirm\}/);
  assert.match(FLOW, /setRev\(null\); \/\/ the review is spent/);
  assert.match(FLOW, /adminRefundsApi\.review\(p\.body\)/);
});
