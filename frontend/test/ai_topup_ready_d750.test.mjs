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
import { AiBudgetUsage, usageMoney } from '../src/ui/AiBudgetUsage.jsx';
import { aiTokenState } from '../src/lib/aiTokens.js';
// D755 (#1916): the reader is lib/aiTokens.js's; `not_ready` is D750's "unavailable".
const aiTopupState = (p, productError) => aiTokenState({ error: productError, data: p });
import { RailUsage } from '../src/ui/WorkerRail.jsx';
import { TOPUP_REASON_LINES } from '../src/pages/hq/PlatformAllowancesPage.jsx';
import { TokenPacksCard } from '../src/pages/hq/TokenPacks.jsx';
import { packLine } from '../src/pages/hq/tokenPacksModel.js';

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
  assert.equal(aiTopupState({ configured: true, state: 'not_ready' }, false), 'not_ready');
  assert.equal(aiTopupState({ configured: false }, false), 'not_ready');
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
    assert.match(ready, /href="\/plans-and-pricing#token-packs"[^>]*>Add tokens</);
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
  // D755 (#1986): D750's single line is now the fallback's own line among the packs, said to come from STRIPE_PRICE_AI_TOPUP.
  const fallback = (state, reason, suffix = '123abc', mode = 'live') => packLine({ origin: 'environment', uid: null, label: null, state, reason, price_id_suffix: suffix, adoptable: true }, mode);
  for (const reason of Object.keys(TOPUP_REASON_LINES)) {
    const line = fallback('not_ready', reason);
    assert.ok(line && line.tone === 'warning', reason);
    assert.match(line.text, /^From STRIPE_PRICE_AI_TOPUP: /);
    assert.match(line.text, /Members don't see it\.$/);
  }
  assert.equal(fallback('not_ready', 'not_one_time').text,
    "From STRIPE_PRICE_AI_TOPUP: STRIPE_PRICE_AI_TOPUP names a recurring price. The top-up needs a one-time USD price. Price …123abc. Members don't see it.");
  assert.match(fallback('not_ready', 'missing_from_catalog').text, /^From STRIPE_PRICE_AI_TOPUP: The price is not in the catalog mirror and Stripe does not know it in live mode\./);
  assert.doesNotMatch(fallback('not_ready', 'bad_config', null, 'test').text, /Price …/);
  assert.match(fallback('ready', null).text, /on sale \(price …123abc\), live mode/);
  assert.equal(fallback('not_ready', 'invented'), null, 'an unknown reason is not guessed');
  assert.equal(packLine(null), null);
  const draw = (status) => renderToStaticMarkup(h(MemoryRouter, null, h(TokenPacksCard, { status: { reload: () => {}, ...status } })));
  assert.match(draw({ status: 'ready', data: { mode: 'live', packs: [{ origin: 'environment', uid: null, label: null, state: 'ready', reason: null, price_id_suffix: '123abc', adoptable: true }] } }), /data-testid="hq-pack-line"/);
  assert.match(draw({ status: 'ready', data: { mode: 'live', packs: [] } }), /No token pack is on sale/, 'no fallback set: the unset sentence');
  assert.match(draw({ status: 'error' }), /Retry<\/button>/);
  assert.match(draw({ status: 'ready', data: { mode: 'live', packs: [{ origin: 'environment', state: 'not_ready', reason: 'invented' }] } }), /Retry<\/button>/);
  assert.match(draw({ status: 'loading' }), /Reading the token packs/);
});
