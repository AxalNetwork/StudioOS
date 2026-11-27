/**
 * D7717 (#7717): the Eurostat SBS importer over every migration and real SQLite, with no network. Provider replies are
 * trimmed copies of real Eurostat responses (fixtures/eurostat_sbs_7717/, requests and dates in fixtures/README.md);
 * files named *.altered.json were changed by hand, as that README says.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import imports, { mount } from '../src/routes/admin_market_observation_imports.ts';
import {
  ingestEurostatSbs, sbsFlag, sbsGeography, sbsParams, sbsRows, sbsUrl, SBS_LIMITATIONS, SOURCE_ID,
} from '../src/services/marketObservations/eurostatSbs.ts';
import { IMPORTERS } from '../src/services/marketObservations/importers.ts';
import { listObservations, parseFilters, readObservation } from '../src/services/researchObservations.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { refuse } from '../src/util/refusal.ts';

const NOW = Date.parse('2026-11-23T16:00:00Z');
const TEST_AUTH = 'test-only'.repeat(4);
const DIR = new URL('./fixtures/eurostat_sbs_7717/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const UPDATED = '2026-09-30T09:00:00.000Z', REVISED = '2026-10-15T09:00:00.000Z';

/** The recorded requests, as fixtures/README.md lists them. */
const MICRO = { from: 2021, to: 2022, indicators: ['ENT_NR', 'EMP_NR', 'NETTUR_MEUR'], activities: ['J62'], size_classes: ['0-9'], geographies: ['DE', 'EL', 'EU27_2020'] };
const C12 = { from: 2022, to: 2022, indicators: ['ENT_NR', 'EMP_NR', 'NETTUR_MEUR'], activities: ['C12'], size_classes: ['50-249', 'GE250'], geographies: ['DK', 'EE', 'CY', 'LU', 'MT'] };
const TOTAL = { from: 2021, to: 2021, indicators: ['ENT_NR', 'NETTUR_MEUR'], activities: ['J62'], size_classes: ['TOTAL'], geographies: ['FR', 'PT', 'LU', 'AL', 'ME', 'RS', 'CH'] };
const RECORDED: Record<string, string> = {
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw?format=JSON&lang=EN&indic_sbs=ENT_NR&indic_sbs=EMP_NR&indic_sbs=NETTUR_MEUR&nace_r2=J62&size_emp=0-9&geo=DE&geo=EL&geo=EU27_2020&time=2021&time=2022': 'j62_micro_de_el_eu27_2021_2022.json',
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw?format=JSON&lang=EN&indic_sbs=ENT_NR&indic_sbs=EMP_NR&indic_sbs=NETTUR_MEUR&nace_r2=C12&size_emp=50-249&size_emp=GE250&geo=DK&geo=EE&geo=CY&geo=LU&geo=MT&time=2022': 'c12_medium_large_2022.json',
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw?format=JSON&lang=EN&indic_sbs=ENT_NR&indic_sbs=NETTUR_MEUR&nace_r2=J62&size_emp=TOTAL&geo=FR&geo=PT&geo=LU&geo=AL&geo=ME&geo=RS&geo=CH&time=2021': 'j62_total_2021.json',
};

function world(t: TestContext) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const env = { JWT_SECRET: TEST_AUTH, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  /** Serve a recorded reply for the request the importer builds; `swap` replaces the body, as an altered copy does. */
  let swap: { file: string; status?: number } | null = null;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input); calls.push(url);
    if (swap) return new Response(fixture(swap.file), { status: swap.status ?? 200, headers: { 'content-type': 'application/json' } });
    const file = RECORDED[url];
    if (!file) throw new Error('unrecorded request ' + url);
    return new Response(fixture(file), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const stored = () => db.prepare('SELECT * FROM research_market_observations ORDER BY id').all() as any[];
  const runs = () => db.prepare('SELECT * FROM research_market_ingestion_runs ORDER BY id').all() as any[];
  return { db, env, calls, stored, runs, serve: (file: string | null, status?: number) => { swap = file ? { file, status } : null; } };
}
const cell = (rows: any[], key: string) => rows.filter(r => r.source_observation_key === key);

test('the importer builds exactly the recorded request and registers under its own source', () => {
  for (const [url, params] of [[Object.keys(RECORDED)[0], MICRO], [Object.keys(RECORDED)[1], C12], [Object.keys(RECORDED)[2], TOTAL]] as const)
    assert.equal(sbsUrl(sbsParams(params)), url);
  assert.deepEqual(Object.keys(IMPORTERS), ['world-bank', 'eurostat-sbs', 'census-cbp', 'bls-ce']);
  assert.equal(IMPORTERS['eurostat-sbs'].source_id, 'eurostat-sbs');
});

test('the migration adds one enabled eurostat-sbs row with its metrics and leaves the generic eurostat row and every store empty', t => {
  const w = world(t);
  const sbs = w.db.prepare("SELECT * FROM research_market_sources WHERE id='eurostat-sbs'").get() as any;
  assert.equal(sbs.enabled, 1); assert.equal(sbs.export_allowed, null); assert.equal(sbs.refresh_policy, 'annual');
  assert.match(sbs.dataset_or_edition, /^sbs_sc_ovw: .*10\.2908\/SBS_SC_OVW$/);
  assert.match(sbs.license_or_usage_note, /copyright-notice, read 2026-11-23/);
  assert.match(sbs.license_or_usage_note, /counts are enterprises, not establishments or every possible buyer/);
  assert.match(sbs.license_or_usage_note, /not what a buyer segment spends on a product/);
  assert.match(sbs.license_or_usage_note, /covers the business economy and leaves out some activities/);
  assert.deepEqual({ ...w.db.prepare("SELECT enabled, dataset_or_edition, export_allowed FROM research_market_sources WHERE id='eurostat'").get() },
    { enabled: 0, dataset_or_edition: 'Eurostat', export_allowed: null });
  assert.deepEqual(w.db.prepare("SELECT metric_key, unit FROM research_market_metrics WHERE source_id='eurostat-sbs' ORDER BY metric_key").all().map((r: any) => [r.metric_key, r.unit]),
    [['sbs_enterprises', 'enterprises'], ['sbs_net_turnover', 'EUR'], ['sbs_persons_employed', 'persons']]);
  assert.equal(w.stored().length, 0);
  assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM research_market_ingestion_runs").get() as any).n, 0);
});

test('a real response imports every cell with its unit, scale, currency, classification, size band and flags; a re-run adds nothing', async t => {
  const w = world(t);
  const first = await ingestEurostatSbs(w.env, MICRO), again = await ingestEurostatSbs(w.env, MICRO);
  assert.deepEqual([first.status, first.rows_seen, first.rows_inserted, first.rows_unchanged], ['succeeded', 18, 18, 0]);
  assert.deepEqual([again.status, again.rows_seen, again.rows_inserted, again.rows_unchanged], ['succeeded', 18, 0, 18]);
  const rows = w.stored(); assert.equal(rows.length, 18);
  const de = cell(rows, 'sbs_sc_ovw:ENT_NR:J62:0-9:DE:2022')[0];
  assert.deepEqual({ ...de, id: 0, retrieved_at: 0 }, {
    id: 0, source_id: SOURCE_ID, metric_key: 'sbs_enterprises', metric_label: 'Enterprises - number', geography_type: 'country',
    geography_code: 'DEU', period: '2022', value: 84564, unit: 'enterprises', observation_status: 'unspecified', published_at: UPDATED,
    retrieved_at: 0, confidence: 'source_reported', source_observation_key: 'sbs_sc_ovw:ENT_NR:J62:0-9:DE:2022', vintage: UPDATED,
    supersedes_observation_id: null, statistical_unit: 'enterprise', scale: 'units', currency: null, price_basis: 'not_applicable',
    industry_scheme: 'nace_rev2', industry_code: 'J62', size_band: 'micro', series_id: 'SBS_SC_OVW.A.ENT_NR.J62.0-9.DE',
    supporting_passage: null, applicability_note: null, limitations: SBS_LIMITATIONS,
  });
  // Eurostat's own code for Greece; the EU figure is the provider's own aggregate, a region row, flagged estimated.
  assert.deepEqual(cell(rows, 'sbs_sc_ovw:NETTUR_MEUR:J62:0-9:EL:2021').map(r => [r.geography_code, r.value, r.scale, r.currency, r.price_basis]),
    [['GRC', 677.67, 'millions', 'EUR', 'current_prices']]);
  assert.deepEqual(cell(rows, 'sbs_sc_ovw:EMP_NR:J62:0-9:EU27_2020:2022').map(r => [r.geography_type, r.geography_code, r.value, r.observation_status]),
    [['region', 'EU27_2020', 1110000, 'estimate']]);
  assert.deepEqual(rows.filter(r => r.observation_status === 'estimate').map(r => r.geography_code), ['EU27_2020', 'EU27_2020', 'EU27_2020', 'EU27_2020']);
  assert.equal(first.skipped.unknown_geography + first.skipped.aggregate_geography + first.skipped.missing + first.skipped.confidential, 0);
});

test('a changed value adds one revision linked to the row it replaces', async t => {
  const w = world(t);
  await ingestEurostatSbs(w.env, MICRO); w.serve('j62_micro_revised.altered.json');
  const revised = await ingestEurostatSbs(w.env, MICRO);
  assert.deepEqual([revised.rows_inserted, revised.rows_unchanged], [1, 17]);
  const chain = cell(w.stored(), 'sbs_sc_ovw:ENT_NR:J62:0-9:DE:2022');
  assert.deepEqual(chain.map(r => [r.value, r.vintage, r.supersedes_observation_id]), [[84564, UPDATED, null], [84600, REVISED, chain[0].id]]);
  w.serve(null); const replay = await ingestEurostatSbs(w.env, MICRO);
  assert.deepEqual([replay.rows_inserted, replay.rows_unchanged], [0, 18]);
});

test('a changed flag with the same value is a revision, whether it moves the status or only the limitations', async t => {
  const w = world(t);
  await ingestEurostatSbs(w.env, MICRO); w.serve('j62_micro_flags_changed.altered.json');
  const result = await ingestEurostatSbs(w.env, MICRO);
  assert.deepEqual([result.rows_inserted, result.rows_unchanged], [2, 16]);
  const eu = cell(w.stored(), 'sbs_sc_ovw:EMP_NR:J62:0-9:EU27_2020:2022');
  assert.deepEqual(eu.map(r => [r.value, r.observation_status, r.supersedes_observation_id]), [[1110000, 'estimate', null], [1110000, 'unspecified', eu[0].id]]);
  const de = cell(w.stored(), 'sbs_sc_ovw:ENT_NR:J62:0-9:DE:2022');
  assert.deepEqual(de.map(r => [r.value, r.observation_status, r.supersedes_observation_id]), [[84564, 'unspecified', null], [84564, 'unspecified', de[0].id]]);
  assert.equal(de[1].limitations, SBS_LIMITATIONS + ' Eurostat flag: provisional.');
});

test('a confidential or missing cell stores no row, never zero; measured zero is stored; break and estimate flags land where they should', async t => {
  const w = world(t);
  const c12 = await ingestEurostatSbs(w.env, C12);
  assert.deepEqual([c12.rows_seen, c12.rows_inserted, c12.skipped.confidential, c12.skipped.missing], [30, 26, 4, 0]);
  assert.equal(w.stored().filter(r => r.value === 0).length, 24);
  assert.equal(w.stored().filter(r => r.value === null).length, 0);
  const total = await ingestEurostatSbs(w.env, TOTAL);
  assert.deepEqual([total.rows_seen, total.rows_inserted, total.skipped.confidential, total.skipped.missing], [14, 9, 3, 2]);
  const rows = w.stored().filter(r => r.size_band === 'all_sizes');
  assert.deepEqual(rows.filter(r => r.geography_code === 'MNE' || r.geography_code === 'ALB'), []);
  assert.deepEqual(cell(rows, 'sbs_sc_ovw:NETTUR_MEUR:J62:TOTAL:LU:2021'), []);
  assert.equal(cell(rows, 'sbs_sc_ovw:ENT_NR:J62:TOTAL:FR:2021')[0].limitations, SBS_LIMITATIONS + ' Eurostat flag: break in time series.');
  assert.deepEqual(cell(rows, 'sbs_sc_ovw:ENT_NR:J62:TOTAL:CH:2021').map(r => [r.geography_code, r.observation_status, r.limitations]),
    [['CHE', 'estimate', SBS_LIMITATIONS]]);
});

test('an unknown or aggregate geography in a reply is skipped and counted, never guessed or stored', async t => {
  const w = world(t); w.serve('j62_micro_geo.altered.json');
  const result = await ingestEurostatSbs(w.env, MICRO);
  assert.deepEqual([result.status, result.rows_seen, result.rows_inserted], ['succeeded', 18, 6]);
  assert.deepEqual([result.skipped.unknown_geography, result.skipped.aggregate_geography], [6, 6]);
  assert.deepEqual([...new Set(w.stored().map(r => r.geography_code))], ['DEU']);
  assert.deepEqual([sbsGeography('EL'), sbsGeography('UK'), sbsGeography('EU27_2020'), sbsGeography('EA20'), sbsGeography('XX'), sbsGeography('EU28')],
    [{ type: 'country', code: 'GRC' }, { type: 'country', code: 'GBR' }, { type: 'region', code: 'EU27_2020' }, 'aggregate', 'unknown', 'aggregate']);
});

test('a country the batch did not ask for is skipped as unknown, and a null value stores nothing', async () => {
  const skipped = () => ({ missing: 0, confidential: 0, unknown_geography: 0, aggregate_geography: 0, unknown_flag: 0 });
  const real = JSON.parse(fixture('j62_micro_de_el_eu27_2021_2022.json'));
  const narrow = skipped(), read = await sbsRows(real, sbsParams({ ...MICRO, geographies: ['DE', 'EU27_2020'] }), narrow);
  assert.deepEqual([read.seen, read.rows.length, narrow.unknown_geography], [18, 12, 6]);
  assert.ok(read.rows.every(r => r.geography_code !== 'GRC'));
  // ALTERED in memory: cell 3 (DE ENT_NR 2022) set to null.
  const altered = { ...real, value: { ...real.value, 3: null } }, nulls = skipped();
  const out = await sbsRows(altered, sbsParams(MICRO), nulls);
  assert.deepEqual([out.rows.length, nulls.missing], [17, 1]);
});

test('a provider failure records a failed run with only its class and keeps every earlier row', async t => {
  const w = world(t);
  await ingestEurostatSbs(w.env, MICRO); const before = w.stored();
  w.serve('not_found_404.json', 404);
  const result = await ingestEurostatSbs(w.env, MICRO);
  assert.deepEqual([result.status, result.rows_inserted, result.failure], ['failed', 0, 'provider_http HTTP 404']);
  assert.deepEqual(w.stored(), before);
  assert.deepEqual(w.runs().map(r => [r.status, r.error]), [['succeeded', null], ['failed', 'provider_http HTTP 404']]);
  assert.doesNotMatch(JSON.stringify([w.runs(), result]), /ERR_NOT_FOUND/);
  const src = w.db.prepare("SELECT last_success_at, last_error FROM research_market_sources WHERE id='eurostat-sbs'").get() as any;
  assert.deepEqual([src.last_success_at, src.last_error], [new Date(NOW).toISOString(), 'provider_http HTTP 404']);
});

test('an over-cap or out-of-scope batch is refused before any run or request', async t => {
  const w = world(t);
  const big = { ...MICRO, geographies: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT'] };
  await assert.rejects(() => ingestEurostatSbs(w.env, big), { code: 'sbs_batch_too_large' });
  for (const bad of [{ ...MICRO, from: 2020 }, { ...MICRO, geographies: ['UK'] }, { ...MICRO, geographies: ['US'] },
    { ...MICRO, size_classes: ['10-19'] }, { ...MICRO, activities: ['J62', 'J62'] }, { ...MICRO, activities: ['A01'] },
    { ...MICRO, indicators: ['AV_MEUR'] }, { ...MICRO, to: 2026 }])
    await assert.rejects(() => ingestEurostatSbs(w.env, bad), { code: 'invalid_sbs_parameters' }, JSON.stringify(bad));
  await assert.rejects(() => ingestEurostatSbs(w.env, MICRO, 'cursor'), { code: 'invalid_cursor' });
  assert.deepEqual([w.calls.length, w.runs().length], [0, 0]);
});

test('flags read as the decision says: e is estimate, the rest are limitations, confidential and m store nothing, unknown is skipped', () => {
  assert.deepEqual(sbsFlag(undefined), { status: 'unspecified', notes: [] });
  assert.deepEqual(sbsFlag('e'), { status: 'estimate', notes: [] });
  assert.deepEqual(sbsFlag('bdep'), { status: 'estimate', notes: ['break in time series', 'definition differs (see metadata)', 'provisional'] });
  assert.deepEqual(sbsFlag('u'), { status: 'unspecified', notes: ['low reliability'] });
  assert.deepEqual([sbsFlag('|C'), sbsFlag('e|C'), sbsFlag('m'), sbsFlag('x'), sbsFlag('|Z')], ['confidential', 'confidential', 'missing', 'unknown_flag', 'unknown_flag']);
});

test('the operator route runs a bounded SBS batch and refuses an over-cap one', async t => {
  const w = world(t);
  w.db.prepare('INSERT INTO users(id,uid,role,name,email,is_active,email_verified) VALUES(1,?,?,?,?,1,1)').run('fixture-1', 'admin', 'Synthetic user', 'fixture-1@example.test');
  w.db.prepare('INSERT INTO super_admins(user_id) VALUES(1)').run();
  w.db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level,created_at,last_step_up_at) VALUES(1,'fixture-1','totp','totp',?,?)")
    .run(new Date(NOW).toISOString(), new Date(NOW).toISOString());
  const app = new Hono<any>().route(mount.path, imports);
  app.onError((error, c) => refuse(c, AUTH_ERROR_STATUSES[error.message] ?? 500, { code: 'auth_required', message: 'Operator access is missing.', raw: error }));
  const token = await new SignJWT({ user_id: 1, role: 'admin', jti: 'fixture-1' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(TEST_AUTH));
  const post = async (params: unknown) => {
    const res = await app.request(mount.path + '/imports', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ importer: 'eurostat-sbs', params, reason: 'Fixture SBS batch' }) }, w.env);
    return { status: res.status, body: await res.json() as any };
  };
  const ok = await post(MICRO);
  assert.equal(ok.status, 202);
  assert.deepEqual([ok.body.result.source_id, ok.body.result.rows_inserted, ok.body.result.skipped.confidential], ['eurostat-sbs', 18, 0]);
  const over = await post({ ...MICRO, geographies: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT'] });
  assert.deepEqual([over.status, over.body.error], [400, 'sbs_batch_too_large']);
  assert.equal(w.runs().length, 1);
});

test('worked query on fixture data: enterprises and turnover for J62, Germany, micro enterprises, 2022, with full provenance', async t => {
  const w = world(t); await ingestEurostatSbs(w.env, MICRO);
  const read = async (metric: string) => {
    const list = await listObservations(w.env, parseFilters({ metric, geography: 'DE', industry_code: 'J62', size_band: 'micro', period_from: '2022', period_to: '2022' }), NOW);
    assert.equal(list.total, 1); assert.equal(list.coverage?.state, 'current');
    return (await readObservation(w.env, Number(list.items[0].id), NOW))!;
  };
  const ent = await read('sbs_enterprises'), tur = await read('sbs_net_turnover');
  const pick = (r: any) => ({ value: r.observation.value, unit: r.observation.unit, scale: r.observation.scale, currency: r.observation.currency,
    source: r.source.name, dataset: r.source.dataset_or_edition, period: r.observation.dates.period_measured.value,
    published: r.observation.dates.published.value, statistical_unit: r.observation.statistical_unit,
    classification: r.observation.industry_scheme + ' ' + r.observation.industry_code, size_band: r.observation.size_band,
    status: r.observation.observation_status, limitations: r.observation.limitations, exportable: r.source.exportable });
  const dataset = 'sbs_sc_ovw: Enterprise statistics by size class and NACE Rev. 2 activity (from 2021 onwards), DOI 10.2908/SBS_SC_OVW';
  assert.deepEqual(pick(ent), { value: 84564, unit: 'enterprises', scale: 'units', currency: null, source: 'Eurostat structural business statistics',
    dataset, period: '2022', published: UPDATED, statistical_unit: 'enterprise', classification: 'nace_rev2 J62', size_band: 'micro',
    status: 'unspecified', limitations: SBS_LIMITATIONS, exportable: false });
  assert.deepEqual(pick(tur), { ...pick(ent), value: 24903.86, unit: 'EUR', scale: 'millions', currency: 'EUR' });
});
