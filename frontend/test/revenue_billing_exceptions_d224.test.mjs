/**
 * D224 — H21 on HQ · Revenue: billing exceptions, the refund as HQ's governed
 * action, and an LTV that says it is not recorded.
 *
 * WHAT IS RENDERED. `BillingExceptions` is pure over its props, so each of its
 * two reads is rendered in every state it can be in — loading, readable,
 * empty and unreadable — and one failing is shown not to blank the other.
 *
 * WHAT IS READ AS SOURCE. The page's wiring (its own refunds read, the zone
 * mounted), the reason floor the SPA shares with the worker, the Billing tab's
 * reason field, and the margin this screen has refused three times (D111,
 * D149, D213): nothing here derives one from `est_cost_usd`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  BillingExceptions, UNAVAILABLE, isOpenDispute, evidenceOverdue,
} from '../src/pages/hq/RevenuePage.jsx';
import { REFUND_REASON_MIN, refundReasonOk } from '../src/lib/refundReason.js';
import { adminConsoleSource } from './_adminConsoles.mjs';
import { revenuePageSource } from './_revenuePage.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(revenuePageSource());
const ADMIN = adminConsoleSource();
const WORKER = raw('cloudflare-worker/src/routes/admin_billing.ts');
// D5037: both refund forms are one component now, the review flow.
const FLOW = codeOnly(raw('frontend/src/components/RefundReviewFlow.jsx'));
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

const NOW = 1_800_000_000;
const render = (props) => renderToStaticMarkup(
  React.createElement(MemoryRouter, null,
    React.createElement(BillingExceptions, { nowSec: NOW, onRetryRefunds: () => {}, onRetryDisputes: () => {}, ...props })),
);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const REFUNDS = {
  available: true,
  window_days: 30,
  source: 'Refunds issued through HQ, from their audit rows. A refund made in the Stripe dashboard is not listed here.',
  count: 2,
  unreadable_rows: 0,
  by_currency: [{ currency: 'EUR', count: 1, amount_cents: 120000 }, { currency: 'USD', count: 1, amount_cents: 2500 }],
  items: [
    { audit_id: 7, refund_id: 're_1', status: 'succeeded', amount_cents: 120000, currency: 'EUR', reason: 'Seat charged twice in March', target_user_id: 30, issued_at: '2026-09-20 10:00:00' },
    { audit_id: 8, refund_id: 're_2', status: 'pending', amount_cents: 2500, currency: 'USD', reason: 'Cancelled inside the window', target_user_id: null, issued_at: '2026-09-21 10:00:00' },
  ],
};
const EMPTY_REFUNDS = { ...REFUNDS, count: 0, by_currency: [], items: [] };
const DISPUTES = {
  ok: true,
  disputes: [
    { id: 'dp_1', amount: 48000, currency: 'eur', status: 'needs_response', due_by: NOW + 86400, has_evidence: false },
    { id: 'dp_2', amount: 320000, currency: 'eur', status: 'needs_response', due_by: NOW - 86400, has_evidence: false },
    { id: 'dp_3', amount: 999, currency: 'eur', status: 'won', due_by: null, has_evidence: true },
  ],
};

// D5039 (canvas RV08) — Billing exceptions in the v2 cockpit: actionable anomalies only, each figure in a value state
// (Loading, Zero, Unavailable are three things), and LTV and the per-branch token margin moved out.
test('readable: refunds per currency, open disputes counted, one row per exception', () => {
  const h = render({ refunds: REFUNDS, disputes: DISPUTES });
  const t = text(h);
  assert.match(t, /Billing exceptions/);
  assert.match(t, /1,200/, 'the EUR refund total is missing');
  assert.match(t, /25/, 'the USD refund total is missing');
  assert.match(t, /Refunds through HQ Last 30 days[\s\S]{0,60} 2 /, 'the refund count is missing or not labelled as the last 30 days');
  assert.match(t, /Open disputes Live[\s\S]{0,60} 2 /, 'a won dispute was counted as open, or an open one was dropped');
  assert.match(t, /1 past evidence deadline/);
  const body = h.split('data-testid="hq-revenue-exceptions"')[1] || '';
  assert.equal((body.match(/<tr/g) || []).length, 4, 'two refunds and two open disputes should be four rows');
  assert.match(t, /Seat charged twice in March/, 'the written reason is not beside its refund');
  assert.match(t, /Dispute · evidence overdue/);
  assert.match(t, /Evidence overdue/);
  assert.match(t, /Account #30/);
});

test('LTV and token margin per branch are not exceptions, and are not drawn here (RV08)', () => {
  for (const props of [{ refunds: REFUNDS, disputes: DISPUTES }, { refunds: null, disputes: null }, { refunds: UNAVAILABLE, disputes: UNAVAILABLE }]) {
    const t = text(render(props));
    assert.doesNotMatch(t, /\bLTV\b/);
    assert.doesNotMatch(t, /Token margin \/ branch/);
  }
  // H5's canvas still drew them; v2's says why they left.
  assert.ok(CANVAS.includes('no store reconciles revenue to account lifetime'));
  assert.ok(raw('design/incoming/Revenue v2 Page.dc.html').includes('LTV and token margin per branch moved out'));
});

test('empty: both stores answered with nothing, and the page says so rather than drawing zeros it did not measure', () => {
  const h = render({ refunds: EMPTY_REFUNDS, disputes: { ok: true, disputes: [] } });
  const t = text(h);
  assert.match(t, /No refund was issued through HQ in the last 30 days and no dispute is open/);
  // A measured zero is drawn as Zero, with its mark, because both reads answered.
  assert.equal((h.match(/data-value-state="zero"/g) || []).length, 2, 'both counts are measured zeros');
  assert.doesNotMatch(t, /could not be read/);
});

test('unreadable refunds: the block says so, and the disputes still draw', () => {
  const h = render({ refunds: UNAVAILABLE, disputes: DISPUTES });
  const t = text(h);
  assert.match(h, /data-testid="hq-revenue-refunds-unreadable"/);
  assert.match(t, /The refunds HQ issued could not be read\. This is not a claim that none were issued\./);
  assert.match(t, /Refunds through HQ Last 30 days[\s\S]{0,60}Unavailable/, 'a failed read drew a figure');
  assert.match(t, /Open disputes Live[\s\S]{0,60} 2 /, 'one failed read blanked the other block');
  assert.doesNotMatch(t, /No refund was issued/, 'a failed read was drawn as an empty one');
});

test('unreadable disputes: the block says so, and the refunds still draw', () => {
  const h = render({ refunds: REFUNDS, disputes: UNAVAILABLE });
  const t = text(h);
  assert.match(h, /data-testid="hq-revenue-disputes-unreadable"/);
  assert.match(t, /Open disputes could not be read\. This is not a claim that there are none\./);
  assert.match(t, /Open disputes Live[\s\S]{0,60}Unavailable/);
  assert.match(t, /Refunds through HQ Last 30 days[\s\S]{0,60} 2 /);
  assert.doesNotMatch(t, /no dispute is open/);
});

test('loading: nothing is drawn as a figure while the reads are out, and loading is not Not recorded', () => {
  const h = render({ refunds: null, disputes: null });
  const t = text(h);
  assert.equal((h.match(/data-value-state="loading"/g) || []).length >= 2, true, 'both counts are drawn as loading');
  assert.doesNotMatch(t, /Not recorded|Unavailable/, 'a read still out is drawn as a figure that does not exist');
  assert.doesNotMatch(t, /could not be read|No refund was issued/);
});

test('a refunds store that answers unavailable shows its own reason', () => {
  const t = text(render({ refunds: { available: false, reason: 'The refund audit rows could not be read.' }, disputes: DISPUTES }));
  assert.match(t, /The refund audit rows could not be read\./);
});

test('open and overdue are decided by Stripe state and the deadline, never guessed', () => {
  assert.equal(isOpenDispute({ status: 'won' }), false);
  assert.equal(isOpenDispute({ status: 'lost' }), false);
  assert.equal(isOpenDispute({ status: 'warning_needs_response' }), true);
  assert.equal(evidenceOverdue({ due_by: NOW - 1, has_evidence: false }, NOW), true);
  assert.equal(evidenceOverdue({ due_by: NOW - 1, has_evidence: true }, NOW), false);
  assert.equal(evidenceOverdue({ due_by: null, has_evidence: false }, NOW), false);
  assert.equal(evidenceOverdue({ due_by: NOW + 1, has_evidence: false }, NOW), false);
});

test('the page mounts the zone and reads refunds through its own endpoint', () => {
  assert.match(PAGE, /<BillingExceptions\b/);
  assert.match(PAGE, /api\.adminBillingRefunds\(\)/);
  assert.match(PAGE, /setRefunds\(UNAVAILABLE\)/, 'a failed refunds read is not recorded as unreadable');
  assert.match(PAGE, /refundForm=\{<RefundReviewFlow onDone=\{loadRefunds\} \/>\}/, 'the refund action is not on Revenue');
  assert.match(FLOW, /api\.adminBillingRefund\(/, 'the review flow does not issue the refund');
});

test('no margin is computed from est_cost_usd on this screen (D111, D149, D213)', () => {
  assert.doesNotMatch(PAGE, /est_cost_usd/);
  assert.doesNotMatch(PAGE, /cost_usd\s*[-/*]|[-/*]\s*\w*\.cost_usd/, 'the token cost is used in arithmetic');
});

test('the reason floor is one number on both sides, and both refund forms require it', () => {
  const m = /export const REFUND_REASON_MIN = (\d+);/.exec(WORKER);
  assert.ok(m, 'the worker no longer exports REFUND_REASON_MIN');
  assert.equal(Number(m[1]), REFUND_REASON_MIN, 'the SPA and the worker disagree on the shortest reason');
  assert.equal(refundReasonOk('x'.repeat(REFUND_REASON_MIN)), true);
  assert.equal(refundReasonOk(` ${'x'.repeat(REFUND_REASON_MIN - 1)} `), false);
  assert.equal(refundReasonOk(undefined), false);
  assert.match(FLOW, /if \(!refundReasonOk\(reason\)\) return \{ error:/, 'the review flow sends a refund without checking its reason');
  assert.match(FLOW, /const body = \{ review_token: token, reason: String\(reason\)\.trim\(\) \};/, 'the reason is not always sent');
  assert.match(ADMIN, /<RefundReviewFlow showStripeFields/, 'the Billing tab does not refund through the review flow');
});

test('Billing stays: its page (D938, /admin/revenue/billing) is linked from Revenue and mounts the panel', () => {
  assert.match(ADMIN, /export function BillingPage\(\) \{[\s\S]*?<BillingPanel \/>/);
  assert.match(PAGE, /to="\/admin\/revenue\/billing"/);
});
