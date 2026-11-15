/**
 * D5020 (#5020, the HQ screens) — Country pricing across the ledger: the catalogue, a market's inputs and trace, the
 * model versions, the annual review queue, the ledger's Needs HQ pricing chips and the licence's Pricing & Market
 * section. The Worker's half (the five reads) is cloudflare-worker/test/licence_pricing_hq_5020.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_pricing_hq_ui_5020.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NOT_RECORDED, PRICING_PATHS, catalogueFacets, catalogueRow, calculationStanding, completenessCell, feeCell, filterCatalogue,
  licenceMarketFacts, modelRows, monthsBetween, pricingSignalsRead, reviewRow, sourceFreshness, tierIndexCell, traceRows,
} from '../src/pages/admin/licences/pricingHqModel.js';
import {
  NEEDS, attentionCell, filterByNeeds, needsFromParam, needsSummary,
} from '../src/pages/admin/licenceLedgerModel.js';
import PricingCatalogue from '../src/pages/admin/licences/PricingCatalogue.jsx';
import PricingCountry from '../src/pages/admin/licences/PricingCountry.jsx';
import PricingModels from '../src/pages/admin/licences/PricingModels.jsx';
import PricingReviews from '../src/pages/admin/licences/PricingReviews.jsx';
import { CountryPricing } from '../src/pages/admin/licences/CountryPricing.jsx';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const TODAY = '2026-11-15';

const COMPLETE = { state: 'complete', recorded: 3, provisional: 0, not_recorded: 0, of: 3, missing: [], provisional_inputs: [] };
const PROV = { state: 'provisional', recorded: 2, provisional: 1, not_recorded: 0, of: 3, missing: [], provisional_inputs: ['startup_ecosystem'] };
const INC = { state: 'incomplete', recorded: 2, provisional: 0, not_recorded: 1, of: 3, missing: ['startup_ecosystem'], provisional_inputs: [] };
const rec = (over = {}) => ({ available: true, complete: true, country_index: 1_180_000, tier: 'A', recommended_annual_fee_cents: 10_400_000, recommended_initial_fee_cents: 4_700_000, currency: 'EUR', unavailable_reason: null, ...over });
const COUNTRIES = [
  { country_code: 'FR', country_name: 'France', region_code: 'Western Europe', currency_code: 'EUR', regulatory_class: 'high', data_completeness: COMPLETE, last_source_update: '2026-10-04', recommendation: rec(), recommendation_reason: null },
  { country_code: 'PT', country_name: 'Portugal', region_code: 'Southern Europe', currency_code: 'EUR', regulatory_class: 'medium', data_completeness: PROV, last_source_update: '2026-09-18', recommendation: rec({ complete: false, country_index: 840_000, tier: 'B', recommended_annual_fee_cents: 7_400_000 }), recommendation_reason: null },
  { country_code: 'DK', country_name: 'Denmark', region_code: 'Nordics', currency_code: 'DKK', regulatory_class: null, data_completeness: INC, last_source_update: '2025-09-02', recommendation: rec({ available: false, complete: false, country_index: null, tier: null, recommended_annual_fee_cents: null, recommended_initial_fee_cents: null, unavailable_reason: 'No recommendation: startup ecosystem not recorded.' }), recommendation_reason: 'No recommendation: startup ecosystem not recorded.' },
];
const MODEL = { uid: 'pm_v3', version: 'v3', status: 'active', currency: 'EUR', effective_from: '2026-11-01' };
const CATALOGUE = { model: MODEL, model_reason: null, model_problem: null, allow_provisional: false, stored: false, countries: COUNTRIES, total: 3, counts: { complete: 1, provisional: 1, incomplete: 1, priced: 2 } };
const VERSIONS = {
  current: { uid: 'pm_v3', version: 'v3', status: 'active', currency: 'EUR', effective_from: '2026-11-01', activated_at: '2026-10-31T16:02:00Z', activated_by: 'Guillaume L.', weight_market_size_bps: 3000, weight_purchasing_power_bps: 4500, weight_startup_ecosystem_bps: 2500, fee_rounding_cents: 50_000, reference_annual_fee_cents: 8_800_000, reference_initial_fee_cents: 4_000_000, usage: { country_snapshots: 12, licence_snapshots: 4, decisions: 2 } },
  current_reason: null,
  drafts: [{ uid: 'pm_v4', version: 'v4', status: 'draft', currency: 'EUR', effective_from: '2026-12-01', activated_at: null, weight_market_size_bps: 3000, weight_purchasing_power_bps: 4000, weight_startup_ecosystem_bps: 3000, fee_rounding_cents: 50_000, reference_annual_fee_cents: 8_800_000, reference_initial_fee_cents: 4_000_000, usage: { country_snapshots: 0, licence_snapshots: 0, decisions: 0 } }],
  retired: [{ uid: 'pm_v2', version: 'v2', status: 'retired', currency: 'EUR', effective_from: '2026-03-02', activated_at: '2026-03-01T09:00:00Z', activated_by: 'Guillaume L.', weight_market_size_bps: 3500, weight_purchasing_power_bps: 4500, weight_startup_ecosystem_bps: 2000, fee_rounding_cents: 50_000, reference_annual_fee_cents: 8_500_000, reference_initial_fee_cents: 4_000_000, usage: { country_snapshots: 30, licence_snapshots: 6, decisions: 3 } }],
  history: [{ at: '2026-10-31T16:02:00Z', event: 'activated', model_uid: 'pm_v3', version: 'v3', by: 'Guillaume L.' }],
};
const TRACE = {
  allow_provisional: false,
  purchasing_power: { factor_ppm: 937_000 }, startup_ecosystem: { factor_ppm: 930_000 }, market_size: { factor_ppm: 620_000 },
  regulatory: { class: 'medium', surcharge_cents: 600_000 },
  index: { weights_bps: { purchasing_power: 4500, startup_ecosystem: 2500, market_size: 3000 }, index_ppm: 840_000, tier: 'B' },
  fees: {
    fee_rounding_cents: 50_000,
    annual: { reference_cents: 8_800_000, rounded_cents: 7_400_000 }, initial: { reference_cents: 4_000_000, rounded_cents: 3_350_000 },
    minimum_royalty: { ratio_bps: 2000, rounded_cents: 1_500_000 }, royalty_bps: { value: 1000, from: 'tier B' },
  },
};
const INPUTS = {
  purchasing_power: { value: 44_900, status: 'recorded', source: 'IMF WEO', source_ref: 'Oct 2026', as_of: '2026-10-14' },
  startup_ecosystem: { value: 52_000, rank: 21, status: 'provisional', source: 'StartupBlink 2025', source_ref: null, as_of: '2026-09-18' },
  market_size: { value: 10_600_000, status: 'recorded', source: 'INE', source_ref: 'Estimativas 2025', as_of: '2026-01-01' },
};
const DETAIL = {
  profile: { country_code: 'PT', country_name: 'Portugal', currency_code: 'EUR', region_code: 'Southern Europe' },
  inputs: INPUTS, data_completeness: PROV, last_source_update: '2026-10-14', regulatory_class: 'medium', model: MODEL, model_reason: null,
  calculation: { recommendation: { ...rec({ complete: false, country_index: 840_000, tier: 'B', recommended_annual_fee_cents: 7_400_000, recommended_initial_fee_cents: 3_350_000 }), model_version: 'v3', provisional: ['startup_ecosystem'], recommended_royalty_bps: 1000, recommended_minimum_royalty_cents: 1_500_000, recommended_regulatory_surcharge_cents: 600_000, trace: TRACE }, source_digest: 'sha256:abc', allow_provisional: true, stored: false },
  calculation_reason: null, observations: [], snapshots: [],
};
const QUEUE = {
  today: TODAY, within_days: 0, horizon: TODAY, total: 2, due: 2, without_open_review: 1,
  items: [
    { licence_uid: 'lic_no', licence_ref: 'WL-NO-001', brand_name: 'Nordlys Studio', status: 'active', due_on: '2026-10-30', due: true, days_overdue: 16, review_row: 'none', open_review: null, latest_decision: { decision: 'overridden', effective_from: '2025-10-30' }, terms: { annual_fee_cents: 9_000_000, currency: 'EUR' }, pricing_data_incomplete: true },
    { licence_uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', status: 'active', due_on: TODAY, due: true, days_overdue: 0, review_row: 'open', open_review: { uid: 'rv1' }, latest_decision: { decision: 'accepted', effective_from: '2025-11-15' }, terms: { annual_fee_cents: null, currency: 'EUR' }, pricing_data_incomplete: false },
  ],
  no_decision: [{ licence_uid: 'lic_old', licence_ref: 'AXL-ES-001', brand_name: 'Iberia Lab', status: 'active', reason: 'No pricing decision recorded' }],
  sweep: 'none',
};

// ── The pure rules ──────────────────────────────────────────────────────────

test('source freshness: stale from twelve whole months, the date said either way, unknown is Not recorded', () => {
  // Mutations checked: stale at eleven months; stale never flagged; an unknown date read as current.
  assert.equal(monthsBetween('2025-11-15', TODAY), 12);
  assert.equal(monthsBetween('2025-11-16', TODAY), 11);
  assert.deepEqual(sourceFreshness('2025-11-15', TODAY), { state: 'stale', label: 'Stale · 12 months · 2025-11-15', months: 12 });
  assert.equal(sourceFreshness('2025-11-16', TODAY).state, 'current');
  assert.equal(sourceFreshness('2026-10-04', TODAY).label, 'Updated 2026-10-04');
  assert.deepEqual(sourceFreshness(null, TODAY), { state: 'not_recorded', label: NOT_RECORDED, months: null });
});

test('the catalogue never shows a 0 for an unpriced market, and names provisional figures', () => {
  // Mutations checked: an unavailable fee drawn as EUR 0; a provisional fee shown plain; incomplete counted as complete.
  assert.equal(completenessCell(COMPLETE).label, '3 of 3 recorded');
  assert.equal(completenessCell(PROV).label, '2 recorded · 1 provisional');
  assert.equal(completenessCell(INC).label, '2 of 3 recorded');
  assert.equal(completenessCell(null).state, 'unavailable');
  const [fr, pt, dk] = COUNTRIES.map((c) => catalogueRow(c, TODAY));
  assert.equal(fr.tierIndex.label, 'Tier A · 1.180×');
  assert.match(pt.annual.label, /· provisional$/);
  assert.equal(pt.annual.state, 'provisional');
  assert.deepEqual(dk.annual, { state: 'not_recorded', label: 'No recommendation' });
  assert.doesNotMatch(dk.annual.label, /\b0\b/);
  assert.equal(dk.tierIndex.label, 'No recommendation: startup ecosystem not recorded.');
  assert.equal(dk.regulatory, NOT_RECORDED);
  assert.equal(dk.freshness.state, 'stale');
  assert.equal(fr.href, '/admin/licences/pricing/country/FR');
  assert.deepEqual(feeCell(null, 'recommended_annual_fee_cents'), { state: 'not_recorded', label: NOT_RECORDED });
  assert.equal(tierIndexCell(null, 'No pricing model is active.').label, 'No pricing model is active.');
});

test('the catalogue filters: search, incomplete data, region, class and currency', () => {
  // Mutations checked: "Incomplete data" keeps provisional out; the search ignores the code; a facet filter ignored.
  const rows = COUNTRIES.map((c) => catalogueRow(c, TODAY));
  assert.deepEqual(filterCatalogue(rows, { incomplete: true }).map((r) => r.code), ['PT', 'DK']);
  assert.deepEqual(filterCatalogue(rows, { q: 'port' }).map((r) => r.code), ['PT']);
  assert.deepEqual(filterCatalogue(rows, { q: 'dk' }).map((r) => r.code), ['DK']);
  assert.deepEqual(filterCatalogue(rows, { region: 'Nordics' }).map((r) => r.code), ['DK']);
  assert.deepEqual(filterCatalogue(rows, { regulatory: NOT_RECORDED }).map((r) => r.code), ['DK']);
  assert.deepEqual(filterCatalogue(rows, { currency: 'EUR' }).map((r) => r.code), ['FR', 'PT']);
  assert.deepEqual(catalogueFacets(rows).classes, ['high', 'medium', NOT_RECORDED]);
});

test('the trace walks the engine\'s own steps; a step it did not reach is not drawn; an unknown surcharge is not free', () => {
  // Mutations checked: the index row drawn for an unpriced market; an unknown surcharge drawn as EUR 0; weights dropped.
  const rows = traceRows(DETAIL.calculation, INPUTS);
  assert.deepEqual(rows.map((r) => r.step), [
    'Population factor', 'PPP GDP per capita factor', 'Startup ecosystem score factor', 'Country index', 'Tier',
    'Annual licence', 'Initial fee', 'Minimum royalty', 'Regulatory surcharge · medium',
  ]);
  assert.equal(rows[0].value, '0.620');
  assert.equal(rows[1].weight, '45%');
  assert.equal(rows[2].note, 'Provisional input');
  assert.equal(rows[3].value, '0.840×');
  assert.match(rows[4].note, /Royalty 10% · from the tier B/);
  assert.match(rows[5].note, /× index, rounded to/);
  const unpriced = { recommendation: { ...DETAIL.calculation.recommendation, available: false, trace: { market_size: { factor_ppm: 1 }, regulatory: { class: null, surcharge_cents: null } } } };
  const u = traceRows(unpriced, { ...INPUTS, startup_ecosystem: { status: 'not_recorded' } });
  assert.ok(!u.some((r) => r.step === 'Country index'));
  assert.equal(u.find((r) => r.step === 'Startup ecosystem score factor').value, NOT_RECORDED);
  const surcharge = u.find((r) => r.step === 'Regulatory surcharge');
  assert.equal(surcharge.value, NOT_RECORDED);
  assert.match(surcharge.note, /unknown, not free/);
  assert.deepEqual(traceRows(null, INPUTS), []);
  assert.equal(calculationStanding(DETAIL).state, 'provisional');
  assert.equal(calculationStanding({ calculation: null, calculation_reason: 'No pricing model to calculate with.' }).label, 'No pricing model to calculate with.');
});

test('model versions: current first, then drafts, then retired; active and retired are immutable', () => {
  // Mutations checked: retired listed before current; a draft offered as immutable; usage dropped.
  const rows = modelRows(VERSIONS);
  assert.deepEqual(rows.map((r) => r.version), ['v3', 'v4', 'v2']);
  assert.equal(rows[0].note, 'Active models are immutable');
  assert.equal(rows[2].note, 'Read-only');
  assert.match(rows[1].note, /Draft/);
  assert.equal(rows[0].weights, '30% / 45% / 25%');
  assert.equal(rows[1].activated, 'Not activated');
  assert.match(rows[0].usage, /12 country snapshots · 4 licence snapshots · 2 decisions/);
  assert.deepEqual(modelRows({ current: null, drafts: [], retired: [] }), []);
});

test('the review queue says when no review is open, and an unknown fee is not 0', () => {
  // Mutations checked: a due licence without a review row read as open; an unknown fee as EUR 0; overdue days lost.
  const [no, fr] = QUEUE.items.map(reviewRow);
  assert.equal(no.review, 'No review open');
  assert.equal(no.due, '2026-10-30 · 16d overdue');
  assert.equal(no.overdue, true);
  assert.equal(no.decision, 'Overridden · effective 2025-10-30');
  assert.equal(no.href, '/admin/licences/lic_no/terms');
  assert.equal(fr.review, 'Review open');
  assert.equal(fr.due, `${TODAY} · due today`);
  assert.equal(fr.annual, NOT_RECORDED);
  assert.equal(reviewRow({ ...QUEUE.items[0], pricing_data_incomplete: null }).data, 'Unavailable');
});

// ── The ledger's Needs HQ pricing chips ─────────────────────────────────────

const LEDGER = [{ uid: 'a', status: 'active', territories: ['FR'] }, { uid: 'b', status: 'active', territories: ['PT'] }, { uid: 'c', status: 'active', territories: ['DK'] }];
const SIGNALS = (over = {}) => ({
  items: [
    { licence_uid: 'a', signals: { pricing_review_due: true, pricing_data_incomplete: false, pricing_overridden: true, exclusivity_at_risk: false } },
    { licence_uid: 'b', signals: { pricing_review_due: true, pricing_data_incomplete: true, pricing_overridden: false, exclusivity_at_risk: false } },
    { licence_uid: 'c', signals: { pricing_review_due: false, pricing_data_incomplete: false, pricing_overridden: false, exclusivity_at_risk: false } },
  ],
  ...over,
});
const READS = { a: { ok: true, total: 0 }, b: { ok: true, total: 0 }, c: { ok: true, total: 0 } };

test('pricing chips count and filter the loaded ledger; two chips narrow', () => {
  // Mutations checked: a chip counting false as true; two chips widening; the signals read ignored by the filter.
  const pricing = pricingSignalsRead(SIGNALS());
  const by = Object.fromEntries(needsSummary(LEDGER, READS, pricing).map((n) => [n.key, n]));
  assert.equal(by.pricing_review_due.label, 'Pricing review due · 2');
  assert.equal(by.pricing_data_incomplete.label, 'Pricing data incomplete · 1');
  assert.equal(by.pricing_overridden.label, 'Overridden pricing · 1');
  assert.equal(by.exclusivity_at_risk.label, 'Exclusivity at risk · None');
  assert.deepEqual(filterByNeeds(LEDGER, READS, ['pricing_review_due'], pricing).map((l) => l.uid), ['a', 'b']);
  assert.deepEqual(filterByNeeds(LEDGER, READS, ['pricing_review_due', 'pricing_overridden'], pricing).map((l) => l.uid), ['a']);
  assert.deepEqual(needsFromParam('pricing_overridden,renewal'), ['renewal', 'pricing_overridden']);
  assert.deepEqual(NEEDS.filter((n) => n.group === 'pricing').map((n) => n.key), ['pricing_review_due', 'pricing_data_incomplete', 'pricing_overridden', 'exclusivity_at_risk']);
});

test('a pricing chip is Reading before the read answers and Unavailable when it failed or a signal is unknown, never 0', () => {
  // Mutations checked: a failed read counted as none; a null signal counted as false; Reading shown as None.
  const reading = needsSummary(LEDGER, READS, pricingSignalsRead(undefined)).find((n) => n.key === 'pricing_review_due');
  assert.deepEqual(reading, { key: 'pricing_review_due', state: 'reading', label: 'Pricing review due · Reading…' });
  const failed = needsSummary(LEDGER, READS, pricingSignalsRead(null)).find((n) => n.key === 'pricing_overridden');
  assert.equal(failed.state, 'unavailable');
  const unknown = SIGNALS();
  unknown.items[2].signals.exclusivity_at_risk = null;
  assert.equal(needsSummary(LEDGER, READS, pricingSignalsRead(unknown)).find((n) => n.key === 'exclusivity_at_risk').label, 'Exclusivity at risk · Unavailable');
  assert.deepEqual(filterByNeeds(LEDGER, READS, ['pricing_review_due'], pricingSignalsRead(null)), [], 'an unread signal matches nothing');
  for (const n of needsSummary(LEDGER, READS, pricingSignalsRead(null))) assert.doesNotMatch(n.label, /· 0$/);
});

test('the pricing signals fold into Attention; no new column', () => {
  // Mutation checked: pricing signals left out of Attention.
  const pricing = pricingSignalsRead(SIGNALS());
  assert.equal(attentionCell(LEDGER[0], READS.a, pricing).label, '2 items');
  assert.equal(attentionCell(LEDGER[2], READS.c, pricing).label, 'None');
  assert.equal(attentionCell(LEDGER[0], READS.a).label, 'None', 'without the read, only what the ledger read knows');
  const table = read('frontend/src/pages/admin/licences/LedgerTable.jsx');
  assert.match(table, /const COLUMNS = \['Licence \/ studio', 'Territory', 'Status', 'Renewal', 'Agreement', 'Branch', 'Requests', 'Billing', 'Attention'\];/);
});

test('the licence\'s Pricing & Market facts: stale sources, the recommendation\'s standing, and no decision recorded', () => {
  // Mutations checked: a stale source not flagged; "applied" said of a snapshot the terms did not come from; no-decision lost.
  const view = {
    countries: [{ country_code: 'FR', recorded: true, inputs: { a: { status: 'recorded', as_of: '2025-10-01' }, b: { status: 'not_recorded', as_of: '2020-01-01' } } }, { country_code: 'BE', recorded: false }],
    recommendation: { uid: 'snap-2', pricing_model_version: 'v3', created_at: '2026-10-04T10:00:00Z' },
    latest_decision: null,
  };
  const f = licenceMarketFacts(view, TODAY);
  assert.deepEqual(f.stale, [{ code: 'FR', oldest: '2025-10-01', months: 13 }], 'a not-recorded input\'s date is not read');
  assert.equal(f.recommendation, 'From model v3 · snapshot 2026-10-04 · not applied');
  assert.equal(f.noDecision, true);
  assert.equal(f.accepted, null);
  const applied = licenceMarketFacts({ ...view, latest_decision: { snapshot_uid: 'snap-2', decision: 'overridden', override_reason: 'Launch hold', created_at: '2026-10-05T00:00:00Z', effective_from: '2026-11-01' } }, TODAY);
  assert.equal(applied.recommendation, 'From model v3 · snapshot 2026-10-04 · applied');
  assert.equal(applied.accepted, 'Overridden 2026-10-05 · effective 2026-11-01 · Launch hold');
});

// ── The screens ─────────────────────────────────────────────────────────────

async function mount(path, routePath, element) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: routePath, element }))));
    await settle(); await settle(); await settle();
  });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    all, props, text: () => text(container), textOf: (id) => text(all(id)[0]),
    click: (id) => act(async () => { props(all(id)[0]).onClick(); await settle(); await settle(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const ok = (v) => () => Promise.resolve(v);
const fail = (status) => () => Promise.reject(Object.assign(new Error('nope'), { status }));

test('the catalogue screen: every market with its model, freshness and fees; Incomplete data filters', async () => {
  // Mutations checked: the model line dropped; an unpriced market drawn as a fee; the filter not applied.
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api: { catalogue: ok(CATALOGUE), modelVersions: ok(VERSIONS) } }));
  try {
    assert.equal(v.textOf('pricing-model-line'), 'Model v3 · active · EUR');
    assert.equal(v.all('pricing-country-row').length, 3);
    assert.match(v.textOf('pricing-catalogue-table'), /DenmarkDK.*No recommendation/s);
    assert.match(v.textOf('pricing-catalogue-table'), /Stale · 14 months · 2025-09-02/);
    assert.equal(v.props(v.all('pricing-tab-catalogue')[0])['aria-current'], 'page');
    assert.equal(v.props(v.all('pricing-tab-models')[0])['aria-current'], undefined, 'only the current tab is lit');
    await v.click('pricing-data-incomplete');
    assert.deepEqual(v.all('pricing-country-row').map((n) => v.props(n)['data-code']), ['PT', 'DK']);
  } finally { await v.unmount(); }
});

test('the catalogue screen: a failed read is Unavailable with Retry; a refusal says Super Admin; an empty one says so', async () => {
  // Mutations checked: a failed read drawn as an empty catalogue; a 403 drawn as Unavailable.
  const down = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api: { catalogue: fail(500), modelVersions: ok(VERSIONS) } }));
  try {
    assert.match(down.textOf('pricing-unavailable'), /could not be read\. It is Unavailable, not empty\./);
    assert.equal(down.all('pricing-catalogue-empty').length, 0);
  } finally { await down.unmount(); }
  const refused = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api: { catalogue: fail(403), modelVersions: fail(403) } }));
  try { assert.match(refused.textOf('pricing-refused'), /Super Admin only/); } finally { await refused.unmount(); }
  const empty = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api: { catalogue: ok({ ...CATALOGUE, countries: [], total: 0 }), modelVersions: ok(VERSIONS) } }));
  try { assert.match(empty.textOf('pricing-catalogue-empty'), /No market profile is recorded yet/); } finally { await empty.unmount(); }
});

test('the country screen: inputs with provenance, the trace, the standing and the digest', async () => {
  // Mutations checked: the source reference dropped; a provisional result shown as complete; the digest hidden.
  let asked = null;
  const api = { country: (code, p) => { asked = [code, p]; return Promise.resolve(DETAIL); } };
  const v = await mount('/admin/licences/pricing/country/pt', '/admin/licences/pricing/country/:code', h(PricingCountry, { api }));
  try {
    assert.deepEqual(asked, ['PT', {}]);
    assert.match(v.textOf('pricing-country-inputs'), /INE · Estimativas 2025/);
    assert.match(v.textOf('pricing-country-inputs'), /52\.0 · rank 21/);
    assert.equal(v.all('pricing-trace-row').length, 9);
    assert.match(v.textOf('pricing-country-standing'), /Provisional: Startup ecosystem score is provisional\./);
    assert.match(v.textOf('pricing-country-digest'), /sha256:abc/);
    assert.match(v.text(), /Preview recommendation · model v3/);
  } finally { await v.unmount(); }
  const missing = await mount('/admin/licences/pricing/country/zz', '/admin/licences/pricing/country/:code', h(PricingCountry, { api: { country: fail(404) } }));
  try { assert.match(missing.textOf('pricing-country-missing'), /No market profile is recorded for ZZ/); } finally { await missing.unmount(); }
});

test('the models screen and the review queue', async () => {
  // Mutations checked: no-active-model unsaid; the no-decision licences dropped; the window not sent.
  const m = await mount('/admin/licences/pricing/models', '/admin/licences/pricing/models', h(PricingModels, { api: { modelVersions: ok({ ...VERSIONS, current: null, current_reason: 'No pricing model is active.' }) } }));
  try {
    assert.match(m.textOf('pricing-no-active-model'), /No pricing model is active\./);
    assert.deepEqual(m.all('pricing-model-row').map((n) => m.props(n)['data-state']), ['draft', 'retired']);
  } finally { await m.unmount(); }
  const windows = [];
  const r = await mount('/admin/licences/pricing/reviews', '/admin/licences/pricing/reviews', h(PricingReviews, { api: { reviewQueue: (p) => { windows.push(p.within_days); return Promise.resolve(QUEUE); } } }));
  try {
    assert.equal(r.all('pricing-review-row').length, 2);
    assert.equal(r.textOf('pricing-reviews-count'), '2 due now · 1 with no review open');
    assert.match(r.textOf('pricing-no-decision'), /No pricing decision recorded · 1.*Iberia Lab/s);
    await r.click('pricing-window-120');
    assert.deepEqual(windows, [0, 120]);
  } finally { await r.unmount(); }
});

test('the licence\'s Pricing & Market section: no decision recorded, the standing, exclusivity and the catalogue linked', async () => {
  // Mutations checked: the no-decision note dropped; the recommendation's standing dropped; the exclusivity link lost.
  const REC = { initial_fee_cents: 4_500_000, annual_fee_cents: 4_750_000, royalty_bps: 600, minimum_royalty_cents: 1_900_000, regulatory_surcharge_cents: null };
  const view = {
    licence_uid: 'lic_a', terms: { annual_fee_cents: 1_000_000, revenue_share_bps: 3000, currency: 'EUR', terms_revision: 4 },
    territory: ['FR'], basis: { basis: 'primary_country', primary_country: 'FR', weights: { FR: 10000 }, implied: true, policy: null },
    model: { uid: 'm1', version: 'v1', currency: 'EUR' }, countries: [{ country_code: 'FR', recorded: true, inputs: { purchasing_power: { status: 'recorded', as_of: '2020-01-01' } } }],
    recommendation: { uid: 'snap-1', basis: 'primary_country', available: true, currency: 'EUR', recommended: REC, created_at: '2026-11-08T10:00:00Z', pricing_model_version: 'v1', trace: { components: [] } },
    latest_decision: null, reviews: [], agreement: { state: 'matches' },
  };
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(h(CountryPricing, { licence: { uid: 'lic_a' }, api: { get: ok(view) } })); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
    const nodes = walk(container);
    const by = (id) => nodes.find((n) => props(n)['data-testid'] === id);
    const all = text(container);
    assert.match(all, /Pricing & Market/);
    assert.match(text(by('pricing-no-decision')), /No pricing decision recorded\./);
    assert.equal(text(by('pricing-recommendation-standing')), 'From model v1 · snapshot 2026-11-08 · not applied');
    const hrefs = nodes.map((n) => props(n).href).filter(Boolean);
    assert.ok(hrefs.includes('/admin/licences/lic_a/territory'), 'the exclusivity block is linked, not redrawn');
    assert.ok(hrefs.includes('/admin/licences/pricing/country/FR'), 'each market opens its sources and calculation');
    assert.match(text(by('pricing-stale')), /FR \(oldest input 2020-01-01/);
    assert.match(text(by('pricing-table')), /Accepted terms/);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('wiring: the routes, the API module against the Worker routes, and the ledger door', () => {
  // Mutations checked: a route not hqOnly; an API path the Worker does not mount; the ledger door removed.
  const routes = read('frontend/src/routes/adminLicencePricing.jsx');
  for (const p of ['/admin/licences/pricing', '/admin/licences/pricing/country/:code', '/admin/licences/pricing/models', '/admin/licences/pricing/reviews']) {
    assert.match(routes, new RegExp(`<Route path="${p.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{guard\\(\\['admin'\\], hqOnly\\(`), p);
  }
  const worker = read('cloudflare-worker/src/routes/admin_licence_pricing_hq.ts');
  const api = read('frontend/src/lib/api/licencePricingHq.js');
  for (const [front, back] of [['/catalogue', "'/catalogue'"], ['/catalogue/${', "'/catalogue/:code'"], ['/model-versions', "'/model-versions'"], ['/review-queue', "'/review-queue'"], ['/signals', "'/signals'"]]) {
    assert.ok(api.includes(`/admin/licence-pricing${front}`), front);
    assert.ok(worker.includes(`r.get(${back}`), back);
  }
  assert.match(worker, /path: '\/api\/admin\/licence-pricing'/);
  assert.match(read('frontend/src/pages/admin/AdminLicences.jsx'), /href="\/admin\/licences\/pricing"/);
  assert.match(read('frontend/src/pages/admin/AdminLicences.jsx'), /licencePricingHqApi\.signals\(\)/);
  assert.equal(PRICING_PATHS.country('fr'), '/admin/licences/pricing/country/FR');
});
