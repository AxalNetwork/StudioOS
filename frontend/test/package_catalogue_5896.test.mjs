/**
 * D5896 (#5896, part 1 (a) of #5026) — HQ's Axal VC package catalogue at /admin/licences/packages (board L29): the
 * model's rules, the page in each read state, the strip's door and the route's rank above /admin/licences/:uid.
 * Every package below is synthetic; the seed's draft v1 is drawn as the migration leaves it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/package_catalogue_5896.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { matchRoutes } from 'react-router-dom';
import { licencePackagesApi } from '../src/lib/api/licencePackages.js';
import { programGrantsApi } from '../src/lib/api/programGrants.js';
import { PackageCatalogueView } from '../src/pages/admin/licences/PackageCatalogue.jsx';
import {
  CATALOGUE_COLUMNS, NOT_RECORDED, catalogueRows, effectiveWord, guidanceRange, historyRows, money, localGrantLabel, rowCells,
} from '../src/pages/admin/licences/packageCatalogueModel.js';
import { HQ_STRIPS } from '../src/lib/hqStrips.js';
import { readRoutesSource } from './_routesSource.mjs';
import { mountContracts } from './_contracts_dom.mjs';

const v = (o) => ({
  uid: `pkg_${o.package_key}_v${o.version}`, description: null, currency: 'EUR', base_annual_fee_cents: 1000000,
  guidance_min_cents: 800000, guidance_max_cents: 1200000, floor_multiplier_ppm: null, ceiling_multiplier_ppm: null,
  effective_from: '2026-12-01', effective_to: null, created_at: '2026-11-09 10:00:00', created_by: 'user:1', ...o,
});
const CORE_V1 = v({ package_key: 'core_network', version: 1, name: 'Core Network', status: 'active' });
const VB_V1 = v({ package_key: 'venture_building', version: 1, name: 'Venture Building', status: 'active', base_annual_fee_cents: 3750000 });
const VB_V2 = v({ package_key: 'venture_building', version: 2, name: 'Venture Building', status: 'draft', base_annual_fee_cents: 4100000, guidance_min_cents: null, created_at: '2026-11-12 09:00:00' });
const OLD_V1 = v({ package_key: 'legacy', version: 1, name: 'Legacy bundle', status: 'retired', effective_to: '2026-10-31' });
const OLD_V2 = v({ package_key: 'legacy', version: 2, name: 'Legacy bundle', status: 'retired', effective_from: '2026-11-01', effective_to: '2026-11-30' });
const SEED = v({ package_key: 'talent_learning', version: 1, name: 'Talent & Learning', status: 'draft' });
const ITEMS = {
  'core_network:1': [{ program_key: 'perks', position: 2 }, { program_key: 'referral-partners', position: 1 }],
  'venture_building:1': [{ program_key: 'spinout-lab', position: 1 }, { program_key: 'ai-native-venture', position: 2 }, { program_key: 'product-testing', position: 3 }],
  'venture_building:2': [{ program_key: 'spinout-lab', position: 1 }, { program_key: 'ai-native-venture', position: 2 }, { program_key: 'product-testing', position: 3 }, { program_key: 'mentor-cohorts', position: 4 }],
  'talent_learning:1': [{ program_key: 'learning', position: 1 }],
};

/* ── the model ─────────────────────────────────────────────────────────────── */

test('the table lists each key\'s active version and the drafts above it, a retired-only key by its newest, the seed as Draft', () => {
  const rows = catalogueRows([VB_V2, VB_V1, CORE_V1, OLD_V1, OLD_V2, SEED]);
  assert.deepEqual(rows.map((r) => `${r.name} v${r.version} ${r.status}`), [
    'Core Network v1 active', 'Venture Building v1 active', 'Talent & Learning v1 draft', 'Venture Building v2 draft', 'Legacy bundle v2 retired',
  ]);
  // A draft below the active version is history, not a row.
  const below = v({ package_key: 'core_network', version: 0, name: 'Core Network', status: 'draft' });
  assert.deepEqual(catalogueRows([CORE_V1, below]).map((r) => r.version), [1]);
  assert.deepEqual(catalogueRows([]), []);
  assert.equal(rowCells(SEED, { state: 'ready', items: ITEMS['talent_learning:1'] }).status, 'Draft');
});

test('money is the version\'s own currency, and an absent figure is Not recorded, never 0', () => {
  assert.equal(money(1000000, 'EUR'), '€10,000');
  assert.equal(money(0, 'EUR'), '€0');
  assert.equal(money(null, 'EUR'), NOT_RECORDED);
  assert.equal(money(1000000, 'XXX'), NOT_RECORDED);
  assert.equal(guidanceRange(CORE_V1), '€8,000 – €12,000');
  assert.equal(guidanceRange(VB_V2), NOT_RECORDED);
  assert.equal(guidanceRange({ ...CORE_V1, guidance_max_cents: null }), NOT_RECORDED);
  const c = rowCells(VB_V2, { state: 'ready', items: ITEMS['venture_building:2'] });
  assert.deepEqual([c.version, c.programs, c.base, c.guidance, c.standalone, c.saving, c.effective], ['v2', '4', '€41,000', NOT_RECORDED, NOT_RECORDED, NOT_RECORDED, 'Not in force']);
  assert.equal(rowCells(CORE_V1, { state: 'error' }).programs, 'Unreadable');
  assert.equal(CATALOGUE_COLUMNS[0], 'Axal VC package');
});

test('effective dates: a draft is not in force, a retired version reads its span, history is newest first', () => {
  assert.equal(effectiveWord(CORE_V1), '1 Dec 2026');
  assert.equal(effectiveWord(OLD_V1), '1 Dec 2026 – 31 Oct 2026');
  assert.equal(effectiveWord(SEED), 'Not in force');
  assert.deepEqual(historyRows([VB_V1, VB_V2]).map((r) => `${r.version} ${r.status} ${r.created}`), ['v2 Draft 12 Nov 2026', 'v1 Active 9 Nov 2026']);
  assert.equal(localGrantLabel(undefined), 'Requires an existing studio grant');
  assert.equal(localGrantLabel({ readiness: 'yes', grantable: false }), 'New studio grants disabled');
  assert.equal(localGrantLabel({}), 'Availability not recorded');
});

/* ── the page ──────────────────────────────────────────────────────────────── */

const original = { ...licencePackagesApi };
const originalDefaults = programGrantsApi.defaults;
const delivery = [
  { program_key: 'spinout-lab', name: 'Spin-Out Lab', readiness: 'yes', grantable: true },
  { program_key: 'ai-native-venture', name: 'AI-native Venture', readiness: 'notready', grantable: false },
  { program_key: 'product-testing', name: 'Product testing', readiness: 'hq', grantable: false },
  { program_key: 'mentor-cohorts', name: 'Mentor cohort access', readiness: 'yes', grantable: false },
];
const never = () => new Promise(() => {});
function stub({ catalogue, versions, version, defaults } = {}) {
  programGrantsApi.defaults = defaults || (async () => ({ programs: delivery }));
  const calls = [];
  licencePackagesApi.catalogue = async () => { calls.push('catalogue'); return catalogue(); };
  licencePackagesApi.versions = async (key) => { calls.push(`versions:${key}`); return versions ? versions(key) : never(); };
  licencePackagesApi.version = async (key, n) => { calls.push(`version:${key}:${n}`); return version ? version(key, n) : never(); };
  return calls;
}
const restore = () => { Object.assign(licencePackagesApi, original); programGrantsApi.defaults = originalDefaults; };
const all = [CORE_V1, VB_V2, VB_V1, SEED];
const byKey = (key) => all.filter((x) => x.package_key === key).sort((a, b) => b.version - a.version);

test('a Super Admin sees every package\'s version, status, programs, fee, guidance and date, and the chosen one\'s history', async (t) => {
  t.after(restore);
  const calls = stub({
    catalogue: () => ({ packages: all }),
    versions: (key) => ({ package_key: key, versions: [...byKey(key)].reverse() }),
    version: (key, n) => {
      if (key === 'core_network') throw Object.assign(new Error('boom'), { status: 500 });
      return { package: { ...all.find((x) => x.package_key === key && x.version === n), items: ITEMS[`${key}:${n}`] } };
    },
  });
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush(); await page.flush();
  const text = page.text();
  for (const col of CATALOGUE_COLUMNS) assert.ok(text.includes(col), `missing column ${col}`);
  assert.match(text, /Core Networkv1Active! Unreadable€10,000€8,000 – €12,000Not recordedNot recorded1 Dec 2026/);
  assert.match(text, /Venture Buildingv1Active3€37,500/);
  assert.match(text, /Talent & Learningv1Draft1€10,000€8,000 – €12,000Not recordedNot recordedNot in force/);
  assert.match(text, /Venture Buildingv2Draft4€41,000Not recordedNot recordedNot recordedNot in force/);
  assert.match(text, /Standalone sum and Bundle saving: Priced per licence/);
  // The first row's package is chosen; its history failed nothing but its programs, which say Unreadable.
  assert.match(text, /Version history · Core Network/);
  assert.ok(calls.includes('versions:core_network'));
  await page.click('Venture Building');
  await page.flush(); await page.flush();
  const h = page.text().slice(page.text().indexOf('Version history · Venture Building'));
  assert.match(h, /v2DraftSpin-Out Lab · Studio operation · Offered for local operationAI-native Venture · Studio operation · Not ready for local operationProduct testing · Studio operation · Run by HQEdit deliveryMentor cohort access · Studio operation · New studio grants disabled/);
  assert.match(h, /v1ActiveSpin-Out Lab · Studio operation · Offered for local operationAI-native Venture · Studio operation · Not ready for local operationProduct testing · Studio operation · Run by HQ/);
  assert.doesNotMatch(page.text(), /package plan/i);
});

test('an explicitly defined HQ service keeps its description even if local grant rules cannot be read', async (t) => {
  t.after(restore);
  stub({
    catalogue: () => ({ packages: [VB_V1] }),
    versions: () => ({ versions: [VB_V1] }),
    version: () => ({ package: { items: [{ program_key: 'product-testing', included_by_default: true,
      delivery: { kind: 'hq_service', description: 'HQ coordinates the testing panel.' } }] } }),
    defaults: async () => { throw new Error('Unavailable'); },
  });
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush(); await page.flush();
  assert.match(page.text(), /product-testing · HQ service · HQ coordinates the testing panel\./);
  assert.doesNotMatch(page.text(), /product-testing · Studio operation/);
});

test('an unavailable grant rule read preserves version contents and offers a retry', async (t) => {
  t.after(restore);
  let fail = true;
  stub({
    catalogue: () => ({ packages: [VB_V1] }),
    versions: () => ({ versions: [VB_V1] }),
    version: () => ({ package: { items: ITEMS['venture_building:1'] } }),
    defaults: async () => { if (fail) throw new Error('Unavailable'); return { programs: delivery }; },
  });
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush(); await page.flush();
  assert.match(page.text(), /product-testing · Studio operation · Availability unreadable/);
  fail = false;
  await page.click('Try again'); await page.flush();
  assert.match(page.text(), /Product testing · Studio operation · Run by HQ/);
});

test('an empty catalogue is None, and a failed read is Unreadable with Try again, never an empty catalogue', async (t) => {
  t.after(restore);
  stub({ catalogue: () => ({ packages: [] }) });
  const empty = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  await empty.flush();
  assert.match(empty.text(), /No Axal VC package exists yet/);
  assert.doesNotMatch(empty.text(), /Unreadable/);
  await empty.unmount();

  let fail = true;
  const calls = stub({
    catalogue: () => { if (fail) throw Object.assign(new Error('down'), { status: 503 }); return { packages: [CORE_V1] }; },
    versions: () => ({ versions: [CORE_V1] }),
    version: () => ({ package: { ...CORE_V1, items: ITEMS['core_network:1'] } }),
  });
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush();
  assert.match(page.text(), /Unreadable\. The Axal VC package catalogue could not be read/);
  assert.doesNotMatch(page.text(), /No Axal VC package exists yet/);
  fail = false;
  await page.click('Try again');
  await page.flush(); await page.flush();
  assert.equal(calls.filter((c) => c === 'catalogue').length, 2);
  assert.match(page.text(), /Core Networkv1Active2€10,000/);
});

test('a failed history read is its own Unreadable, and the table stays', async (t) => {
  t.after(restore);
  stub({
    catalogue: () => ({ packages: [CORE_V1] }),
    versions: () => { throw Object.assign(new Error('down'), { status: 500 }); },
    version: () => ({ package: { ...CORE_V1, items: ITEMS['core_network:1'] } }),
  });
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush(); await page.flush();
  assert.match(page.text(), /Core Networkv1Active2/);
  assert.match(page.text(), /Unreadable\. The versions of this Axal VC package could not be read/);
});

test('HQ can describe and remove a draft HQ service, reloading only the edited version', async (t) => {
  t.after(restore);
  const versions = [VB_V2, VB_V1, { ...VB_V1, version: 0, status: 'retired' }];
  let service = null;
  const program = 'product-testing';
  const calls = stub({
    catalogue: () => ({ packages: versions }),
    versions: () => ({ versions }),
    version: (_, n) => ({ package: { ...versions.find((v) => v.version === n), items: [
      { program_key: 'spinout-lab' }, { program_key: program, ...(n === 2 && service ? { delivery: service } : {}) },
    ] } }),
  });
  const writes = [];
  licencePackagesApi.updateItemDelivery = async (...args) => {
    writes.push(args);
    service = args[3].delivery.kind === 'hq_service' ? args[3].delivery : null;
  };
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush();
  const buttons = () => page.nodes().filter((node) => node.tagName === 'BUTTON').map(page.props);
  assert.deepEqual(buttons().map((p) => p['aria-label']).filter((a) => a?.startsWith('Edit delivery')), ['Edit delivery for Product testing, v2']);
  const mark = calls.length;
  await page.click('Edit delivery');
  await page.fill('Delivered by', 'hq_service');
  await page.fill('Service provided by HQ', '   ');
  assert.ok(buttons().find((p) => p.children === 'Save delivery').disabled);
  await page.fill('Service provided by HQ', 'a'.repeat(501));
  assert.ok(buttons().find((p) => p.children === 'Save delivery').disabled);
  assert.equal(page.props(page.nodes().find((n) => n.tagName === 'TEXTAREA')).maxLength, 500);
  await page.fill('Service provided by HQ', '  HQ runs one testing panel.  ');
  await page.click('Save delivery'); await page.flush();
  assert.deepEqual(writes[0], ['venture_building', 2, program, { expected_description: null,
    delivery: { kind: 'hq_service', description: 'HQ runs one testing panel.' } }]);
  assert.deepEqual(calls.slice(mark), ['version:venture_building:2']);
  assert.match(page.text(), /HQ service · HQ runs one testing panel/);
  await page.click('Edit delivery');
  await page.fill('Delivered by', 'studio_operation');
  await page.click('Save delivery'); await page.flush();
  assert.deepEqual(writes[1][3], { expected_description: 'HQ runs one testing panel.', delivery: { kind: 'studio_operation' } });
  assert.doesNotMatch(page.text(), /HQ service · HQ runs/);
  assert.match(page.text(), /Product testing · Studio operation · Run by HQ/);

  licencePackagesApi.publish = async () => {
    versions[0] = { ...VB_V2, status: 'active' };
    versions[1] = { ...VB_V1, status: 'retired' };
    return { package: versions[0], retired_version: 1 };
  };
  await page.click('Publish…');
  const { act } = await import('react');
  await act(async () => page.props(page.nodes().find((n) => n.tagName === 'TEXTAREA')).onChange({ target: { value: 'Publish reviewed delivery terms' } }));
  await page.click('Publish');
  await page.flush(); await page.flush();
  assert.doesNotMatch(page.text(), /Edit delivery/, 'publication refreshes each history detail before offering draft-only editing');
});

test('a refused save preserves the draft input; conflicting publication reloads the version and removes editing', async (t) => {
  t.after(restore);
  let status = 'draft';
  const message = 'The draft or its delivery terms changed. Reload the version.';
  stub({
    catalogue: () => ({ packages: [VB_V2] }),
    versions: () => ({ versions: [VB_V2] }),
    version: () => ({ package: { ...VB_V2, status, items: [{ program_key: 'product-testing' }] } }),
  });
  let writes = 0;
  licencePackagesApi.updateItemDelivery = async () => {
    writes++;
    if (writes === 1) throw new Error('Your session needs a recent sign-in.');
    status = 'active';
    throw Object.assign(new Error(message), { code: 'changed_since_open', status: 409 });
  };
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  t.after(() => page.unmount());
  await page.flush();
  await page.click('Edit delivery');
  await page.fill('Delivered by', 'hq_service');
  await page.fill('Service provided by HQ', 'HQ provides a testing panel.');
  await page.click('Save delivery');
  assert.match(page.text(), /Your session needs a recent sign-in/);
  assert.equal(page.props(page.nodes().find((n) => n.tagName === 'TEXTAREA')).value, 'HQ provides a testing panel.');
  await page.click('Save delivery');
  assert.ok(page.text().includes(message));
  assert.doesNotMatch(page.text(), /Save delivery/);
  await page.click('Reload version'); await page.flush();
  assert.equal(writes, 2);
  assert.match(page.text(), /Version history[\s\S]+v2Active/);
  assert.doesNotMatch(page.text(), /Edit delivery/);
});

/* ── the address and the door ─────────────────────────────────────────────── */

test('/admin/licences/packages outranks /admin/licences/:uid, is HQ only, and the Licences strip opens it', () => {
  const src = readRoutesSource();
  const declared = [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
  const best = (url) => matchRoutes(declared.map((path) => ({ path })), url)?.at(-1)?.route.path ?? null;
  assert.equal(best('/admin/licences/packages'), '/admin/licences/packages');
  assert.equal(best('/admin/licences/lic_1'), '/admin/licences/:uid');
  assert.match(src, /<Route path="\/admin\/licences\/packages" element=\{guard\(\['admin'\], hqOnly\(<PackageCatalogue \/>\)\)\} \/>/);
  assert.deepEqual(HQ_STRIPS.Licences.at(-1), { label: 'Axal VC packages', route: '/admin/licences/packages' });
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<StripLink to="\/admin\/licences\/packages">Axal VC packages<\/StripLink>/);
});

test('the client reads with ?all=1 for the catalogue and encoded keys; it has no DELETE (D5897 §4 adds the writes)', () => {
  const src = readFileSync(new URL('../src/lib/api/licencePackages.js', import.meta.url), 'utf8');
  assert.match(src, /request\('\/admin\/licence-packages\?all=1'\)/);
  assert.doesNotMatch(src, /method:\s*'DELETE'/);
  assert.match(src, /versions[/][$][{]enc[(]version[)][}][/]items[/][$][{]enc[(]program[)][}][/]delivery/);
  assert.match(src, /method: 'PATCH', body: JSON.stringify[(]body[)]/);
});
