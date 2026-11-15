/**
 * D5898 (#5898, part 1 (c) of #5026) — compare Axal VC packages and price them for one licence
 * (/admin/licences/packages/compare, board L30): the model's rules, the page in each state the issue names (no
 * licence chosen, no active packages, a failed read, provisional market data, a bundle that costs more than its
 * programs), Preview pricing from the catalogue, and the route's rank. Every package and licence is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/package_compare_5898.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { matchRoutes } from 'react-router-dom';
import { licencePackagesApi, pricingQuery } from '../src/lib/api/licencePackages.js';
import { licenceLedgerApi } from '../src/lib/api/licenceLedger.js';
import { PackageCompareView } from '../src/pages/admin/licences/PackageCompare.jsx';
import { PackageCatalogueView } from '../src/pages/admin/licences/PackageCatalogue.jsx';
import {
  NOT_RECORDED, compareColumns, indexWord, percentWord, previewHref, priceCells, programGrid, provenance, recFor, warningSentence,
} from '../src/pages/admin/licences/packageCompareModel.js';
import { readRoutesSource } from './_routesSource.mjs';
import { mountContracts } from './_contracts_dom.mjs';

const v = (o) => ({
  uid: `pkg_${o.package_key}_v${o.version}`, description: null, currency: 'EUR', base_annual_fee_cents: 1000000,
  guidance_min_cents: 800000, guidance_max_cents: 1200000, effective_from: '2026-12-01', effective_to: null,
  created_at: '2026-11-09 10:00:00', created_by: 'user:1', ...o,
});
const CORE = v({ package_key: 'core_network', version: 1, name: 'Core Network', status: 'active' });
const TALENT = v({ package_key: 'talent_learning', version: 1, name: 'Talent & Learning', status: 'active', base_annual_fee_cents: 1500000 });
const VB = v({ package_key: 'venture_building', version: 1, name: 'Venture Building', status: 'active', base_annual_fee_cents: 3750000 });
const VB_DRAFT = v({ package_key: 'venture_building', version: 2, name: 'Venture Building', status: 'draft', base_annual_fee_cents: 4100000 });
const OLD = v({ package_key: 'legacy', version: 1, name: 'Legacy bundle', status: 'retired' });
const ITEMS = {
  'core_network:1': [{ program_key: 'referral-partners', position: 1, included_by_default: true }, { program_key: 'perks', position: 2, included_by_default: true }],
  'talent_learning:1': [{ program_key: 'learning', position: 1, included_by_default: true }, { program_key: 'perks', position: 2, included_by_default: false }],
  'venture_building:1': [{ program_key: 'spinout-lab', position: 1, included_by_default: true }, { program_key: 'product-testing', position: 2, included_by_default: true }],
  'venture_building:2': [{ program_key: 'spinout-lab', position: 1, included_by_default: true }, { program_key: 'mentor-cohorts', position: 2, included_by_default: true }],
};
const rec = (pkg, o = {}) => ({
  available: true, unavailable_reason: null, package_uid: pkg.uid, package_key: pkg.package_key, package_version: pkg.version,
  currency: 'EUR', country_index_ppm: 1180000, pricing_model_version: 3, base_annual_fee_cents: pkg.base_annual_fee_cents,
  recommended_annual_fee_cents: 1180000, guidance_min_cents: null, guidance_max_cents: null, programs: [{ program_key: 'x' }],
  standalone_sum_cents: 1450000, bundle_saving_cents: 270000, bundle_discount_bps: 1862, bundle_value_warning: false,
  bundle_premium_cents: null, warnings: [], name: pkg.name, status: pkg.status, ...o,
});
const PRICING = {
  licence_uid: 'lic_fr',
  snapshot: { uid: 'snap-0001-fr', latest: true, created_at: '2026-10-04 09:00:00', pricing_model_version: 3, currency: 'EUR' },
  country_index_ppm: 1180000, index_reason: null, model_version: 3,
  packages: [
    rec(CORE),
    rec(TALENT, {
      recommended_annual_fee_cents: 1770000, standalone_sum_cents: 1500000, bundle_saving_cents: null, bundle_discount_bps: null,
      bundle_value_warning: true, bundle_premium_cents: 270000,
      warnings: [
        { code: 'provisional_market_data', sentence: 'The country index uses provisional market data for FR (rent).' },
        { code: 'bundle_value_warning', sentence: 'This package costs more than its programs bought one by one (by 270000 cents), so it is shown with no discount.', detail: { premium_cents: 270000 } },
      ],
    }),
    rec(VB, {
      recommended_annual_fee_cents: 4450000, standalone_sum_cents: null, bundle_saving_cents: null, bundle_discount_bps: null,
      warnings: [{ code: 'missing_program_price', sentence: 'No reference price is recorded for product-testing, so the programs\' standalone total is not known and no saving is shown.' }],
    }),
  ],
};

/* ── the model ─────────────────────────────────────────────────────────────── */

test('columns: every active version, cheapest base first; Preview pricing narrows to one version, a draft included', () => {
  const all = [VB_DRAFT, VB, TALENT, CORE, OLD];
  assert.deepEqual(compareColumns(all).map((c) => `${c.package_key}:${c.version}`), ['core_network:1', 'talent_learning:1', 'venture_building:1']);
  assert.deepEqual(compareColumns(all, { package_key: 'venture_building', version: '2' }).map((c) => c.status), ['draft']);
  assert.deepEqual(compareColumns(all, { package_key: 'venture_building' }).map((c) => c.version), [1], 'no version: the active one');
  assert.deepEqual(compareColumns(all, { package_key: 'legacy' }).map((c) => c.status), ['retired'], 'no active: the newest');
  assert.deepEqual(compareColumns(all, { package_key: 'venture_building', version: '9' }), []);
  assert.deepEqual(compareColumns([]), []);
});

test('the grid lists every program any column lists, marks included, optional and absent, and a failed column alone', () => {
  const cols = [CORE, TALENT, VB];
  const details = {
    'core_network:1': { state: 'ready', items: ITEMS['core_network:1'] },
    'talent_learning:1': { state: 'ready', items: ITEMS['talent_learning:1'] },
    'venture_building:1': { state: 'error' },
  };
  const grid = programGrid(cols, details);
  assert.deepEqual(grid.map((r) => r.program), ['referral-partners', 'perks', 'learning']);
  assert.deepEqual(grid.find((r) => r.program === 'perks').cells, ['included', 'optional', 'unreadable']);
  assert.deepEqual(grid.find((r) => r.program === 'learning').cells, ['none', 'included', 'unreadable']);
});

test('prices are the Worker\'s: Not recorded with its sentence when null, never 0 and never a smaller sum', () => {
  const none = priceCells(CORE, undefined, { licenceChosen: false });
  assert.equal(none.base.text, '€10,000');
  assert.equal(none.adjusted.text, NOT_RECORDED);
  assert.match(none.adjusted.note, /Choose a licence/);
  assert.match(priceCells(CORE, undefined, { licenceChosen: true, priced: false }).saving.note, /no package price/);

  const core = priceCells(CORE, recFor(PRICING, CORE), { licenceChosen: true });
  assert.deepEqual([core.adjusted.text, core.standalone.text, core.saving.text, core.warnings.text], ['€11,800', '€14,500', '€2,700 · 18.6%', 'None']);

  const vb = priceCells(VB, recFor(PRICING, VB), { licenceChosen: true });
  assert.equal(vb.adjusted.text, '€44,500');
  assert.equal(vb.standalone.text, NOT_RECORDED);
  assert.match(vb.standalone.note, /No reference price is recorded for product-testing/);
  assert.equal(vb.saving.text, NOT_RECORDED);
  assert.notEqual(vb.standalone.text, '€0');

  const talent = priceCells(TALENT, recFor(PRICING, TALENT), { licenceChosen: true });
  assert.equal(talent.saving.text, 'No saving');
  assert.equal(talent.saving.note, 'This package costs more than its programs bought one by one, by €2,700, so it is shown with no discount.');
  assert.deepEqual(talent.warnings.list.map((w) => w.code), ['provisional_market_data', 'bundle_value_warning']);

  const off = priceCells(CORE, rec(CORE, { available: false, unavailable_reason: 'This package version is priced in EUR and the licence\'s country recommendation in USD; publish a package version in USD.' }), { licenceChosen: true });
  assert.equal(off.adjusted.text, NOT_RECORDED);
  assert.match(off.adjusted.note, /priced in EUR/);
  assert.equal(recFor(PRICING, VB_DRAFT), undefined, 'a version the read did not price is not matched to another');
});

test('provenance, index, percent, warning words and the Preview pricing address', () => {
  assert.deepEqual(provenance(PRICING), { snapshot: '4 Oct 2026', latest: 'Latest', model: 'v3', index: '1.180', indexReason: null });
  assert.equal(provenance({ ...PRICING, snapshot: { ...PRICING.snapshot, latest: false } }).latest, 'Not the latest');
  assert.equal(provenance({ ...PRICING, country_index_ppm: null, index_reason: 'No index.' }).index, NOT_RECORDED);
  assert.equal(indexWord(1000000), '1.000');
  assert.equal(percentWord(null), null);
  assert.equal(warningSentence({ code: 'provisional_market_data', sentence: 'S.' }, 'EUR'), 'S.');
  assert.equal(previewHref(VB_DRAFT), '/admin/licences/packages/compare?package=venture_building&version=2');
});

/* ── the page ──────────────────────────────────────────────────────────────── */

const original = { ...licencePackagesApi };
const originalLedger = { ...licenceLedgerApi };
const never = () => new Promise(() => {});
const LICENCES = { items: [{ uid: 'lic_fr', brand_name: 'Axal VC France', licence_ref: 'FR-001' }, { uid: 'lic_de', brand_name: null, licence_ref: 'DE-001' }], total: 2, complete: true };
function stub({ catalogue = () => ({ packages: [CORE, TALENT, VB, VB_DRAFT] }), version, pricing, licences = () => LICENCES } = {}) {
  const calls = [];
  licencePackagesApi.catalogue = async () => { calls.push('catalogue'); return catalogue(); };
  licencePackagesApi.version = async (key, n) => {
    calls.push(`version:${key}:${n}`);
    if (version) return version(key, n);
    return { package: { package_key: key, version: n, items: ITEMS[`${key}:${n}`] } };
  };
  licencePackagesApi.pricing = async (uid, q = {}) => { calls.push(`pricing:${uid}:${q.package || ''}:${q.version ?? ''}`); return pricing ? pricing(uid, q) : never(); };
  licenceLedgerApi.all = async () => { calls.push('licences'); return licences(); };
  return calls;
}
const restore = () => { Object.assign(licencePackagesApi, original); Object.assign(licenceLedgerApi, originalLedger); };
async function open(url) {
  const page = await mountContracts(React.createElement(PackageCompareView), url);
  await page.flush(); await page.flush(); await page.flush();
  return page;
}

test('no licence chosen: the programs and base prices are drawn, nothing is priced, and the picker lists the licences', async (t) => {
  t.after(restore);
  const calls = stub();
  const page = await open('/admin/licences/packages/compare');
  t.after(() => page.unmount());
  const text = page.text();
  assert.match(text, /Core Network v1Talent & Learning v1Venture Building v1/);
  assert.doesNotMatch(text, /Venture Building v2/, 'a draft is not compared unless named');
  assert.match(text, /referral-partners✓—— ?perks✓Optional—/);
  assert.match(text, /Annual package price · base€10,000€15,000€37,500Country-adjustedNot recordedChoose a licence to price this package at its market\./);
  assert.match(text, /Choose a licence under “Price for”/);
  assert.match(text, /Axal VC France · FR-001/);
  assert.match(text, /DE-001/);
  assert.ok(!calls.some((c) => c.startsWith('pricing:')), 'nothing is priced before a licence is chosen');
  assert.doesNotMatch(text, /Review offer|Accept/);
  assert.doesNotMatch(text, /package plan/i);
});

test('a chosen licence: Worker prices, provenance, a missing program price, provisional data and a bundle dearer than its programs', async (t) => {
  t.after(restore);
  const calls = stub({ pricing: () => PRICING });
  const page = await open('/admin/licences/packages/compare?licence=lic_fr');
  t.after(() => page.unmount());
  const text = page.text();
  assert.ok(calls.includes('pricing:lic_fr::'), 'every active package, from the latest snapshot');
  assert.match(text, /country recommendation of 4 Oct 2026 \(Latest\) · pricing model v3 · country index 1\.180/);
  assert.match(text, /Country-adjusted · Axal VC France · FR-001€11,800€17,700€44,500/);
  assert.match(text, /Standalone sum€14,500€15,000Not recordedNo reference price is recorded for product-testing/);
  assert.match(text, /Bundle saving€2,700 · 18\.6%No savingThis package costs more than its programs bought one by one, by €2,700/);
  assert.match(text, /The country index uses provisional market data for FR \(rent\)\./);
  assert.doesNotMatch(text, /€0\b/);
});

test('a licence with no country recommendation says so; a failed pricing read is Unreadable with Try again', async (t) => {
  t.after(restore);
  stub({ pricing: () => { throw Object.assign(new Error('x'), { status: 409, code: 'no_licence_snapshot', message: 'This licence has no country recommendation yet. Make one under Country pricing first.' }); } });
  const none = await open('/admin/licences/packages/compare?licence=lic_fr');
  assert.match(none.text(), /No country recommendation yet\. This licence has no country recommendation yet/);
  assert.doesNotMatch(none.text(), /Unreadable/);
  assert.match(none.text(), /This licence has no package price/);
  await none.unmount();

  let fail = true;
  const calls = stub({ pricing: () => { if (fail) throw Object.assign(new Error('down'), { status: 503 }); return PRICING; } });
  const page = await open('/admin/licences/packages/compare?licence=lic_fr');
  t.after(() => page.unmount());
  assert.match(page.text(), /Unreadable\. The package pricing for this licence could not be read/);
  assert.doesNotMatch(page.text(), /€11,800/);
  fail = false;
  await page.click('Try again');
  await page.flush(); await page.flush();
  assert.equal(calls.filter((c) => c.startsWith('pricing:')).length, 2);
  assert.match(page.text(), /€11,800/);
});

test('no active package, and a failed catalogue read, are each said as such', async (t) => {
  t.after(restore);
  stub({ catalogue: () => ({ packages: [VB_DRAFT, OLD] }) });
  const empty = await open('/admin/licences/packages/compare');
  assert.match(empty.text(), /No Axal VC package is active yet/);
  assert.doesNotMatch(empty.text(), /Unreadable/);
  await empty.unmount();

  stub({ catalogue: () => { throw Object.assign(new Error('down'), { status: 500 }); } });
  const page = await open('/admin/licences/packages/compare');
  t.after(() => page.unmount());
  assert.match(page.text(), /Unreadable\. The Axal VC package catalogue could not be read/);
  assert.doesNotMatch(page.text(), /No Axal VC package is active yet/);
});

test('Preview pricing opens the comparison for that one version, a draft included, and prices that version', async (t) => {
  t.after(restore);
  const calls = stub({ pricing: (uid, q) => ({ ...PRICING, packages: [rec(VB_DRAFT, { recommended_annual_fee_cents: 4840000, status: 'draft' })] }) });
  const page = await open('/admin/licences/packages/compare?package=venture_building&version=2&licence=lic_fr');
  t.after(() => page.unmount());
  assert.ok(calls.includes('pricing:lic_fr:venture_building:2'));
  assert.match(page.text(), /Venture Building v2\s?· Draft/);
  assert.match(page.text(), /spinout-lab✓mentor-cohorts✓/);
  assert.match(page.text(), /€48,400/);
  assert.match(page.text(), /Compare every active package/);
});

test('the catalogue\'s rows each carry Preview pricing to that version, and the note links the comparison', async (t) => {
  t.after(restore);
  stub();
  licencePackagesApi.versions = async () => ({ versions: [CORE] });
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush(); await page.flush();
  const previews = page.nodes().filter((n) => page.props(n)?.['data-testid'] === 'package-preview-pricing');
  assert.equal(previews.length, 4, 'one per catalogue row');
  assert.match(page.text(), /Compare Axal VC packages for one licence/);
  const hrefs = page.nodes().filter((n) => n.tagName === 'A').map((n) => page.props(n)?.href);
  assert.ok(hrefs.includes('/admin/licences/packages/compare?package=venture_building&version=2'), hrefs.join(' '));
  assert.ok(hrefs.includes('/admin/licences/packages/compare'));
});

/* ── the address and the client ───────────────────────────────────────────── */

test('/admin/licences/packages/compare outranks /admin/licences/:uid and is HQ only; the client reads only', () => {
  const src = readRoutesSource();
  const declared = [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
  const best = (url) => matchRoutes(declared.map((path) => ({ path })), url)?.at(-1)?.route.path ?? null;
  assert.equal(best('/admin/licences/packages/compare'), '/admin/licences/packages/compare');
  assert.equal(best('/admin/licences/packages'), '/admin/licences/packages');
  assert.match(src, /<Route path="\/admin\/licences\/packages\/compare" element=\{guard\(\['admin'\], hqOnly\(<PackageCompare \/>\)\)\} \/>/);
  const client = readFileSync(new URL('../src/lib/api/licencePackages.js', import.meta.url), 'utf8');
  assert.match(client, /\/admin\/licences\/\$\{enc\(licenceUid\)\}\/package-pricing/);
  assert.doesNotMatch(client, /method:\s*'(POST|PUT|DELETE)'/);
  assert.equal(pricingQuery(), '');
  assert.equal(pricingQuery({ package: 'venture_building', version: 2 }), '?package=venture_building&version=2');
  assert.equal(pricingQuery({ version: 2 }), '', 'a version is never sent without its package (the Worker refuses it)');
});
