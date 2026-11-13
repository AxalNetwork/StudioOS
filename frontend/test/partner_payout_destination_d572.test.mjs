/**
 * D572 part 3b (#1183) — the payout destination (a label and the last 4
 * characters) on the request form, the history and the admin queue. The
 * leaderboard page this file also pinned was removed (owner, #2297).
 *
 * The worker half is pinned on real SQLite in
 * `cloudflare-worker/test/partner_earnings_3b_d572.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_payout_destination_d572.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import {
  destinationCheck, destinationLine, payoutOptions, payoutRequestBody,
} from '../src/lib/partnerEarnings.js';
import { PayoutRequestForm, PayoutHistory } from '../src/pages/partner/earnings/PartnerEarnings.jsx';
import { PayoutQueue } from '../src/pages/admin/AdminCommissions.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el)).replace(/\s+/g, ' ');

// ── The destination ───────────────────────────────────────────────────────

test('the form\'s destination rule is the route\'s', () => {
  assert.deepEqual(destinationCheck({}), { state: 'none' });
  assert.deepEqual(destinationCheck({ label: ' Main account ', last4: 'ab12' }), { state: 'ok', label: 'Main account', last4: 'AB12' });
  assert.equal(destinationCheck({ label: 'Main', last4: '' }).state, 'incomplete');
  assert.equal(destinationCheck({ label: '', last4: '1234' }).state, 'incomplete');
  assert.equal(destinationCheck({ label: 'x'.repeat(61), last4: '1234' }).state, 'bad_label');
  assert.equal(destinationCheck({ label: 'x'.repeat(60), last4: '1234' }).state, 'ok');
  for (const bad of ['123', '12345', '12-4', '12 4']) assert.equal(destinationCheck({ label: 'Main', last4: bad }).state, 'bad_last4', bad);
});

test('the request body carries the destination only when it is whole', () => {
  const o = { cents: 75000, currency: 'USD' };
  assert.deepEqual(payoutRequestBody(o, 'wire', '', { label: 'Main account', last4: '4821' }),
    { amount_cents: 75000, currency: 'USD', payout_method: 'wire', destination_label: 'Main account', destination_last4: '4821' });
  assert.deepEqual(payoutRequestBody(o, 'wire', '', { label: 'Main account', last4: '' }),
    { amount_cents: 75000, currency: 'USD', payout_method: 'wire' });
  assert.deepEqual(payoutRequestBody(o, 'wire', ''), { amount_cents: 75000, currency: 'USD', payout_method: 'wire' });
});

const COMMISSIONS = [
  { id: 1, amount_cents: 50000, currency: 'USD', status: 'accrued', source_type: 'purchase', created_at: '2026-09-01 10:00:00' },
  { id: 2, amount_cents: 25000, currency: 'USD', status: 'accrued', source_type: 'purchase', created_at: '2026-09-02 10:00:00' },
];

test('the form asks where it is sent, refuses half a destination, and confirms it', () => {
  const plan = payoutOptions(COMMISSIONS);
  const form = html(h(PayoutRequestForm, { state: 'ready', plan, draft: { method: 'wire', destLabel: 'Main', destLast4: '' } }));
  assert.match(form, /data-testid="input-payout-dest-label"/);
  assert.match(form, /data-testid="input-payout-dest-last4"/);
  assert.match(renderedText(form), /Name the destination and give its last 4 characters/);
  assert.match(form, /<button[^>]*disabled=""[^>]*data-testid="button-review-payout"/, 'half a destination can be sent for review');
  const ok = html(h(PayoutRequestForm, { state: 'ready', plan, draft: { method: 'wire', destLabel: 'Main', destLast4: '4821' } }));
  assert.doesNotMatch(ok, /text-payout-dest-error/);
  assert.doesNotMatch(ok, /<button[^>]*disabled=""[^>]*data-testid="button-review-payout"/);
  const confirm = text(h(PayoutRequestForm, { state: 'ready', plan, stage: 'confirm', draft: { optionIndex: 1, method: 'wire', destLabel: 'Main', destLast4: 'ab12' } }));
  assert.match(confirm, /Sent to\s*Main ···· AB12/);
});

const PAYOUTS = [
  { id: 1, uid: 'p1', amount_cents: 50000, currency: 'USD', status: 'requested', payout_method: 'wire', destination_label: 'Main account', destination_last4: '4821', created_at: '2026-10-04 10:00:00', commission_ids: [1] },
  { id: 2, uid: 'p2', amount_cents: 25000, currency: 'USD', status: 'requested', payout_method: 'crypto', destination_label: null, destination_last4: null, created_at: '2026-10-03 10:00:00', commission_ids: [2] },
];

test('the history and the admin queue name the destination, or say none was named', () => {
  assert.equal(destinationLine(PAYOUTS[0]), 'Main account ···· 4821');
  assert.equal(destinationLine(PAYOUTS[1]), null);
  assert.equal(destinationLine({ destination_label: 'Main account', destination_last4: null }), null, 'half a destination is not shown as one');
  const history = html(h(PayoutHistory, { state: 'ready', rows: PAYOUTS }));
  assert.match(renderedText(history.slice(history.indexOf('row-payout-1'), history.indexOf('row-payout-2'))), /to Main account ···· 4821/);
  assert.match(renderedText(history.slice(history.indexOf('row-payout-2'))), /destination not named/);
  const queue = html(h(PayoutQueue, { state: 'ready', rows: PAYOUTS.map((p) => ({ ...p, name: 'Pat Partner' })), view: 'all' }));
  assert.match(queue, /data-testid="text-queue-dest-1">to Main account ···· 4821/);
  assert.doesNotMatch(queue, /text-queue-dest-2/);
  assert.match(renderedText(queue.slice(queue.indexOf('row-queue-2'))), /destination not named/);
});
