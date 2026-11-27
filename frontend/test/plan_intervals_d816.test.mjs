/**
 * D816 (#2262) — the founder and investor checkouts take an interval. The
 * existing API methods send it when the page names one and send the body they
 * always sent when it does not, so every caller today still buys monthly (the
 * investor plan key's own interval). For #2211 part 2's interval switch.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/plan_intervals_d816.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';

async function sent(run) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { await run(); return seen; } finally { globalThis.fetch = realFetch; restore(); }
}

test('the founder checkout sends the interval it is given, and the old body without one', async () => {
  // Mutation checked: drop the interval from the body → the yearly call sends `{ tier }` and buys monthly.
  const seen = await sent(async () => { await api.tierCheckout('growth', 'year'); await api.tierCheckout('studio'); });
  assert.deepEqual(seen.map((s) => [s.url.replace(/^.*\/api/, ''), s.body]), [
    ['/billing/tier/checkout', { tier: 'growth', interval: 'year' }],
    ['/billing/tier/checkout', { tier: 'studio' }],
  ]);
});

test('the investor checkout sends the interval it is given, and the plan key alone without one', async () => {
  // Mutation checked: drop the interval from the body → the yearly request reads as the key's month.
  const seen = await sent(async () => { await api.investorCheckout('investor_pro_monthly', 'year'); await api.investorCheckout('investor_inst_yearly'); });
  assert.deepEqual(seen.map((s) => [s.url.replace(/^.*\/api/, ''), s.body]), [
    ['/billing/investor/checkout', { plan: 'investor_pro_monthly', interval: 'year' }],
    ['/billing/investor/checkout', { plan: 'investor_inst_yearly' }],
  ]);
});
