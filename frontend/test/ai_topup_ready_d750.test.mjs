/**
 * D750 (#1841) — the AI top-up's three member cases on the rail and the
 * compact card, HQ's readiness sentence, and spend shown to the cent.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ai_topup_ready_d750.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AiBudgetUsage, aiTopupState, usageMoney } from '../src/ui/AiBudgetUsage.jsx';
import { RailUsage } from '../src/ui/WorkerRail.jsx';
import { TOPUP_REASON_LINES, TopUpReadinessCard, topUpStatusLine } from '../src/pages/hq/PlatformAllowancesPage.jsx';

const BUDGET = {
  licence: 'founder:growth', daily_microusd: 5000000, monthly_microusd: 50000000,
  day_spend_microusd: 4999, month_spend_microusd: 29536, balance_microusd: 10000000,
  day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0, held_for_review: [],
};
const READY = { configured: true, state: 'ready', product: { price_id: 'price_TopUp123abc', currency: 'usd', unit_amount: 2500 } };
const CASES = {
  ready: { product: READY, productError: false },
  not_ready: { product: { configured: true, state: 'not_ready' }, productError: false },
  unset: { product: { configured: false }, productError: false },
  unreadable: { product: null, productError: true },
};
const reading = (over) => ({ budget: BUDGET, loading: false, budgetError: false, reload: () => {}, ...over });
const rail = (over) => renderToStaticMarkup(h(RailUsage, { reading: reading(over) }));
const card = (over) => renderToStaticMarkup(h(AiBudgetUsage, { reading: reading(over) }));
// Tags stripped until none is left, so one split by another (`<a<b>>`)
// cannot come back together after a single pass (as _founder_tool_checks.mjs).
const stripTags = (s) => {
  let out = s;
  for (let prev = null; prev !== out;) { prev = out; out = out.replace(/<[^>]*>/g, ''); }
  return out;
};
const words = (html) => stripTags(html).replace(/&#x27;/g, "'").replace(/&lt;/g, '<');

test('usageMoney rounds to the cent, says <$0.01 under half a cent, and keeps large values exact', () => {
  assert.equal(usageMoney(0), '$0.00');
  assert.equal(usageMoney(1), '<$0.01');
  assert.equal(usageMoney(4999), '<$0.01');
  assert.equal(usageMoney(5000), '$0.01');
  assert.equal(usageMoney(14999), '$0.01');
  assert.equal(usageMoney(29536), '$0.03');
  assert.equal(usageMoney(50000000), '$50.00');
  assert.equal(usageMoney(Number.MAX_SAFE_INTEGER), '$9,007,199,254.74');
  assert.equal(usageMoney(1234567894999), '$1,234,567.89');
  assert.equal(usageMoney(1234567895000), '$1,234,567.90');
});

test('the shared reader: ready only with a sellable price; not_ready and unset are unavailable; a failed read is unreadable', () => {
  assert.equal(aiTopupState(READY, false), 'ready');
  assert.equal(aiTopupState({ configured: true, state: 'not_ready' }, false), 'unavailable');
  assert.equal(aiTopupState({ configured: false }, false), 'unavailable');
  assert.equal(aiTopupState(READY, true), 'unreadable');
  assert.equal(aiTopupState(null, false), 'unreadable');
  assert.equal(aiTopupState({ configured: true, product: READY.product }, false), 'unreadable', 'no state is not on sale');
  for (const bad of [{ price_id: 'prod_1' }, { currency: 'eur' }, { unit_amount: 0 }, { unit_amount: 1.5 }]) {
    assert.equal(aiTopupState({ ...READY, product: { ...READY.product, ...bad } }, false), 'unreadable', JSON.stringify(bad));
  }
});

for (const [name, draw] of [['the rail', rail], ['the compact card', card]]) {
  test(`${name}: Add tokens when ready, "isn't available yet" with no Retry when not ready or unset, Unreadable with Retry on a failed read`, () => {
    const ready = draw(CASES.ready);
    assert.match(ready, /href="\/checkout\?ai_topup=1"[^>]*>Add tokens</);
    assert.doesNotMatch(words(ready), /isn't available|could not be read/);
    for (const c of ['not_ready', 'unset']) {
      const html = draw(CASES[c]);
      assert.match(words(html), /Top-up isn't available yet\./, c);
      assert.doesNotMatch(html, /Add tokens|href="\/checkout|Retry|<button|could not be read|role="alert"/, c);
    }
    const bad = draw(CASES.unreadable);
    assert.match(words(bad), /could not be read/);
    assert.match(bad, /Retry<\/button>/);
    assert.doesNotMatch(bad, /Add tokens|isn&#x27;t available/);
  });
  test(`${name}: spend reads to the cent with the exact figure in its title`, () => {
    const html = draw(CASES.ready);
    assert.match(words(html), /<\$0\.01 of \$5\.00/);
    assert.match(words(html), /\$0\.03 of \$50\.00/);
    assert.doesNotMatch(words(html), /\$0\.029536|\$0\.004999/);
    assert.match(html, /title="\$0\.029536/);
    assert.match(html, /title="\$0\.004999/);
  });
}

test('HQ readiness: one plain sentence per reason, the six-character suffix and the mode, never a key', () => {
  for (const reason of Object.keys(TOPUP_REASON_LINES)) {
    const line = topUpStatusLine({ state: 'not_ready', reason, price_id_suffix: '123abc', mode: 'live' });
    assert.ok(line && line.tone === 'warning', reason);
    assert.match(line.text, /Members are told it isn't available yet\.$/);
  }
  assert.equal(topUpStatusLine({ state: 'not_ready', reason: 'not_one_time', price_id_suffix: '123abc', mode: 'live' }).text,
    "STRIPE_PRICE_AI_TOPUP names a recurring price. The top-up needs a one-time USD price. Price …123abc. Members are told it isn't available yet.");
  assert.match(topUpStatusLine({ state: 'not_ready', reason: 'missing_from_catalog', price_id_suffix: '123abc', mode: 'live' }).text,
    /^The price is not in the catalog mirror and Stripe does not know it in live mode\./);
  assert.doesNotMatch(topUpStatusLine({ state: 'not_ready', reason: 'bad_config', price_id_suffix: null, mode: 'test' }).text, /Price …/);
  assert.match(topUpStatusLine({ state: 'ready', reason: null, price_id_suffix: '123abc', mode: 'live' }).text, /on sale \(price …123abc\), live mode/);
  assert.match(topUpStatusLine({ state: 'unset', reason: null, price_id_suffix: null, mode: 'live' }).text, /is not set/);
  assert.equal(topUpStatusLine({ state: 'not_ready', reason: 'invented', mode: 'live' }), null, 'an unknown reason is not guessed');
  assert.equal(topUpStatusLine(null), null);
  const draw = (status) => renderToStaticMarkup(h(MemoryRouter, null, h(TopUpReadinessCard, { status: { reload: () => {}, ...status } })));
  assert.match(draw({ status: 'ready', data: { state: 'ready', reason: null, price_id_suffix: '123abc', mode: 'live' } }), /data-testid="hq-topup-readiness-line"/);
  assert.match(draw({ status: 'error' }), /Retry<\/button>/);
  assert.match(draw({ status: 'ready', data: { state: 'not_ready', reason: 'invented' } }), /Retry<\/button>/);
  assert.match(draw({ status: 'loading' }), /Reading the top-up/);
});
