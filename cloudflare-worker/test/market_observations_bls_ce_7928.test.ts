/**
 * D7928 (#7928): the BLS Consumer Expenditure importer, over every migration and real SQLite, with no network. Every
 * workbook here is invented: a few categories with made-up means, standard errors and coefficients of variation laid
 * out as the importer expects the calendar-year standard-error table. No real BLS value is committed.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  ceParams, ceRows, ceTableUrl, CE_ITEMS, CE_LIMITATIONS, ingestBlsConsumerExpenditure, label, LAST_YEAR, sheetRows, SOURCE_ID, workbookGrid,
} from '../src/services/marketObservations/blsConsumerExpenditure.ts';
import { IMPORTERS } from '../src/services/marketObservations/importers.ts';
import { buildZip } from '../src/util/zip.ts';

const NOW = Date.parse('2026-11-27T05:00:00Z');
const MODIFIED = 'Wed, 24 Sep 2025 13:30:00 GMT', REVISED = 'Thu, 15 Jan 2026 13:30:00 GMT';

type Fx = string | number | { inline: string } | { str: string } | { error: string } | null;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** An invented workbook: shared strings for most text, an inline string and a formula string where a row says so. */
function workbook(grid: Fx[][]): Uint8Array {
  const strings: string[] = [];
  const sheet = grid.map((row, r) => `<row r="${r + 1}">` + row.map((v, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    if (v === null) return `<c r="${ref}" s="1"/>`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'string') { strings.push(v); return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`; }
    if ('inline' in v) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v.inline)}</t></is></c>`;
    if ('str' in v) return `<c r="${ref}" t="str"><f>A1</f><v>${esc(v.str)}</v></c>`;
    return `<c r="${ref}" t="e"><v>${v.error}</v></c>`;
  }).join('') + '</row>').join('');
  return buildZip([
    { name: 'xl/sharedStrings.xml', content: `<?xml version="1.0"?><sst count="${strings.length}">${strings.map(s => `<si><t>${esc(s)}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0"?><worksheet><sheetData>${sheet}</sheetData></worksheet>` },
  ]);
}
/** Invented table. Housing's SE is blank (suppressed) and its CV unreadable text; Healthcare is absent; Education spent 0. */
const GRID: Fx[][] = [
  ['Table 1100. Area type: invented test table', null, null],
  ['Item', 'All consumer units', 'Urban'],
  ['Number of consumer units (in thousands)', 100000, 90000],
  ['Average annual expenditures', null, null],
  ['Mean', 50000.5, 51000], ['SE', 400.25, 410], ['CV(%)', 0.8, 0.81],
  ['Food', null, null],
  ['Mean', 7000, 7100], ['Share', 14, 14], ['SE', 90, 95], ['CV(%)', 1.29, 1.3],
  ['Food at home', null, null],
  ['Mean', 4000, 4100], ['SE', 60, 61], ['CV(%)', 1.5, 1.5],
  ['Housing', null, null],
  ['Mean', 18000, 19000], ['SE', null, 300], ['CV(%)', 'n.a.', 1.6],
  [{ inline: 'Apparel and services ........' }, null, null],
  ['Mean', 2000, 2100], ['SE', 50, 51], ['CV(%)', 2.5, 2.4],
  ['Education', null, null],
  ['Mean', 0, 10], ['SE', 0, 1], ['CV(%)', null, 10],
];
const ASK = { year: 2025, items: ['total', 'food', 'housing', 'education', 'healthcare', 'apparel'] };

async function world(t: TestContext, { enabled = true } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  if (enabled) db.exec(`UPDATE research_market_sources SET enabled=1 WHERE id='${SOURCE_ID}'`);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const env = { ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  let reply: () => Promise<Response> = async () => new Response(workbook(GRID), { headers: { 'last-modified': MODIFIED } });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any) => { calls.push(String(input)); return reply(); });
  const stored = () => db.prepare('SELECT * FROM research_market_observations ORDER BY id').all() as any[];
  const runs = () => db.prepare('SELECT * FROM research_market_ingestion_runs ORDER BY id').all() as any[];
  return { db, env, calls, stored, runs, serve: (fn: () => Promise<Response>) => { reply = fn; } };
}

test('the importer is registered under its own source and asks for exactly the table of the year', () => {
  assert.deepEqual(Object.keys(IMPORTERS), ['world-bank', 'eurostat-sbs', 'census-cbp', 'bls-ce']);
  assert.equal(IMPORTERS['bls-ce'].source_id, 'bls-ce');
  assert.equal(ceTableUrl(2025), 'https://www.bls.gov/cex/tables/calendar-year/mean-item-share-average-standard-error/cu-area-type-2025.xlsx');
});

test('a batch is one year from 2023 and known categories; anything else is refused before any request', () => {
  assert.deepEqual(ceParams({ year: 2023 }), { year: 2023, items: Object.keys(CE_ITEMS) });
  assert.deepEqual(ceParams({ year: 2024, items: ['food'] }), { year: 2024, items: ['food'] });
  for (const bad of [
    { year: 2022 }, { year: LAST_YEAR + 1 }, { year: '2024' }, { year: 2024, items: [] }, { year: 2024, items: ['groceries'] },
    { year: 2024, items: ['food', 'food'] }, { year: 2024, items: 'food' }, { year: 2024, geography: 'Northeast' }, null, [], 'x',
  ]) assert.throws(() => ceParams(bad), (e: any) => e.code === 'invalid_bls_ce_parameters', JSON.stringify(bad));
});

test('the migration adds one disabled bls-ce source and 27 catalogue rows, and a disabled source runs nothing', async t => {
  const w = await world(t, { enabled: false });
  const src = w.db.prepare("SELECT * FROM research_market_sources WHERE id='bls-ce'").get() as any;
  assert.equal(src.enabled, 0, 'no live activation is authorised (#7928)');
  assert.equal(src.export_allowed, null); assert.equal(src.refresh_policy, 'annual');
  assert.match(src.license_or_usage_note, /must be confirmed before it is enabled/);
  const metrics = w.db.prepare("SELECT metric_key, unit FROM research_market_metrics WHERE source_id='bls-ce'").all() as any[];
  assert.equal(metrics.length, 27);
  for (const item of Object.keys(CE_ITEMS)) for (const [stat, unit] of [['mean', 'USD'], ['se', 'USD'], ['cv', 'percent']])
    assert.ok(metrics.some(m => m.metric_key === `ce_${item}_${stat}` && m.unit === unit), `${item} ${stat}`);
  await assert.rejects(ingestBlsConsumerExpenditure(w.env, ASK), (e: any) => e.code === 'source_disabled');
  assert.equal(w.calls.length, 0); assert.equal(w.runs().length, 0); assert.equal(w.stored().length, 0);
});

test('an import stores each mean with its published SE and CV, units and geography; blanks store nothing; a re-run adds nothing', async t => {
  const w = await world(t);
  const r = await ingestBlsConsumerExpenditure(w.env, ASK);
  assert.deepEqual(w.calls, [ceTableUrl(2025)]);
  assert.deepEqual([r.status, r.rows_seen, r.rows_inserted], ['succeeded', 18, 12]);
  assert.deepEqual(r.skipped, { not_published: 3, suppressed: 2, unknown_cell: 1 });
  const rows = w.stored(), by = (key: string) => rows.find(x => x.source_observation_key === key);
  const mean = by('ce:us:2025:allcu:food:mean'), se = by('ce:us:2025:allcu:food:se'), cv = by('ce:us:2025:allcu:food:cv');
  assert.deepEqual([mean.value, mean.unit, mean.scale, mean.currency, mean.price_basis, mean.statistical_unit, mean.geography_type, mean.geography_code, mean.period, mean.observation_status],
    [7000, 'USD', 'units', 'USD', 'current_prices', 'consumer_unit', 'country', 'USA', '2025', 'estimate']);
  assert.deepEqual([se.metric_key, se.value, se.unit, se.currency], ['ce_food_se', 90, 'USD', 'USD']);
  assert.deepEqual([cv.metric_key, cv.value, cv.unit, cv.currency, cv.price_basis], ['ce_food_cv', 1.29, 'percent', null, 'not_applicable']);
  assert.equal(mean.limitations, CE_LIMITATIONS + ' Published standard error: 90 USD; coefficient of variation: 1.29 percent.');
  assert.match(se.limitations, /standard error of the mean for Food, not a spending value/);
  assert.equal(mean.series_id, 'CE.US.ALLCU.FOOD.MEAN');
  assert.deepEqual([mean.industry_scheme, mean.industry_code, mean.size_band], [null, null, null]);
  assert.equal(by('ce:us:2025:allcu:total:mean').value, 50000.5, 'values as published, never rounded');
  assert.equal(by('ce:us:2025:allcu:apparel:mean').value, 2000, 'a label with leader dots, in an inline string, is still its item');
  const housing = by('ce:us:2025:allcu:housing:mean');
  assert.match(housing.limitations, /standard error: not published; coefficient of variation: not published\./);
  assert.equal(by('ce:us:2025:allcu:housing:se'), undefined, 'a suppressed (blank) SE stores nothing, never 0');
  assert.equal(by('ce:us:2025:allcu:housing:cv'), undefined, 'unreadable text stores nothing');
  assert.deepEqual([by('ce:us:2025:allcu:education:mean').value, by('ce:us:2025:allcu:education:se').value], [0, 0], 'a published zero is stored');
  assert.equal(by('ce:us:2025:allcu:education:cv'), undefined);
  assert.ok(!rows.some(x => x.source_observation_key.includes('healthcare')), 'a category the table lacks stores nothing');
  assert.ok(!rows.some(x => x.value === 4000 || x.value === 7100), 'neither Food at home nor the Urban column is read as Food');
  assert.ok(rows.every(x => x.published_at === '2025-09-24T13:30:00.000Z' && x.vintage === '2025-09-24T13:30:00.000Z'));
  const again = await ingestBlsConsumerExpenditure(w.env, ASK);
  assert.deepEqual([again.status, again.rows_inserted, again.rows_unchanged], ['succeeded', 0, 12]);
  assert.equal(w.stored().length, 12);
});

test('a revised standard error adds a revision of the SE and of the mean that cites it, and nothing else', async t => {
  const w = await world(t);
  await ingestBlsConsumerExpenditure(w.env, { year: 2025, items: ['food'] });
  const revised = GRID.map(r => (r[0] === 'SE' && r[1] === 90 ? ['SE', 95, 95] : r));
  w.serve(async () => new Response(workbook(revised), { headers: { 'last-modified': REVISED } }));
  const r = await ingestBlsConsumerExpenditure(w.env, { year: 2025, items: ['food'] });
  assert.deepEqual([r.rows_inserted, r.rows_unchanged], [2, 1]);
  const means = w.stored().filter(x => x.source_observation_key === 'ce:us:2025:allcu:food:mean');
  assert.deepEqual(means.map(x => x.value), [7000, 7000]);
  assert.match(means[1].limitations, /standard error: 95 USD/);
  assert.equal(means[1].supersedes_observation_id, means[0].id);
});

test('a provider or layout failure records a failed run with only its class and keeps every earlier row', async t => {
  const w = await world(t);
  await ingestBlsConsumerExpenditure(w.env, { year: 2025, items: ['food'] });
  const kept = w.stored().length;
  const zero = { not_published: 0, suppressed: 0, unknown_cell: 0 };
  for (const [reply, failure] of [
    [async () => new Response('gone', { status: 404 }), 'provider_http HTTP 404'],
    [async () => new Response('not a zip'), 'provider_payload'],
    [async () => new Response(buildZip([{ name: 'xl/worksheets/sheet2.xml', content: '<worksheet/>' }])), 'provider_payload'],
    [async () => new Response(workbook(GRID.filter(r => r[1] !== 'All consumer units'))), 'provider_payload'],
    [async () => new Response(workbook([...GRID, ['Food', null, null]])), 'provider_payload'],
    [async () => new Response(workbook(GRID.flatMap(r => (r[0] === 'SE' && r[1] === 90 ? [r, r] : [r])))), 'provider_payload'],
    [async () => new Response(workbook(GRID.map(r => (r[1] === 7000 ? ['Mean', { error: '#N/A' }, 1] : r)))), 'provider_payload'],
    [async () => new Response('x', { headers: { 'content-length': String(3_000_000) } }), 'provider_payload HTTP 200'],
  ] as const) {
    w.serve(reply);
    const r = await ingestBlsConsumerExpenditure(w.env, { year: 2025, items: ['food'] });
    assert.deepEqual([r.status, r.failure, r.rows_inserted, r.skipped], ['failed', failure, 0, zero]);
  }
  assert.equal(w.stored().length, kept, 'last good values are kept');
});

test('labels, cell types and a missing Last-Modified read as the reader defines them', async () => {
  assert.deepEqual(['Food', ' Food  at  home ', 'Apparel and services ....', 'Healthcare (a)', 'Education b/', 'CV(%)'].map(label),
    ['Food', 'Food at home', 'Apparel and services', 'Healthcare', 'Education', 'CV(%)']);
  const grid = sheetRows('<row r="1"><c r="B1" t="str"><v>R&amp;D</v></c><c r="C1"><v>1.5E3</v></c><c r="D1"/></row><row r="2"/>', []);
  assert.deepEqual([grid.length, 0 in grid[0], grid[0][1], grid[0][2], grid[0][3], grid[1].length], [2, false, { s: 'R&D' }, { n: 1500 }, null, 0]);
  assert.throws(() => sheetRows('<row><c r="A1" t="s"><v>3</v></c></row>', ['only one']), (e: any) => e.kind === 'provider_payload');
  assert.throws(() => sheetRows('<row><c r="A1"><v>12,5</v></c></row>', []), (e: any) => e.kind === 'provider_payload');
  const skipped = { not_published: 0, suppressed: 0, unknown_cell: 0 };
  const noDate = await ceRows(await workbookGrid(workbook(GRID)), ceParams({ year: 2025, items: ['food'] }), null, skipped);
  assert.ok(noDate.rows.length === 3 && noDate.rows.every(r => r.published_at === null && /^content-sha256:[0-9a-f]{64}$/.test(r.vintage)));
});
