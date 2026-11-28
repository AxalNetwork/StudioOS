/**
 * D7715 (#7715) — the HQ country catalogue's two write sheets: Import country data on the catalogue and Record
 * observation on a market (canvas LCD-01 to LCD-08, D7703, owner options A), and the #7714 consistency flags. The
 * Worker's half (the three D5016 writes and the D7714 read) is tested in cloudflare-worker/test.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_pricing_writes_7715.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  IMPORT_MAX_ROWS, catalogueRow, consistencyClearLine, consistencyFlags, fieldValueWords, findingLine, formErrors, historyRow,
  importOutcome, importSummary, observationBody, parseImportFile, profileField, refusalOf, statusChoices, typedValue,
} from '../src/pages/admin/licences/pricingHqModel.js';
import PricingCatalogue from '../src/pages/admin/licences/PricingCatalogue.jsx';
import PricingCountry from '../src/pages/admin/licences/PricingCountry.jsx';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-19T14:30:00Z');

// Sample rows only: every source, reference and figure here is invented.
const row = (country_code, field, value, over = {}) => ({ country_code, field, value, status: 'recorded', source: 'Source A sample', source_ref: 'table 1', as_of: '2026-01-01', ...over });
const BODY = {
  observations: [
    row('PT', 'population', 10_412_000), row('PT', 'ppp_gdp_per_capita', 45_200),
    row('EE', 'population', 1_371_000), row('EE', 'startup_ecosystem_score', 60_450, { status: 'provisional', source_ref: null }),
    row('IE', 'population', 5_281_000),
  ],
  expected_revisions: { PT: 12, EE: 7, IE: 4 },
  reason: 'Annual refresh from the sample source',
};
const FILE = JSON.stringify(BODY);

// ── The pure rules ──────────────────────────────────────────────────────────

test('the import file: refused whole before sending only for what the Worker refuses whole', () => {
  // Mutations checked: a file of 501 rows accepted; a country with no revision accepted; 0 rows sent; non-JSON thrown.
  assert.match(parseImportFile('{nope', 'x.json').problem, /^x\.json is not the JSON body/);
  assert.match(parseImportFile('{"rows":[]}', 'x.json').problem, /no observations list/);
  assert.equal(parseImportFile('{"observations":[]}', 'empty.json').problem, 'empty.json holds 0 observations. Nothing to review.');
  const big = JSON.stringify({ observations: Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => row('PT', 'population', 1)), expected_revisions: { PT: 1 } });
  assert.equal(parseImportFile(big, 'big.json').problem, 'An import holds 1 to 500 observations. big.json has 501 rows. Nothing was imported. Split it into files of at most 500 rows.');
  const atCap = JSON.stringify({ observations: Array.from({ length: IMPORT_MAX_ROWS }, () => row('PT', 'population', 1)), expected_revisions: { PT: 1 } });
  assert.equal(parseImportFile(atCap).ok, true, '500 rows is allowed');
  const noRev = JSON.stringify({ ...BODY, expected_revisions: { PT: 12, EE: 'seven' } });
  assert.equal(parseImportFile(noRev).problem, 'Name the revision you read for every country in the import. No revision is named for EE and IE. Nothing was imported.');
  // A row's own fields are the Worker's to judge: a bad value is not refused here.
  const bad = parseImportFile(JSON.stringify({ ...BODY, observations: [row('PT', 'population', 1.5)] }));
  assert.equal(bad.ok, true);
});

test('what an import will change: countries, rows, every field counted (0 said) and the revision each was read at', () => {
  // Mutations checked: a field with no rows left out; the revision dropped; rows counted per field wrongly.
  const p = parseImportFile(FILE);
  assert.equal(p.ok, true);
  assert.equal(p.body.reason, BODY.reason);
  assert.deepEqual(p.summary.countries, [{ code: 'PT', rows: 2, revision: 12 }, { code: 'EE', rows: 2, revision: 7 }, { code: 'IE', rows: 1, revision: 4 }]);
  assert.equal(p.summary.rows, 5);
  assert.deepEqual(p.summary.fields.map((f) => `${f.label} ${f.rows}`), ['Population 3', 'PPP GDP per capita 1', 'Startup ecosystem score 1', 'Startup ecosystem rank 0']);
  assert.deepEqual(importSummary({ observations: [] }).fields.map((f) => f.rows), [0, 0, 0, 0]);
});

test('an import answer: written countries with their revisions, and a 207 naming the countries that changed', () => {
  // Mutations checked: a conflicted country counted as written; the countries left unnamed; revision now from the wrong side.
  const done = importOutcome({ applied: { PT: 2, EE: 2, IE: 1 }, conflicts: [] }, BODY);
  assert.equal(done.partial, false);
  assert.equal(done.line, '5 observations recorded for 3 countries.');
  assert.deepEqual(done.written[0], { code: 'PT', rows: 2, revisionRead: 12, revisionNow: 14 });
  const part = importOutcome({ applied: { PT: 2 }, conflicts: [{ country_code: 'EE', current_revision: 8 }, { country_code: 'IE', current_revision: 5 }] }, BODY);
  assert.equal(part.partial, true);
  assert.equal(part.line, '2 observations recorded for 1 country. 2 countries changed since this file was built: EE and IE. Nothing was written for them.');
  assert.deepEqual(part.notWritten, [{ code: 'EE', rows: 2, revisionInFile: 7, revisionNow: 8 }, { code: 'IE', rows: 1, revisionInFile: 4, revisionNow: 5 }]);
  assert.match(part.live, /EE and IE changed since the file was built; nothing was written for them\./);
});

test('a refusal in the Worker\'s words: rows renumbered from 1 with their country, fields, and no answer said as unknown', () => {
  // Mutations checked: rows numbered from 0; a 500 read as a refusal; a network failure read as a refusal; the revision now lost.
  const rows = refusalOf({ status: 400, code: 'invalid_import', message: 'Some observations have fields to fix; nothing was imported.', data: { rows: [{ row: 3, fields: { status: 'a rank is recorded or not; there is no provisional rank' } }] } }, BODY);
  assert.equal(rows.answered, true);
  assert.equal(rows.sentence, 'Some observations have fields to fix; nothing was imported.');
  assert.deepEqual(rows.rows, [{ n: 4, code: 'EE', field: 'status', words: 'a rank is recorded or not; there is no provisional rank' }]);
  const stale = refusalOf({ status: 409, code: 'profile_conflict', message: 'Denmark changed since you read it, so nothing was saved. Reload it and apply your change again.', data: { current_revision: 10 } });
  assert.equal(stale.currentRevision, 10);
  assert.equal(refusalOf(new Error('Failed to fetch')).answered, false);
  assert.equal(refusalOf({ status: 500, message: 'x' }).answered, false);
  assert.equal(refusalOf({ status: 403, code: 'step_up_required', message: 'Confirm with your authenticator.' }).answered, true);
  assert.deepEqual(formErrors(refusalOf({ status: 400, code: 'reason_required', message: 'Say why, in 3 to 500 characters.' })), { reason: 'Say why, in 3 to 500 characters.' });
  assert.deepEqual(formErrors(refusalOf({ status: 400, code: 'invalid_observation', message: 'The observation has fields to fix.', data: { fields: { source: 'every observation names its source' } } })), { source: 'every observation names its source' });
});

test('the record sheet: a rank is never provisional, Provisional needs a value, a Not recorded field offers only a value', () => {
  // Mutations checked: Provisional offered for a rank; Provisional offered with no value; status mode offered on an empty field.
  const profile = { population: 5_961_000, population_status: 'recorded', population_source: 'S', population_as_of: '2026-01-01', startup_ecosystem_score: null, startup_score_status: 'not_recorded', startup_ecosystem_rank: 21, ppp_gdp_per_capita: 74_100, ppp_status: 'provisional' };
  assert.deepEqual(statusChoices('startup_ecosystem_rank', profileField(profile, 'startup_ecosystem_rank')), { record: ['recorded'], status: ['not_recorded'] });
  assert.deepEqual(statusChoices('population', profileField(profile, 'population')), { record: ['recorded', 'provisional'], status: ['provisional', 'not_recorded'] });
  assert.deepEqual(statusChoices('ppp_gdp_per_capita', profileField(profile, 'ppp_gdp_per_capita')).status, ['not_recorded'], 'already provisional');
  assert.deepEqual(statusChoices('startup_ecosystem_score', profileField(profile, 'startup_ecosystem_score')).status, []);
  assert.equal(profileField(profile, 'startup_ecosystem_rank').status, 'recorded');
  assert.equal(fieldValueWords('startup_ecosystem_score', 41_250), '41,250 = 41.250 points');
  assert.equal(fieldValueWords('population', null), 'Not recorded');
});

test('the observation body: the typed value read with its grouping, the revision from the read, nothing rounded', () => {
  // Mutations checked: a decimal rounded before sending; the reference sent as ""; the revision not sent.
  assert.equal(typedValue('41,250'), 41_250);
  assert.equal(typedValue('41.25'), 41.25, 'the Worker refuses it, in its words');
  assert.equal(typedValue(''), null);
  assert.equal(typedValue('abc'), 'abc');
  const b = observationBody({ field: 'startup_ecosystem_score', value: '41 250', status: 'recorded', source: 'Source B sample', source_ref: ' ', as_of: '2026-10-01', reason: 'Edition received' }, 9);
  assert.deepEqual(b, { field: 'startup_ecosystem_score', value: 41_250, status: 'recorded', source: 'Source B sample', source_ref: null, as_of: '2026-10-01', reason: 'Edition received', expected_revision: 9 });
});

const FINDINGS = {
  checked: { countries: 49, fields: 196 },
  findings: [
    { country_code: 'PT', field: 'population', kind: 'value_without_history', differences: [], profile: { value: 10_412_000 }, history: null, expected: null, snapshots: { count: 2, decisions: 1 } },
    { country_code: 'PT', field: 'ppp_gdp_per_capita', kind: 'differs_from_history', differences: ['value', 'as_of'], profile: { value: 44_900 }, history: { as_of: '2026-10-14', profile_revision: 10 }, expected: { value: 43_700 }, snapshots: { count: 0 } },
  ],
  total: 2,
};

test('the consistency flags: Reading, Unavailable (never all consistent), the findings, and the checked-and-clean line', () => {
  // Mutations checked: a failed check drawn as clean; the snapshots holding a value dropped; the history's value omitted.
  assert.equal(consistencyFlags({ state: 'loading' }).state, 'reading');
  const down = consistencyFlags({ state: 'error' });
  assert.equal(down.state, 'unavailable');
  assert.equal(consistencyClearLine(down), null);
  const ok = consistencyFlags({ state: 'ok', data: FINDINGS });
  assert.deepEqual(ok.countries, ['PT']);
  assert.equal(findingLine(ok.byCountry.PT.population), 'No history row for this value · 2 frozen pricing snapshots hold it');
  assert.equal(findingLine(ok.byCountry.PT.ppp_gdp_per_capita), 'Differs from its latest history row: profile 44,900 international dollars, whole · history 43,700 international dollars, whole · as-of date differs (2026-10-14, revision 10)');
  assert.equal(consistencyClearLine(consistencyFlags({ state: 'ok', data: { checked: { countries: 49, fields: 196 }, findings: [] } })), 'Checked 49 countries and 196 fields: every value matches its history.');
  assert.equal(catalogueRow({ country_code: 'PT', profile_revision: 12 }, '2026-11-19').revision, 12);
  assert.equal(historyRow({ uid: 'o1', field: 'population', kind: 'status', status: 'not_recorded', value: 5, recorded_by: 'user:1', reason: 'r', profile_revision: 3 }).value, 'Not recorded');
});

// ── The screens ─────────────────────────────────────────────────────────────

const settle = () => new Promise((r) => setImmediate(r));
async function mount(path, routePath, element) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: routePath, element }))));
    await settle(); await settle(); await settle();
  });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const one = (id) => { const n = all(id)[0]; assert.ok(n, `no ${id}`); return n; };
  const fire = (id, fn) => act(async () => { fn(props(one(id))); await settle(); await settle(); await settle(); });
  return {
    all, props, one, text: () => text(container), textOf: (id) => text(all(id)[0]), textIn: text,
    click: (id) => fire(id, (p) => p.onClick()),
    type: (id, value) => fire(id, (p) => p.onChange({ target: { value } })),
    pick: (id, name, body) => fire(id, (p) => p.onChange({ target: { files: [{ name, text: () => Promise.resolve(body) }], value: '' } })),
    disabled: (id) => props(one(id)).disabled === true,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const COUNTRIES = [
  { country_code: 'PT', country_name: 'Portugal', region_code: 'Southern Europe', currency_code: 'EUR', regulatory_class: 'medium', data_completeness: null, last_source_update: '2026-10-14', recommendation: null, recommendation_reason: 'No pricing model is active.', profile_revision: 12 },
  { country_code: 'EE', country_name: 'Estonia', region_code: 'Baltics', currency_code: 'EUR', regulatory_class: 'low', data_completeness: null, last_source_update: '2025-09-02', recommendation: null, recommendation_reason: 'No pricing model is active.', profile_revision: 7 },
];
const CATALOGUE = { model: null, model_reason: 'No pricing model is active.', model_problem: null, countries: COUNTRIES, total: 2, counts: {} };
const VERSIONS = { current: null, drafts: [], retired: [] };

function catalogueApi(over = {}) {
  const calls = { catalogue: 0, consistency: 0, sent: [] };
  const api = {
    catalogue: () => { calls.catalogue += 1; return Promise.resolve(CATALOGUE); },
    modelVersions: () => Promise.resolve(VERSIONS),
    consistency: () => { calls.consistency += 1; return over.consistency ? over.consistency() : Promise.resolve({ checked: { countries: 2, fields: 8 }, findings: [], total: 0 }); },
  };
  const writeApi = { importCountries: (body) => { calls.sent.push(body); return over.importCountries(body); } };
  return { api, writeApi, calls };
}

async function toReview(v, file = FILE, reason = null) {
  await v.click('pricing-import-open');
  assert.equal(v.disabled('pricing-import-review'), true, 'Review is off until a file is chosen');
  await v.pick('pricing-import-file-input', 'country-import.json', file);
  await v.click('pricing-import-review');
  if (reason !== null) await v.type('pricing-import-reason-input', reason);
}

test('Import: a builder body is previewed, sent once with its reason, and the catalogue is read again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  // Mutations checked: the reason typed not sent; the catalogue not read again; the summary's rows miscounted; Revision column dropped.
  const { api, writeApi, calls } = catalogueApi({ importCountries: () => Promise.resolve({ applied: { PT: 2, EE: 2, IE: 1 }, conflicts: [] }) });
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api, writeApi }));
  try {
    assert.deepEqual(v.all('pricing-cell-revision').map(v.textIn), ['12', '7']);
    assert.match(v.textOf('pricing-check-clear'), /Checked 2 countries and 8 fields: every value matches its history\./);
    await toReview(v, FILE, 'Annual refresh, checked twice');
    assert.equal(v.textOf('pricing-import-countries'), '3');
    assert.equal(v.textOf('pricing-import-rows'), '5 of at most 500');
    assert.equal(v.textOf('pricing-import-fields'), 'Population 3 · PPP GDP per capita 1 · Startup ecosystem score 1 · Startup ecosystem rank 0');
    assert.equal(v.all('pricing-import-row').length, 5);
    assert.match(v.textOf('pricing-import-revisions'), /PT \[12\].*EE \[7\].*IE \[4\]/s);
    const before = calls.catalogue;
    await v.click('pricing-import-send');
    assert.equal(calls.sent.length, 1);
    assert.deepEqual(calls.sent[0], { ...BODY, reason: 'Annual refresh, checked twice' });
    assert.equal(calls.catalogue, before + 1, 'the catalogue is read again after the write');
    assert.equal(v.props(v.one('pricing-import-outcome'))['data-partial'], 'false');
    assert.match(v.textOf('pricing-import-outcome'), /5 observations recorded for 3 countries\./);
    assert.match(v.textOf('pricing-live'), /5 observations recorded for 3 countries\./);
    await v.click('pricing-import-back');
    assert.equal(v.all('pricing-import-sheet').length, 0);
    assert.match(v.textOf('pricing-import-reread-note'), /read again at 14:30 UTC after the import/);
  } finally { await v.unmount(); }
});

test('Import: a partial answer names the conflicted countries, and the same body cannot be sent again', async () => {
  // Mutations checked: the conflicts table dropped; the spent body forgotten when the sheet closes; Import left on for the same file.
  const { api, writeApi, calls } = catalogueApi({ importCountries: () => Promise.resolve({ applied: { PT: 2 }, conflicts: [{ country_code: 'EE', current_revision: 8 }, { country_code: 'IE', current_revision: 5 }] }) });
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api, writeApi }));
  try {
    await toReview(v);
    assert.equal(v.props(v.one('pricing-import-reason-input')).value, BODY.reason, 'the builder\'s reason is offered, to be read and kept or changed');
    await v.click('pricing-import-send');
    assert.equal(v.props(v.one('pricing-import-outcome'))['data-partial'], 'true');
    assert.match(v.textOf('pricing-import-outcome'), /2 countries changed since this file was built: EE and IE\. Nothing was written for them\. The Worker answered 207/);
    assert.deepEqual(v.all('pricing-import-conflict').map((n) => v.props(n)['data-code']), ['EE', 'IE']);
    assert.match(v.textOf('pricing-import-rebuild'), /Read the catalogue again and rebuild the file for EE, IE.*never sends the same file twice/);
    assert.equal(v.all('pricing-import-send').length, 0, 'no resend is offered');
    await v.click('pricing-import-back');
    await toReview(v);
    assert.match(v.textOf('pricing-import-already-sent'), /already sent from this page/);
    assert.equal(v.disabled('pricing-import-send'), true);
    await v.click('pricing-import-send');
    assert.equal(calls.sent.length, 1, 'sent once');
  } finally { await v.unmount(); }
});

test('Import: a refusal shows the Worker\'s sentence and rows, changes nothing, and is not resent', async () => {
  // Mutations checked: a refusal re-reading the catalogue; rows numbered from 0; Import left on after a refusal.
  const refusal = Object.assign(new Error('Some observations have fields to fix; nothing was imported.'), {
    status: 400, code: 'invalid_import', data: { rows: [{ row: 1, fields: { value: 'value must be an integer (PPP in whole international dollars, the startup score in thousandths of a point)' } }] },
  });
  const { api, writeApi, calls } = catalogueApi({ importCountries: () => Promise.reject(refusal) });
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api, writeApi }));
  try {
    const before = calls.catalogue;
    await toReview(v, FILE, 'Annual refresh');
    await v.click('pricing-import-send');
    assert.match(v.textOf('pricing-import-refused'), /^✕ Some observations have fields to fix; nothing was imported\./);
    assert.deepEqual(v.all('pricing-import-row-error').map(v.textIn), ['2PTvaluevalue must be an integer (PPP in whole international dollars, the startup score in thousandths of a point)']);
    assert.equal(v.disabled('pricing-import-send'), true, 'no resend after a refusal');
    assert.equal(calls.catalogue, before, 'a refusal changes nothing on the page');
    assert.equal(v.all('pricing-import-reread-note').length, 0);
    assert.equal(v.props(v.one('pricing-import-reason-input')).value, 'Annual refresh', 'the reason is kept');
    await v.click('pricing-import-choose-again');
    assert.equal(v.disabled('pricing-import-review'), true, 'the file is chosen again');
  } finally { await v.unmount(); }
});

test('Import: no answer is said as unknown, nothing on the page changes, and the file is spent', async () => {
  // Mutations checked: a network failure offered Send again; the page re-read on its own; the body not marked spent.
  const { api, writeApi, calls } = catalogueApi({ importCountries: () => Promise.reject(new Error('Failed to fetch')) });
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api, writeApi }));
  try {
    const before = calls.catalogue;
    await toReview(v, FILE, 'Annual refresh');
    await v.click('pricing-import-send');
    assert.match(v.textOf('pricing-import-unknown'), /did not reach the Worker, so its answer is unknown\. Read the catalogue again before sending anything/);
    assert.equal(calls.catalogue, before);
    assert.equal(v.all('pricing-import-send').length, 0);
    await v.click('pricing-import-reread');
    assert.equal(calls.catalogue, before + 1);
    await toReview(v);
    assert.equal(v.disabled('pricing-import-send'), true);
  } finally { await v.unmount(); }
});

test('Import: a file refused before sending, and a failed catalogue read turns Import off', async () => {
  // Mutations checked: a 501-row file reaching Review; Import on with no catalogue read.
  const { api, writeApi } = catalogueApi({ importCountries: () => Promise.resolve({ applied: {}, conflicts: [] }) });
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api, writeApi }));
  try {
    await v.click('pricing-import-open');
    await v.pick('pricing-import-file-input', 'country-import.json', JSON.stringify({ ...BODY, expected_revisions: { PT: 12 } }));
    assert.match(v.textOf('pricing-import-problem'), /No revision is named for EE and IE\./);
    assert.equal(v.disabled('pricing-import-review'), true);
  } finally { await v.unmount(); }
  const down = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, {
    api: { ...api, catalogue: () => Promise.reject(Object.assign(new Error('x'), { status: 500 })) }, writeApi,
  }));
  try {
    await toReview(down, FILE, 'Annual refresh');
    assert.match(down.textOf('pricing-import-unreadable'), /no revision can be checked/);
    assert.equal(down.disabled('pricing-import-send'), true);
  } finally { await down.unmount(); }
  const refused = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, {
    api: { ...api, catalogue: () => Promise.reject(Object.assign(new Error('x'), { status: 403 })) }, writeApi,
  }));
  try { assert.equal(refused.all('pricing-import-open').length, 0, 'Super Admin only: no button opens a sheet'); } finally { await refused.unmount(); }
});

test('the catalogue flags the markets with a value to check, and says Unavailable when the check failed', async () => {
  // Mutations checked: no Check column with findings; the filter ignoring the flags; a failed check drawn as clean.
  const { api, writeApi } = catalogueApi({ consistency: () => Promise.resolve(FINDINGS) });
  const v = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, { api, writeApi }));
  try {
    assert.match(v.textOf('pricing-check-line'), /2 values to check in 1 market/);
    assert.deepEqual(v.all('pricing-cell-check').map(v.textIn), ['⚠ 2 to check', '⚠ 2 to check']);
    await v.click('pricing-data-check');
    assert.deepEqual(v.all('pricing-country-row').map((n) => v.props(n)['data-code']), ['PT']);
  } finally { await v.unmount(); }
  const down = await mount('/admin/licences/pricing', '/admin/licences/pricing', h(PricingCatalogue, catalogueApi({ consistency: () => Promise.reject(Object.assign(new Error('x'), { status: 500 })) })));
  try {
    assert.match(down.textOf('pricing-check-unavailable'), /could not be read\. No value is flagged and nothing is called consistent/);
    assert.equal(down.all('pricing-check-clear').length, 0);
    assert.equal(down.all('pricing-data-check').length, 0);
  } finally { await down.unmount(); }
});

const PROFILE = {
  country_code: 'DK', country_name: 'Denmark', currency_code: 'DKK', region_code: 'Nordics', revision: 9,
  population: 5_961_000, population_status: 'recorded', population_source: 'Source A sample', population_source_ref: 'table 1', population_as_of: '2026-01-01',
  ppp_gdp_per_capita: 74_100, ppp_status: 'recorded', ppp_source: 'Source A sample', ppp_as_of: '2026-10-14',
  startup_ecosystem_score: 52_140, startup_score_status: 'recorded', startup_source: 'Source B sample', startup_source_ref: 'edition 3', startup_as_of: '2025-09-02', startup_ecosystem_rank: null,
};
const detail = (profile, observations = []) => ({
  profile, inputs: {}, data_completeness: null, last_source_update: null, regulatory_class: null, model: null, model_reason: 'No pricing model is active.',
  calculation: null, calculation_reason: 'No pricing model is active.', observations, snapshots: [],
});
const NEWROW = { uid: 'o9', field: 'startup_ecosystem_score', kind: 'value', value: 41_250, status: 'recorded', source: 'Source B sample', source_ref: 'edition 4', as_of: '2026-10-01', ingested_at: '2026-11-19T14:41:00Z', recorded_by: 'user:7', reason: 'Edition received', profile_revision: 10 };

function countryApi({ record, status, consistency } = {}) {
  const calls = { country: 0, recorded: [], status: [] };
  let current = detail(PROFILE);
  const api = {
    country: () => { calls.country += 1; return Promise.resolve(current); },
    consistency: consistency || (() => Promise.resolve({ checked: { countries: 1, fields: 4 }, findings: [], total: 0 })),
  };
  const writeApi = {
    recordObservation: (code, body) => { calls.recorded.push([code, body]); return record(body).then((r) => { current = detail({ ...PROFILE, revision: r.profile.revision }, [NEWROW]); return r; }); },
    setFieldStatus: (code, field, body) => { calls.status.push([code, field, body]); return status(body); },
  };
  return { api, writeApi, calls, bump: (rev) => { current = detail({ ...PROFILE, revision: rev }); } };
}

async function fillRecord(v) {
  await v.click('pricing-record-open');
  assert.match(v.textOf('pricing-obs-revision'), /You are changing revision 9 of Denmark/);
  await v.type('pricing-obs-field-input', 'startup_ecosystem_score');
  await v.type('pricing-obs-value-input', '41,250');
  await v.type('pricing-obs-source-input', 'Source B sample');
  await v.type('pricing-obs-source_ref-input', 'edition 4');
  await v.type('pricing-obs-as_of-input', '2026-10-01');
  await v.type('pricing-obs-reason-input', 'Edition received');
}

test('Record observation: sent with its source and date and the revision read, then the market is read again', async () => {
  // Mutations checked: the revision typed or omitted; the market not read again; the new row not first; the live line unsaid.
  const c = countryApi({ record: () => Promise.resolve({ profile: { revision: 10 } }) });
  const v = await mount('/admin/licences/pricing/country/dk', '/admin/licences/pricing/country/:code', h(PricingCountry, { api: c.api, writeApi: c.writeApi }));
  try {
    assert.equal(v.textOf('pricing-country-revision'), '9');
    await fillRecord(v);
    await v.click('pricing-obs-send');
    assert.deepEqual(c.calls.recorded, [['DK', { field: 'startup_ecosystem_score', value: 41_250, status: 'recorded', source: 'Source B sample', source_ref: 'edition 4', as_of: '2026-10-01', reason: 'Edition received', expected_revision: 9 }]]);
    assert.equal(c.calls.country, 2, 'read again after the write');
    assert.equal(v.all('pricing-obs-sheet').length, 0);
    assert.equal(v.textOf('pricing-country-revision'), '10');
    assert.equal(v.textOf('pricing-live'), 'Startup ecosystem score recorded for Denmark. Revision 10.');
    const first = v.all('pricing-history-row')[0];
    assert.equal(v.props(first)['data-new'], 'true');
    assert.match(v.textIn(first), /2026-11-19 14:41Startup ecosystem score41,250 = 41\.250 pointsRecordedSource B sample · edition 42026-10-01user:7Edition received10/);
  } finally { await v.unmount(); }
});

test('Record observation: a stale revision and field problems are shown in the Worker\'s words, typed values kept, nothing changes', async () => {
  // Mutations checked: a refusal re-reading the page; typed values cleared; field problems not on their fields; the revision now unsaid.
  let answer = Object.assign(new Error('Denmark changed since you read it, so nothing was saved. Reload it and apply your change again.'), { status: 409, code: 'profile_conflict', data: { current_revision: 10 } });
  const c = countryApi({ record: () => Promise.reject(answer) });
  const v = await mount('/admin/licences/pricing/country/dk', '/admin/licences/pricing/country/:code', h(PricingCountry, { api: c.api, writeApi: c.writeApi }));
  try {
    await fillRecord(v);
    await v.click('pricing-obs-send');
    assert.equal(c.calls.country, 1, 'a failed send changes nothing on the page');
    assert.match(v.textOf('pricing-obs-conflict'), /^! Denmark changed since you read it, so nothing was saved\. Reload it and apply your change again\. It is at revision 10 now\. Your typed values are kept below\./);
    assert.equal(v.props(v.one('pricing-obs-value-input')).value, '41,250');
    c.bump(10);
    await v.click('pricing-obs-reload');
    assert.match(v.textOf('pricing-obs-revision'), /revision 10 of Denmark/);
    assert.equal(v.all('pricing-obs-conflict').length, 0);
    answer = Object.assign(new Error('The observation has fields to fix.'), { status: 400, code: 'invalid_observation', data: { fields: { source: 'every observation names its source', as_of: 'as_of must be the YYYY-MM-DD date the value is true as of' } } });
    await v.click('pricing-obs-send');
    assert.equal(c.calls.recorded[1][1].expected_revision, 10, 'the revision comes from the read on screen');
    assert.match(v.textOf('pricing-obs-refused'), /^✕ The observation has fields to fix\. Nothing was saved\. Each problem is shown on its field/);
    assert.equal(v.textOf('pricing-obs-source-err'), '✕ every observation names its source');
    assert.equal(v.textOf('pricing-obs-as_of-err'), '✕ as_of must be the YYYY-MM-DD date the value is true as of');
    assert.equal(v.props(v.one('pricing-obs-source-input'))['aria-describedby'], 'pricing-obs-source-err');
    assert.equal(v.all('pricing-history-row').length, 0, 'no history row appears');
  } finally { await v.unmount(); }
});

test('Change a field\'s status: Not recorded asks to confirm what it clears, then sends the status with the revision read', async () => {
  // Mutations checked: Not recorded sent without the confirm step; Provisional offered for a rank; the status sent to the wrong field.
  const c = countryApi({ status: () => Promise.resolve({ profile: { revision: 10 } }) });
  const v = await mount('/admin/licences/pricing/country/dk', '/admin/licences/pricing/country/:code', h(PricingCountry, { api: c.api, writeApi: c.writeApi }));
  try {
    await v.click('pricing-record-open');
    await v.click('pricing-obs-mode-status');
    await v.type('pricing-obs-field-input', 'startup_ecosystem_rank');
    assert.match(v.textOf('pricing-obs-status-none'), /Not recorded, so there is no status to change/);
    await v.type('pricing-obs-field-input', 'startup_ecosystem_score');
    assert.deepEqual(v.all('pricing-obs-new-status')[0].childNodes.map((n) => v.props(n)['data-testid']), ['pricing-obs-new-status-provisional', 'pricing-obs-new-status-not_recorded']);
    await v.click('pricing-obs-new-status-not_recorded');
    await v.type('pricing-obs-reason-input', 'Edition withdrawn by its publisher');
    await v.click('pricing-obs-mark');
    assert.equal(c.calls.status.length, 0, 'the first press confirms');
    assert.match(v.textOf('pricing-obs-confirm'), /Value 52,140 = 52\.140 points.*Source Source B sample.*Reference edition 3.*As-of date 2025-09-02.*The history is kept.*Denmark cannot be priced until this field is recorded again/s);
    await v.click('pricing-obs-mark');
    assert.deepEqual(c.calls.status, [['DK', 'startup_ecosystem_score', { status: 'not_recorded', reason: 'Edition withdrawn by its publisher', expected_revision: 9 }]]);
    assert.equal(v.textOf('pricing-live'), 'Startup ecosystem score marked Not recorded for Denmark. Revision 10.');
  } finally { await v.unmount(); }
});

test('the country page flags a value with no history and one that differs, from the consistency read', async () => {
  // Mutations checked: the flag drawn on the wrong input; the flag's Record link opening another field; a failed check called clean.
  const c = countryApi({ record: () => Promise.resolve({ profile: { revision: 10 } }), consistency: () => Promise.resolve({ ...FINDINGS, findings: FINDINGS.findings.map((f) => ({ ...f, country_code: 'DK' })) }) });
  const v = await mount('/admin/licences/pricing/country/dk', '/admin/licences/pricing/country/:code', h(PricingCountry, { api: c.api, writeApi: c.writeApi }));
  try {
    assert.match(v.textOf('pricing-country-check'), /2 values to check on Denmark/);
    assert.deepEqual(v.all('pricing-input-flag').map((n) => v.props(n)['data-field']), ['population', 'ppp_gdp_per_capita']);
    assert.match(v.textOf('pricing-input-flag'), /No history row for this value · 2 frozen pricing snapshots hold it/);
    await act(async () => { v.props(v.all('pricing-input-flag-record')[1]).onClick(); await settle(); });
    assert.equal(v.props(v.one('pricing-obs-field-input')).value, 'ppp_gdp_per_capita');
  } finally { await v.unmount(); }
  const down = await mount('/admin/licences/pricing/country/dk', '/admin/licences/pricing/country/:code', h(PricingCountry, countryApi({ consistency: () => Promise.reject(Object.assign(new Error('x'), { status: 500 })) })));
  try {
    assert.match(down.textOf('pricing-check-unavailable'), /nothing is called consistent/);
    assert.equal(down.all('pricing-input-check').length, 0);
  } finally { await down.unmount(); }
});

test('wiring: each new client method names a route the Worker mounts', () => {
  // Mutations checked: a client path the Worker does not mount; the consistency read put in the write module.
  const writes = read('frontend/src/lib/api/licencePricing.js');
  const reads = read('frontend/src/lib/api/licencePricingHq.js');
  const worker = read('cloudflare-worker/src/routes/admin_licence_pricing.ts');
  const hq = read('cloudflare-worker/src/routes/admin_licence_pricing_hq.ts');
  assert.ok(writes.includes("post('/admin/licence-pricing/countries/import'") && worker.includes("pricing.post('/countries/import'"));
  assert.ok(writes.includes('`/admin/licence-pricing/countries/${enc(code)}/observations`') && worker.includes("pricing.post('/countries/:code/observations'"));
  assert.ok(writes.includes('`/admin/licence-pricing/countries/${enc(code)}/fields/${enc(field)}/status`, { method: \'PUT\'') && worker.includes("pricing.put('/countries/:code/fields/:field/status'"));
  assert.ok(reads.includes("request('/admin/licence-pricing/consistency')") && hq.includes("r.get('/consistency'"));
  assert.ok(!writes.includes('/consistency'));
  for (const src of [worker, hq]) assert.match(src, /path: '\/api\/admin\/licence-pricing'/);
});
