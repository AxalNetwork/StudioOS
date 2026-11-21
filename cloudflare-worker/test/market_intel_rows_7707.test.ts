/**
 * D7707 (#7707) — a stored market-intelligence statistic says which period it
 * measures, when the provider last updated it and when it was fetched, and
 * each run of a live source leaves a record an operator can read.
 *
 * On real SQLite (migrations 030, 379 and 7707). The provider responses are
 * recorded inline, in each API's documented shape, as the D538 test does:
 * this sandbox cannot reach the providers.
 *
 *   1. World Bank, OECD and Eurostat rows carry the period their response
 *      names, the provider's own last-updated date (never the fetch time),
 *      `scope = 'context'` and their coverage area; Crossref, OpenAlex and
 *      arXiv rows carry the window queried and `scope = 'sector'`.
 *   2. A response with no readable period stores a null period.
 *   3. For the same responses the rows stored, and each row's ts, metric_key,
 *      metric_value and geo, are what main stores, so no index value changes.
 *   4. A live source writes one run row; a failing one writes a failed row
 *      with an error class from the fixed list and removes nothing; a source
 *      that is off writes none; no run row holds provider text or a URL; a run
 *      row that cannot be written stops nothing.
 *   5. liveRows.ts reads a row's retrieval time and counts distinct observations.
 *   6. The health route answers an HQ admin and refuses anyone else and a branch.
 *   7. schema.ts declares what the migration declares.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/market_intel_rows_7707.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { runSourcesByCadence, classifyRunError, SECTORS } from '../src/services/market_intel/aggregator.ts';
import {
  retrievedAtSql, retrievedAt, observationKeySql, distinctObservationsSql, countDistinctObservations,
  liveRowSql, STUB_CITATION_PREFIX,
} from '../src/services/market_intel/liveRows.ts';
import { normalisePeriod, windowPeriod, publishedDate } from '../src/services/market_intel/sources/_live.ts';
import { eurostatValuePeriod } from '../src/services/market_intel/sources/eurostat.ts';
import { oecdObservationPeriod } from '../src/services/market_intel/sources/oecd.ts';
import { listSources } from '../src/services/market_intel/registry.ts';
import { ensureMarketIntelSchema } from '../src/services/market_intel/schema.ts';
import '../src/services/market_intel/sources/index.ts';
import healthRoutes, { mount, NO_RUN_REASON, NO_PERIOD_REASON } from '../src/routes/admin_market_intel_health.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = '../sql/migrations/202611191833_7707_market_intel_row_dates_runs.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, FOUNDER = 2;
const DAY = 86_400_000;
// The clock is pinned (D5614): every fetch time, window and retrieval date below is this instant's.
const NOW = Date.parse('2026-11-19T12:00:00.000Z');
mock.timers.enable({ apis: ['Date'], now: NOW });
type Db = InstanceType<typeof DatabaseSync>;

function fixture(withMigration = true): Db {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
  `);
  db.exec(readFileSync(resolve(here, '../sql/migrations/030_market_intel.sql'), 'utf8'));
  db.exec(readFileSync(resolve(here, '../sql/migrations/379_market_intel_index_basis.sql'), 'utf8'));
  if (withMigration) db.exec(readFileSync(resolve(here, MIGRATION), 'utf8'));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Ada', 'ada@axal.example')`).run(ADMIN);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fen', 'fen@axal.example')`).run(FOUNDER);
  return db;
}

function kv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

function envFor(db: Db, extra: Record<string, string> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db), RATE_LIMITS: kv(), ...extra } as any;
}

const MACRO = { MI_FLAG_WORLD_BANK: 'live', MI_FLAG_OECD: 'live', MI_FLAG_EUROSTAT: 'live' };
const RESEARCH = { MI_FLAG_OPENALEX: 'live', MI_FLAG_CROSSREF: 'live', MI_FLAG_ARXIV: 'live' };

/* ------------------------------------------------------------------ */
/* Recorded responses                                                  */
/* ------------------------------------------------------------------ */

const OECD_DIMS = [
  { id: 'REF_AREA', values: [{ id: 'OECD' }] },
  { id: 'FREQ', values: [{ id: 'A' }] },
  { id: 'MEASURE', values: [{ id: 'G' }] },
  { id: 'UNIT_MEASURE', values: [{ id: 'PT_B1GQ' }] },
  { id: 'PRICE_BASE', values: [{ id: '_Z' }] },
  { id: 'TRANSFORMATION', values: [{ id: '_Z' }] },
  { id: 'TIME_PERIOD', role: 'time', values: [{ id: '2022' }, { id: '2023' }] },
];

const RECORDED: Record<string, () => unknown> = {
  'api.worldbank.org': () => [
    { page: 1, pages: 1, per_page: 1, total: 1, sourceid: '2', lastupdated: '2026-07-01' },
    [{ indicator: { id: 'NE.GDI.TOTL.ZS', value: 'Gross capital formation (% of GDP)' },
       country: { id: '1W', value: 'World' }, countryiso3code: 'WLD', date: '2025', value: 25, unit: '', obs_status: '', decimal: 1 }],
  ],
  // The observation sits at position 1 of TIME_PERIOD: 2023, not the first year listed.
  'sdmx.oecd.org': () => ({
    data: {
      dataSets: [{ action: 'Information', observations: { '0:0:0:0:0:0:1': [2.7] } }],
      structures: [{ dimensions: { observation: OECD_DIMS } }],
    },
  }),
  // Value keys are sparse: key 2 is 2023 even though 2024 is listed (with no value).
  'ec.europa.eu': () => ({
    version: '2.0', class: 'dataset', label: 'Gross domestic expenditure on R&D (GERD)',
    id: ['freq', 'unit', 'sectperf', 'geo', 'time'],
    size: [1, 1, 1, 1, 4],
    value: { '0': 2.2, '2': 2.4 },
    updated: '2026-03-28T23:00:00+0100',
    dimension: { time: { category: { index: { '2021': 0, '2022': 1, '2023': 2, '2024': 3 } } } },
  }),
  'api.openalex.org': () => ({ meta: { count: 1500 }, results: [{ id: 'https://openalex.org/W4400000001' }] }),
  'api.crossref.org': () => ({ status: 'ok', message: { 'total-results': 800, items: [{ DOI: '10.1000/recorded.2026.1' }] } }),
  'export.arxiv.org': () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>150</opensearch:totalResults>
  <entry><id>http://arxiv.org/abs/2610.00001v1</id><title>A recorded preprint</title></entry>
</feed>`,
};

/** The same responses with no readable period anywhere. */
const NO_PERIOD: Record<string, () => unknown> = {
  'api.worldbank.org': () => [{ page: 1 }, [{ date: 'n/a', value: 25 }]],
  'sdmx.oecd.org': () => ({ data: { dataSets: [{ observations: { '0:0:0:0:0:0:0': [2.7] } }] } }),
  'ec.europa.eu': () => ({ value: { '0': 2.2, '1': 2.24, '2': 2.4 }, id: ['freq', 'unit', 'sectperf', 'geo', 'time'] }),
};

function withResponses<T>(table: Record<string, () => unknown>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const r = table[url.hostname] ?? RECORDED[url.hostname];
    if (!r) throw new Error(`unrecorded host ${url.hostname}`);
    const body = r();
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  }) as any;
  return fn().finally(() => { globalThis.fetch = real; });
}

function withFetch<T>(impl: (input: any) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl as any;
  return fn().finally(() => { globalThis.fetch = real; });
}

const rowsOf = (db: Db, key: string) =>
  db.prepare('SELECT * FROM market_intel_rows WHERE source_key = ? ORDER BY id').all(key) as any[];
const runsOf = (db: Db) => db.prepare('SELECT * FROM market_intel_source_runs ORDER BY id').all() as any[];
const today = () => '2026-11-19';

/* ------------------------------------------------------------------ */
/* 1–3. What a stored row measures, and what stays as on main          */
/* ------------------------------------------------------------------ */

/** What main stores for these responses: its formulas, with the same inputs (D538's EXPECT). */
const MAIN: Record<string, { metric_key: string; metric_value: number; raw: number }> = {
  world_bank: { metric_key: 'capital', metric_value: 0.5, raw: 25 },     // clamp01(25 / 50)
  oecd:       { metric_key: 'capital', metric_value: 0.45, raw: 2.7 },   // clamp01(2.7 / 6)
  eurostat:   { metric_key: 'capital', metric_value: 0.4, raw: 2.4 },    // clamp01(2.4 / 6), the last value
  openalex:   { metric_key: 'research', metric_value: 0.5, raw: 1500 },  // saturate(1500, 1500)
  crossref:   { metric_key: 'research', metric_value: 0.5, raw: 800 },   // saturate(800, 800)
  arxiv:      { metric_key: 'research', metric_value: 0.5, raw: 150 },   // saturate(150, 150)
};

async function runAll(db: Db) {
  const before = NOW;
  const env = envFor(db, { ...MACRO, ...RESEARCH });
  await withResponses({}, async () => {
    await runSourcesByCadence(env, 'weekly');
    await runSourcesByCadence(env, 'daily');
  });
  return { before, after: NOW };
}

test('world_bank: a 2025 value fetched today is stored with period 2025, today as its retrieval date and the provider\'s last-updated date', async () => {
  const db = fixture();
  const { before, after } = await runAll(db);
  const rows = rowsOf(db, 'world_bank');
  assert.equal(rows.length, SECTORS.length);
  for (const r of rows) {
    assert.equal(r.observed_period, '2025');
    assert.equal(r.observed_period_end, '2025-12-31');
    assert.equal(r.published_at, '2026-07-01', 'the header\'s lastupdated');
    assert.equal(r.retrieved_at.slice(0, 10), today());
    assert.ok(Date.parse(r.retrieved_at) >= before && Date.parse(r.retrieved_at) <= after);
    assert.equal(r.scope, 'context');
    assert.equal(r.coverage_area, 'World');
    assert.deepEqual(JSON.parse(r.payload_json), { series: 'NE.GDI.TOTL.ZS', series_name: 'Gross capital formation (% of GDP)', divisor: 50 });
  }
});

test('oecd and eurostat: each row carries the year its response names, from the key of the value stored', async () => {
  const db = fixture();
  await runAll(db);
  for (const r of rowsOf(db, 'oecd')) {
    assert.deepEqual([r.observed_period, r.observed_period_end], ['2023', '2023-12-31'], 'OECD: TIME_PERIOD position 1');
    assert.equal(r.published_at, null, 'OECD sends no publication date; the fetch time is never one');
    assert.deepEqual([r.scope, r.coverage_area], ['context', 'OECD aggregate']);
    assert.equal(JSON.parse(r.payload_json).divisor, 6);
  }
  for (const r of rowsOf(db, 'eurostat')) {
    assert.deepEqual([r.observed_period, r.observed_period_end], ['2023', '2023-12-31'], 'Eurostat: the time index of key 2, not the last year listed');
    assert.equal(r.published_at, '2026-03-28T22:00:00.000Z', 'the response\'s updated');
    assert.deepEqual([r.scope, r.coverage_area], ['context', 'EU27']);
  }
  assert.equal(rowsOf(db, 'oecd').length + rowsOf(db, 'eurostat').length, 2 * SECTORS.length);
});

test('crossref, openalex and arxiv: each row carries the window queried, to the day, and is tagged sector', async () => {
  const db = fixture();
  await runAll(db);
  const from = '2026-10-20';
  for (const key of ['crossref', 'openalex', 'arxiv']) {
    const rows = rowsOf(db, key);
    assert.equal(rows.length, SECTORS.length, key);
    for (const r of rows) {
      assert.equal(r.observed_period, `${from}/${today()}`, key);
      assert.equal(r.observed_period_end, today(), key);
      assert.equal(r.published_at, null, `${key}: no publication date, and never the fetch time`);
      assert.equal(r.scope, 'sector', key);
      assert.equal(r.coverage_area, null, key);
    }
  }
});

test('a response with no readable period stores the row with a null period, never a guessed one', async () => {
  const db = fixture();
  await withResponses(NO_PERIOD, () => runSourcesByCadence(envFor(db, MACRO), 'weekly'));
  for (const key of ['world_bank', 'oecd', 'eurostat']) {
    const rows = rowsOf(db, key);
    assert.equal(rows.length, SECTORS.length, `${key} still stores its rows`);
    for (const r of rows) {
      assert.equal(r.observed_period, null, key);
      assert.equal(r.observed_period_end, null, key);
      assert.equal(r.published_at, null, `${key}: no last-updated date sent, none stored`);
      assert.notEqual(r.retrieved_at, null);
    }
  }
});

test('the rows stored, and each row\'s ts, metric_key, metric_value and geo, are what main stores', async () => {
  const db = fixture();
  const { before, after } = await runAll(db);
  for (const [key, e] of Object.entries(MAIN)) {
    const rows = rowsOf(db, key);
    assert.equal(rows.length, SECTORS.length, `${key}: one row per sector, as on main`);
    assert.deepEqual(rows.map((r) => r.sector).sort(), SECTORS.slice().sort());
    for (const r of rows) {
      assert.equal(r.metric_key, e.metric_key, key);
      assert.ok(Math.abs(r.metric_value - e.metric_value) < 1e-9, `${key} metric_value ${r.metric_value}`);
      assert.equal(r.raw_value, e.raw, key);
      assert.equal(r.geo, 'global', key);
      // ts is still the fetch time, as on main, and retrieved_at is the same instant.
      assert.ok(Date.parse(r.ts) >= before && Date.parse(r.ts) <= after, `${key} ts ${r.ts}`);
      assert.equal(r.retrieved_at, r.ts, key);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Period readers                                                      */
/* ------------------------------------------------------------------ */

test('normalisePeriod, windowPeriod and publishedDate: the stored formats, and null for what cannot be read', () => {
  assert.deepEqual(normalisePeriod('2025'), { observed_period: '2025', observed_period_end: '2025-12-31' });
  assert.deepEqual(normalisePeriod('2025Q3'), { observed_period: '2025-Q3', observed_period_end: '2025-09-30' });
  assert.deepEqual(normalisePeriod('2024-Q1'), { observed_period: '2024-Q1', observed_period_end: '2024-03-31' });
  assert.deepEqual(normalisePeriod('2024M02'), { observed_period: '2024-02', observed_period_end: '2024-02-29' });
  assert.deepEqual(normalisePeriod('2025-07'), { observed_period: '2025-07', observed_period_end: '2025-07-31' });
  assert.deepEqual(normalisePeriod('2025-07-04'), { observed_period: '2025-07-04/2025-07-04', observed_period_end: '2025-07-04' });
  for (const bad of ['', 'n/a', '2025-13', '2025Q5', '25', null, undefined, {}]) {
    assert.equal(normalisePeriod(bad as any), null, `${String(bad)} is not a period`);
  }
  assert.deepEqual(windowPeriod('2026-10-20', '2026-11-19'), { observed_period: '2026-10-20/2026-11-19', observed_period_end: '2026-11-19' });
  assert.equal(windowPeriod('2026-11-19', '2026-10-20'), null);
  assert.equal(publishedDate('2026-07-01'), '2026-07-01');
  assert.equal(publishedDate('2026-03-28T23:00:00+0100'), '2026-03-28T22:00:00.000Z');
  assert.equal(publishedDate('soon'), null);
  assert.equal(publishedDate(undefined), null);
});

test('eurostat and oecd period readers: the position of the value\'s own key, or null', () => {
  const j: any = RECORDED['ec.europa.eu']();
  assert.equal(eurostatValuePeriod(j, '2')?.observed_period, '2023');
  assert.equal(eurostatValuePeriod(j, '0')?.observed_period, '2021');
  assert.equal(eurostatValuePeriod({ ...j, dimension: { time: { category: { index: ['2021', '2022', '2023', '2024'] } } } }, '3')?.observed_period, '2024');
  // A time dimension that is not last: stride is the product of the sizes after it.
  const twoGeo = { id: ['time', 'geo'], size: [3, 2], dimension: { time: { category: { index: { '2021': 0, '2022': 1, '2023': 2 } } } } };
  assert.equal(eurostatValuePeriod(twoGeo as any, '5')?.observed_period, '2023');
  assert.equal(eurostatValuePeriod(twoGeo as any, '2')?.observed_period, '2022');
  assert.equal(eurostatValuePeriod({ value: { '0': 1 } } as any, '0'), null);
  const o: any = (RECORDED['sdmx.oecd.org']() as any).data;
  assert.equal(oecdObservationPeriod(o, '0:0:0:0:0:0:1')?.observed_period, '2023');
  assert.equal(oecdObservationPeriod(o, '0:0:0:0:0:0:0')?.observed_period, '2022');
  assert.equal(oecdObservationPeriod(o, '0:0:1'), null, 'a key that does not fit the structure');
  assert.equal(oecdObservationPeriod({}, '0:0:0:0:0:0:0'), null);
});

/* ------------------------------------------------------------------ */
/* 4. The run record                                                   */
/* ------------------------------------------------------------------ */

test('a run of a live source writes one run row with rows seen and inserted; a source that is off writes none', async () => {
  const db = fixture();
  await withResponses({}, () => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live' }), 'daily'));
  const runs = runsOf(db);
  assert.equal(runs.length, 1, `only the live source left a run row: ${runs.map((r) => r.source_key)}`);
  const r = runs[0];
  assert.deepEqual(
    [r.source_key, r.outcome, r.reason, r.rows_seen, r.rows_inserted, r.rows_unchanged, r.error_class],
    ['openalex', 'fetched', null, SECTORS.length, SECTORS.length, null, null],
  );
  assert.ok(r.started_at <= r.finished_at);
  assert.ok(listSources().filter((s) => s.cadence === 'daily').length > 1, 'other daily sources ran, off');
});

test('production with every source off: no run row at all', async () => {
  const db = fixture();
  for (const cad of ['hourly', 'daily', 'weekly'] as const) await runSourcesByCadence(envFor(db), cad);
  assert.equal(runsOf(db).length, 0);
});

test('a failing provider writes a failed run row with an error class from the fixed list, and removes nothing', async () => {
  const db = fixture();
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url)
     VALUES ('openalex', ?, 'global', 'research', 0.6, 'count', ?, 'https://openalex.org/W1')`,
  ).run(SECTORS[0], new Date(NOW - DAY).toISOString());
  await withFetch(async () => new Response('down for maintenance', { status: 503 }),
    () => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live' }), 'daily'));
  const [r] = runsOf(db);
  assert.deepEqual([r.outcome, r.reason, r.error_class, r.rows_seen, r.rows_inserted], ['failed', 'fetch_failed', 'http_503', 0, 0]);
  assert.equal(rowsOf(db, 'openalex').length, 1, 'the row stored before the failure is still there');
});

test('no run row holds provider text or a URL', async () => {
  const db = fixture();
  const SECRET = 'provider says: see https://api.openalex.org/works?filter=x for details';
  await withFetch(async () => { throw new Error(SECRET); },
    () => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live', MI_FLAG_CROSSREF: 'live' }), 'daily'));
  await withFetch(async () => new Response('<html>not json</html>', { status: 200 }),
    () => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live' }), 'daily'));
  const runs = runsOf(db);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.error_class), ['other', 'other', 'unreadable_response']);
  for (const r of runs) {
    for (const [col, v] of Object.entries(r)) {
      if (typeof v !== 'string') continue;
      assert.doesNotMatch(v, /:\/\/|provider says|html|openalex\.org|api\./i, `${col} holds provider text: ${v}`);
    }
  }
});

test('a source out of quota, or with nothing to cite, writes a run row that says so', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO market_intel_quota (source_key, day, calls, errors, cap) VALUES ('openalex', ?, 5, 0, 5)`).run(today());
  await withResponses({}, () => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live' }), 'daily'));
  await runSourcesByCadence(envFor(db, { MI_FLAG_NEWS_GDELT: 'live' }), 'hourly');
  const runs = runsOf(db);
  assert.deepEqual(runs.map((r) => [r.source_key, r.outcome, r.reason, r.error_class]), [
    ['openalex', 'out_of_quota', 'quota_exhausted', null],
    ['news_gdelt', 'nothing_to_cite', 'no_live_rows', null],
  ]);
  assert.equal(runs[1].rows_seen, SECTORS.length, 'the draft answered with stub rows, none stored');
  assert.equal(runs[1].rows_inserted, 0);
});

test('a run row that cannot be written never stops ingestion', async () => {
  const db = fixture();
  db.exec('DROP TABLE market_intel_source_runs');
  const real = console.warn;
  const warned: string[] = [];
  console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };
  try {
    const r = await withResponses({}, () => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live' }), 'daily'));
    assert.equal(r.details.find((d) => d.source === 'openalex')!.inserted, SECTORS.length);
  } finally { console.warn = real; }
  assert.equal(rowsOf(db, 'openalex').length, SECTORS.length);
  assert.ok(warned.some((l) => /could not record the run of openalex/.test(l)), warned.join('\n'));
});

test('classifyRunError: http status, timeout, unreadable, empty, other, and nothing else', () => {
  assert.equal(classifyRunError(new Error('http_429')), 'http_429');
  assert.equal(classifyRunError(new Error('live_fetch_failed Agentic B2B:http_503,DevTools:http_503')), 'http_503');
  const abort = new Error('This operation was aborted'); abort.name = 'AbortError';
  assert.equal(classifyRunError(abort), 'timeout');
  assert.equal(classifyRunError(new Error('live_fetch_failed Agentic B2B:This operation was aborted')), 'timeout');
  assert.equal(classifyRunError(new SyntaxError('Unexpected token < in JSON at position 0')), 'unreadable_response');
  assert.equal(classifyRunError(new Error('live_fetch_failed ')), 'empty');
  assert.equal(classifyRunError(new Error('live_fetch_failed empty')), 'empty');
  assert.equal(classifyRunError(new Error('fetch failed')), 'other');
  assert.equal(classifyRunError(undefined), 'other');
});

/* ------------------------------------------------------------------ */
/* 5. liveRows.ts                                                      */
/* ------------------------------------------------------------------ */

test('retrieval time is retrieved_at, or ts for a row written before D7707', () => {
  const db = fixture();
  const ins = db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, ts, citation_url, retrieved_at)
     VALUES ('world_bank', ?, 'global', 'capital', 0.5, ?, 'https://data.worldbank.org/x', ?)`,
  );
  ins.run('A', '2026-10-01T00:00:00.000Z', null);
  ins.run('B', '2026-10-02T00:00:00.000Z', '2026-10-03T00:00:00.000Z');
  const got = db.prepare(`SELECT sector, ${retrievedAtSql()} AS at FROM market_intel_rows ORDER BY sector`).all() as any[];
  assert.deepEqual(got.map((r) => r.at), ['2026-10-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
  assert.equal(retrievedAt({ ts: '2026-10-01T00:00:00.000Z', retrieved_at: null }), '2026-10-01T00:00:00.000Z');
  assert.equal(retrievedAt({ ts: '2026-10-02T00:00:00.000Z', retrieved_at: '2026-10-03T00:00:00.000Z' }), '2026-10-03T00:00:00.000Z');
  assert.match(retrievedAtSql('r'), /^COALESCE\(r\.retrieved_at, r\.ts\)$/);
  assert.throws(() => retrievedAtSql('r; DROP'), /bare identifier/);
});

test('distinct observations: a period read by several runs is one; without a period, one per UTC day', () => {
  const db = fixture();
  const ins = db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, ts, citation_url, observed_period)
     VALUES (?, ?, 'global', ?, 0.5, ?, 'https://example.org/c', ?)`,
  );
  // World Bank 2025, fetched by three runs on two days: one observation.
  ins.run('world_bank', 'A', 'capital', '2026-11-18T00:05:00.000Z', '2025');
  ins.run('world_bank', 'A', 'capital', '2026-11-18T06:05:00.000Z', '2025');
  ins.run('world_bank', 'A', 'capital', '2026-11-19T00:05:00.000Z', '2025');
  // A different sector is a different observation.
  ins.run('world_bank', 'B', 'capital', '2026-11-19T00:05:00.000Z', '2025');
  // Rows written before D7707: no period, so one per UTC day of ts.
  ins.run('openalex', 'A', 'research', '2026-11-18T00:05:00.000Z', null);
  ins.run('openalex', 'A', 'research', '2026-11-18T23:59:00.000Z', null);
  ins.run('openalex', 'A', 'research', '2026-11-19T00:01:00.000Z', null);
  // A stub row is no observation.
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, ts, citation_url)
     VALUES ('openalex', 'A', 'global', 'research', 0.5, '2026-11-17T00:00:00.000Z', ?)`,
  ).run(`${STUB_CITATION_PREFIX}openalex`);
  const sql = db.prepare(`SELECT ${distinctObservationsSql()} AS n FROM market_intel_rows WHERE ${liveRowSql()}`).get() as any;
  assert.equal(sql.n, 4, '1 (WB A) + 1 (WB B) + 2 days of OpenAlex');
  const rows = db.prepare(`SELECT * FROM market_intel_rows WHERE ${liveRowSql()}`).all() as any[];
  assert.equal(countDistinctObservations(rows), 4, 'the code and the SQL agree');
  const keys = db.prepare(`SELECT DISTINCT ${observationKeySql('m')} AS k FROM market_intel_rows m WHERE ${liveRowSql('m')} ORDER BY k`).all() as any[];
  assert.ok(keys.some((k) => k.k === 'world_bank|A|global|capital|p:2025'), JSON.stringify(keys));
  assert.ok(keys.some((k) => k.k === 'openalex|A|global|research|d:2026-11-18'), JSON.stringify(keys));
});

/* ------------------------------------------------------------------ */
/* 6. The health route                                                 */
/* ------------------------------------------------------------------ */

async function callHealth(env: any, who: number | null) {
  const app = new Hono<any>().route(mount.path, healthRoutes);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const headers: Record<string, string> = {};
  if (who) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(mount.path, { headers }, env);
  return { status: res.status, body: await res.json() as any };
}

test('health: an HQ admin reads each source\'s flag, cadence, last runs, live rows, newest period and newest retrieval', async () => {
  const db = fixture();
  // A row written before D7707 (no period, no retrieved_at) and a stub row.
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, ts, citation_url)
     VALUES ('world_bank', 'A', 'global', 'capital', 0.5, '2030-01-01T00:00:00.000Z', 'https://data.worldbank.org/x')`,
  ).run();
  // The stub row claims a later period: it must move neither the count nor the newest period.
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, ts, citation_url, observed_period, observed_period_end)
     VALUES ('world_bank', 'A', 'global', 'capital', 0.5, ?, ?, '2099', '2099-12-31')`,
  ).run(new Date(NOW).toISOString(), `${STUB_CITATION_PREFIX}world_bank`);
  const env = envFor(db, { MI_FLAG_WORLD_BANK: 'live' });
  for (let i = 0; i < 7; i++) await withResponses({}, () => runSourcesByCadence(env, 'weekly'));
  await withFetch(async () => new Response('', { status: 502 }), () => runSourcesByCadence(env, 'weekly'));

  const { status, body } = await callHealth(env, ADMIN);
  assert.equal(status, 200, JSON.stringify(body));
  const wb = body.sources.find((s: any) => s.key === 'world_bank');
  assert.deepEqual([wb.flag, wb.cadence], ['live', 'weekly']);
  assert.equal(wb.runs.length, body.runs_per_source, 'the last runs only');
  assert.deepEqual([wb.runs[0].outcome, wb.runs[0].error_class], ['failed', 'http_502'], 'newest first');
  assert.equal(wb.runs[1].outcome, 'fetched');
  assert.ok(!('runs_reason' in wb));
  assert.equal(wb.live_rows, 7 * SECTORS.length + 1, 'live rows only: the stub row is not held');
  assert.deepEqual([wb.newest_period, wb.newest_period_end], ['2025', '2025-12-31'], 'from live rows only');
  assert.equal(wb.newest_retrieved_at, '2030-01-01T00:00:00.000Z', 'an old row\'s retrieval time is its ts');

  const oecd = body.sources.find((s: any) => s.key === 'oecd');
  assert.deepEqual([oecd.flag, oecd.runs, oecd.runs_reason], ['off', [], NO_RUN_REASON], 'no run on record, and it says so');
  assert.deepEqual([oecd.live_rows, oecd.newest_period, oecd.newest_period_reason, oecd.newest_retrieved_at], [0, null, NO_PERIOD_REASON, null]);
  assert.equal(body.sources.length, listSources().length);
});

test('health: refused for a non-admin, for no session and on a branch deployment', async () => {
  const db = fixture();
  assert.equal((await callHealth(envFor(db), FOUNDER)).status, 403, 'a founder');
  assert.equal((await callHealth(envFor(db), null)).status, 401, 'no session');
  const branch = await callHealth(envFor(db, { BRANCH_CODE: 'lisbon' }), ADMIN);
  assert.equal(branch.status, 403, `a branch admin: ${JSON.stringify(branch.body)}`);
  assert.equal((await callHealth(envFor(db), ADMIN)).status, 200, 'the same admin at HQ');
});

test('health: a run record that cannot be read answers 503 with a code, never zeros', async () => {
  const db = fixture(false);
  const { status, body } = await callHealth(envFor(db), ADMIN);
  assert.equal(status, 503);
  assert.equal(body.error, 'market_intel_health_unreadable');
  assert.ok(!('sources' in body));
});

/* ------------------------------------------------------------------ */
/* 7. schema.ts declares what the migration declares                   */
/* ------------------------------------------------------------------ */

const columns = (db: Db, table: string) =>
  (db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY name').all(table) as any[]).map((r) => r.name);

test('schema.ts: a fresh development database and an old one both reach the migrated shape', async () => {
  const migrated = fixture();
  // Fresh: nothing but users.
  const fresh = new DatabaseSync(':memory:');
  fresh.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT)');
  await ensureMarketIntelSchema(envFor(fresh));
  // Old: market_intel_rows as migration 030 made it, before D7707.
  const old = fixture(false);
  await ensureMarketIntelSchema(envFor(old));
  for (const table of ['market_intel_rows', 'market_intel_source_runs']) {
    assert.deepEqual(columns(fresh, table), columns(migrated, table), `${table}: fresh`);
    assert.deepEqual(columns(old, table), columns(migrated, table), `${table}: old`);
  }
  for (const c of ['observed_period', 'observed_period_end', 'published_at', 'retrieved_at', 'coverage_area', 'scope']) {
    assert.ok(columns(migrated, 'market_intel_rows').includes(c), c);
  }
  // The scope check holds on every path.
  for (const db of [migrated, fresh, old]) {
    assert.throws(() => db.prepare(
      `INSERT INTO market_intel_rows (source_key, sector, metric_key, metric_value, ts, scope) VALUES ('k', 's', 'm', 0.5, 't', 'everything')`,
    ).run(), /CHECK/);
    assert.throws(() => db.prepare(
      `INSERT INTO market_intel_source_runs (source_key, started_at, outcome, error_class) VALUES ('k', 't', 'fetched', 'provider said no')`,
    ).run(), /CHECK/);
  }
});
