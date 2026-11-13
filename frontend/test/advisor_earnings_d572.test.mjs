/**
 * D572 (#1183) — Advisor Studio's Earnings module reads its two figures from
 * the routes that hold them.
 *
 * It read `balance_cents` and `lifetime_cents` off `payoutsMe()`, which on
 * the Worker is a bare list of payouts, so both always printed "Not
 * recorded". `earningsFigures` takes the balance from `/commissions/me` and
 * sums COMPLETED payouts for "Lifetime paid", per currency.
 *
 * Run alone:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_earnings_d572.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { earningsFigures } from '../src/pages/advisor/advisorEarnings.js';
import { codeOnly } from './_codeOnly.mjs';

const money = (cents, cur) => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(cents / 100);

test('the balance comes from /commissions/me, and lifetime paid sums completed payouts only', () => {
  const f = earningsFigures(
    { balance_cents: 4200, lifetime_cents: 99999, mixed_currency: false, by_currency: [{ currency: 'USD', balance_cents: 4200 }] },
    [
      { status: 'completed', amount_cents: 1000, currency: 'USD' },
      { status: 'completed', amount_cents: 2500, currency: 'USD' },
      { status: 'requested', amount_cents: 7000, currency: 'USD' },
      { status: 'failed', amount_cents: 9000, currency: 'USD' },
    ],
  );
  assert.equal(f.balance, money(4200, 'USD'));
  assert.equal(f.paid, money(3500, 'USD'), 'a requested or failed payout is not paid; lifetime_cents (every commission ever) is not "paid" either');
});

test('more than one currency is shown per currency, never summed', () => {
  const f = earningsFigures(
    { balance_cents: null, mixed_currency: true, by_currency: [{ currency: 'EUR', balance_cents: 500 }, { currency: 'USD', balance_cents: 700 }] },
    [{ status: 'completed', amount_cents: 300, currency: 'USD' }, { status: 'completed', amount_cents: 200, currency: 'EUR' }],
  );
  assert.equal(f.balance, `${money(500, 'EUR')} · ${money(700, 'USD')}`);
  assert.equal(f.paid, `${money(200, 'EUR')} · ${money(300, 'USD')}`);
});

test('a read in the wrong shape is "Not recorded", never a zero', () => {
  // The old wiring: payoutsMe() answered with the list, and the page read
  // balance_cents off it.
  assert.deepEqual(earningsFigures([], {}), { balance: 'Not recorded', paid: 'Not recorded' });
  assert.deepEqual(earningsFigures(null, null), { balance: 'Not recorded', paid: 'Not recorded' });
  // A list that was read and holds no completed payout is a true zero.
  assert.equal(earningsFigures(null, []).paid, money(0, 'USD'));
});

test('the module reads both routes and renders the computed figures', () => {
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/AdvisorStudioHome.jsx'), 'utf8'));
  assert.match(src, /api\.commissionsMe\(\)/);
  assert.match(src, /<b>\{earnings\.balance\}<\/b>/);
  assert.match(src, /<b>\{earnings\.paid\}<\/b>/);
  assert.doesNotMatch(src, /payouts\.data\.balance_cents|payouts\.data\.lifetime_cents/, 'the list has no totals on it');
});
