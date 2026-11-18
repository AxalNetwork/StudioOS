/**
 * D5897 (#5897, part 1 (b) of #5026) — the Axal VC package catalogue's actions (board L29): Create draft version,
 * Edit draft, Publish… and Retire…, each against a stubbed client. Every package below is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/package_actions_5897.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { licencePackagesApi } from '../src/lib/api/licencePackages.js';
import { PackageCatalogueView } from '../src/pages/admin/licences/PackageCatalogue.jsx';
import {
  bodyFrom, formFrom, keyOptions, programKeys, publishConsequence, refusalLines, retireConsequence, rowActions, writeFailure,
} from '../src/pages/admin/licences/packageDraftModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const v = (o) => ({
  uid: `pkg_${o.package_key}_v${o.version}`, description: null, currency: 'EUR', base_annual_fee_cents: 1000000,
  guidance_min_cents: 800000, guidance_max_cents: 1200000, floor_multiplier_ppm: 800000, ceiling_multiplier_ppm: null,
  effective_from: '2026-12-01', effective_to: null, created_at: '2026-11-09 10:00:00', created_by: 'user:1', ...o,
});
const CORE_V1 = v({ package_key: 'core_network', version: 1, name: 'Core Network', status: 'active' });
const VB_V1 = v({ package_key: 'venture_building', version: 1, name: 'Venture Building', status: 'active', base_annual_fee_cents: 3750000 });
const VB_V2 = v({ package_key: 'venture_building', version: 2, name: 'Venture Building', status: 'draft', base_annual_fee_cents: 4100000 });
const OLD_V2 = v({ package_key: 'legacy', version: 2, name: 'Legacy bundle', status: 'retired', effective_to: '2026-11-30' });
const ITEMS = [
  { program_key: 'ai-native-venture', position: 2, included_by_default: 0, metadata: { note: 'kept' } },
  { program_key: 'spinout-lab', position: 1, included_by_default: 1, metadata: null },
];

/* ── the model ─────────────────────────────────────────────────────────────── */

test('a Draft offers Edit draft and Publish, an Active version Retire, a Retired one nothing', () => {
  assert.deepEqual(rowActions('draft'), ['edit', 'publish']);
  assert.deepEqual(rowActions('active'), ['retire']);
  assert.deepEqual(rowActions('retired'), []);
  assert.deepEqual(rowActions(undefined), []);
});

test('the editor\'s text round-trips a version: money in major units, multipliers as decimals, programs in order with their flags', () => {
  const form = formFrom(VB_V2, ITEMS);
  assert.equal(form.base, '41000.00');
  assert.equal(form.guidance_min, '8000.00');
  assert.equal(form.floor, '0.8');
  assert.equal(form.ceiling, '');
  assert.equal(form.programs, 'spinout-lab\nai-native-venture');
  const r = bodyFrom({ ...form, base: '41,500.50', programs: 'spinout-lab\nai-native-venture\nmentor-cohorts' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, {
    name: 'Venture Building', description: null, currency: 'EUR', base_annual_fee_cents: 4150050,
    guidance_min_cents: 800000, guidance_max_cents: 1200000, floor_multiplier_ppm: 800000, ceiling_multiplier_ppm: null,
    effective_from: '2026-12-01', effective_to: null,
    items: [
      { program_key: 'spinout-lab', included_by_default: true, metadata: null },
      { program_key: 'ai-native-venture', included_by_default: false, metadata: { note: 'kept' } },
      { program_key: 'mentor-cohorts', included_by_default: true, metadata: null },
    ],
  });
  assert.equal('package_key' in r.body, false);
  assert.equal(bodyFrom({ ...formFrom(null), package_key: ' new_key ' }, { withKey: true }).body.package_key, 'new_key');
  assert.deepEqual(programKeys(' a,\n\n b \n'), ['a', 'b']);
});

test('only what a body cannot be built without is refused in the browser; the rest is the Worker\'s', () => {
  const bad = bodyFrom({ ...formFrom(VB_V2, ITEMS), base: '10.005', floor: 'most' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.base, /^Global base annual fee: EUR has 2 decimal places/);
  assert.match(bad.errors.floor, /^Floor multiplier: write a decimal/);
  // A blank name, blank fee or no programs is sent: the Worker answers it in its own words.
  const blank = bodyFrom(formFrom(null));
  assert.equal(blank.ok, true);
  assert.equal(blank.body.base_annual_fee_cents, null);
  assert.deepEqual(blank.body.items, []);
});

test('Publish and Retire say what will happen first', () => {
  assert.equal(publishConsequence(VB_V2, VB_V1),
    'Venture Building v2 becomes the version in force, and its programs and prices are frozen from then on. v1, active now, is retired: it stops being offered, and licences on it keep it until their review.');
  assert.match(publishConsequence(VB_V2, null), /No version of this package is active now, so none is retired\.$/);
  assert.equal(retireConsequence(CORE_V1),
    'Core Network v1 stops being offered to licensees. Licences on it keep it until their review. No version of this package is active until another is published.');
});

test('a refusal is the Worker\'s own words; any other failure never says nothing changed', () => {
  const refused = writeFailure(Object.assign(new Error('The package has fields to fix.'), { status: 400, data: { fields: { items: 'items is a list of 1 to 50 programs', effective_from: 'effective_from must be a YYYY-MM-DD date' } } }), 'Saving the draft');
  assert.equal(refused.refused, true);
  assert.equal(refused.title, 'Saving the draft refused.');
  assert.deepEqual(refused.lines, ['The package has fields to fix.', 'Programs: items is a list of 1 to 50 programs', 'Effective from: effective_from must be a YYYY-MM-DD date']);
  const unknown = writeFailure(Object.assign(new Error('Request timed out'), { status: 503 }), 'Publish');
  assert.equal(unknown.refused, false);
  assert.equal(unknown.title, 'Publish may or may not have been saved.');
  assert.doesNotMatch(unknown.lines.join(' '), /nothing (was )?changed|not saved/i);
  assert.equal(writeFailure(new Error('Failed to fetch'), 'Retire').refused, false);
  assert.deepEqual(refusalLines({}), ['The write failed and the Worker sent no reason.']);
  assert.deepEqual(keyOptions([VB_V1, VB_V2, CORE_V1]).map((o) => o.label), ['Core Network (next is v2)', 'Venture Building (next is v3)']);
});

/* ── the page ──────────────────────────────────────────────────────────────── */

const original = { ...licencePackagesApi };
const restore = () => Object.assign(licencePackagesApi, original);
function stub(state, writes = {}) {
  const calls = [];
  licencePackagesApi.catalogue = async () => { calls.push('catalogue'); return { packages: state.all }; };
  licencePackagesApi.versions = async (key) => { calls.push(`versions:${key}`); return { package_key: key, versions: state.all.filter((x) => x.package_key === key) }; };
  licencePackagesApi.version = async (key, n) => { calls.push(`version:${key}:${n}`); return { package: { ...state.all.find((x) => x.package_key === key && x.version === n), items: ITEMS } }; };
  for (const [name, fn] of Object.entries(writes)) {
    licencePackagesApi[name] = async (...args) => { calls.push([name, ...args]); return fn(...args); };
  }
  return calls;
}
const count = (calls, what) => calls.filter((c) => c === what).length;
const textarea = (page) => page.nodes().find((n) => n.tagName === 'TEXTAREA');
async function type(page, node, value) {
  const { act } = await import('react');
  await act(async () => { page.props(node).onChange({ target: { value } }); });
}
async function open(state, writes) {
  const calls = stub(state, writes);
  const page = await mountContracts(React.createElement(PackageCatalogueView), '/admin/licences/packages');
  await page.flush(); await page.flush();
  return { page, calls };
}
const buttons = (page) => page.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => page.props(n)['aria-label']).filter(Boolean);

test('each row offers the doors its status allows, and a Retired row offers no edit', async (t) => {
  t.after(restore);
  const { page } = await open({ all: [CORE_V1, VB_V1, VB_V2, OLD_V2] });
  t.after(() => page.unmount());
  assert.deepEqual(buttons(page).filter((l) => /^(Edit draft|Publish|Retire) /.test(l)).sort(), [
    'Edit draft Venture Building v2', 'Publish Venture Building v2', 'Retire Core Network v1', 'Retire Venture Building v1',
  ]);
  assert.ok(!buttons(page).some((l) => /Legacy bundle/.test(l)), 'a retired version has no door');
  assert.ok(!buttons(page).some((l) => /^Edit draft (Core|Venture Building v1)/.test(l)), 'an active version has no edit door');
});

test('Publish asks a reason after saying what happens, sends it, and the list and history read again', async (t) => {
  t.after(restore);
  const state = { all: [VB_V1, VB_V2] };
  const { page, calls } = await open(state, {
    publish: (key, n) => { state.all = [{ ...VB_V1, status: 'retired' }, { ...VB_V2, status: 'active' }]; return { package: { ...VB_V2, status: 'active' }, retired_version: 1 }; },
  });
  t.after(() => page.unmount());
  const before = count(calls, 'catalogue');
  await page.click('Publish…');
  assert.match(page.text(), /Publish Venture Building v2/);
  assert.match(page.text(), /v1, active now, is retired: it stops being offered/);
  await assert.rejects(page.click('Publish'), /Disabled button/, 'no reason, no publish');
  await type(page, textarea(page), 'ok');
  await assert.rejects(page.click('Publish'), /Disabled button/, 'the Worker takes 3 characters at least');
  await type(page, textarea(page), 'Board approved the v2 bundle');
  await page.click('Publish');
  await page.flush(); await page.flush();
  assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0] === 'publish'), ['publish', 'venture_building', 2, 'Board approved the v2 bundle']);
  assert.match(page.text(), /Published\. Venture Building v2 is in force\. v1 was retired\./);
  assert.ok(count(calls, 'catalogue') > before, 'the catalogue read again');
  assert.ok(count(calls, 'versions:venture_building') >= 2, 'the history read again');
  assert.match(page.text(), /Venture Buildingv2Active/);
  assert.deepEqual(buttons(page).filter((l) => /^(Edit draft|Publish|Retire) /.test(l)), ['Retire Venture Building v2']);
});

test('a refused Retire shows the Worker\'s sentence; an unanswered one says the outcome is unknown; both read again', async (t) => {
  t.after(restore);
  let fail = Object.assign(new Error('core_network v1 is no longer active.'), { status: 409, code: 'not_active' });
  const { page, calls } = await open({ all: [CORE_V1] }, { retire: () => { throw fail; } });
  t.after(() => page.unmount());
  await page.click('Retire…');
  assert.match(page.text(), /Core Network v1 stops being offered to licensees/);
  await type(page, textarea(page), 'Replaced by Full');
  const before = count(calls, 'catalogue');
  await page.click('Retire');
  await page.flush(); await page.flush();
  assert.match(page.text(), /Retire refused\. core_network v1 is no longer active\./);
  assert.ok(count(calls, 'catalogue') > before);
  fail = Object.assign(new Error('Request timed out'), { status: 504 });
  await page.click('Retire…');
  await type(page, textarea(page), 'Replaced by Full');
  await page.click('Retire');
  await page.flush(); await page.flush();
  assert.match(page.text(), /Retire may or may not have been saved\. Request timed out The catalogue was read again/);
  assert.doesNotMatch(page.text(), /nothing changed/i);
});

test('Create draft version starts from the chosen package\'s newest version and makes its next draft', async (t) => {
  t.after(restore);
  const state = { all: [CORE_V1, VB_V1, VB_V2] };
  const V3 = v({ package_key: 'venture_building', version: 3, name: 'Venture Building', status: 'draft', base_annual_fee_cents: 4200000 });
  let refuse = true;
  const { page, calls } = await open(state, {
    draftNext: (key, body) => {
      if (refuse) { refuse = false; throw Object.assign(new Error('No program has the key ghost.'), { status: 400, code: 'unknown_program_key', data: { program_keys: ['ghost'] } }); }
      state.all = [...state.all, V3];
      return { package: V3 };
    },
  });
  t.after(() => page.unmount());
  await page.click('Create draft version…');
  assert.match(page.text(), /Core Network \(next is v2\)Venture Building \(next is v3\)A new Axal VC package \(v1\)/);
  const select = page.nodes().find((n) => n.tagName === 'SELECT');
  const { act } = await import('react');
  await act(async () => { page.props(select).onChange({ target: { value: 'venture_building' } }); });
  await page.click('Continue');
  await page.flush();
  assert.ok(calls.includes('version:venture_building:2'), 'the newest version is read for its programs');
  assert.match(page.text(), /Venture Building v3\. A draft is not offered to anyone until it is published/);
  await page.fill('Global base annual fee', '42000');
  await page.fill('Programs', 'spinout-lab\nai-native-venture\nghost');
  await page.click('Save draft');
  await page.flush();
  assert.match(page.text(), /Saving the draft refused\.No program has the key ghost\./, 'the refusal, in the Worker\'s words, inside the open editor');
  await page.fill('Programs', 'spinout-lab\nai-native-venture');
  const before = count(calls, 'catalogue');
  await page.click('Save draft');
  await page.flush(); await page.flush();
  const sent = calls.filter((c) => Array.isArray(c) && c[0] === 'draftNext').at(-1);
  assert.equal(sent[1], 'venture_building');
  assert.equal(sent[2].base_annual_fee_cents, 4200000);
  assert.deepEqual(sent[2].items.map((i) => i.program_key), ['spinout-lab', 'ai-native-venture']);
  assert.match(page.text(), /Saved\. Venture Building v3 is a draft/);
  assert.ok(count(calls, 'catalogue') > before);
  assert.match(page.text(), /Version history · Venture Building/);
  assert.match(page.text(), /v3Draft/);
});

test('Edit draft saves that draft in place; a new package sends its key', async (t) => {
  t.after(restore);
  const state = { all: [VB_V1, VB_V2] };
  const { page, calls } = await open(state, {
    editDraft: (key, n, body) => ({ package: { ...VB_V2, ...body } }),
    create: (body) => { state.all = [...state.all, v({ package_key: body.package_key, version: 1, name: body.name, status: 'draft' })]; return { package: state.all.at(-1) }; },
  });
  t.after(() => page.unmount());
  await page.click('Edit draft');
  await page.flush();
  assert.match(page.text(), /Venture Building v2\. A draft/);
  await page.fill('Name', 'Venture Building Plus');
  await page.click('Save draft');
  await page.flush();
  const edit = calls.find((c) => Array.isArray(c) && c[0] === 'editDraft');
  assert.deepEqual([edit[1], edit[2], edit[3].name], ['venture_building', 2, 'Venture Building Plus']);

  await page.click('Create draft version…');
  const select = page.nodes().find((n) => n.tagName === 'SELECT');
  const { act } = await import('react');
  await act(async () => { page.props(select).onChange({ target: { value: '__new__' } }); });
  await page.click('Continue');
  await page.flush();
  await page.fill('Package key', 'talent_learning');
  await page.fill('Name', 'Talent & Learning');
  await page.click('Save draft');
  await page.flush(); await page.flush();
  const made = calls.find((c) => Array.isArray(c) && c[0] === 'create');
  assert.equal(made[1].package_key, 'talent_learning');
  assert.match(page.text(), /Saved\. Talent & Learning v1 is a draft/);
});

test('the client sends each write to its route and has no DELETE; the copy never says "package plan"', () => {
  const src = readFileSync(new URL('../src/lib/api/licencePackages.js', import.meta.url), 'utf8');
  assert.match(src, /create: \(body\) => request\('\/admin\/licence-packages', \{ method: 'POST'/);
  assert.match(src, /draftNext: .*\/versions`, \{ method: 'POST'/);
  assert.match(src, /editDraft: .*\/versions\/\$\{enc\(version\)\}`, \{ method: 'PUT'/);
  assert.match(src, /publish: .*\/publish`, \{ method: 'POST', body: JSON\.stringify\(\{ reason \}\)/);
  assert.match(src, /retire: .*\/retire`, \{ method: 'POST', body: JSON\.stringify\(\{ reason \}\)/);
  assert.doesNotMatch(src, /method: 'DELETE'/);
  for (const f of ['PackageCatalogue.jsx', 'PackageDraftEditor.jsx', 'packageDraftModel.js']) {
    const page = readFileSync(new URL(`../src/pages/admin/licences/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(page.replace(/never a bare “package plan”/g, ''), /package plan/i, f);
  }
});
