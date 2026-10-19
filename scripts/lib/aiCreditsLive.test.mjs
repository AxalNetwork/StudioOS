// D755 CR10 (#1987) — the read-only AI credits live check: a good answer
// passes, a missing route warns, and a malformed one fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePlansBody, judgePlansResponse, judgePricingShell } from './aiCreditsLive.mjs';

/** The public read as CR2 (#1919) serves it. */
const good = () => ({
  plans: [
    { family: 'founder', licence_key: 'founder:free', product_id: null, plan_name: null, free: true, prices: [],
      allowance: { daily_microusd: 5000000, monthly_microusd: 50000000, source: 'environment' } },
    { family: 'founder', licence_key: 'founder:growth', product_id: 'prod_growth', plan_name: 'Validate + Build', free: false,
      prices: [{ price_id: 'price_growth', unit_amount: 4900, currency: 'usd', interval: 'month', interval_count: 1 }],
      allowance: { daily_microusd: 1000000, monthly_microusd: 5000000, source: 'recorded' } },
    { family: 'market_intelligence', licence_key: null, product_id: 'prod_mi', plan_name: 'Market Intelligence Pro', free: false,
      prices: [{ price_id: 'price_mi', unit_amount: 1900, currency: 'usd', interval: 'month', interval_count: 1 }], allowance: null },
  ],
  packs: [
    { uid: 'pack10', label: '$10 of tokens', price_id: 'price_pack10', unit_amount: 1000, currency: 'usd', credit_microusd: 10000000, bonus_microusd: 0 },
    { uid: null, label: '$12.50 of tokens', price_id: 'price_env', unit_amount: 1250, currency: 'usd', credit_microusd: 12500000, bonus_microusd: 1250000 },
  ],
  covers: 'Covers Eadwyn and the AI tools on every page, Validate interview sessions and live transcription, at the rates on your Usage page.',
  resets: 'Resets at 00:00 UTC each day and on the 1st each month.',
});
const json = (body, extra = {}) => ({ status: 200, contentType: 'application/json; charset=UTF-8', cacheControl: 'public, max-age=60', text: JSON.stringify(body), ...extra });

test('a good answer passes with no warning', () => {
  assert.deepEqual(judgePlansResponse(json(good())), { errors: [], warnings: [] });
  assert.deepEqual(judgePlansBody({ ...good(), packs: [] }), { errors: [], warnings: [] }, 'no pack on sale is a good answer');
});

test('a route not deployed yet warns, and never fails', () => {
  for (const res of [
    { status: 404, contentType: 'application/json', text: '{"detail":"Not found"}' },
    { status: 405, contentType: 'text/plain', text: '' },
    { status: 200, contentType: 'text/html; charset=utf-8', text: '<!doctype html><div id="root"></div>' },
  ]) {
    const r = judgePlansResponse(res);
    assert.deepEqual(r.errors, [], JSON.stringify(res));
    assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /not deployed yet/);
  }
  assert.match(judgePlansResponse(json(good(), { cacheControl: '' })).warnings[0], /no max-age/);
});

test('a malformed or failing answer fails', () => {
  const bad = [
    ['HTTP 503', { status: 503, contentType: 'application/json', text: '{}' }, /HTTP 503/],
    ['not JSON', { status: 200, contentType: 'application/json', text: '<html>' }, /not JSON/],
    ['valid JSON served as plain text', json(good(), { contentType: 'text/plain' }), /text\/plain, not JSON/],
    ['an array', json([]), /not a JSON object/],
  ];
  for (const [name, res, want] of bad) {
    const r = judgePlansResponse(res);
    assert.ok(r.errors.length > 0, name); assert.match(r.errors.join('\n'), want, name);
  }
  const mutate = (fn) => { const b = good(); fn(b); return judgePlansBody(b).errors.join('\n'); };
  const cases = [
    [(b) => { b.plans = []; }, /plans is not a non-empty array/],
    [(b) => { delete b.packs; }, /packs is not an array/],
    [(b) => { b.plans[0].family = 'gold'; }, /family/],
    [(b) => { b.plans[0].licence_key = 7; }, /licence_key/],
    [(b) => { b.plans[1].prices = null; }, /prices is not an array/],
    [(b) => { b.plans[1].prices[0].unit_amount = 49.5; }, /prices\[0\]/],
    [(b) => { b.plans[1].allowance = { daily_microusd: 1, monthly_microusd: -1, source: 'recorded' }; }, /allowance/],
    [(b) => { b.plans[1].allowance.source = 'guessed'; }, /allowance/],
    [(b) => { b.packs[0].label = '10 tokens'; }, /label/],
    [(b) => { b.packs[0].price_id = 'prod_x'; }, /price_id/],
    [(b) => { b.packs[0].unit_amount = 499; b.packs[0].credit_microusd = 4990000; }, /unit_amount/],
    [(b) => { b.packs[0].currency = 'eur'; }, /currency/],
    [(b) => { b.packs[0].credit_microusd = 12500000; }, /face value/],
    [(b) => { b.packs[0].bonus_microusd = 1000001; }, /10%/],
    [(b) => { b.packs[0].uid = 5; }, /uid/],
    [(b) => { b.covers = ' '; }, /covers/],
    [(b) => { delete b.resets; }, /resets/],
    [(b) => { b.plans[1].allowance.recorded_by = 1; }, /names a person: recorded_by/],
    [(b) => { b.plans[1].recorded_by_name = 'Owner'; }, /recorded_by_name/],
    [(b) => { b.packs[0].user_id = 2; }, /user_id/],
  ];
  for (const [fn, want] of cases) assert.match(mutate(fn), want, String(fn));
});

test('/plans-and-pricing must be the SPA shell', () => {
  assert.deepEqual(judgePricingShell({ status: 200, contentType: 'text/html; charset=utf-8', text: '<!doctype html><div id="root"></div>' }), { errors: [], warnings: [] });
  for (const [res, want] of [
    [{ status: 404, contentType: 'text/html', text: '' }, /HTTP 404/],
    [{ status: 200, contentType: 'application/json', text: '{"detail":"Not found"}' }, /not HTML/],
    [{ status: 200, contentType: 'text/html', text: '<html>maintenance</html>' }, /not the SPA shell/],
  ]) assert.match(judgePricingShell(res).errors.join('\n'), want);
});
