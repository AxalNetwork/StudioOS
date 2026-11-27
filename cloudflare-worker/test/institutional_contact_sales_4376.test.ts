/**
 * #4376 (owner, 2026-11-04): Investor Institutional is custom-priced. It is
 * never bought: the catalogue does not sell it, the old checkout refuses it,
 * and the tier gate names sales, never an upgrade.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/institutional_contact_sales_4376.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the catalogue does not sell Institutional, and its reason is Contact Axal VC', () => {
  const cat = src('services/planCatalogue.ts');
  assert.match(cat, /key: 'investor:institutional'[^\n]*\n\s*sellable: false, sellable_reason: NOT_SOLD\.custom,/);
  assert.match(cat, /custom: 'Priced by Axal VC for each firm: Contact Axal VC\.'/);
});

test('the old investor checkout refuses Institutional before any price is read', () => {
  const b = src('routes/billing.ts');
  const at = b.indexOf("if (INVESTOR_PLAN_TO_PRICE[body.plan].tier === 'institutional')");
  assert.ok(at > 0);
  assert.match(b.slice(at, at + 200), /return refuse\(c, 409, \{ code: 'not_sellable', message: NOT_SOLD\.custom \}\);/);
  assert.ok(at < b.indexOf('const price = await legacyPlanPrice(c, `investor:${cfg.tier}`', at), 'refused before a price is looked up');
});

test('the Institutional gate names sales, never an upgrade', () => {
  const g = src('middleware/requireInvestorTier.ts');
  const line = g.split('\n').find((l) => l.includes('This is an Investor Institutional feature'))!;
  assert.match(line, /Contact Axal VC\./);
  assert.doesNotMatch(line, /Upgrade/);
});
