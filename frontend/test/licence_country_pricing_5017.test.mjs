/**
 * D5017 (#5017) — the Country pricing panel on the licence's Terms tab. The
 * Worker's half is cloudflare-worker/test/licence_pricing_apply_5017.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_country_pricing_5017.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { CountryPricing } from '../src/pages/admin/licences/CountryPricing.jsx';
import { basketOf, buildApply, centsFrom, changesContract, difference, figure, freshness, NOT_RECORDED } from '../src/pages/admin/licences/countryPricingModel.js';

const h = React.createElement;
const REC = { initial_fee_cents: 4_500_000, annual_fee_cents: 4_750_000, royalty_bps: 600, minimum_royalty_cents: 1_900_000, regulatory_surcharge_cents: null };
const VIEW = {
  licence_uid: 'lic_a', terms: { annual_fee_cents: 1_000_000, revenue_share_bps: 3000, currency: 'EUR', terms_revision: 4 },
  territory: ['FR'], basis: { basis: 'primary_country', primary_country: 'FR', weights: { FR: 10000 }, policy_revision: 0, implied: true, policy: null },
  model: { uid: 'm1', version: 'v1', currency: 'EUR', effective_from: '2026-12-01' }, model_reason: null,
  countries: [{ country_code: 'FR', recorded: true, country_name: 'France', inputs: {
    purchasing_power: { status: 'recorded', as_of: '2024-12-31' }, startup_ecosystem: { status: 'provisional', as_of: '2025-06-01' }, market_size: { status: 'recorded', as_of: '2023-12-31' } } }],
  recommendation: { uid: 'snap-0001', basis: 'primary_country', available: true, currency: 'EUR', recommended: REC, created_at: '2026-11-08T10:00:00Z', components: [{ country_code: 'FR', weight_bps: 10000 }],
    pricing_model_version: 'v1', trace: { components: [{ country_code: 'FR', weight_bps: 10000, country_index: 950000, tier: 'B', values: REC, provisional: [] }] } },
  recommendation_reason: null, latest_decision: null, drift: {}, next_review_on: null, review_due: false, reviews: [],
  agreement: { state: 'matches', contract: { status: 'signed' } },
};

test('the model: unknown is "Not recorded", money and rates read as a person reads them', () => {
  // Mutations checked: null rendered as 0; a bps shown as a fraction; a difference computed against an unknown.
  assert.equal(figure(null, 'cents', 'EUR'), NOT_RECORDED);
  assert.equal(figure(0, 'cents', 'EUR'), 'EUR 0', 'zero is a real figure, distinct from not recorded');
  assert.equal(figure(650, 'bps'), '6.5%');
  assert.equal(difference(null, 5, 'cents', 'EUR'), null);
  assert.equal(difference(4_750_000, 1_000_000, 'cents', 'EUR'), `+EUR ${(37500).toLocaleString()}`);
  assert.equal(centsFrom('42000.5', 'EUR'), 4_200_050);
  assert.ok(Number.isNaN(centsFrom('42,000', 'EUR')));
  const f = freshness(VIEW.countries[0]);
  assert.equal(f.label, 'Oldest input as of 2023-12-31');
  assert.deepEqual(f.provisional, ['startup_ecosystem']);
  assert.equal(freshness({ recorded: false }).label, NOT_RECORDED);
  assert.deepEqual(basketOf({ FR: '6000', BE: '4000' }, ['BE', 'FR']), { weights: { FR: 6000, BE: 4000 }, total: 10000, ok: true });
  assert.equal(basketOf({ FR: '6000', BE: '3000' }, ['BE', 'FR']).ok, false);
});

test('the apply body names the snapshot and the terms revision; an override needs its reason', () => {
  // Mutations checked: the revision left out; an unchanged figure sent as an override; an override without a reason allowed.
  const plain = buildApply({ view: VIEW, form: { accepted: {}, reason: 'Annual pricing', effective_from: '2027-01-01', acknowledge: true } });
  assert.deepEqual(plain.body, { snapshot_uid: 'snap-0001', expected_terms_revision: 4, effective_from: '2027-01-01', reason: 'Annual pricing', acknowledge_agreement_mismatch: true });
  assert.equal(plain.override, false);
  const same = buildApply({ view: VIEW, form: { accepted: { annual_fee_cents: '47500' }, reason: 'Annual pricing', effective_from: '2027-01-01' } });
  assert.equal(same.override, false, 'typing the recommended figure is not an override');
  const bare = buildApply({ view: VIEW, form: { accepted: { annual_fee_cents: '42000' }, reason: 'Annual pricing', effective_from: '2027-01-01' } });
  assert.equal(bare.ok, false);
  assert.ok(bare.errors.override_reason);
  const ok = buildApply({ view: VIEW, form: { accepted: { annual_fee_cents: '42000' }, reason: 'Annual pricing', override_reason: 'Launch discount', effective_from: '2027-01-01' }, reviewUid: 'rev-00001' });
  assert.deepEqual(ok.body.accepted, { annual_fee_cents: 4_200_000 });
  assert.equal(ok.body.override_reason, 'Launch discount');
  assert.equal(ok.body.review_uid, 'rev-00001');
  assert.equal(changesContract(VIEW, { accepted: {} }), true);
  assert.equal(changesContract({ ...VIEW, terms: { ...VIEW.terms, annual_fee_cents: 4_750_000, revenue_share_bps: 600 } }, { accepted: {} }), false);
});

async function mount(api, view = VIEW) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await act(async () => { root.render(h(CountryPricing, { licence: { uid: 'lic_a' }, api })); await settle(); await settle(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    by, props, text: () => text(container),
    click: (id) => act(async () => { props(by(id)).onClick(); await settle(); await settle(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the panel shows the recommendation beside the current terms, and a refresh changes nothing but the recommendation', async () => {
  // Mutations checked: an unknown surcharge drawn as 0; the refresh wired to apply; the read not repeated after a refresh.
  const calls = [];
  const api = { get: async () => { calls.push('get'); return VIEW; }, refresh: async () => { calls.push('refresh'); return { snapshot: VIEW.recommendation, licence_changed: false }; } };
  const m = await mount(api);
  const table = m.text();
  assert.match(table, /Regulatory surcharge\s*Not recorded/);
  assert.match(table, /index 0\.950× · tier B/);
  assert.doesNotMatch(table, /snap-0001/, 'no internal id is shown');
  await m.click('pricing-refresh');
  assert.deepEqual(calls, ['get', 'refresh', 'get']);
  assert.match(m.text(), /The licence terms did not change/);
  await m.unmount();
});

test('applying with a signed agreement asks for the acknowledgement before it can be sent', async () => {
  // Mutations checked: the acknowledgement box not shown; the submit enabled without it.
  const api = { get: async () => VIEW, apply: async () => ({ push_outcome: 'committed', agreement: { state: 'mismatch' } }) };
  const m = await mount(api);
  await m.click('pricing-apply');
  assert.ok(m.by('pricing-ack'), 'the acknowledgement is asked for');
  assert.equal(m.props(m.by('pricing-apply-submit')).disabled, true);
  await m.unmount();
});

test('the panel sits on the Terms tab under the core terms', () => {
  const page = readFileSync(new URL('../src/pages/admin/licences/LicenceDetail.jsx', import.meta.url), 'utf8');
  assert.match(page, /\{step === 4 && <CountryPricing licence=\{d\} onSaved=\{refresh\} \/>\}/);
  const api = readFileSync(new URL('../src/lib/api/licencePricing.js', import.meta.url), 'utf8');
  for (const p of ['/pricing`', '/pricing/policy`', '/pricing/snapshot`', '/pricing/apply`', '/pricing/reviews`', '/resolve`']) assert.ok(api.includes(p), p);
});
