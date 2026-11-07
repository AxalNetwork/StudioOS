/**
 * D4674 (#4674) — Expertise keeps prices, currencies and concurrent edits.
 * The Worker half is in cloudflare-worker/test/advisor_stores.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_expertise_d4674.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { amountToCents, centsToInput } from '../src/lib/moneyInput.js';
import { moneyCents, usdCents } from '../src/workspaces/boards/format.js';
import { money } from '../src/pages/advisor/expertise/kit.jsx';
import { serviceDraftOf, serviceEditBody } from '../src/pages/advisor/expertise/expertiseModel.js';
import * as limits from '../src/lib/advisorLimits.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('12.50, 12,50, 1,5 and grouped thousands cannot silently change magnitude', () => {
  const cents = (t) => amountToCents(t).cents;
  assert.equal(cents('12.50'), 1250);
  assert.equal(cents('12,50'), 1250);
  assert.equal(cents('1,5'), 150, '1,5 is one and a half, not fifteen');
  assert.equal(cents('1,500'), 150000);
  assert.equal(cents('1 500'), 150000);
  assert.equal(cents('1.500,50'), 150050);
  assert.equal(cents('1,500.50'), 150050);
  assert.equal(cents('$2500'), 250000);
  assert.equal(cents(''), null, 'blank is not recorded, never zero');
  assert.equal(cents('0'), 0, 'zero is a price');
  for (const bad of ['1.500', '12.345', '1,5,5', '1.2.3', 'abc', '12,', '1e3', '-5']) {
    assert.ok(amountToCents(bad).error, `${bad} is refused, not guessed`);
  }
});

test('an amount typed and shown again is the same amount', () => {
  for (const c of [1, 5, 99, 100, 12345, 150050, 99999999]) assert.equal(amountToCents(centsToInput(c)).cents, c, String(c));
  assert.equal(centsToInput(null), '');
});

test('CHF 123.45 stays CHF 123.45 on the detail row and the overview; null is not zero', () => {
  assert.equal(money(12345, 'CHF'), 'CHF 123.45');
  assert.equal(moneyCents(12345, 'CHF'), 'CHF 123.45');
  assert.equal(moneyCents(12345, 'USD'), '$123.45', 'not rounded to $123');
  assert.equal(moneyCents(500000, 'EUR'), '€5,000');
  assert.equal(usdCents(250), '$2.50');
  assert.equal(moneyCents(null, 'CHF'), null);
  assert.equal(money(undefined, 'CHF'), null);
  assert.equal(moneyCents(0, 'CHF'), 'CHF 0', 'zero is a price');
  const board = read('src/workspaces/boards/advisorExpertise.js');
  assert.match(board, /moneyCents\(s\.price_cents, s\.currency\)/);
  assert.doesNotMatch(board, /usdCents/);
});

test('an edit sends only what changed; a currency change carries the price with it', () => {
  const row = { title: 'Sprint', kind: 'fixed', price_cents: 12345, currency: 'CHF', duration_note: null, scope: null, is_active: 1, updated_at: 'r1' };
  const same = serviceEditBody(row, serviceDraftOf(row), 12345);
  assert.deepEqual(same.body, {});
  const scope = serviceEditBody(row, { ...serviceDraftOf(row), scope: 'Two weeks' }, 12345);
  assert.deepEqual(scope.body, { scope: 'Two weeks' });
  const cur = serviceEditBody(row, { ...serviceDraftOf(row), currency: 'EUR' }, 12345);
  assert.deepEqual(cur.body, { currency: 'EUR', price_cents: 12345 });
  assert.equal(serviceDraftOf(row).price, '123.45');
});

test('the editors send their revision, reset from what the server stored, and handle a conflict', () => {
  const services = read('src/pages/advisor/expertise/ServicesZone.jsx');
  assert.match(services, /updateMyAdvisorService\(row\.id, \{ \.\.\.body, revision: row\.updated_at \}\)/);
  assert.match(services, /setEditDraft\(serviceDraftOf\(saved\)\)/);
  assert.match(services, /revision_conflict/);
  assert.match(services, /currency: draft\.currency,/, 'a service is created with its stated currency');
  assert.match(services, /'Price \(minor units\)', 'Currency'/, 'the export carries the currency beside the amount');
  const profile = read('src/pages/advisor/expertise/ProfileZone.jsx');
  assert.match(profile, /revision: was\.updated_at/);
  assert.match(profile, /setDraft\(draftOf\(saved\)\)/);
  assert.match(profile, /revision_conflict/);
});

test('the inputs\' limits are the Worker\'s limits', () => {
  const src = read('../cloudflare-worker/src/services/advisorLimits.ts');
  const obj = (name) => Object.fromEntries([...src.match(new RegExp(`${name} = \\{([^}]*)\\}`))[1].matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(limits.SERVICE_LIMITS, obj('SERVICE_LIMITS'));
  assert.deepEqual(limits.PROFILE_LIMITS, obj('PROFILE_LIMITS'));
  assert.equal(limits.LIST_MAX_ITEMS, Number(src.match(/LIST_MAX_ITEMS = (\d+)/)[1]));
  const cur = src.match(/SUPPORTED_CURRENCIES = \[([^\]]*)\]/)[1].match(/'([A-Z]{3})'/g).map((x) => x.slice(1, 4));
  assert.deepEqual(limits.SUPPORTED_CURRENCIES, cur);
  assert.match(read('src/pages/advisor/expertise/ServicesZone.jsx'), /maxLength=\{SERVICE_LIMITS\.scope\}/);
  assert.match(read('src/pages/advisor/expertise/ProfileZone.jsx'), /maxLength=\{PROFILE_LIMITS\.bio\}/);
});
