/**
 * D786 (#2211) part 2 — /pricing to the owner's canvas: a member reads it
 * inside the app shell (top bar and left sidebar), a visitor inside the
 * public site's frame; every card's figure is the catalogue read's; a plan
 * the catalogue does not sell is "Not offered yet"; "Save n%" is computed
 * from the plan's own two prices; AI tokens are never "credits".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pricing_page_d786_part2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  heldCard, modelGroups, modelPrices, packCards, planCards, priceOf, unitPrice, usd, yearlySaving,
} from '../src/lib/pricingModel.js';
import * as COPY from '../src/lib/sitePricing.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const price = (unit_amount, interval) => ({
  price_id: `price_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1,
  allowance_microusd: Math.floor((unit_amount * 2500) / (interval === 'year' ? 12 : 1)),
});
const paid = (family, licence_key, product_id, prices) => ({ family, licence_key, product_id, plan_name: product_id, free: false, prices });
const free = (family, licence_key) => ({ family, licence_key, product_id: null, plan_name: null, free: true, prices: [] });
// The live catalogue's shape on 2026-10-20 (stripe_products): Growth $79, Studio $249,
// Professional $149 or $1,428 a year, Institutional $599 or $5,748 a year.
const READ = {
  plans: [
    free('founder', 'founder:free'), free('investor', 'investor:free'), free('other', 'other'),
    paid('founder', 'founder:growth', 'prod_growth', [price(7900, 'month')]),
    paid('founder', 'founder:studio', 'prod_studio', [price(24900, 'month')]),
    paid('investor', 'investor:professional', 'prod_pro', [price(142800, 'year'), price(14900, 'month')]),
    paid('investor', 'investor:institutional', 'prod_inst', [price(574800, 'year'), price(59900, 'month')]),
  ],
  packs: [],
};
const cardsOf = (tab, opts) => planCards(READ, COPY.PLAN_CARDS[tab], opts).cards;
const byId = (cards, id) => cards.find((c) => c.id === id);

// ================================================================ the frames

test('App mounts /pricing inside the app shell for a member and in the site frame for a visitor', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/pricing" element=\{user \? guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <PricingPage user=\{user\} \/>\) : <PricingPage \/>\} \/>/,
    'a member gets guard(): RequireAuth draws ProtectedLayout, the top bar and the left sidebar');
  const page = read('frontend/src/pages/PricingPage.jsx');
  assert.match(page, /if \(user\) return <MemberPricing user=\{user\} \/>;/);
  assert.match(page, /<SitePage title="Pricing">\s*<PricingBody \/>\s*<\/SitePage>/, 'a visitor gets the site header and footer');
  assert.doesNotMatch(page, /FOUNDER_TIERS|INVESTOR_TIERS|PricingPhone|ui\/phone/);
});

// ================================================================ the cards

test('Founder: the catalogue\'s prices, the canvas\'s names, and the AI each plan includes', () => {
  const cards = cardsOf('founder', {});
  assert.deepEqual(cards.map((c) => c.name), ['Free', 'Validate + Build', 'Raise + Grow']);
  assert.equal(byId(cards, 'free').price, 'Free');
  assert.equal(byId(cards, 'growth').price, '$79');
  assert.equal(byId(cards, 'studio').price, '$249');
  assert.ok(byId(cards, 'growth').feats.includes('$19.75 of AI tokens a month'), '25% of $79');
  assert.ok(byId(cards, 'studio').feats.includes('$62.25 of AI tokens a month'), '25% of $249');
  assert.equal(byId(cards, 'growth').lead, 'Everything in Free, plus:');
  assert.equal(byId(cards, 'free').lead, '');
});

test('a plan the catalogue does not sell is "Not offered yet"; a custom plan never shows a figure', () => {
  const inv = cardsOf('investor', {});
  const plus = byId(inv, 'plus');
  assert.equal(plus.offered, false);
  assert.deepEqual(plus.button, { label: 'Not offered yet', to: null, disabled: true });
  assert.equal(byId(inv, 'professional').price, '$149', 'the catalogue\'s $149, not the canvas\'s $150');
  const inst = byId(inv, 'institutional');
  assert.equal(inst.price, 'Custom');
  assert.equal(inst.button.to, '/contact');
  // Advisor Pro and Operating Partner Pro are not in the catalogue yet.
  assert.equal(byId(cardsOf('advisor', {}), 'pro').button.label, 'Not offered yet');
  const op = byId(cardsOf('operating-partner', {}), 'pro');
  assert.equal(op.name, 'Operating Partner Pro', 'the owner\'s name for the plan');
  assert.equal(op.button.label, 'Not offered yet');
});

test('Yearly: the yearly price per month and what is billed; a missing yearly price says so, never a computed one', () => {
  const inv = cardsOf('investor', { billing: 'yearly' });
  assert.equal(byId(inv, 'professional').price, '$119', '$1,428 ÷ 12');
  assert.equal(byId(inv, 'professional').note, '$1,428 billed yearly');
  assert.ok(byId(inv, 'professional').feats.includes('$29.75 of AI tokens a month'), '25% of $1,428 ÷ 12');
  const founder = cardsOf('founder', { billing: 'yearly' });
  assert.equal(byId(founder, 'growth').price, '$79', 'the monthly price stays: no computed yearly price');
  assert.equal(byId(founder, 'growth').note, 'Yearly not offered yet');
  assert.equal(byId(founder, 'growth').yearlyMissing, true);
});

test('"Save n%" is computed from each plan\'s own two prices, never typed', () => {
  assert.equal(planCards(READ, COPY.PLAN_CARDS.investor, {}).saving, 'Save 20%', '1 − 1428 / (12 × 149) = 20.1%');
  assert.equal(planCards(READ, COPY.PLAN_CARDS.founder, {}).saving, null, 'no founder plan has a yearly price');
  assert.equal(yearlySaving([paid('advisor', 'advisor', 'p', [price(2000, 'month'), price(20400, 'year')])]), 'Save 15%', 'the owner\'s $20 / $204');
  assert.equal(yearlySaving([
    paid('x', 'a', 'a', [price(2000, 'month'), price(20400, 'year')]),
    paid('x', 'b', 'b', [price(14900, 'month'), price(142800, 'year')]),
  ]), 'Save up to 20%');
  assert.equal(planCards(READ, COPY.PLAN_CARDS.advisor, {}).sells, false, 'no Monthly / Yearly switch where nothing is sold');
  assert.doesNotMatch(read('frontend/src/pages/PricingPage.jsx') + read('frontend/src/lib/sitePricing.js'), /Save \d+%|20%|15%/);
});

test('D816\'s read: `monthly`, `yearly` and `yearly_saving_percent` are used as the Worker sends them', () => {
  const d816 = {
    plans: [
      free('founder', 'founder:free'),
      { ...paid('founder', 'founder:growth', 'prod_growth', [price(7900, 'month'), price(80580, 'year')]),
        monthly: { unit_amount: 7900, currency: 'usd', allowance_microusd: 19_750_000 },
        yearly: { unit_amount: 80580, currency: 'usd', allowance_microusd: 16_787_500 },
        yearly_saving_percent: 15 },
      { ...paid('founder', 'founder:studio', 'prod_studio', [price(24900, 'month')]), monthly: { unit_amount: 24900, currency: 'usd', allowance_microusd: 62_250_000 }, yearly: null, yearly_saving_percent: null },
    ],
  };
  const built = planCards(d816, COPY.PLAN_CARDS.founder, { billing: 'yearly' });
  assert.equal(built.saving, 'Save 15%', 'the Worker\'s percent');
  assert.equal(byId(built.cards, 'growth').price, '$67.15', '$805.80 ÷ 12, to the cent');
  assert.equal(byId(built.cards, 'growth').note, '$805.80 billed yearly');
  assert.equal(byId(built.cards, 'studio').note, 'Yearly not offered yet', 'yearly: null is no yearly price');
  // `yearly: null` wins over a yearly row left in `prices`: the Worker's word is final.
  assert.equal(priceOf({ prices: [price(100, 'year')], yearly: null }, 'year'), null);
});

test('the buttons: a visitor registers; a member\'s own plan is "Current plan"; another plan opens its product', () => {
  const visitor = cardsOf('founder', {});
  assert.deepEqual(byId(visitor, 'growth').button, { label: 'Get started', to: '/register?lane=founder', disabled: false });
  const member = cardsOf('founder', { held: 'growth', signedIn: true });
  assert.equal(byId(member, 'growth').current, true);
  assert.deepEqual(byId(member, 'growth').button, { label: 'Current plan', to: null, disabled: true });
  assert.deepEqual(byId(member, 'studio').button, { label: 'Upgrade', to: '/pricing/products/prod_studio', disabled: false });
  assert.deepEqual(byId(member, 'free').button, { label: 'Manage plan', to: '/account/billing', disabled: false });
});

test('heldCard reads the session\'s own tier, for the member\'s own role\'s tab only', () => {
  assert.equal(heldCard(null, null, 'founder'), null, 'a visitor holds nothing');
  assert.equal(heldCard({ subscription_tier: 'studio' }, 'founder', 'founder'), 'studio');
  assert.equal(heldCard({}, 'founder', 'founder'), 'free');
  assert.equal(heldCard({ subscription_tier: 'studio' }, 'founder', 'investor'), null);
  assert.equal(heldCard({ subscription_tier: 'growth' }, 'investor', 'founder'), null, 'an investor holds no founder plan');
  assert.equal(heldCard({ investor_tier: 'professional' }, 'investor', 'investor'), 'professional');
  // D1049 (#2900): an Operating Partner's plan is read from their plan status, not assumed Basic.
  assert.equal(heldCard({}, 'partner', 'operating-partner'), null, 'nothing marked before the plan status is read');
  assert.equal(heldCard({}, 'partner', 'operating-partner', { status: 'ready', body: { plan_group: 'partner', status: 'free' } }), 'free');
});

test('an unreadable read is "Prices unavailable", not an empty tab', () => {
  assert.deepEqual(planCards(null, COPY.PLAN_CARDS.founder), { unreadable: true });
  assert.deepEqual(planCards({ detail: 'x' }, COPY.PLAN_CARDS.founder), { unreadable: true });
  assert.match(read('frontend/src/pages/PricingPage.jsx'), /Prices unavailable\. Try again\./);
});

// ================================================================ models and packs

test('Models: the canvas\'s groups are the Worker\'s, in order, and each price keeps three figures', () => {
  const worker = read('cloudflare-worker/src/services/ai/publicModels.ts');
  const block = worker.slice(worker.indexOf('export const MODEL_GROUPS'), worker.indexOf('] as const);'));
  const names = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...COPY.MODEL_GROUPS], names);
  const groups = modelGroups([{ id: 'a', group: 'Safety' }, { id: 'b', group: 'Reasoning' }, { id: 'c', group: 'Reasoning' }], COPY.MODEL_GROUPS);
  assert.deepEqual(groups.map((g) => [g.t, g.rows.length]), [['Reasoning', 2], ['Safety', 1]], 'empty groups are left out');
  assert.equal(unitPrice(0.3), '$0.300');
  assert.equal(unitPrice(0.0475), '$0.0475');
  assert.equal(unitPrice(4.881), '$4.88');
  assert.deepEqual(modelPrices({ billed: { tokens_out: 1.2, tokens_in: 0.3 }, unit_words: { tokens_in: 'per 1M input tokens', tokens_out: 'per 1M output tokens' } }).map((p) => p.label),
    ['per 1M input tokens', 'per 1M output tokens'], 'input before output');
});

test('packs: the read\'s packs and their live offers; none on sale says so', () => {
  assert.deepEqual(packCards({ packs: [] }), []);
  const [p] = packCards({ packs: [{ uid: 'k1', unit_amount: 2500, credit_microusd: 25_000_000, bonus_microusd: 5_000_000, offer_ends_at: '2026-11-12T00:00:00Z', first_purchase_only: true }] });
  assert.deepEqual(p, { uid: 'k1', price: '$25', use: '$25 of AI use', offers: ['+20% bonus until 12 Nov', 'First purchase only'] });
  assert.match(read('frontend/src/pages/PricingPage.jsx'), /No token packs are on sale right now\./);
});

// ================================================================ copy

test('the copy: no canvas placeholder, AI tokens never "credits", and the AI is never an advisor', () => {
  const copy = read('frontend/src/lib/sitePricing.js');
  const code = copy.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /\[\$?[\d.n]+\]|\[\d+ \w+\]/, 'a bracketed canvas placeholder reached the page');
  for (const [q, a] of [...COPY.FAQ, ...COPY.FAQ_INVESTOR]) {
    const text = `${q} ${a}`;
    if (/credits/i.test(text)) assert.match(text, /Perks credits/, `"credits" outside Perks: ${q}`);
  }
  assert.match(COPY.FAQ.find(([q]) => q === 'Can I set a spending limit?')[1], /Account › Usage › Limits/, 'D788\'s spend limit exists');
  assert.equal(usd(142800), '$1,428');
  assert.equal(usd(1975), '$19.75');
  assert.equal(priceOf(READ.plans[5], 'year').unit_amount, 142800);
});
