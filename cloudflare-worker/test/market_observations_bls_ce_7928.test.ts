/**
 * D7928 (#7928): the BLS Consumer Expenditure importer, over every migration and real SQLite, with no network. Every
 * workbook here is invented: a few categories with made-up means, standard errors and relative standard errors, laid
 * out the way the real calendar-year Table 1721 is (D7928-p2: label row, then Mean / Share / SE / RSE rows; footnote
 * markers in withheld cells; a caution letter in a number format; the legend under the table). No real BLS value is
 * committed.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  BLS_USER_AGENT, CE_CAUTION, ceParams, ceRows, ceTableUrl, cellMarks, CE_ITEMS, CE_LIMITATIONS, footnotes, ingestBlsConsumerExpenditure, label,
  LAST_YEAR, sheetRows, SOURCE_ID, workbookGrid,
} from '../src/services/marketObservations/blsConsumerExpenditure.ts';
import { IMPORTERS } from '../src/services/marketObservations/importers.ts';
import { buildZip } from '../src/util/zip.ts';

const NOW = Date.parse('2026-11-27T05:00:00Z');
const MODIFIED = 'Wed, 24 Sep 2025 13:30:00 GMT', REVISED = 'Thu, 15 Jan 2026 13:30:00 GMT';

type Fx = string | number | { n: number; mark: 'b' | 'a' } | { inline: string } | { str: string } | { error: string } | null;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Style 0 plain, 1 for empty cells, 2 prints `123 b/` (BLS's escaped form), 3 prints `123 a/` (the quoted form). */
const STYLES = '<?xml version="1.0"?><styleSheet><numFmts count="2">'
  + `<numFmt numFmtId="169" formatCode="${esc('# \\b\\/;-# \\b\\/')}"/><numFmt numFmtId="170" formatCode="${esc('#,# "a/"')}"/></numFmts>`
  + '<cellXfs count="4"><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="1"/><xf numFmtId="169" fontId="0"/><xf numFmtId="170" fontId="0"/></cellXfs></styleSheet>';
/** An invented workbook: shared strings for most text, an inline string and a formula string where a row says so. */
function workbook(grid: Fx[][], { styles = STYLES as string | null } = {}): Uint8Array {
  const strings: string[] = [];
  const sheet = grid.map((row, r) => `<row r="${r + 1}">` + row.map((v, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    if (v === null) return `<c r="${ref}" s="1"/>`;
    if (typeof v === 'number') return `<c r="${ref}" s="0" t="n"><v>${v}</v></c>`;
    if (typeof v === 'string') { strings.push(v); return `<c r="${ref}" s="0" t="s"><v>${strings.length - 1}</v></c>`; }
    if ('n' in v) return `<c r="${ref}" s="${v.mark === 'b' ? 2 : 3}" t="n"><v>${v.n}</v></c>`;
    if ('inline' in v) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v.inline)}</t></is></c>`;
    if ('str' in v) return `<c r="${ref}" t="str"><f>A1</f><v>${esc(v.str)}</v></c>`;
    return `<c r="${ref}" t="e"><v>${v.error}</v></c>`;
  }).join('') + '</row>').join('');
  return buildZip([
    { name: 'xl/sharedStrings.xml', content: `<?xml version="1.0"?><sst count="${strings.length}">${strings.map(s => `<si><t>${esc(s)}</t></si>`).join('')}</sst>` },
    ...(styles === null ? [] : [{ name: 'xl/styles.xml', content: styles }]),
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0"?><worksheet><sheetData>${sheet}</sheetData></worksheet>` },
  ]);
}
const CAUTION_NOTE = 'b Data have a Relative Standard Error (RSE) equal to or greater than 25 percent. These estimates should be used with caution.';
const SMALL_NOTE = 'c Value is too small to display.';
const SUPPRESSED_NOTE = 'd Data are suppressed due to the Relative Standard Error (RSE) being equal to or greater than 25 percent.';
/**
 * Invented table. Housing's SE is withheld (`d/`, suppressed by the legend) and its RSE unreadable text; Apparel's SE
 * carries the caution letter and its RSE cell is blank; Healthcare is absent; Education spent 0 and its RSE is too
 * small to display (`c/`).
 */
const GRID: Fx[][] = [
  ['Table 9999. Type of area: invented test table', null, null],
  ['Item', 'All\nconsumer\nunits', 'Urban'],
  [null, null, 'Total urban'],
  ['Number of consumer units (in thousands) a/ ', 100000, 90000],
  ['Income before taxes', null, null],
  ['Mean', 90000, 91000], ['SE', 1000, 1100], ['RSE', 1.11, 1.21],
  ['Average annual expenditures', null, null],
  ['Mean', 50000.5, 51000], ['SE', 400.25, 410], ['RSE', 0.8, 0.81],
  ['Food', null, null],
  ['Mean', 7000, 7100], ['Share', 14, 14], ['SE', 90, 95], ['RSE', 1.29, 1.3],
  ['Food at home', null, null],
  ['Mean', 4000, 4100], ['Share', 8, 8], ['SE', 60, 61], ['RSE', 1.5, 1.5],
  ['Housing', null, null],
  ['Mean', 18000, 19000], ['Share', 36, 37], ['SE', 'd/', 300], ['RSE', 'n.a.', 1.6],
  [{ inline: 'Apparel and services ........' }, null, null],
  ['Mean', 2000, 2100], ['Share', 4, 4], ['SE', { n: 50, mark: 'b' }, 51], ['RSE', null, 2.4],
  ['Education', null, null],
  ['Mean', 0, 10], ['Share', 'c/', 'c/'], ['SE', 0, 1], ['RSE', 'c/', 10],
  [null, null, null],
  ['a Data are rounded to the nearest thousands.', null, null],
  [CAUTION_NOTE, null, null], [SMALL_NOTE, null, null], [SUPPRESSED_NOTE, null, null],
  ['Source: invented test table', null, null],
];
const ASK = { year: 2025, items: ['total', 'food', 'housing', 'education', 'healthcare', 'apparel'] };
const zeroSkips = () => ({ not_published: 0, suppressed: 0, too_small: 0, unknown_cell: 0 });

async function world(t: TestContext, { enabled = true } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  if (enabled) db.exec(`UPDATE research_market_sources SET enabled=1 WHERE id='${SOURCE_ID}'`);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const env = { ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  let reply: () => Promise<Response> = async () => new Response(workbook(GRID), { headers: { 'last-modified': MODIFIED } });
  const calls: string[] = [], agents: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    calls.push(String(input)); agents.push(new Headers(init?.headers).get('user-agent')); return reply();
  });
  const stored = () => db.prepare('SELECT * FROM research_market_observations ORDER BY id').all() as any[];
  const runs = () => db.prepare('SELECT * FROM research_market_ingestion_runs ORDER BY id').all() as any[];
  return { db, env, calls, agents, stored, runs, serve: (fn: () => Promise<Response>) => { reply = fn; } };
}

test('the importer is registered under its own source and asks for exactly the table of the year', () => {
  assert.deepEqual(Object.keys(IMPORTERS), ['world-bank', 'eurostat-sbs', 'census-cbp', 'bls-ce', 'sec-edgar-facts']);
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

test('the migrations leave one disabled bls-ce source with the verified terms and 27 catalogue rows; a disabled source runs nothing', async t => {
  const w = await world(t, { enabled: false });
  const src = w.db.prepare("SELECT * FROM research_market_sources WHERE id='bls-ce'").get() as any;
  assert.equal(src.enabled, 0, 'no live activation is authorised (#7928)');
  assert.equal(src.export_allowed, null); assert.equal(src.refresh_policy, 'annual');
  assert.match(src.license_or_usage_note, /in the public domain.*read 2026-11-27/);
  assert.doesNotMatch(src.license_or_usage_note, /must be confirmed/);
  assert.match(src.dataset_or_edition, /^Consumer Expenditure Surveys, calendar-year Table 1721/);
  const metrics = w.db.prepare("SELECT metric_key, unit, definition FROM research_market_metrics WHERE source_id='bls-ce'").all() as any[];
  assert.equal(metrics.length, 27);
  for (const item of Object.keys(CE_ITEMS)) for (const [stat, unit] of [['mean', 'USD'], ['se', 'USD'], ['cv', 'percent']])
    assert.ok(metrics.some(m => m.metric_key === `ce_${item}_${stat}` && m.unit === unit), `${item} ${stat}`);
  const cvs = metrics.filter(m => m.metric_key.endsWith('_cv'));
  assert.ok(cvs.length === 9 && cvs.every(m => m.definition.includes('(RSE row: BLS\'s relative standard error)') && !m.definition.includes('CV(%)')));
  await assert.rejects(ingestBlsConsumerExpenditure(w.env, ASK), (e: any) => e.code === 'source_disabled');
  assert.equal(w.calls.length, 0); assert.equal(w.runs().length, 0); assert.equal(w.stored().length, 0);
});

test('an import stores each mean with its published SE and RSE; withheld cells store nothing by the legend; a re-run adds nothing', async t => {
  const w = await world(t);
  const r = await ingestBlsConsumerExpenditure(w.env, ASK);
  assert.deepEqual(w.calls, [ceTableUrl(2025)]);
  assert.deepEqual(w.agents, [BLS_USER_AGENT], 'bls.gov refuses a download that does not identify its owner');
  assert.match(BLS_USER_AGENT, /^Axal StudioOS .*@axal\.vc\)$/);
  assert.deepEqual([r.status, r.rows_seen, r.rows_inserted, r.caution], ['succeeded', 18, 11, 1]);
  assert.deepEqual(r.skipped, { not_published: 3, suppressed: 1, too_small: 1, unknown_cell: 2 });
  const rows = w.stored(), by = (key: string) => rows.find(x => x.source_observation_key === key);
  const mean = by('ce:us:2025:allcu:food:mean'), se = by('ce:us:2025:allcu:food:se'), cv = by('ce:us:2025:allcu:food:cv');
  assert.deepEqual([mean.value, mean.unit, mean.scale, mean.currency, mean.price_basis, mean.statistical_unit, mean.geography_type, mean.geography_code, mean.period, mean.observation_status],
    [7000, 'USD', 'units', 'USD', 'current_prices', 'consumer_unit', 'country', 'USA', '2025', 'estimate']);
  assert.deepEqual([se.metric_key, se.value, se.unit, se.currency], ['ce_food_se', 90, 'USD', 'USD']);
  assert.deepEqual([cv.metric_key, cv.value, cv.unit, cv.currency, cv.price_basis], ['ce_food_cv', 1.29, 'percent', null, 'not_applicable']);
  assert.equal(mean.limitations, CE_LIMITATIONS + ' Published standard error: 90 USD; relative standard error (coefficient of variation): 1.29 percent.');
  assert.match(se.limitations, /standard error of the mean for Food, not a spending value\.$/);
  assert.equal(mean.series_id, 'CE.US.ALLCU.FOOD.MEAN');
  assert.deepEqual([mean.industry_scheme, mean.industry_code, mean.size_band], [null, null, null]);
  assert.equal(by('ce:us:2025:allcu:total:mean').value, 50000.5, 'values as published, never rounded');
  assert.equal(by('ce:us:2025:allcu:total:cv').value, 0.8, 'the RSE row is the CV');
  const housing = by('ce:us:2025:allcu:housing:mean');
  assert.match(housing.limitations, /standard error: not published; relative standard error \(coefficient of variation\): not published\./);
  assert.equal(by('ce:us:2025:allcu:housing:se'), undefined, 'a suppressed SE stores nothing, never 0');
  assert.equal(by('ce:us:2025:allcu:housing:cv'), undefined, 'unreadable text stores nothing');
  const apparelSe = by('ce:us:2025:allcu:apparel:se');
  assert.equal(by('ce:us:2025:allcu:apparel:mean').value, 2000, 'a label with leader dots, in an inline string, is still its item');
  assert.equal(apparelSe.value, 50, 'a value BLS flags for caution is still its published value');
  assert.ok(apparelSe.limitations.endsWith(' ' + CE_CAUTION), 'and says it is flagged');
  assert.ok(!by('ce:us:2025:allcu:apparel:mean').limitations.includes(CE_CAUTION), 'only the flagged cell carries the flag');
  assert.equal(by('ce:us:2025:allcu:apparel:cv'), undefined, 'a blank value cell stores nothing');
  assert.deepEqual([by('ce:us:2025:allcu:education:mean').value, by('ce:us:2025:allcu:education:se').value], [0, 0], 'a published zero is stored');
  assert.equal(by('ce:us:2025:allcu:education:cv'), undefined, 'too small to display stores nothing, never 0');
  assert.ok(!rows.some(x => x.source_observation_key.includes('healthcare')), 'a category the table lacks stores nothing');
  assert.ok(!rows.some(x => [4000, 7100, 90000].includes(x.value)), 'neither Food at home, Income nor the Urban column is read as an item');
  assert.ok(rows.every(x => x.published_at === '2025-09-24T13:30:00.000Z' && x.vintage === '2025-09-24T13:30:00.000Z'));
  const again = await ingestBlsConsumerExpenditure(w.env, ASK);
  assert.deepEqual([again.status, again.rows_inserted, again.rows_unchanged], ['succeeded', 0, 11]);
  assert.equal(w.stored().length, 11);
});

test('a footnote letter means what the table\'s own legend says, which changes between years', async () => {
  const p = ceParams({ year: 2023, items: ['education'] });
  // The 2023 tables printed `c` for suppressed; from 2024 `c` is too small to display. The same cell reads both ways.
  const year2023 = GRID.map(r => (r[0] === SMALL_NOTE ? ['c Data are suppressed due to the RSE being equal to or greater than 25 percent.', null, null]
    : r[0] === SUPPRESSED_NOTE ? ['d Value is too small to display.', null, null] : r));
  const a = zeroSkips(), b = zeroSkips();
  await ceRows(await workbookGrid(workbook(year2023)), p, null, a);
  await ceRows(await workbookGrid(workbook(GRID)), p, null, b);
  assert.deepEqual([a.suppressed, a.too_small, b.suppressed, b.too_small], [1, 0, 0, 1]);
  // A marker or a number-format letter the legend does not explain stores nothing.
  const unexplained = zeroSkips();
  const odd = GRID.map(r => (r[0] === 'Mean' && r[1] === 0 ? ['Mean', { n: 5, mark: 'a' }, 10] : r[0] === 'SE' && r[1] === 0 ? ['SE', 'e/', 1] : r));
  const read = await ceRows(await workbookGrid(workbook(odd)), p, null, unexplained);
  assert.deepEqual([read.rows.length, unexplained.unknown_cell, unexplained.too_small], [0, 2, 1]);
  // Without the legend line, the caution letter is unexplained too.
  const noLegend = zeroSkips(), cautioned = { count: 0 };
  const apparel = await ceRows(await workbookGrid(workbook(GRID.filter(r => r[0] !== CAUTION_NOTE))), ceParams({ year: 2025, items: ['apparel'] }), null, noLegend, cautioned);
  assert.deepEqual([apparel.rows.map(x => x.metric_key), noLegend.unknown_cell, cautioned.count], [['ce_apparel_mean'], 2, 0]);
  assert.deepEqual(Object.fromEntries(footnotes(await workbookGrid(workbook(GRID)))), { a: 'other', b: 'caution', c: 'too_small', d: 'suppressed' });
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
  for (const [reply, failure] of [
    [async () => new Response('gone', { status: 404 }), 'provider_http HTTP 404'],
    [async () => new Response('not a zip'), 'provider_payload'],
    [async () => new Response(buildZip([{ name: 'xl/worksheets/sheet2.xml', content: '<worksheet/>' }])), 'provider_payload'],
    [async () => new Response(workbook(GRID.filter(r => r[1] !== 'All\nconsumer\nunits'))), 'provider_payload'],
    [async () => new Response(workbook([...GRID, ['Food', null, null]])), 'provider_payload'],
    [async () => new Response(workbook(GRID.flatMap(r => (r[0] === 'SE' && r[1] === 90 ? [r, r] : [r])))), 'provider_payload'],
    [async () => new Response(workbook(GRID.map(r => (r[1] === 7000 ? ['Mean', { error: '#N/A' }, 1] : r)))), 'provider_payload'],
    // The layout guessed before bls.gov could be read: a `CV(%)` row is not the RSE row, so no item is complete.
    [async () => new Response(workbook(GRID.map(r => (r[0] === 'RSE' ? ['CV(%)', ...r.slice(1)] : r)))), 'provider_payload'],
    [async () => new Response(workbook(GRID.filter(r => !(r[0] === 'SE' && r[1] === 90)))), 'provider_payload'],
    [async () => new Response(workbook([...GRID, [SMALL_NOTE, null, null]])), 'provider_payload'],
    [async () => new Response(workbook(GRID, { styles: STYLES.replace(/<xf numFmtId="1[67]\d"[^>]*\/>/g, '').replace('count="4"', 'count="2"') })), 'provider_payload'],
    [async () => new Response('x', { headers: { 'content-length': String(3_000_000) } }), 'provider_payload HTTP 200'],
  ] as const) {
    w.serve(reply);
    const r = await ingestBlsConsumerExpenditure(w.env, { year: 2025, items: ['food'] });
    assert.deepEqual([r.status, r.failure, r.rows_inserted, r.skipped, r.caution], ['failed', failure, 0, zeroSkips(), 0]);
  }
  assert.equal(w.stored().length, kept, 'last good values are kept');
});

test('labels, cell types, styles and a missing Last-Modified read as the reader defines them', async () => {
  assert.deepEqual(['Food', ' Food  at  home ', 'Apparel and services ....', 'Healthcare (a)', 'Education b/', 'All\nconsumer\nunits'].map(label),
    ['Food', 'Food at home', 'Apparel and services', 'Healthcare', 'Education', 'All consumer units']);
  const grid = sheetRows('<row r="1"><c r="B1" t="str"><v>R&amp;D</v></c><c r="C1"><v>1.5E3</v></c><c r="D1"/></row><row r="2"/>', []);
  assert.deepEqual([grid.length, 0 in grid[0], grid[0][1], grid[0][2], grid[0][3], grid[1].length], [2, false, { s: 'R&D' }, { n: 1500 }, null, 0]);
  assert.throws(() => sheetRows('<row><c r="A1" t="s"><v>3</v></c></row>', ['only one']), (e: any) => e.kind === 'provider_payload');
  assert.throws(() => sheetRows('<row><c r="A1"><v>12,5</v></c></row>', []), (e: any) => e.kind === 'provider_payload');
  assert.deepEqual(cellMarks(STYLES), [null, null, 'b', 'a']);
  assert.deepEqual(cellMarks('<cellXfs><xf numFmtId="9"/><xf numFmtId="200"/></cellXfs><numFmts><numFmt numFmtId="200" formatCode="# \\b\\/ \\c\\/"/></numFmts>'), [null, '?']);
  assert.deepEqual(sheetRows('<row><c r="A1" s="2" t="n"><v>7</v></c><c r="B1" s="0"><v>8</v></c></row>', [], cellMarks(STYLES))[0], [{ n: 7, mark: 'b' }, { n: 8 }]);
  assert.throws(() => sheetRows('<row><c r="A1" s="4" t="n"><v>7</v></c></row>', [], cellMarks(STYLES)), (e: any) => e.kind === 'provider_payload');
  const unstyled = await workbookGrid(workbook(GRID, { styles: null }));
  assert.ok(unstyled.flat().every(c => !(c && 'mark' in c)), 'a workbook without styles has no marked number');
  const skipped = zeroSkips();
  const noDate = await ceRows(await workbookGrid(workbook(GRID)), ceParams({ year: 2025, items: ['food'] }), null, skipped);
  assert.ok(noDate.rows.length === 3 && noDate.rows.every(r => r.published_at === null && /^content-sha256:[0-9a-f]{64}$/.test(r.vintage)));
});
