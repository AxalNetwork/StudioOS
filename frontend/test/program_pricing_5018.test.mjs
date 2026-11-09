/**
 * D5018 (#5018) — program pricing on the Program grants pages. The Worker's
 * half is cloudflare-worker/test/program_pricing_5018.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_pricing_5018.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { StudioPricing } from '../src/pages/admin/grants/ProgramPricing.jsx';
import { NOT_RECORDED, buildPricing, centsOf, money, pricingLine } from '../src/pages/admin/grants/programPricingModel.js';

const h = React.createElement;
const REC = { available: true, currency: 'EUR', recommended_annual_fee_cents: 1_750_000, recommended_initial_fee_cents: null, country_index_ppm: 875_000, unavailable_reason: null };
const SPIN = {
  program_key: 'spinout-lab', name: 'Spin-Out Lab', base: { version: 2, currency: 'EUR', annual_fee_cents: 2_000_000, initial_fee_cents: null },
  base_reason: null, recommendation: REC,
  accepted: { annual_fee_cents: 1_500_000, currency: 'EUR', overridden: true, override_reason: 'Pilot discount', effective_from: '2027-01-01', effective_to: null },
};
const PERKS = { program_key: 'perks', name: 'Perks', base: null, base_reason: 'Not recorded: no reference price is published for this program.', recommendation: { available: false, unavailable_reason: 'No reference price is recorded for this program.', recommended_annual_fee_cents: null }, accepted: null };

test('a line reads base → country-adjusted → accepted; no base is Not recorded, never free', () => {
  // Mutations checked: a missing base shown as 0; the override chip dropped; an unknown accepted shown as 0.
  const l = pricingLine(SPIN);
  assert.equal(l.base, money(2_000_000, 'EUR'));
  assert.equal(l.adjusted, money(1_750_000, 'EUR'));
  assert.equal(l.accepted, money(1_500_000, 'EUR'));
  assert.equal(l.overridden, true);
  assert.equal(l.period, '2027-01-01 → open');
  const p = pricingLine(PERKS);
  assert.equal(p.base, NOT_RECORDED);
  assert.equal(p.adjusted, NOT_RECORDED);
  assert.equal(p.accepted, NOT_RECORDED);
  assert.notEqual(money(0, 'EUR'), NOT_RECORDED, 'zero is a figure, distinct from not recorded');
  assert.equal(centsOf('12000.5'), 1_200_050);
  assert.ok(Number.isNaN(centsOf('12,000')));
});

test('the grant write sends pricing only when a price is chosen, and never a fee twice', () => {
  // Mutations checked: the fee kept in the terms beside pricing; an override without a reason; accepting with no recommendation.
  assert.deepEqual(buildPricing({ mode: 'terms', rec: REC, form: {} }), { ok: true, pricing: null, dropFee: false });
  assert.deepEqual(buildPricing({ mode: 'recommended', rec: REC, form: { effective_from: '2027-01-01' }, snapshotUid: 'snap-1234' }),
    { ok: true, pricing: { licence_snapshot_uid: 'snap-1234', effective_from: '2027-01-01' }, dropFee: true });
  assert.equal(buildPricing({ mode: 'recommended', rec: PERKS.recommendation, form: {} }).ok, false);
  assert.equal(buildPricing({ mode: 'override', rec: REC, form: { fee: '15000' } }).ok, false, 'an override says why');
  const ov = buildPricing({ mode: 'override', rec: REC, form: { fee: '15000', override_reason: 'Pilot discount' } });
  assert.deepEqual(ov.pricing, { accepted_annual_fee_cents: 1_500_000, override_reason: 'Pilot discount' });
  assert.equal(buildPricing({ mode: 'override', rec: REC, form: { fee: '1', override_reason: 'x y z', effective_from: '2027-02-01', effective_to: '2027-01-01' } }).ok, false);
  const dialogs = readFileSync(new URL('../src/pages/admin/grants/GrantDialogs.jsx', import.meta.url), 'utf8');
  assert.match(dialogs, /if \(priced\.dropFee\) delete terms\.fee_cents;/);
  assert.match(dialogs, /<PriceBlock price=\{price\}/);
});

test('the studio\'s pricing table marks an override and says Not recorded for a program with no base', async () => {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const read = { status: 'ready', data: { snapshot: { uid: 's', created_at: '2026-11-08T10:00:00Z' }, country_index_ppm: 875_000, model_version: 'v1', index_reason: null, programs: [SPIN, PERKS] } };
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  await act(async () => { root.render(h(StudioPricing, { uid: 'lic_a', read, onRetry() {} })); });
  assert.match(textOf(container), /Country index 0\.875×/);
  assert.match(textOf(by('pricing-row-perks')), /^PerksNot recorded/);
  assert.ok(by('pricing-override-spinout-lab'));
  assert.equal(by('pricing-override-perks'), undefined);
  await act(async () => { root.render(h(StudioPricing, { uid: 'lic_a', read: { status: 'error', data: null }, onRetry() {} })); });
  assert.match(textOf(container), /could not be read\. That is not the same as none/);
  await act(async () => root.unmount());
  restore();
});

test('the studio view and the defaults view read program pricing on their own', () => {
  const studio = readFileSync(new URL('../src/pages/admin/grants/StudioView.jsx', import.meta.url), 'utf8');
  assert.match(studio, /programPricingApi\.forLicence\(uid\)/);
  assert.match(studio, /price=\{priceOf\(r\.program\.key\)\}/);
  const defaults = readFileSync(new URL('../src/pages/admin/grants/DefaultsView.jsx', import.meta.url), 'utf8');
  assert.match(defaults, /<ReferencePrices read=\{prices\} reload=\{loadPrices\} \/>/);
});
