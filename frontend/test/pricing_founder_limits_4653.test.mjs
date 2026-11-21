/**
 * D4653 part 3 (#4653): the owner's two answers of 2026-11-20.
 *
 * A — on /pricing?for=founder each plan card lists its limits (startups,
 * interviews and OKRs, introductions a month, the AI allowance) next to its
 * price, above its button, so the three plans compare in the first view. The
 * other tabs keep their cards as they were.
 *
 * "Views" — the Operating Partner Pro line reads "Partner insights: leads and
 * conversion": nothing counts a profile view (D676).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pricing_founder_limits_4653.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { PLAN_CATALOGUE, publicCatalogue } = await import('../../cloudflare-worker/src/services/planCatalogue.ts');
const { PLAN_CARDS, COMPARE } = await import('../src/lib/sitePricing.js');
const { planCards } = await import('../src/lib/pricingModel.js');

const price = (licence, cents) => ({ licence_key: licence, free: false,
  prices: [{ price_id: `price_${licence.replace(/\W/g, '')}`, unit_amount: cents, currency: 'usd', interval: 'month', interval_count: 1, allowance_microusd: cents * 2_500 }],
  monthly: { unit_amount: cents, currency: 'usd', allowance_microusd: cents * 2_500 }, yearly: null });
const READ = { plans: [price('founder:growth', 7900), price('founder:studio', 24900)] };

// What each founder card must show above its button: one line per kind of limit.
const KINDS = [
  ['startups', /\bstartups?\b/],
  ['interviews and OKRs', /interviews.*OKRs/],
  ['introductions a month', /introductions a month/],
  ['AI allowance', /AI tokens/],
];

test('every founder card carries its four limits, apart from its other lines', () => {
  const { cards } = planCards(READ, PLAN_CARDS.founder, { tab: 'founder' });
  assert.deepEqual(cards.map((c) => c.id), ['free', 'growth', 'studio']);
  for (const card of cards) {
    for (const [kind, re] of KINDS) {
      assert.equal(card.limits.filter((l) => re.test(l)).length, 1, `${card.name}: one ${kind} line among its limits`);
      assert.deepEqual(card.feats.filter((l) => re.test(l)), [], `${card.name}: the ${kind} line is not repeated below the button`);
    }
  }
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.deepEqual(byId.free.limits, ['1 active startup', 'Validate: 5 customer interviews and 3 OKRs', 'Accept up to 3 introductions a month', 'AI runs from AI tokens you top up']);
  assert.deepEqual(byId.growth.limits, ['Unlimited startups', 'Unlimited interviews and OKRs', 'Accept up to 10 introductions a month', '$19.75 of AI tokens a month']);
  assert.deepEqual(byId.studio.limits, ['Unlimited startups', 'Unlimited interviews and OKRs', 'Accept up to 25 introductions a month', '$62.25 of AI tokens a month']);
});

test('a founder limit is a catalogue line: the spec names lines its feats already hold', () => {
  for (const spec of PLAN_CARDS.founder) {
    const entry = PLAN_CATALOGUE.find((p) => p.key === `founder:${spec.id}`);
    for (const line of spec.limits) assert.ok(entry.included.includes(line), `${spec.name}: "${line}" is in the catalogue`);
  }
});

test('the other tabs have no limits block, so their cards are unchanged', () => {
  for (const [tab, specs] of Object.entries(PLAN_CARDS)) {
    if (tab === 'founder') continue;
    const plans = specs.filter((s) => s.match).map((s) => ({ ...price(s.match, 4900), licence_key: s.match }));
    const { cards } = planCards({ plans }, specs, { tab });
    for (const card of cards) {
      assert.deepEqual(card.limits, [], `${tab}/${card.id}`);
      assert.deepEqual(card.feats.slice(0, specs.find((s) => s.id === card.id).feats.length), [...specs.find((s) => s.id === card.id).feats], `${tab}/${card.id}: every line, in order`);
    }
  }
});

test('the card draws its limits after the price and before its button and the other lines', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../src/pages/PricingPage.jsx'), 'utf8');
  const card = src.slice(src.indexOf('function PlanCard('), src.indexOf('function GroupHead('));
  const at = (needle) => { const i = card.indexOf(needle); assert.ok(i > 0, `PlanCard has ${needle}`); return i; };
  const limits = at('card.limits.map(');
  assert.ok(at('axp-price-n') < limits, 'the limits follow the price');
  assert.ok(limits < at('card.button.checkout &&'), 'the limits come before the button');
  assert.ok(limits < at('card.feats.map('), 'and before the rest of the lines');
  assert.match(card, /card\.limits\.length > 0 &&/, 'a card without limits draws no block');
});

test('"Partner insights" claims no views anywhere a partner plan is presented', () => {
  const VIEWS = /\bviews?\b/i;
  const pro = PLAN_CATALOGUE.find((p) => p.key === 'partner:pro');
  assert.ok(pro.included.includes('Partner insights: leads and conversion'));
  for (const row of [...PLAN_CATALOGUE, ...publicCatalogue()]) {
    assert.deepEqual(row.included.filter((l) => VIEWS.test(l)), [], `${row.key} in the catalogue`);
  }
  for (const [tab, specs] of Object.entries(PLAN_CARDS)) {
    for (const spec of specs) assert.deepEqual(spec.feats.filter((l) => VIEWS.test(l)), [], `${tab}/${spec.id}`);
  }
  assert.ok(PLAN_CARDS['operating-partner'].find((s) => s.id === 'pro').feats.includes('Partner insights: leads and conversion'));
  for (const [tab, groups] of Object.entries(COMPARE)) {
    assert.deepEqual(groups.flatMap(([, list]) => list.map((r) => r[0])).filter((l) => VIEWS.test(l)), [], `${tab} comparison`);
  }
  const billing = readFileSync(resolve(import.meta.dirname, '../src/pages/account/BillingSection.jsx'), 'utf8');
  const partner = billing.slice(billing.indexOf('const PERSONA_PLANS'), billing.indexOf('advisor: {', billing.indexOf('const PERSONA_PLANS')));
  assert.doesNotMatch(partner, /\bviews\b/i, "Billing's partner plans");
});
