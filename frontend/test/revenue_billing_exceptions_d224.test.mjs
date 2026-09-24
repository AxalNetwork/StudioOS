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
  BillingExceptions, UNAVAILABLE, NOT_RECORDED_H21, isOpenDispute, evidenceOverdue,
} from '../src/pages/hq/RevenuePage.jsx';
import { REFUND_REASON_MIN, refundReasonOk } from '../src/lib/refundReason.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/hq/RevenuePage.jsx'));
const ADMIN = raw('frontend/src/pages/AdminPage.jsx');
const WORKER = raw('cloudflare-worker/src/routes/admin_billing.ts');
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

test('readable: refunds per currency, open disputes counted, one row per exception', () => {
  const h = render({ refunds: REFUNDS, disputes: DISPUTES });
  const t = text(h);
  assert.match(t, /Billing exceptions/);
  assert.match(t, /1,200/, 'the EUR refund total is missing');
  assert.match(t, /25/, 'the USD refund total is missing');
  assert.match(t, /2 issued through HQ in 30 days/);
  assert.match(t, /Disputes open 2 /, 'a won dispute was counted as open, or an open one was dropped');
  assert.match(t, /1 past evidence deadline/);
  const body = h.split('data-testid="hq-revenue-exceptions"')[1] || '';
  assert.equal((body.match(/<tr/g) || []).length, 4, 'two refunds and two open disputes should be four rows');
  assert.match(t, /Seat charged twice in March/, 'the written reason is not beside its refund');
  assert.match(t, /Evidence overdue/);
  assert.match(t, /Account #30/);
});

test('LTV and token margin per branch render Not recorded with the canvas reasons, whatever loaded', () => {
  for (const props of [{ refunds: REFUNDS, disputes: DISPUTES }, { refunds: null, disputes: null }, { refunds: UNAVAILABLE, disputes: UNAVAILABLE }]) {
    const t = text(render(props));
    assert.match(t, /LTV Not recorded /);
    assert.match(t, /Token margin \/ branch Not recorded /);
    assert.ok(t.includes(NOT_RECORDED_H21.ltv));
    assert.ok(t.includes(NOT_RECORDED_H21.tokenMargin));
  }
  // The reasons are the canvas's own, not new ones.
  assert.ok(CANVAS.includes('no store reconciles revenue to account lifetime'));
  assert.ok(CANVAS.includes('gateway cost is an estimate, not a ledger'));
  assert.match(NOT_RECORDED_H21.ltv, /no store reconciles revenue to account lifetime/i);
  assert.match(NOT_RECORDED_H21.tokenMargin, /gateway cost is an estimate, not a ledger/i);
});

test('empty: both stores answered with nothing, and the page says so rather than drawing zeros', () => {
  const t = text(render({ refunds: EMPTY_REFUNDS, disputes: { ok: true, disputes: [] } }));
  assert.match(t, /No refund was issued through HQ in the last 30 days and no dispute is open/);
  assert.match(t, /Refunds \(30d\) None /);
  assert.match(t, /Disputes open 0 /);
  assert.doesNotMatch(t, /could not be read/);
});

test('unreadable refunds: the block says so, and the disputes still draw', () => {
  const h = render({ refunds: UNAVAILABLE, disputes: DISPUTES });
  const t = text(h);
  assert.match(h, /data-testid="hq-revenue-refunds-unreadable"/);
  assert.match(t, /The refunds HQ issued could not be read\. This is not a claim that none were issued\./);
  assert.match(t, /Refunds \(30d\) Not recorded /, 'a failed read drew a figure');
  assert.match(t, /Disputes open 2 /, 'one failed read blanked the other block');
  assert.doesNotMatch(t, /No refund was issued/, 'a failed read was drawn as an empty one');
});

test('unreadable disputes: the block says so, and the refunds still draw', () => {
  const h = render({ refunds: REFUNDS, disputes: UNAVAILABLE });
  const t = text(h);
  assert.match(h, /data-testid="hq-revenue-disputes-unreadable"/);
  assert.match(t, /Open disputes could not be read\. This is not a claim that there are none\./);
  assert.match(t, /Disputes open Not recorded /);
  assert.match(t, /2 issued through HQ/);
  assert.doesNotMatch(t, /no dispute is open/);
});

test('loading: nothing is drawn as a figure while the reads are out', () => {
  const t = text(render({ refunds: null, disputes: null }));
  assert.match(t, /Refunds \(30d\) Not recorded /);
  assert.match(t, /Disputes open Not recorded /);
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
  assert.match(PAGE, /api\.adminBillingRefund\(/, 'the refund action is not on Revenue');
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
  assert.match(PAGE, /refundReasonOk\(f\.reason\)/, 'Revenue sends a refund without checking its reason');
  assert.match(ADMIN, /refundReasonOk\(refForm\.reason\)/, 'the Billing tab sends a refund without checking its reason');
  assert.match(ADMIN, /body\.reason = refForm\.reason\.trim\(\);/, 'the Billing tab no longer always sends the reason');
});

test('the Billing tab stays: the /admin?tab=billing door is linked from Revenue and the panel is still mounted', () => {
  assert.match(ADMIN, /tab === 'billing' && <div data-testid="admin-billing-panel"><BillingPanel \/><\/div>/);
  assert.match(PAGE, /to="\/admin\?tab=billing"/);
});
