/**
 * D7708 (#7708) — a sector index's score, source count, change and source mix
 * describe evidence over a stated window, not how often a job ran.
 *
 * On real SQLite (migrations 030, 379, 7707 and 7708), clock pinned (D5614):
 *
 *   1. Two rows with the same observation identity change no score, count or share.
 *   2. Composite and dimension counts are both distinct registered providers;
 *      an unregistered key is never counted.
 *   3. An annual figure its provider confirmed inside the window is in it
 *      whatever year it measures; one not confirmed inside it is out.
 *   4. Mix shares sum to 1 and equal the weights the score used, read back
 *      from the stored point.
 *   5. Each point stores and returns its window; a point written before D7708
 *      reads "Window not recorded", never a derived date.
 *   6. A dimension fed only by figures copied to every sector is flagged.
 *   7. A compass snapshot written before D7708 is never served.
 *   8. Freshness counts live data by retrieval date.
 *   9. The migration's columns match the runtime declaration.
 *  10. The fixture's composite scores before and after D7708 (pinned).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_counts_freshness_7708.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import marketIntel, { readCompassFreshness, INDEX_HISTORY_NOTE, DELTA_NOTE } from '../src/routes/market_intel.ts';
import { recomputeIndexes, COMPASS_KV_KEY } from '../src/services/market_intel/aggregator.ts';
import {
  composeSectorScores, compositeMix, compositeHeadline, distinctObservations, storedWindow, scoreWindow,
  periodKey, WINDOW_DAYS, WINDOW_NOT_RECORDED, type ScoredRow,
} from '../src/services/market_intel/scoring.ts';
import { listSources } from '../src/services/market_intel/registry.ts';
import { ensureMarketIntelSchema } from '../src/services/market_intel/schema.ts';
import { sectorSeries, sectorPeriods } from '../src/routes/research_sectors.ts';
import '../src/services/market_intel/sources/index.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIG = (f: string) => readFileSync(resolve(here, `../sql/migrations/${f}`), 'utf8');
const M7707 = '202611191833_7707_market_intel_row_dates_runs.sql';
const M7708 = '202611220337_7708_market_intel_index_window.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-22T12:00:00.000Z');
mock.timers.enable({ apis: ['Date'], now: NOW });
const sources = new Map(listSources().map((s) => [s.key, s] as const));
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
type Db = InstanceType<typeof DatabaseSync>;

function fixture(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.exec(MIG('030_market_intel.sql'));
  db.exec(MIG('379_market_intel_index_basis.sql'));
  db.exec(MIG(M7707));
  db.exec(MIG(M7708));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Ada', 'ada@axal.example')`).run(ADMIN);
  return db;
}

function kv() {
  const m = new Map<string, string>();
  return {
    map: m,
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}
const envFor = (db: Db, store = kv()) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: store });

/** A live row (cited by its provider). `retrieved` is days ago; `period` the period measured. */
function row(db: Db, r: { source_key: string; sector?: string; metric_key?: string; value: number; retrieved: number;
  period?: string | null; scope?: 'sector' | 'context' | null; coverage?: string | null; tsDays?: number; withRetrieved?: boolean }) {
  const retrieved = ago(r.retrieved);
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url,
       observed_period, retrieved_at, scope, coverage_area)
     VALUES (?, ?, 'global', ?, ?, 'index', ?, ?, ?, ?, ?, ?)`,
  ).run(r.source_key, r.sector ?? 'DevTools', r.metric_key ?? 'research', r.value,
    r.tsDays == null ? retrieved : ago(r.tsDays), `https://provider.example/${r.source_key}`,
    r.period ?? null, r.withRetrieved === false ? null : retrieved, r.scope ?? null, r.coverage ?? null);
}

const scoredRows = (db: Db, sector = 'DevTools') => db.prepare(
  `SELECT id, source_key, sector, geo, metric_key, metric_value, ts, observed_period, retrieved_at, scope, coverage_area
     FROM market_intel_rows WHERE sector = ?`).all(sector) as unknown as ScoredRow[];
const point = (db: Db, dimension: string, sector = 'DevTools') => db.prepare(
  `SELECT * FROM market_intel_indexes WHERE sector = ? AND dimension = ? AND period_key = ?`).get(sector, dimension, periodKey()) as any;

/* ------------------------------------------------------------------ */

test('the same observation stored twice changes no score, count or share', () => {
  const db = fixture();
  row(db, { source_key: 'openalex', value: 0.8, retrieved: 2, period: '2026-10-23/2026-11-20', scope: 'sector' });
  row(db, { source_key: 'crossref', value: 0.4, retrieved: 3, period: '2026-10-22/2026-11-19', scope: 'sector' });
  const once = composeSectorScores({ rows: scoredRows(db), sources, now: new Date() });
  // The same OpenAlex window fetched again by a later run: one observation, the latest stored.
  row(db, { source_key: 'openalex', value: 0.8, retrieved: 1, period: '2026-10-23/2026-11-20', scope: 'sector' });
  const twice = composeSectorScores({ rows: scoredRows(db), sources, now: new Date() });
  assert.equal(distinctObservations(scoredRows(db), sources).length, 2);
  assert.deepEqual(twice.research.source_count, once.research.source_count);
  assert.deepEqual(twice.research.mix!.entries.map((e) => [e.source_key, e.observations]), once.research.mix!.entries.map((e) => [e.source_key, e.observations]));
  // The latest stored copy is the one used: its retrieval is a day newer, so its decay — and the score — follow it.
  assert.ok(Math.abs(twice.research.value! - once.research.value!) < 2, 'a refetch must not double a source\'s weight');
  const doubled = composeSectorScores({ rows: [...scoredRows(db)].map((r, i) => ({ ...r, observed_period: `${r.observed_period}#${i}` })), sources, now: new Date() });
  assert.notEqual(doubled.research.mix!.entries[0].observations, twice.research.mix!.entries[0].observations, 'the identity is what dedupes');
});

test('source_count is distinct registered providers, for a dimension and for the composite; an unregistered key never counts', () => {
  const db = fixture();
  for (let i = 0; i < 4; i++) row(db, { source_key: 'openalex', value: 0.6, retrieved: 1 + i, period: `2026-1${i % 2}-01/2026-11-1${i}` });
  row(db, { source_key: 'crossref', value: 0.5, retrieved: 2, period: '2026-10-01/2026-11-01' });
  row(db, { source_key: 'hackernews', metric_key: 'sentiment', value: 0.7, retrieved: 1, period: '2026-11-21/2026-11-21' });
  row(db, { source_key: 'not_a_registered_source', value: 1, retrieved: 1, period: '2026' });
  const scores = composeSectorScores({ rows: scoredRows(db), sources, now: new Date() });
  assert.equal(scores.research.source_count, 2, 'openalex and crossref, however many rows');
  assert.ok(!scores.research.mix!.entries.some((e) => e.source_key === 'not_a_registered_source'));
  const composite = compositeMix(scores)!;
  assert.equal(composite.source_count, 3, 'openalex, crossref and hackernews: providers, not the seven rows');
});

test('an annual figure confirmed inside the window is in it whatever year it measures; one not confirmed inside it is out', () => {
  const db = fixture();
  row(db, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: 3, period: '2023', scope: 'context', coverage: 'World' });
  let s = composeSectorScores({ rows: scoredRows(db), sources, now: new Date() });
  assert.equal(s.capital.source_count, 1, 'a 2023 figure the provider returned three days ago is in');
  const db2 = fixture();
  row(db2, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: WINDOW_DAYS + 2, period: '2026', scope: 'context', coverage: 'World' });
  s = composeSectorScores({ rows: scoredRows(db2), sources, now: new Date() });
  assert.equal(s.capital.value, null, 'a 2026 figure last returned 32 days ago is out');
  // A row written before D7707 has no retrieved_at: its ts is its retrieval date.
  const db3 = fixture();
  row(db3, { source_key: 'openalex', value: 0.5, retrieved: 40, tsDays: 2, withRetrieved: false });
  assert.equal(composeSectorScores({ rows: scoredRows(db3), sources, now: new Date() }).research.source_count, 1);
  // Membership follows the retrieval date, not ts: a row stored long ago that its provider returned yesterday is in.
  const db4 = fixture();
  row(db4, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: 1, tsDays: 45, period: '2024', scope: 'context' });
  assert.equal(composeSectorScores({ rows: scoredRows(db4), sources, now: new Date() }).capital.source_count, 1);
});

test('recomputeIndexes stores the window and a mix whose shares sum to 1 and equal the weights the score used', async () => {
  const db = fixture();
  row(db, { source_key: 'openalex', value: 0.8, retrieved: 1, period: '2026-10-22/2026-11-21', scope: 'sector' });
  row(db, { source_key: 'arxiv', value: 0.3, retrieved: 7, period: '2026-10-16/2026-11-15', scope: 'sector' });
  row(db, { source_key: 'oecd', metric_key: 'capital', value: 0.4, retrieved: 2, period: '2024', scope: 'context', coverage: 'OECD aggregate' });
  // The same OpenAlex window fetched again, earlier: one observation, so no extra weight and no extra count.
  row(db, { source_key: 'openalex', value: 0.8, retrieved: 3, period: '2026-10-22/2026-11-21', scope: 'sector' });
  await recomputeIndexes(envFor(db) as any);
  const research = point(db, 'research');
  const w = storedWindow(research);
  assert.equal(w.window_start, scoreWindow(new Date()).window_start);
  assert.equal(w.window_end, new Date(NOW).toISOString());
  assert.equal(w.window_reason, null);
  const entries = w.source_mix!.entries;
  assert.ok(Math.abs(entries.reduce((n, e) => n + e.share, 0) - 1) < 1e-9, 'shares sum to 1');
  // The weights the score used: registry weight × recency decay on the retrieval date.
  const weight = (key: string, days: number) => sources.get(key)!.weight * Math.pow(0.5, days / 14);
  const used = { openalex: weight('openalex', 1), arxiv: weight('arxiv', 7), oecd: weight('oecd', 2) };
  const total = used.openalex + used.arxiv + used.oecd;
  for (const e of entries) assert.ok(Math.abs(e.share - used[e.source_key as keyof typeof used] / total) < 1e-9, e.source_key);
  assert.equal(research.source_count, 3);
  // The composite: distinct providers (3), never the row count (4), with the same window.
  const composite = point(db, 'composite');
  assert.equal(composite.source_count, 3);
  assert.equal(composite.window_end, research.window_end);
  const cshares = storedWindow(composite).source_mix!.entries;
  assert.ok(Math.abs(cshares.reduce((n, e) => n + e.share, 0) - 1) < 1e-9);
});

test('a dimension fed only by figures copied to every sector is flagged, with the coverage and period it really has', async () => {
  const db = fixture();
  for (const sector of ['DevTools', 'Cybersecurity']) {
    row(db, { source_key: 'world_bank', sector, metric_key: 'capital', value: 0.45, retrieved: 1, period: '2024', scope: 'context', coverage: 'World' });
    row(db, { source_key: 'openalex', sector, value: 0.6, retrieved: 1, period: '2026-10-22/2026-11-21', scope: 'sector' });
  }
  await recomputeIndexes(envFor(db) as any);
  const capital = storedWindow(point(db, 'capital')).source_mix!;
  assert.equal(capital.context_only, true);
  assert.deepEqual(capital.entries.map((e) => [e.source_key, e.scope, e.coverage_area, e.period_from, e.period_to]), [['world_bank', 'context', 'World', '2024', '2024']]);
  assert.equal(storedWindow(point(db, 'research')).source_mix!.context_only, false);
  // And the same flag on the sector read, per point.
  const periods = sectorPeriods();
  const rows = db.prepare(`SELECT * FROM market_intel_indexes WHERE sector = 'DevTools'`).all() as any[];
  const series = sectorSeries(rows, periods) as any;
  assert.equal(series.capital.context_only, true);
  assert.equal(series.research.context_only, false);
  assert.equal(series.capital.points.at(-1).source_mix[0].coverage_area, 'World');
});

test('a point written before D7708 reads "Window not recorded" and no mix, never a derived date', () => {
  assert.deepEqual(storedWindow({ window_start: null, window_end: null, source_mix_json: null }),
    { window_start: null, window_end: null, window_reason: WINDOW_NOT_RECORDED, source_mix: null });
  assert.equal(storedWindow({ window_start: '2026-10-23T12:00:00.000Z', window_end: '2026-11-22T12:00:00.000Z', source_mix_json: '{not json' }).source_mix, null,
    'a stored mix that cannot be read is not guessed');
  const periods = sectorPeriods();
  const series = sectorSeries([{ sector: 'DevTools', period_key: periods.at(-1)!, dimension: 'research', value: 55, delta_pct: 3,
    source_count: 9, computed_at: '2026-11-21T04:00:00Z' }], periods) as any;
  assert.equal(series.research.window_start, null);
  assert.equal(series.research.window_reason, WINDOW_NOT_RECORDED);
  assert.deepEqual(series.research.points.at(-1).source_mix, []);
});

test('a change names both windows: its own and the previous point\'s', () => {
  const periods = sectorPeriods();
  const mk = (period: string, start: string, end: string, value: number, delta: number | null) => ({
    sector: 'DevTools', period_key: period, dimension: 'research', value, delta_pct: delta, source_count: 2, computed_at: end,
    window_start: start, window_end: end, source_mix_json: JSON.stringify({ window_start: start, window_end: end, context_only: false, entries: [] }),
  });
  const series = sectorSeries([
    mk(periods.at(-2)!, '2026-09-30T04:00:00.000Z', '2026-10-30T04:00:00.000Z', 50, null),
    mk(periods.at(-1)!, '2026-10-23T12:00:00.000Z', '2026-11-22T12:00:00.000Z', 55, 10),
  ], periods) as any;
  assert.deepEqual(series.research.change_against,
    { period: periods.at(-2), window_start: '2026-09-30T04:00:00.000Z', window_end: '2026-10-30T04:00:00.000Z', window_reason: null });
  assert.equal(series.research.window_start, '2026-10-23T12:00:00.000Z');
  assert.equal(series.research.points.at(-2).change_against, null, 'no change, no comparison named');
});

/* ------------------------------------------------------------------ */

const app = new Hono<any>();
app.route('/market-intel', marketIntel);
async function get(env: ReturnType<typeof envFor>, path: string) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

test('a compass snapshot written before D7708 is never served, and the compass body returns its window', async () => {
  const db = fixture();
  row(db, { source_key: 'openalex', sector: 'Cybersecurity', value: 0.6, retrieved: 1, period: '2026-10-22/2026-11-21', scope: 'sector' });
  const store = kv();
  // The pre-D7708 snapshot: row counts, no window, under the key D538 used.
  await store.put('cache:mi:compass:global:live', JSON.stringify({ period_key: periodKey(), rows: [
    { sector: 'Cybersecurity', geo: 'global', period_key: periodKey(), dimension: 'composite', value: 99, source_count: 480, computed_at: 'x' }] }));
  assert.notEqual(COMPASS_KV_KEY, 'compass:global:live');
  const { status, body } = await get(envFor(db, store), '/market-intel/sector-compass');
  assert.equal(status, 200);
  const cyber = body.sectors.find((s: any) => s.sector === 'Cybersecurity');
  assert.notEqual(cyber.composite, 99, 'the pre-D7708 snapshot was served');
  assert.equal(body.window_end, new Date(NOW).toISOString());
  assert.equal(Date.parse(body.window_end) - Date.parse(body.window_start), WINDOW_DAYS * DAY);
  assert.equal(body.history_note, INDEX_HISTORY_NOTE);
  assert.match(INDEX_HISTORY_NOTE, /30 days before its last refresh/);
  assert.match(DELTA_NOTE, /each the score over its own 30-day window/);
});

test('freshness counts live data by its retrieval date', async () => {
  const db = fixture();
  // Measured in 2023, last returned by the provider yesterday: live data inside the window.
  row(db, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: 1, period: '2023', scope: 'context', tsDays: 1 });
  let f = await readCompassFreshness(envFor(db) as any) as any;
  assert.equal(f.last_live, ago(1).slice(0, 10));
  assert.equal(f.days_covered, 1);
  // Stored 45 days ago, returned by the provider yesterday: its retrieval date, not ts, puts it in the window.
  const db1 = fixture();
  row(db1, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: 1, period: '2024', scope: 'context', tsDays: 45 });
  f = await readCompassFreshness(envFor(db1) as any) as any;
  assert.equal(f.last_live, ago(1).slice(0, 10));
  assert.equal(f.days_covered, 1);
  // A row whose retrieval falls outside the window is not live data in it.
  const db2 = fixture();
  row(db2, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: 45, tsDays: 45 });
  f = await readCompassFreshness(envFor(db2) as any) as any;
  assert.equal(f.days_covered, 0);
});

test('the migration\'s columns match what schema.ts declares', async () => {
  const migrated = fixture();
  const cols = (db: Db) => (db.prepare(`PRAGMA table_info(market_intel_indexes)`).all() as any[]).map((c) => `${c.name}:${c.type}`).sort();
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL);`);
  await ensureMarketIntelSchema({ DB: d1Over(fresh) } as any);
  assert.deepEqual(cols(fresh), cols(migrated));
  // An old development table (030 + 379 only) reaches the same shape.
  const old = new DatabaseSync(':memory:');
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL);`);
  old.exec(MIG('030_market_intel.sql'));
  old.exec(MIG('379_market_intel_index_basis.sql'));
  await ensureMarketIntelSchema({ DB: d1Over(old) } as any);
  assert.deepEqual(cols(old), cols(migrated));
});

/**
 * The fixture the PR and D7708 quote. Before D7708 (main's scorer at b72755cf68
 * run on the same rows): research 78.2, capital 50, demand 70, sentiment 70,
 * composite 67.1, composite source_count 7 (the row count). After: below,
 * pinned. Research falls because OpenAlex's one window, fetched three times, now
 * counts once.
 */
function beforeAfterFixture(db: Db) {
  // OpenAlex fetched three times for one window, Crossref once, World Bank's 2024 figure twice.
  for (const r of [1, 2, 3]) row(db, { source_key: 'openalex', value: 0.9, retrieved: r, period: '2026-10-22/2026-11-21', scope: 'sector' });
  row(db, { source_key: 'crossref', value: 0.3, retrieved: 5, period: '2026-10-18/2026-11-17', scope: 'sector' });
  for (const r of [1, 4]) row(db, { source_key: 'world_bank', metric_key: 'capital', value: 0.5, retrieved: r, period: '2024', scope: 'context', coverage: 'World' });
  row(db, { source_key: 'hackernews', metric_key: 'sentiment', value: 0.7, retrieved: 2, period: '2026-11-20/2026-11-20', scope: 'sector' });
}

test('the fixture\'s composite after D7708: each observation once, providers counted', () => {
  const db = fixture();
  beforeAfterFixture(db);
  const scores = composeSectorScores({ rows: scoredRows(db), sources, now: new Date() });
  assert.deepEqual([scores.research.value, scores.capital.value, scores.demand.value, scores.sentiment.value], [65.2, 50, 70, 70]);
  assert.equal(compositeHeadline(scores), 63.8);
  assert.equal(compositeMix(scores)!.source_count, 4, 'openalex, crossref, world_bank, hackernews — not 7 rows');
});
