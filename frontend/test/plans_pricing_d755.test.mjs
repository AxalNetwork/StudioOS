// D755 (#1915, CR5 PR 2) — /plans-and-pricing: every plan family's card shows
// its AI allowance from the public plans-and-packs read, the free plans get
// cards, the phone lists every family, and a read that fails says Unreadable,
// never "$0.00". The Token packs section is CR7's (checkout_token_pack_d755).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import BundleCard from '../src/components/products/BundleCard.jsx';
import FreePlanCard from '../src/components/products/FreePlanCard.jsx';
import { bundleContentFor, isBundleProduct } from '../src/components/products/productsShared.js';
import {
  allowanceLine, planAi, planOf, planForProduct, freePlans,
  phonePlans, planPriceLabel, FAMILY_LABELS, NO_ALLOWANCE, ALLOWANCE_UNREADABLE,
  TOP_UP_WITH_PACKS, YOUR_PLAN, TOKEN_PACKS_ID,
} from '../src/lib/plansPricing.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const ready = (data) => ({ status: 'ready', data });
const LOADING = { status: 'loading', data: null };
const UNREADABLE = { status: 'unreadable', data: null };

const COVERS = 'Covers Eadwyn and the AI tools on every page, Validate interview sessions and live transcription, at the rates on your Usage page.';
const RESETS = 'Resets on the 1st of each month at 00:00 UTC.';
// D783 (#2124): a plan includes 25% of its price each month, with no day figure; no plan, none.
const A = (m) => ({ share: 0.25, monthly_microusd: m, source: m ? 'plan' : 'none' });
const line = (m) => `Includes ${m} of AI each month: 25% of the price. Past it, runs use your tokens.`;
const month = (cents, id) => [{ price_id: id, unit_amount: cents, currency: 'usd', interval: 'month', interval_count: 1 }];
// What CR2's read answers (services/aiCredits.ts `plansAndPacks`), one plan per family.
const READ = {
  plans: [
    { family: 'founder', licence_key: 'founder:free', product_id: null, plan_name: null, free: true, prices: [], allowance: A(0) },
    { family: 'investor', licence_key: 'investor:free', product_id: null, plan_name: null, free: true, prices: [], allowance: A(0) },
    { family: 'other', licence_key: 'other', product_id: null, plan_name: null, free: true, prices: [], allowance: A(0) },
    { family: 'founder', licence_key: 'founder:growth', product_id: 'prod_growth', plan_name: 'Validate + Build', free: false, prices: month(2000, 'price_g'), allowance: A(5_000_000) },
    { family: 'investor', licence_key: 'investor:professional', product_id: 'prod_pro', plan_name: 'Investor — Professional', free: false, prices: month(4900, 'price_ip'), allowance: A(12_250_000) },
    { family: 'advisor', licence_key: 'advisor', product_id: 'prod_adv', plan_name: 'Advisor', free: false, prices: month(2900, 'price_a'), allowance: A(7_250_000) },
    { family: 'partner', licence_key: 'partner', product_id: 'prod_part', plan_name: 'Operating Partner', free: false, prices: month(9900, 'price_p'), allowance: A(24_750_000) },
    { family: 'market_intelligence', licence_key: null, product_id: 'prod_mi', plan_name: 'Market Intelligence Pro', free: false, prices: month(1500, 'price_mi'), allowance: A(3_750_000) },
  ],
  packs: [
    { uid: 'pk_10', label: '$10 of tokens', price_id: 'price_pk10', unit_amount: 1000, currency: 'usd', credit_microusd: 10_000_000, bonus_microusd: 0 },
    { uid: 'pk_25', label: '$25 of tokens', price_id: 'price_pk25', unit_amount: 2500, currency: 'usd', credit_microusd: 25_000_000, bonus_microusd: 0 },
  ],
  covers: COVERS, resets: RESETS,
};
const product = (id, name, metadata) => ({ id, name, kind: 'subscription', metadata, categories: [], prices: [{ id: `price_${id}`, active: true, type: 'recurring', interval: 'month', unit_amount: 2000, currency: 'usd' }] });
const CATALOG = {
  growth: product('prod_growth', 'Validate + Build', { tier: 'growth' }),
  pro: product('prod_pro', 'Investor — Professional', { investor_tier: 'professional' }),
  adv: product('prod_adv', 'Advisor', { plan_group: 'advisor' }),
  part: product('prod_part', 'Operating Partner', { plan_group: 'partner' }),
  mi: product('prod_mi', 'Market Intelligence Pro', { plan: 'mi_pro' }),
};
const card = (p, reading = ready(READ), licence = null) => {
  const plan = planForProduct(p, reading) || planOf(p.metadata);
  return text(html(h(BundleCard, { product: p, globalCycle: 'monthly', onPreview: () => {}, onSubscribe: () => {}, ai: planAi(plan, reading, { licence }), family: plan?.family })));
};

test('the allowance line says the month a plan includes and its share, and says so when there is none', () => {
  assert.equal(allowanceLine(A(5_000_000)), line('$5.00'));
  assert.equal(allowanceLine(A(12_250_000)), line('$12.25'));
  assert.equal(allowanceLine(A(0)), NO_ALLOWANCE);
  assert.equal(NO_ALLOWANCE, 'No plan: every run uses your tokens.');
  for (const bad of [null, {}, A(-1), A(1.5), A('1'), { ...A(5_000_000), share: null }]) assert.equal(allowanceLine(bad), null);
});

test('every family\'s card carries its allowance from the read, what it covers, when it resets, and Top up', () => {
  const cases = [
    [CATALOG.growth, 'Founder', line('$5.00')],
    [CATALOG.pro, 'Investor', line('$12.25')],
    [CATALOG.adv, 'Advisor', line('$7.25')],
    [CATALOG.part, 'Operating Partner', line('$24.75')],
    // D783: Market Intelligence Pro is a member plan like the others, so it gives its share.
    [CATALOG.mi, 'Market Intelligence Pro', line('$3.75')],
  ];
  for (const [p, family, line] of cases) {
    const t = card(p);
    assert.ok(t.replace(/^Most popular /, '').startsWith(family), `${p.name} is named after its family`);
    assert.ok(t.includes(`AI allowance ${line} ${COVERS} ${RESETS} ${TOP_UP_WITH_PACKS.label}`), `${p.name}: ${t}`);
  }
  const markup = html(h(BundleCard, { product: CATALOG.growth, globalCycle: 'monthly', onPreview: () => {}, onSubscribe: () => {}, ai: planAi(planForProduct(CATALOG.growth, ready(READ)), ready(READ)) }));
  assert.match(markup, new RegExp(`<a href="#${TOKEN_PACKS_ID}"[^>]*>Top up with token packs</a>`));
  assert.equal(FAMILY_LABELS.partner, 'Operating Partner');
});

test('Market Intelligence Pro is a plan card', () => {
  assert.ok(isBundleProduct(CATALOG.mi), 'Market Intelligence Pro is a plan card');
});

test('the free plans get cards of their own, Exploring and other accounts included', () => {
  const free = freePlans(ready(READ));
  assert.deepEqual(free.map((p) => p.title), ['Founder Free', 'Investor Free', 'Exploring and other accounts']);
  const t = text(html(h(FreePlanCard, { plan: free[0], ai: planAi(free[0], ready(READ)) })));
  assert.equal(t, `Founder Founder Free $0 AI allowance ${NO_ALLOWANCE} ${COVERS} ${RESETS} ${TOP_UP_WITH_PACKS.label}`);
  const other = text(html(h(FreePlanCard, { plan: free[2], ai: planAi(free[2], ready(READ)) })));
  assert.ok(other.startsWith('Exploring or other Exploring and other accounts $0 AI allowance No plan: every run uses your tokens.'));
});

test('"Your plan" marks the card whose licence is the member\'s, and only that one', () => {
  assert.ok(card(CATALOG.adv, ready(READ), 'advisor').includes(YOUR_PLAN));
  assert.ok(!card(CATALOG.part, ready(READ), 'advisor').includes(YOUR_PLAN));
  assert.ok(!card(CATALOG.adv, ready(READ), null).includes(YOUR_PLAN), 'no licence read, no current plan');
});

test('planOf reads a product\'s metadata exactly as the Worker\'s planOf does', () => {
  const table = [
    [{ tier: 'growth' }, { family: 'founder', licence_key: 'founder:growth' }],
    [{ tier: 'studio' }, { family: 'founder', licence_key: 'founder:studio' }],
    [{ investor_tier: 'professional' }, { family: 'investor', licence_key: 'investor:professional' }],
    [{ investor_tier: 'institutional' }, { family: 'investor', licence_key: 'investor:institutional' }],
    [{ plan_group: 'advisor' }, { family: 'advisor', licence_key: 'advisor' }],
    [{ plan_group: 'partner' }, { family: 'partner', licence_key: 'partner' }],
    [{ plan: 'mi_pro' }, { family: 'market_intelligence', licence_key: null }],
    [{ tier: 'free' }, null], [{}, null], [null, null],
  ];
  for (const [meta, want] of table) assert.deepEqual(planOf(meta), want, JSON.stringify(meta));
  // The two stay one rule: each Worker branch has its line here.
  const worker = read('cloudflare-worker/src/services/aiCredits.ts');
  for (const cond of ["metadata.tier === 'growth' || metadata.tier === 'studio'", "metadata.investor_tier === 'professional' || metadata.investor_tier === 'institutional'",
    "metadata.plan_group === 'advisor' || metadata.plan_group === 'partner'", "metadata.plan === 'mi_pro'"]) assert.ok(worker.includes(cond), cond);
  // With the read out, a card is still named after its family.
  assert.ok(card(CATALOG.part, UNREADABLE).startsWith('Operating Partner'));
});

test('a read that fails says Unreadable on every card, never "$0.00"; while loading it says nothing', () => {
  for (const p of [CATALOG.growth, CATALOG.adv, CATALOG.part]) {
    const t = card(p, UNREADABLE);
    assert.ok(t.includes(ALLOWANCE_UNREADABLE), t);
    assert.ok(!t.includes('$0.00'));
  }
  assert.equal(ALLOWANCE_UNREADABLE, "Unreadable · The AI allowances · The plans' prices are unaffected.");
  // A plan the read has but whose allowance is missing is unreadable too, not zero.
  const broken = ready({ ...READ, plans: READ.plans.map((p) => (p.product_id === 'prod_adv' ? { ...p, allowance: null } : p)) });
  assert.ok(card(CATALOG.adv, broken).includes(ALLOWANCE_UNREADABLE));
  assert.ok(!card(CATALOG.growth, LOADING).includes('AI allowance'));
});

test('card copy is keyed by the plan\'s metadata, so a renamed Stripe product keeps its features', () => {
  const renamed = product('prod_x', 'Founder Growth (2027)', { tier: 'growth' });
  assert.equal(bundleContentFor(renamed), bundleContentFor(CATALOG.growth));
  assert.ok(bundleContentFor(renamed)?.features?.length > 0);
  assert.equal(bundleContentFor(product('prod_y', 'Something else', {})), null);
});

test('the page: the plan cards, then CR7\'s Token packs section; one read for both widths', () => {
  const page = read('frontend/src/pages/ProductsPage.jsx');
  const plans = page.indexOf('Profile bundles');
  const free = page.indexOf('<FreePlanCard');
  const packs = page.indexOf('<TokenPacksSection onPacksRead={setTokenPacks} />');
  assert.ok(plans > 0 && free > plans && packs > free, 'plans (free cards first), then Token packs');
  assert.match(page, /ai=\{planAi\(plan, pricing, \{ licence \}\)\}/, 'every bundle card gets its AI');
  assert.match(page, /<PricingPhone pricing=\{pricing\} budget=\{budget\}>/);
  assert.match(read('frontend/src/pages/account/PricingPhone.jsx'), /publicPricingApi\.plansAndPacks\(\)/);
  assert.equal(TOP_UP_WITH_PACKS.href, '#token-packs', 'the cards\' Top up line lands on CR7\'s section');
});

test('the phone lists every family in order, with each plan\'s price from the read', () => {
  const rows = phonePlans(ready(READ));
  assert.deepEqual(rows.map((r) => r.title), [
    'Founder Free', 'Founder · Validate + Build', 'Investor Free', 'Investor · Investor — Professional',
    'Advisor · Advisor', 'Operating Partner · Operating Partner', 'Market Intelligence Pro · Market Intelligence Pro', 'Exploring and other accounts',
  ]);
  assert.equal(planPriceLabel(READ.plans[3]), '$20 / month');
  assert.equal(planPriceLabel({ free: false, prices: [{ unit_amount: 19950, currency: 'usd', interval: 'year', interval_count: 1 }] }), '$199.50 / year');
  assert.equal(planPriceLabel(READ.plans[0]), '$0');
  assert.equal(phonePlans(UNREADABLE), null);
});
