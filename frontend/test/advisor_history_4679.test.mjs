/**
 * #4679 — the Earnings page cannot show an older response under a newer
 * period, cannot file text under the wrong period, and does not call
 * unpaid money "received".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestOnly, draftFitsPeriod, stateTiles } from '../src/pages/advisor/practice/earningsLedger.js';

const PAGE = readFileSync(new URL('../src/pages/advisor/practice/EarningsZone.jsx', import.meta.url), 'utf8');

test('only the latest ticket may write; cancel invalidates everything in flight', () => {
  const t = latestOnly();
  const q2 = t.begin();
  const q3 = t.begin();
  assert.equal(t.isCurrent(q2), false, 'the older quarter’s response is dropped');
  assert.equal(t.isCurrent(q3), true);
  t.cancel();
  assert.equal(t.isCurrent(q3), false, 'a window change drops the draft still in flight');
});

test('text is fileable only against the period it was written for', () => {
  assert.equal(draftFitsPeriod('2026-Q3', '2026-Q3'), true);
  assert.equal(draftFitsPeriod('2026-Q2', '2026-Q3'), false);
  assert.equal(draftFitsPeriod(null, '2026-Q3'), false, 'absent evidence is a refusal');
  assert.equal(draftFitsPeriod('2026-Q3', null), false);
});

const LEDGER = {
  totals: { gross_cents: 75_000 },
  states: {
    billed: { sessions: 1, gross_cents: 10_000 },
    collected: { sessions: 1, gross_cents: 25_000, net_cents: 21_250 },
    written_off: { sessions: 1, gross_cents: 40_000 },
    refunds_owed: { amount_cents: 5_000 }, refunded: { amount_cents: 0 },
    paid_out_cents: 1_000, void_sessions: 2,
  },
};

test('received is the collected net, never the net of everything priced', () => {
  const t = stateTiles(LEDGER);
  assert.equal(t.received_cents, 21_250);
  assert.equal(t.unpaid_cents, 10_000);
  assert.equal(t.written_off_cents, 40_000);
  assert.equal(t.paid_out_cents, 1_000);
  assert.equal(t.void_sessions, 2);
});

test('a ledger without states reads as absent, not zero', () => {
  assert.equal(stateTiles({ totals: {} }), null);
  assert.equal(stateTiles(null), null);
  assert.equal(stateTiles({ states: { collected: {}, paid_out_cents: null } }).paid_out_cents, null);
});

test('the page uses the tickets, sends the period with a note, and labels nothing "received"', () => {
  // Success AND failure paths both check the ticket before writing.
  const n = (re) => (PAGE.match(re) || []).length;
  assert.ok(n(/ledgerTicket\.current\.isCurrent\(t\)/g) >= 2, 'ledger success and error');
  assert.ok(n(/restTicket\.current\.isCurrent\(t\)/g) >= 1, 'note/payout read');
  assert.ok(n(/draftTicket\.current\.isCurrent\(t\)/g) >= 3, 'draft success, error and finally');
  assert.match(PAGE, /period_key: window_\.key/);
  assert.match(PAGE, /draftFitsPeriod\(draftKey, window_\.key\)/);
  // #4834 (D4834): Practice v2 says "recorded", never "you received": nothing
  // the store holds shows money reaching the advisor except a paid payout.
  assert.doesNotMatch(PAGE, /[Yy]ou received/);
  assert.equal(/received \$\{money\(/.test(PAGE), false, 'the AI coverage line must not call any figure received');
});
