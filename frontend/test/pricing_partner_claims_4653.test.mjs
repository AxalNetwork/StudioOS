/**
 * D4653 part 2 (#4653): the Operating Partner plans sell only what runs.
 * D676 dropped "Verification badges" (kyb_verified is never set) and Stripe
 * Connect payouts (not configured for partners) from the partner page; the
 * Pricing cards, the comparison, the catalogue that Checkout and the public
 * read project, and Billing's partner plans carried them on. #6985 imports
 * plan identity from these sources, so they must not reintroduce either.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pricing_partner_claims_4653.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { PLAN_CATALOGUE, publicCatalogue } = await import('../../cloudflare-worker/src/services/planCatalogue.ts');
const { plansAndPacks } = await import('../../cloudflare-worker/src/services/aiCredits.ts');
const { PLAN_CARDS, COMPARE } = await import('../src/lib/sitePricing.js');
const { planCards } = await import('../src/lib/pricingModel.js');

const UNBACKED = [/verif(?:ication|ied)[^,]*badge/i, /Stripe Connect/i];
const hits = (lines) => lines.filter((line) => UNBACKED.some((re) => re.test(line)));

function emptyCatalogueEnv() {
  return { DB: { prepare() {
    const statement = { bind: () => statement, all: async () => ({ success: true, results: [] }),
      first: async () => null, run: async () => ({ success: true }) };
    return statement;
  } } };
}

test('the partner catalogue entries list neither claim, and keep what does run', () => {
  for (const key of ['partner:free', 'partner:pro']) {
    const entry = PLAN_CATALOGUE.find((p) => p.key === key);
    assert.ok(entry, key);
    assert.deepEqual(hits(entry.included), [], `${key} still includes ${hits(entry.included)}`);
  }
  assert.ok(PLAN_CATALOGUE.find((p) => p.key === 'partner:free').included.includes('Live founder requests'));
  assert.ok(PLAN_CATALOGUE.find((p) => p.key === 'partner:pro').included.includes('Client status reports'));
});

test('the public plans read, which Checkout summarises, carries neither claim', async () => {
  const body = await plansAndPacks(emptyCatalogueEnv());
  const rows = [...body.catalogue, ...publicCatalogue()].filter((r) => r.family === 'partner');
  assert.equal(rows.length, 4, 'both partner plans, in the read and the catalogue');
  for (const row of rows) {
    assert.ok(Array.isArray(row.included) && row.included.length > 0, `${row.key} lists what it includes`);
    assert.deepEqual(hits(row.included), [], `${row.key} in the public read`);
  }
});

test('the Operating Partner Pricing cards and comparison carry neither claim', () => {
  const specs = PLAN_CARDS['operating-partner'];
  for (const spec of specs) assert.deepEqual(hits(spec.feats), [], `${spec.name} card`);
  const read = { plans: [{ licence_key: 'partner', free: false,
    monthly: { unit_amount: 4900, currency: 'usd', allowance_microusd: 0 }, yearly: null }] };
  const { cards } = planCards(read, specs);
  for (const card of cards) assert.deepEqual(hits(card.feats), [], `${card.name} rendered card`);
  const rows = COMPARE['operating-partner'].flatMap(([, list]) => list);
  assert.deepEqual(hits(rows.map((r) => r[0])), [], 'comparison rows');
  // Each remaining row still has one cell per card.
  for (const row of rows) assert.equal(row.length - 1, specs.length, row[0]);
});

test('no Pricing tab advertises either claim', () => {
  for (const [tab, specs] of Object.entries(PLAN_CARDS)) {
    for (const spec of specs) assert.deepEqual(hits(spec.feats), [], `${tab}/${spec.id}`);
  }
  for (const [tab, groups] of Object.entries(COMPARE)) {
    assert.deepEqual(hits(groups.flatMap(([, list]) => list.map((r) => r[0]))), [], `${tab} comparison`);
  }
});

test("Billing's partner plan lists carry neither claim", () => {
  const src = readFileSync(resolve(import.meta.dirname, '../src/pages/account/BillingSection.jsx'), 'utf8');
  const partner = src.slice(src.indexOf('const PERSONA_PLANS'), src.indexOf('advisor: {', src.indexOf('const PERSONA_PLANS')));
  const features = [...partner.matchAll(/features: \[([^\]]*)\]/g)].flatMap((m) => m[1].split(/',\s*'/));
  assert.ok(features.length >= 6, 'both partner feature lists were read');
  assert.deepEqual(hits(features), []);
});
