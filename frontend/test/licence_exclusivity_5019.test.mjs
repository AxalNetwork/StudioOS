/**
 * D5019 (#5019) — the Exclusivity panel on the licence's Territory tab. The
 * Worker's half is cloudflare-worker/test/licence_exclusivity_5019.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_exclusivity_5019.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { Exclusivity } from '../src/pages/admin/licences/Exclusivity.jsx';
import { NOT_RECORDED, buildSave, minimumText, yearLine } from '../src/pages/admin/licences/exclusivityModel.js';

const h = React.createElement;
const VIEW = {
  licence_uid: 'lic_a',
  operating: { territory: ['FR'], annual_fee_cents: 5_000_000, revenue_share_bps: 600, currency: 'EUR', minimum_guarantee_cents: 1_200_000 },
  exclusivity: {
    uid: 'x1', revision: 2, scope_type: 'country_exclusive', territory: { countries: ['FR'], regions: [] }, parent_licence_uid: null, child_licence_uids: [],
    state: 'at_risk', contractual: true, cure_until: null, targets: [], starts_on: null, ends_on: null, review_on: '2027-01-01', cure_period_days: 90,
  },
  exclusivity_reason: null,
  progress: [
    { year: 1, period_start: '2025-01-01', period_end: '2025-12-31', status: 'missed', metrics: [{ metric: 'qualifying_revenue_cents', target: 10_000_000, measured: 4_000_000, met: false }] },
    { year: 2, period_start: '2026-01-01', period_end: '2026-12-31', status: 'not_recorded', metrics: [{ metric: 'cohorts', target: 3, measured: null, met: null }] },
  ],
  observations: [], next_review_on: '2027-01-01',
  reviews: [{ uid: 'rev-1', state: 'open', trigger: 'target_missed', opened_at: '2026-02-01T00:00:00Z' }],
  history: [{ revision: 2, scope_type: 'country_exclusive', state: 'at_risk', created_at: '2026-02-01', reason: 'Target missed' }, { revision: 1, scope_type: 'country_exclusive', state: 'in_force', created_at: '2025-01-01', reason: 'Granted' }],
  children: [], master: null, schedule: { exclusive: true, matches: false, reason: null }, agreement: { state: 'matches' }, regions: [],
};

test('a target year reads its progress, or Not recorded, never 0', () => {
  // Mutations checked: an unmeasured target shown as 0; a missed year not flagged.
  const y1 = yearLine(VIEW.progress[0], 'EUR');
  assert.equal(y1.missed, true);
  assert.match(y1.metrics[0].text, /Revenue: EUR 40,000 of EUR 100,000/);
  const y2 = yearLine(VIEW.progress[1], 'EUR');
  assert.equal(y2.status, NOT_RECORDED);
  assert.equal(y2.metrics[0].text, `Cohorts: ${NOT_RECORDED} of 3`);
});

test('D5019 part 2: the operating minimum is the schedule\'s Minimum Guarantee, or Not recorded, or Unreadable; never 0', () => {
  // Mutations checked: a missing minimum drawn as 0; an unreadable schedule drawn as Not recorded.
  assert.equal(minimumText({ minimum_guarantee_cents: 1_200_000, currency: 'EUR' }), 'EUR 12,000');
  assert.equal(minimumText({ minimum_guarantee_cents: null, currency: 'EUR' }), NOT_RECORDED);
  assert.equal(minimumText({ currency: 'EUR' }), NOT_RECORDED);
  assert.equal(minimumText({ minimum_guarantee_cents: 'unreadable', currency: 'EUR' }), 'Unreadable');
});

test('a save names the revision it read, a reason, and only the targets filled in', () => {
  // Mutations checked: the revision left out; an empty target year sent; a save without a reason allowed.
  const form = {
    scope_type: 'regional_exclusive', countries: '', regions: 'us-ca, US-NYC', reason: '', targets: [
      { year: 1, period_start: '2027-01-01', period_end: '2027-12-31', min_revenue: '100000', min_cohorts: '2', min_active_members: '' },
      { year: 2, period_start: '', period_end: '', min_revenue: '', min_cohorts: '', min_active_members: '' },
    ],
  };
  assert.ok(buildSave({ form, revision: 2, currency: 'EUR' }).errors.reason);
  const ok = buildSave({ form: { ...form, reason: 'Split the US market' }, revision: 2, currency: 'EUR' });
  assert.equal(ok.body.expected_revision, 2);
  assert.deepEqual(ok.body.territory, { countries: [], regions: ['US-CA', 'US-NYC'] });
  assert.deepEqual(ok.body.targets, [{ year: 1, period_start: '2027-01-01', period_end: '2027-12-31', min_revenue_cents: 10_000_000, min_cohorts: 2, min_active_members: null, min_network: null }]);
  assert.ok(buildSave({ form: { ...form, regions: '', reason: 'x y z' }, revision: 2, currency: 'EUR' }).errors.regions);
  const master = buildSave({ form: { scope_type: 'master_franchise', countries: 'BE', children: 'lic_B, lic_C', reason: 'Benelux master', targets: [] }, revision: 0 });
  assert.deepEqual(master.body.child_licence_uids, ['lic_B', 'lic_C'], 'licence ids keep their case');
});

test('the panel: operating licence apart, an open review shows its consequence before anything can be done', async () => {
  // Mutations checked: the resolve enabled before the consequence is read; the fee shown as part of exclusivity.
  const calls = [];
  const api = {
    get: async () => VIEW,
    preview: async (...a) => { calls.push(['preview', ...a]); return { consequence: 'Exclusivity over FR ends today.', stored: false }; },
    resolve: async (...a) => { calls.push(['resolve', ...a]); return {}; },
  };
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await act(async () => { root.render(h(Exclusivity, { licence: { uid: 'lic_a' }, api })); await settle(); await settle(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  assert.match(text(by('exclusivity-operating')), /Paying this fee grants no exclusivity/);
  assert.match(text(by('exclusivity-operating')), /Annual fee EUR 50,000 · royalty 6% · minimum guarantee EUR 12,000/, 'the operating licence shows fee, royalty and minimum (D5019 part 2)');
  assert.match(text(by('exclusivity-scope-card')), /At risk — HQ review/);
  assert.match(text(by('exclusivity-commitments')), /Year 1 target.*Missed — HQ review/);
  assert.ok(by('exclusivity-review'));
  assert.equal(by('exclusivity-resolve'), undefined, 'no action before the consequence is shown');
  await act(async () => { props(by('exclusivity-preview')).onClick(); await settle(); await settle(); });
  assert.match(text(by('exclusivity-consequence')), /ends today/);
  assert.equal(props(by('exclusivity-resolve')).disabled, true, 'not until it is acknowledged and a reason given');
  assert.deepEqual(calls.map((c) => c[0]), ['preview']);
  await act(async () => root.unmount());
  restore();
});

test('the panel sits on the Territory tab, and the contract carries exclusivity fields', () => {
  const page = readFileSync(new URL('../src/pages/admin/licences/LicenceDetail.jsx', import.meta.url), 'utf8');
  assert.match(page, /\{step === 2 && <Exclusivity licence=\{d\} \/>\}/);
  const contract = readFileSync(new URL('../../cloudflare-worker/src/services/licenceContract.ts', import.meta.url), 'utf8');
  assert.match(contract, /named\[`exclusivity\.\$\{k\}`\] = v;/);
});
