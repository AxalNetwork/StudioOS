/** D7716 (#7716): the observation query, single read, catalogue and one CSV rule over every migration; synthetic rows only. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import observations from '../src/routes/research_observations.ts';
import marketData from '../src/routes/research_market_data.ts';
import { runObservationBatch, type Observation } from '../src/services/marketObservations/write.ts';
import {
  EXPORT_ROW_CAP, ISO2_TO_ISO3, MAIN_EXPORT_COLUMNS, OBSERVATION_FIELDS, REFRESH_ALLOWANCE_DAYS, sourceState, storedGeography,
} from '../src/services/researchObservations.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { refuse } from '../src/util/refusal.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const TEST_AUTH = 'test-only'.repeat(4);
/** The export's header on main before D7716, copied from routes/research_market_data.ts as it stood. */
const MAIN_HEADER = ['source_id','source_name','source_url','source_dataset_or_edition','metric_key','metric_label','geography_type','geography_code','period','value','unit','observation_status','published_at','retrieved_at','methodology_url','license_or_usage_note','confidence','vintage','supersedes_observation_id'];
const PROVENANCE = [...MAIN_HEADER, ...OBSERVATION_FIELDS];

function world(t: TestContext) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  db.prepare('INSERT INTO users(id,uid,role,name,email,is_active,email_verified) VALUES(?,?,?,?,?,1,1)')
    .run(7, 'fixture-7', 'founder', 'Synthetic member', 'fixture-7@example.test');
  db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level,created_at,last_step_up_at) VALUES(?,?,'password','password',?,?)")
    .run(7, 'fixture-7', new Date(NOW).toISOString(), new Date(NOW).toISOString());
  const sql: string[] = [], base = d1Over(db);
  const env = { JWT_SECRET: TEST_AUTH, ENVIRONMENT: 'development', DB: { ...base, prepare(s: string) { sql.push(s); return base.prepare(s); } } } as any;
  const app = new Hono<any>().route('/api/research', observations).route('/api/research', marketData);
  app.onError((error, c) => refuse(c, AUTH_ERROR_STATUSES[error.message] ?? 500, {
    code: 'auth_required', message: 'Sign in to read market observations.', raw: error,
  }));
  const token = () => new SignJWT({ user_id: 7, role: 'founder', jti: 'fixture-7' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(TEST_AUTH));
  const get = async (path: string, signedIn = true) => {
    const res = await app.request(path, { headers: signedIn ? { Authorization: 'Bearer ' + await token() } : {} }, env);
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() as any : await res.text() };
  };
  /** Write through the shared writer exactly as an importer does: one prepared batch for one enabled source. */
  const write = async (source: string, rows: Observation[]) => runObservationBatch(env, source, async () => ({
    rows, seen: rows.length, vintage: rows[0]?.vintage ?? 'v', cursor: null, retry_cursor: null, progressed: true,
  }));
  return { db, env, sql, get, write };
}

/** A row shaped as the World Bank import writes it (D7709), plus optional D7716 fields. */
const wb = (over: Partial<Observation> = {}): Observation => ({
  metric_key: 'population', metric_label: 'Population', geography_type: 'country', geography_code: 'CHE', period: '2024',
  value: 9000000, unit: 'people', observation_status: 'unspecified', published_at: '2026-11-01',
  source_observation_key: 'SP.POP.TOTL:CHE:2024', vintage: '2026-11-01', ...over,
});
const csvRows = (text: string) => text.split('\r\n').map(line => line.split(','));

test('the migration adds nullable fields, the export flag, the indexes and the seeded World Bank catalogue', t => {
  const { db } = world(t);
  const cols = new Map((db.prepare('PRAGMA table_info(research_market_observations)').all() as any[]).map(c => [c.name, c]));
  for (const f of OBSERVATION_FIELDS) assert.equal(cols.get(f)?.notnull, 0, f + ' is a nullable column');
  const sources = Object.fromEntries((db.prepare('SELECT id, export_allowed FROM research_market_sources').all() as any[]).map(r => [r.id, r.export_allowed]));
  assert.equal(sources['world-bank'], 1);
  for (const id of Object.keys(sources).filter(id => id !== 'world-bank')) assert.equal(sources[id], null, id + ' stays unset');
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='research_market_observations'").all() as any[]).map(r => r.name);
  for (const name of ['idx_market_obs_metric_period', 'idx_market_obs_industry', 'idx_market_obs_supersedes']) assert.ok(indexes.includes(name), name);
  const metrics = db.prepare("SELECT metric_key, definition FROM research_market_metrics WHERE source_id='world-bank'").all() as any[];
  assert.equal(metrics.length, 10);
  assert.ok(metrics.every(m => m.definition.length > 20 && m.definition.endsWith('.')), 'each metric has a one-sentence definition');
});

test('the writer stores the new fields and refuses a value outside the exported lists, writing nothing', async t => {
  const w = world(t);
  const ok = await w.write('world-bank', [wb({ statistical_unit: 'enterprise', scale: 'units', currency: 'USD', price_basis: 'current_prices',
    industry_scheme: 'nace_rev2', industry_code: 'J62', size_band: 'sme', series_id: 'synthetic-series', limitations: 'Synthetic limitation.' })]);
  assert.equal(ok.rows_inserted, 1);
  const stored = w.db.prepare('SELECT statistical_unit, industry_scheme, industry_code, size_band, currency FROM research_market_observations').get() as any;
  assert.deepEqual({ ...stored }, { statistical_unit: 'enterprise', industry_scheme: 'nace_rev2', industry_code: 'J62', size_band: 'sme', currency: 'USD' });
  for (const bad of [{ statistical_unit: 'company' }, { size_band: 'huge' }, { currency: 'usd' }, { industry_code: 'J62' }, { scale: 'dozens' }]) {
    const r = await w.write('world-bank', [wb({ source_observation_key: 'K:' + JSON.stringify(bad), ...bad } as any)]);
    assert.deepEqual([r.status, r.rows_inserted, r.failure], ['failed', 0, 'provider_payload'], JSON.stringify(bad));
  }
  assert.equal((w.db.prepare('SELECT COUNT(*) n FROM research_market_observations').get() as any).n, 1);
});

test('the list, the single read and the CSV carry identical provenance, and the CSV header starts with main\'s columns', async t => {
  const w = world(t);
  await w.write('world-bank', [wb({ statistical_unit: 'person', limitations: 'Midyear estimate.' })]);
  const list = await w.get('/api/research/observations?metric=population&geography=CHE');
  assert.equal(list.status, 200);
  const item = list.body.items[0];
  const one = await w.get('/api/research/observations/' + item.id);
  const csv = await w.get('/api/research/observations/export.csv?metric=population&geography=CHE');
  const [header, row] = csvRows(csv.body);
  assert.deepEqual(MAIN_EXPORT_COLUMNS, MAIN_HEADER);
  assert.deepEqual(header.slice(0, MAIN_HEADER.length), MAIN_HEADER);
  assert.deepEqual(header, PROVENANCE);
  const fromCsv = Object.fromEntries(header.map((k, i) => [k, row[i]]));
  for (const k of PROVENANCE) {
    const cell = (v: unknown) => v == null ? '' : String(v);
    assert.equal(cell(item[k]), cell(one.body.observation[k]), 'list and single read: ' + k);
    assert.equal(cell(item[k]), fromCsv[k], 'list and CSV: ' + k);
  }
  assert.equal(one.body.observation.dates.published.label, 'Published');
  assert.equal(one.body.observation.dates.period_measured.value, '2024');
  assert.equal(one.body.source.usage_note, item.license_or_usage_note);
});

test('a country reads the same row by its two- and three-letter code; every seeded country is mapped; an unknown code is refused', async t => {
  const w = world(t);
  await w.write('world-bank', [wb()]);
  const two = await w.get('/api/research/observations?geography=ch'), three = await w.get('/api/research/observations?geography=CHE');
  assert.deepEqual(two.body.items.map((i: any) => i.id), three.body.items.map((i: any) => i.id));
  assert.equal(two.body.items.length, 1);
  const seeded = (w.db.prepare('SELECT code FROM research_countries').all() as any[]).map(r => r.code);
  assert.ok(seeded.length > 0);
  for (const code of seeded) assert.ok(ISO2_TO_ISO3[code], 'mapped: ' + code);
  assert.equal(storedGeography('EU27_2020'), 'EU27_2020');
  for (const bad of ['ZZ', 'ZZZ', 'Switzerland']) {
    const r = await w.get('/api/research/observations?geography=' + bad);
    assert.deepEqual([r.status, r.body.error], [400, 'unknown_geography'], bad);
  }
});

test('a revised value: the list shows only the current row by default, and the single read returns the chain in order', async t => {
  const w = world(t);
  await w.write('world-bank', [wb()]);
  await w.write('world-bank', [wb({ value: 9100000, vintage: '2026-11-15', published_at: '2026-11-15' })]);
  await w.write('world-bank', [wb({ value: 9200000, vintage: '2026-11-20', published_at: '2026-11-20' })]);
  const current = await w.get('/api/research/observations?metric=population');
  assert.deepEqual(current.body.items.map((i: any) => i.value), [9200000]);
  assert.equal(current.body.total, 1);
  const all = await w.get('/api/research/observations?metric=population&vintages=all');
  assert.equal(all.body.total, 3);
  const [first, middle, last] = (w.db.prepare('SELECT id FROM research_market_observations ORDER BY id').all() as any[]).map(r => r.id);
  const readLast = await w.get('/api/research/observations/' + last);
  assert.deepEqual(readLast.body.revisions.map((r: any) => [r.id, r.position]), [[first, 'older'], [middle, 'older'], [last, 'this']]);
  assert.equal(readLast.body.observation.current, true);
  const readFirst = await w.get('/api/research/observations/' + first);
  assert.deepEqual(readFirst.body.revisions.map((r: any) => [r.id, r.position]), [[first, 'this'], [middle, 'newer'], [last, 'newer']]);
  assert.equal(readFirst.body.observation.current, false);
  const readMiddle = await w.get('/api/research/observations/' + middle);
  assert.deepEqual(readMiddle.body.revisions.map((r: any) => r.id), [first, middle, last]);
  assert.equal((await w.get('/api/research/observations/999999')).status, 404);
});

test('with more rows than one page, total and the second page are right, and the filtering is in the SQL', async t => {
  const w = world(t);
  const ins = w.db.prepare(`INSERT INTO research_market_observations(source_id,metric_key,metric_label,geography_type,geography_code,period,value,unit,
    observation_status,retrieved_at,source_observation_key,vintage) VALUES('world-bank',?,?,'country',?,?,?,'people','unspecified',?,?,'v1')`);
  for (let i = 0; i < 45; i++) ins.run('population', 'Population', 'FRA', String(1980 + i), i, new Date(NOW).toISOString(), 'k' + i);
  for (let i = 0; i < 5; i++) ins.run('unemployment_pct', 'Unemployment', 'FRA', String(2000 + i), i, new Date(NOW).toISOString(), 'u' + i);
  w.sql.length = 0;
  const page1 = await w.get('/api/research/observations?metric=population&geography=FR&limit=20');
  const page3 = await w.get('/api/research/observations?metric=population&geography=FR&limit=20&offset=40');
  assert.deepEqual([page1.body.total, page1.body.items.length, page3.body.items.length], [45, 20, 5]);
  assert.deepEqual(page3.body.items.map((i: any) => i.period), ['2020', '2021', '2022', '2023', '2024']);
  assert.ok(w.sql.some(s => s.includes('o.metric_key = ?') && s.includes('o.geography_code = ?') && s.includes('LIMIT ? OFFSET ?')));
  const range = await w.get('/api/research/observations?metric=population&period_from=2010&period_to=2012');
  assert.deepEqual(range.body.items.map((i: any) => i.period), ['2010', '2011', '2012']);
  const mixed = await w.get('/api/research/observations?period_from=2010&period_to=2012-Q1');
  assert.deepEqual([mixed.status, mixed.body.error], [400, 'mixed_period_forms']);
});

test('each of the four states comes from a seeded case and is distinct in the payload', async t => {
  const w = world(t);
  await w.write('world-bank', [wb()]);
  const state = async (q: string) => (await w.get('/api/research/observations?' + q)).body.coverage;
  assert.equal((await state('metric=unlisted_metric&geography=CHE')).state, 'not_covered');
  assert.equal((await state('metric=unemployment_pct&geography=CHE')).state, 'no_observation');
  assert.equal((await state('metric=population&geography=CHE')).state, 'current');
  w.db.prepare("UPDATE research_market_sources SET last_error='provider_http HTTP 502' WHERE id='world-bank'").run();
  const failing = await state('metric=population&geography=CHE');
  assert.equal(failing.state, 'source_failing');
  assert.equal(failing.latest.value, 9000000);
  assert.equal(failing.latest.age_days, 0);
  w.db.prepare("UPDATE research_market_sources SET last_error=NULL, last_success_at=? WHERE id='world-bank'")
    .run(new Date(NOW - (REFRESH_ALLOWANCE_DAYS.monthly + 1) * 86_400_000).toISOString());
  assert.equal((await state('metric=population&geography=CHE')).state, 'stale');
  assert.equal(sourceState({ id: 'x', refresh_policy: 'whenever', last_success_at: new Date(NOW).toISOString(), last_error: null }, NOW), 'stale',
    'an unknown refresh policy never reads as fresh');
  assert.equal(sourceState({ id: 'x', refresh_policy: 'monthly', last_success_at: null, last_error: null }, NOW), 'stale');
});

test('rows of a source not marked exportable are marked on the list, left out of both CSVs and counted', async t => {
  const w = world(t);
  w.db.prepare("UPDATE research_market_sources SET enabled=1 WHERE id='oecd'").run();
  await w.write('world-bank', [wb()]);
  await w.write('oecd', [wb({ source_observation_key: 'OECD:CHE:2024', value: 1 })]);
  // Another country's row: a country filter must leave it out of both exports.
  await w.write('world-bank', [wb({ geography_code: 'FRA', source_observation_key: 'SP.POP.TOTL:FRA:2024' })]);
  const list = await w.get('/api/research/observations?geography=CHE');
  assert.deepEqual(list.body.items.map((i: any) => [i.source_id, i.exportable]).sort(), [['oecd', false], ['world-bank', true]]);
  for (const path of ['/api/research/observations/export.csv?geography=CHE', '/api/research/market-data/export.csv?country=CHE']) {
    const csv = await w.get(path);
    assert.equal(csv.status, 200, path);
    const [header, ...rows] = csvRows(csv.body);
    assert.deepEqual(header, PROVENANCE, path + ' header');
    assert.deepEqual(rows.map(r => [r[0], r[7]]), [['world-bank', 'CHE']], path + ' rows');
    assert.deepEqual(JSON.parse(csv.headers.get('X-Export-Omitted')!), { oecd: 1 }, path + ' omitted');
  }
});

test('a CSV past the cap is refused with its code, never cut short; a cell a spreadsheet would run is written as text', async t => {
  const w = world(t);
  await w.write('world-bank', [wb({ metric_label: '=HYPERLINK("example.test")' })]);
  const safe = await w.get('/api/research/observations/export.csv');
  assert.ok(safe.body.includes(`"'=HYPERLINK(""example.test"")"`));
  const ins = w.db.prepare(`INSERT INTO research_market_observations(source_id,metric_key,metric_label,geography_type,geography_code,period,value,unit,
    observation_status,retrieved_at,source_observation_key,vintage) VALUES('world-bank','population','Population','country','USA',?,1,'people','unspecified',?,?,'v1')`);
  for (let i = 0; i < EXPORT_ROW_CAP; i++) ins.run(String(i), new Date(NOW).toISOString(), 'cap' + i);
  for (const path of ['/api/research/observations/export.csv', '/api/research/market-data/export.csv']) {
    const r = await w.get(path);
    assert.deepEqual([r.status, r.body.error], [413, 'export_too_large'], path);
    assert.match(r.body.message, /Narrow the filters/);
  }
});

test('a request with no sign-in is refused on every route', async t => {
  const w = world(t);
  await w.write('world-bank', [wb()]);
  for (const path of ['/api/research/observations', '/api/research/observations/metrics', '/api/research/observations/export.csv', '/api/research/observations/1']) {
    assert.equal((await w.get(path, false)).status, 401, path);
  }
  const metrics = await w.get('/api/research/observations/metrics');
  // D7717: later importers add their own catalogue rows; the World Bank's ten stay.
  assert.equal(metrics.body.items.filter((m: any) => m.source_id === 'world-bank').length, 10);
});
