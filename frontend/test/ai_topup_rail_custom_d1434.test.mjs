// D1434 (#3703): the AIRail's Add tokens is connected to the custom amount.
// With no pack on sale, the $1-each custom top-up ($5 to $500) is still a
// top-up the member can buy, so the rail, Usage and Pricing draw it as ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTokenState, sellableCustom } from '../src/lib/aiTokens.js';
import { topUpState as railTopUp } from '../src/ui/WorkerRail.jsx';

const CUSTOM = { price_id: 'price_1UXfXFFA2hGHNbZ5ATCdUAgr', unit_amount: 100, currency: 'usd', min_cents: 500, max_cents: 50000 };
const PACK = { price_id: 'price_pack10', currency: 'usd', unit_amount: 1000 };

test('the custom amount alone makes the top-up ready', () => {
  assert.equal(aiTokenState({ data: { state: 'not_ready', packs: [], custom: CUSTOM } }), 'ready');
  assert.equal(aiTokenState({ data: { state: 'unset', custom: CUSTOM } }), 'ready');
  assert.equal(railTopUp({ state: 'not_ready', packs: [], custom: CUSTOM }, false), 'ready', 'the AIRail draws Add tokens as a link');
});

test('no pack and no custom amount stays not ready; a failed read stays unreadable', () => {
  assert.equal(aiTokenState({ data: { state: 'not_ready', packs: [], custom: null } }), 'not_ready');
  assert.equal(aiTokenState({ error: true, data: { custom: CUSTOM } }), 'unreadable', 'a failed read is never ready');
  assert.equal(aiTokenState({ loading: true, data: { custom: CUSTOM } }), 'loading');
});

test('packs on sale behave as before', () => {
  assert.equal(aiTokenState({ data: { state: 'ready', packs: [PACK], custom: CUSTOM } }), 'ready');
  assert.equal(aiTokenState({ data: { state: 'ready', packs: [PACK] } }), 'ready');
});

test('only a $1 USD price with a whole-dollar range is a custom offer', () => {
  assert.equal(sellableCustom(CUSTOM), true);
  assert.equal(sellableCustom({ ...CUSTOM, unit_amount: 500 }), false, 'not the $1 price');
  assert.equal(sellableCustom({ ...CUSTOM, currency: 'eur' }), false);
  assert.equal(sellableCustom({ ...CUSTOM, price_id: 'nope' }), false);
  assert.equal(sellableCustom({ ...CUSTOM, min_cents: 550 }), false, 'whole dollars only');
  assert.equal(sellableCustom({ ...CUSTOM, min_cents: 60000 }), false, 'min above max');
  assert.equal(sellableCustom(null), false);
});
