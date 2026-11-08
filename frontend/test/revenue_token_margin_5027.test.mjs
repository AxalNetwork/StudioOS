/**
 * D5027 — Revenue renders the token margin the Worker computes (D762) instead of a permanent blank.
 *
 * Mutations checked: margin pinned back to null; a null margin drawn as $0.00; the cost hidden when the margin is
 * unreadable; included-plan usage added into the top-up spend; the top-up figures drawn as $0.00 when every run
 * predates migration 493; the stale "no price is recorded" sentence put back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenPnl, tokenMarginView } from '../src/pages/hq/RevenuePage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const root = new URL('../../', import.meta.url);
const PAGE = codeOnly(readFileSync(new URL('frontend/src/pages/hq/RevenuePage.jsx', root), 'utf8'));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/ /g, ' ').replace(/\s+/g, ' ');
const draw = (token) => text(renderToStaticMarkup(React.createElement(TokenPnl, { token })));

/** The Worker's `token_cost` payload (routes/admin_revenue.ts), with the D762 fields. */
const payload = (o = {}) => ({
  available: true, currency: 'USD', calls: 12, cost_usd: 3.5,
  billed_available: true, member_runs: 10, runs_not_recorded: 2,
  included_in_plans_microusd: 900_000, topup_spend_microusd: 5_000_000, topup_cost_microusd: 2_000_000,
  tokens_given_microusd: 500_000, margin_microusd: 2_500_000, ...o,
});

test('a positive margin is drawn with its parts: top-up spend, top-up cost, tokens given, included in plans, coverage', () => {
  const t = draw(payload());
  assert.match(t, /Token margin \$2\.50/);
  assert.match(t, /Top-up spend \$5\.00/);
  assert.match(t, /Top-up cost \$2\.00/);
  assert.match(t, /Tokens given \$0\.50/);
  assert.match(t, /Included in plans \$0\.90/);
  assert.match(t, /Token cost, platform-wide \$3\.50/);
  assert.match(t, /10 member runs settled; 2 before the charge ledger \(migration 493\) and outside the margin/);
  assert.match(t, /Admin-licence runs are left out/);
  assert.equal(tokenMarginView(payload()).tone, 'positive');
});

test('a zero margin is a real figure, a negative one is drawn as the loss it is', () => {
  const zero = draw(payload({ topup_spend_microusd: 2_500_000, topup_cost_microusd: 2_000_000, tokens_given_microusd: 500_000, margin_microusd: 0 }));
  assert.match(zero, /Token margin \$0\.00/);
  assert.equal(tokenMarginView(payload({ margin_microusd: 0 })).tone, 'zero');
  const neg = payload({ margin_microusd: -1_250_000 });
  assert.match(draw(neg), /Token margin -\$1\.25/);
  assert.equal(tokenMarginView(neg).tone, 'negative');
  assert.match(renderToStaticMarkup(React.createElement(TokenPnl, { token: neg })), /text-red-700[^"]*"[^>]*>-\$1\.25|text-red-700[\s\S]{0,200}-\$1\.25/, 'a loss is toned as one');
  // Sub-cent amounts are not rounded away.
  assert.match(draw(payload({ topup_spend_microusd: 1_500, topup_cost_microusd: 500, tokens_given_microusd: 0, margin_microusd: 1_000 })), /Token margin \$0\.001/);
});

test('every run predating migration 493: the margin and the figures from the charge join are Not recorded, never $0.00', () => {
  const t = payload({ member_runs: 4, runs_not_recorded: 4, topup_spend_microusd: 0, topup_cost_microusd: 0, margin_microusd: null });
  const v = tokenMarginView(t);
  assert.equal(v.state, 'predates');
  assert.equal(v.margin, null);
  assert.equal(v.topupSpend, null, 'a spend of "0" over runs with no charge is not a spend of zero');
  assert.equal(v.topupCost, null);
  assert.match(v.reason, /before the charge ledger|settled before the charge ledger/);
  assert.match(v.reason, /not a margin of zero/);
  const shown = draw(t);
  assert.match(shown, /Token margin Not recorded/);
  assert.match(shown, /Top-up spend Not recorded/);
  assert.match(shown, /Top-up cost Not recorded/);
  assert.doesNotMatch(shown, /Token margin \$0/);
  // What does not need the charge join stays: the tokens HQ gave and the allowance drawn, and the cost.
  assert.match(shown, /Tokens given \$0\.50/);
  assert.match(shown, /Included in plans \$0\.90/);
  assert.match(shown, /Token cost, platform-wide \$3\.50/);
  assert.match(shown, /4 member runs settled; 4 before the charge ledger/);
});

test('cost and margin fail apart: an unreadable ledger leaves the cost on screen with the server\'s reason', () => {
  const t = { available: true, currency: 'USD', calls: 12, cost_usd: 3.5, billed_available: false, billed_reason: 'The AI holds and token ledger could not be read, so the margin is not shown.' };
  const v = tokenMarginView(t);
  assert.equal(v.state, 'margin_unreadable');
  assert.equal(v.cost, '$3.50');
  assert.equal(v.margin, null);
  const shown = draw(t);
  assert.match(shown, /Token cost, platform-wide \$3\.50/, 'the cost is kept');
  assert.match(shown, /Token margin Not recorded/);
  assert.match(shown, /The AI holds and token ledger could not be read, so the margin is not shown\./);
  assert.doesNotMatch(shown, /Top-up spend \$|Top-up cost \$|Tokens given \$|Included in plans \$/, 'no part of an unreadable ledger is drawn');
});

test('an unreadable usage log: nothing is drawn as a number, and the reason is the server\'s', () => {
  const t = { available: false, reason: 'The AI usage log could not be read.' };
  const v = tokenMarginView(t);
  assert.equal(v.state, 'unreadable');
  const shown = draw(t);
  assert.match(shown, /The AI usage log could not be read\./);
  assert.match(shown, /Token margin Not recorded/);
  assert.doesNotMatch(shown, /\$\d/, 'a dollar figure appeared with nothing behind it');
  for (const missing of [null, undefined, {}]) assert.equal(tokenMarginView(missing).state, 'unreadable');
  assert.doesNotMatch(draw(null), /\$\d/);
});

test('included-plan usage is its own figure and never part of the top-up spend or the margin', () => {
  const a = tokenMarginView(payload({ included_in_plans_microusd: 0 }));
  const b = tokenMarginView(payload({ included_in_plans_microusd: 90_000_000 }));
  assert.equal(a.topupSpend, b.topupSpend, 'allowance draws changed the top-up spend');
  assert.equal(a.margin, b.margin, 'allowance draws changed the margin');
  assert.equal(a.included, '$0.00');
  assert.equal(b.included, '$90.00');
  assert.match(draw(payload()), /allowance draws; a plan's price pays for these, so they are not token revenue/);
});

test('a missing field is never defaulted to a number', () => {
  const sparse = tokenMarginView({ available: true, billed_available: true, margin_microusd: 1_000_000 });
  assert.equal(sparse.topupSpend, null);
  assert.equal(sparse.given, null);
  assert.equal(sparse.included, null);
  assert.equal(sparse.coverage, null, 'run counts that were not sent are not shown as 0 of 0');
  assert.equal(sparse.cost, null);
  assert.equal(sparse.margin, '$1.00');
});

test('the page no longer says the price charged is not recorded, and takes no part of the margin from the browser', () => {
  assert.doesNotMatch(PAGE, /no price is recorded/i);
  assert.doesNotMatch(PAGE, /the price charged for it is not/i);
  assert.doesNotMatch(PAGE, /value=\{null\}\s*note="no price/i);
  assert.match(PAGE, /<TokenPnl token=\{token\} \/>/, 'the Token P&L zone does not draw the D762 payload');
  assert.match(PAGE, /tokenView\.margin \?\? <Unrecorded \/>/, 'the stream table row does not draw the margin');
  assert.doesNotMatch(PAGE, /margin_microusd\s*[-+*/]|topup_spend_microusd\s*[-+*/]|[-+*/]\s*\w*\.?(topup_cost|tokens_given)_microusd/, 'the margin is worked out in the browser');
});
