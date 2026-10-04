/**
 * D538 (#1078) — no market-intelligence stub row reaches a read or a screen.
 *
 * On 4 October 2026 every one of the 237,372 rows in `market_intel_rows` was a
 * synthetic stub (each cites `https://axal.vc/market-intel/sources/<key>`), and
 * the 504 rows of `market_intel_indexes` were computed from them. This file
 * pins, on real SQLite (node:sqlite speaks D1's dialect):
 *
 *   1. the shared predicate — which rows are live, in JS and in SQL;
 *   2. that indexes are computed from live rows only, carry `basis = 'live'`,
 *      skip a dimension no live row feeds, and clear a stale one;
 *   3. that the routes never return a stub row or a stub-derived index, and
 *      say "not recorded" with the reason instead of a neutral 50;
 *   4. that the endpoints which served figures written into the code now say
 *      those figures are not recorded;
 *   5. that every SQL read of either table in the Worker carries the predicate.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/market_intel_live_rows_d538.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import marketIntel from '../src/routes/market_intel.ts';
import privateData from '../src/routes/private-data.ts';
import { recomputeIndexes } from '../src/services/market_intel/aggregator.ts';
import {
  isLiveRow, liveRowSql, liveIndexSql, STUB_CITATION_PREFIX, LIVE_INDEX_BASIS, NO_LIVE_SOURCE_REASON,
} from '../src/services/market_intel/liveRows.ts';
import { composeSectorScores, compositeHeadline, periodKey } from '../src/services/market_intel/scoring.ts';
import { listSources } from '../src/services/market_intel/registry.ts';
import '../src/services/market_intel/sources/index.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const STUB = (key: string) => `${STUB_CITATION_PREFIX}${key}`;

/** The market-intel tables as migrations 030 + 379 leave them, plus a users row. */
function fixture() {
  const db = new DatabaseSync(':memory:');
  const mig030 = readFileSync(resolve(here, '../sql/migrations/030_market_intel.sql'), 'utf8');
  const mig379 = readFileSync(resolve(here, '../sql/migrations/379_market_intel_index_basis.sql'), 'utf8');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, timezone TEXT DEFAULT 'UTC',
                                digest_frequency TEXT DEFAULT 'weekly');
  `);
  db.exec(mig030);
  db.exec(mig379);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Ada', 'ada@axal.example')`).run(ADMIN);
  return db;
}

/** A RATE_LIMITS-shaped KV backed by a Map, so the warm snapshot is observable. */
function kv() {
  const m = new Map<string, string>();
  return {
    map: m,
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

function envFor(db: InstanceType<typeof DatabaseSync>, store = kv()) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: store };
}

function insertRow(db: InstanceType<typeof DatabaseSync>, r: {
  source_key: string; sector: string; metric_key?: string; metric_value: number; citation_url: string | null; ageDays?: number;
}) {
  const ts = new Date(Date.now() - (r.ageDays ?? 1) * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url)
     VALUES (?, ?, 'global', ?, ?, 'index', ?, ?)`,
  ).run(r.source_key, r.sector, r.metric_key ?? 'research', r.metric_value, ts, r.citation_url);
}

const app = new Hono<any>();
app.route('/market-intel', marketIntel);
app.route('/private-data', privateData);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, (err?.status as any) || 500));

async function get(env: ReturnType<typeof envFor>, path: string) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

/** Network off: the headline and quote feeds must report unreadable, not invent. */
function withoutNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('network_disabled_in_test'); }) as any;
  return fn().finally(() => { globalThis.fetch = real; });
}

/* ------------------------------------------------------------------ */
/* 1. The predicate                                                    */
/* ------------------------------------------------------------------ */

test('isLiveRow: a provider citation is live; the stub page, a blank and a missing citation are not', () => {
  assert.equal(isLiveRow({ citation_url: 'https://openalex.org/W123' }), true);
  assert.equal(isLiveRow({ citation_url: STUB('openalex') }), false, 'the stub page is not a source');
  assert.equal(isLiveRow({ citation_url: `  ${STUB('gdelt')}` }), false, 'leading whitespace does not launder a stub');
  assert.equal(isLiveRow({ citation_url: '' }), false);
  assert.equal(isLiveRow({ citation_url: '   ' }), false);
  assert.equal(isLiveRow({ citation_url: null }), false, 'a row nothing cites cannot show where its number came from');
  assert.equal(isLiveRow({}), false);
  // The prefix itself is the stub page of every source, every connector uses it.
  assert.equal(STUB_CITATION_PREFIX, 'https://axal.vc/market-intel/sources/');
});

test('every connector stub cites the stub page, so the predicate catches every one', () => {
  const sources = listSources();
  assert.ok(sources.length >= 20, `only ${sources.length} connectors registered`);
  for (const src of sources) {
    const rows = src.fetchStub({ sectors: ['DevTools'], now: new Date('2026-10-04T00:00:00Z') });
    assert.ok(rows.length > 0, `${src.key} stub returned nothing`);
    for (const r of rows) assert.equal(isLiveRow(r), false, `${src.key} stub row reads as live: ${r.citation_url}`);
  }
});

test('liveRowSql selects exactly the rows isLiveRow accepts, on real SQLite', () => {
  const db = fixture();
  const cases: Array<[string | null, boolean]> = [
    ['https://openalex.org/W1', true],
    ['https://www.gdeltproject.org/x', true],
    [STUB('openalex'), false],
    [`  ${STUB('arxiv')}`, false],
    ['', false],
    ['   ', false],
    [null, false],
  ];
  cases.forEach(([url], i) => insertRow(db, { source_key: `s${i}`, sector: 'DevTools', metric_value: 0.5, citation_url: url }));
  const got = db.prepare(`SELECT source_key FROM market_intel_rows WHERE ${liveRowSql()} ORDER BY id`).all().map((r: any) => r.source_key);
  const want = cases.map(([url, live], i) => [i, live, url] as const).filter(([, live]) => live).map(([i]) => `s${i}`);
  assert.deepEqual(got, want);
  for (const [url, live] of cases) assert.equal(isLiveRow({ citation_url: url }), live, `JS and SQL disagree on ${url}`);
  // An alias qualifies the column; anything but a bare identifier is refused.
  assert.match(liveRowSql('r'), /r\.citation_url/);
  assert.throws(() => liveRowSql('r; DROP TABLE x'), /bare identifier/);
  assert.equal(liveIndexSql(), `(basis = '${LIVE_INDEX_BASIS}')`);
});

/* ------------------------------------------------------------------ */
/* 2. Indexes from live rows only                                      */
/* ------------------------------------------------------------------ */

test('a dimension no row feeds has no value, and the headline averages only recorded dimensions', () => {
  const sources = new Map(listSources().map((s) => [s.key, s] as const));
  const none = composeSectorScores({ rows: [], sources, now: new Date() });
  for (const d of Object.values(none)) assert.deepEqual(d, { value: null, source_count: 0 }, 'an empty dimension is not 50');
  assert.equal(compositeHeadline(none), null, 'an average of nothing is not 50');
  assert.equal(compositeHeadline({ demand: { value: 80 }, supply: { value: null }, capital: { value: null }, talent: { value: null }, research: { value: 40 }, sentiment: { value: null } } as any), 60);
});

test('recomputeIndexes reads no stub row: stubs alone write no index at all', async () => {
  const db = fixture();
  for (const sector of ['DevTools', 'Cybersecurity']) {
    insertRow(db, { source_key: 'openalex', sector, metric_value: 0.9, citation_url: STUB('openalex') });
    insertRow(db, { source_key: 'news_gdelt', sector, metric_key: 'sentiment', metric_value: 0.9, citation_url: STUB('news_gdelt') });
  }
  const r = await recomputeIndexes(envFor(db) as any);
  assert.equal(r.rows_written, 0, 'stub rows produced an index');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM market_intel_indexes').get() as any).n, 0);
});

test('recomputeIndexes computes from live rows only, stamps basis live, and clears a dimension that lost its data', async () => {
  const db = fixture();
  const period = periodKey();
  // A stale, stub-derived current-period row for a dimension nothing live feeds.
  db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count) VALUES ('DevTools','global',?, 'capital', 50, 3)`).run(period);
  // One live research row and a stub research row of a very different value.
  insertRow(db, { source_key: 'openalex', sector: 'DevTools', metric_value: 0.2, citation_url: 'https://openalex.org/W9' });
  insertRow(db, { source_key: 'arxiv', sector: 'DevTools', metric_value: 0.95, citation_url: STUB('arxiv') });

  const store = kv();
  const r = await recomputeIndexes(envFor(db, store) as any);
  const rows = db.prepare(`SELECT dimension, value, source_count, basis FROM market_intel_indexes WHERE sector = 'DevTools' ORDER BY dimension`).all() as any[];
  const byDim = Object.fromEntries(rows.map((x) => [x.dimension, x]));
  assert.ok(byDim.research, 'the live research row produced no index');
  assert.equal(byDim.research.value, 20, 'the stub row leaked into the research index');
  assert.equal(byDim.research.source_count, 1);
  assert.equal(byDim.research.basis, LIVE_INDEX_BASIS);
  assert.equal(byDim.composite.value, 20, 'the composite averaged in a dimension nothing recorded');
  assert.equal(byDim.composite.basis, LIVE_INDEX_BASIS);
  assert.equal(byDim.capital, undefined, 'the stale stub-derived capital row survived the recompute');
  for (const d of ['demand', 'supply', 'talent', 'sentiment']) assert.equal(byDim[d], undefined, `${d} written with no live source`);
  assert.ok(r.rows_cleared > 0);
  // Sectors with no live row at all get no row either.
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM market_intel_indexes WHERE sector <> 'DevTools'`).get() as any).n, 0);
  // The warm snapshot lives under the versioned key, never the pre-D538 one.
  assert.ok([...store.map.keys()].some((k) => k.endsWith('compass:global:live')));
  assert.ok(![...store.map.keys()].some((k) => k.endsWith('compass:global')), 'the pre-D538 snapshot key was written');
});

/* ------------------------------------------------------------------ */
/* 3. The routes                                                       */
/* ------------------------------------------------------------------ */

test('sector-compass: stub-derived indexes and stub rows read as not recorded, never 50', async () => {
  const db = fixture();
  const period = periodKey();
  // Pre-D538 index rows: computed from stubs, no basis.
  for (const dim of ['composite', 'demand', 'supply', 'capital', 'talent', 'research', 'sentiment']) {
    db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count) VALUES ('Cybersecurity','global',?,?,71,5)`).run(period, dim);
  }
  insertRow(db, { source_key: 'openalex', sector: 'Cybersecurity', metric_value: 0.7, citation_url: STUB('openalex') });
  // And a stale pre-D538 warm snapshot under the old key, which must not be read.
  const store = kv();
  await store.put('cache:mi:compass:global', JSON.stringify({ period_key: period, rows: [{ sector: 'Cybersecurity', geo: 'global', period_key: period, dimension: 'composite', value: 71, source_count: 5, computed_at: 'x' }] }));

  const { status, body } = await get(envFor(db, store), '/market-intel/sector-compass');
  assert.equal(status, 200);
  assert.equal(body.recorded_sectors, 0);
  assert.equal(body.computed_at, null);
  for (const s of body.sectors) {
    assert.equal(s.composite, null, `${s.sector} carries a composite with no live source`);
    assert.equal(s.composite_reason, NO_LIVE_SOURCE_REASON);
    for (const [d, v] of Object.entries<any>(s.dimensions)) {
      assert.equal(v.value, null, `${s.sector}.${d} = ${v.value}`);
      assert.equal(v.reason, NO_LIVE_SOURCE_REASON);
    }
  }
  assert.doesNotMatch(JSON.stringify(body), /"value":50\b|"composite":50\b/, 'a neutral 50 is back');
});

test('sector-compass: a live index row is shown, with the others still not recorded', async () => {
  const db = fixture();
  insertRow(db, { source_key: 'openalex', sector: 'Cybersecurity', metric_value: 0.62, citation_url: 'https://openalex.org/W7' });
  const { body } = await get(envFor(db), '/market-intel/sector-compass');
  const cyber = body.sectors.find((s: any) => s.sector === 'Cybersecurity');
  assert.equal(cyber.composite, 62);
  assert.equal(cyber.composite_reason, undefined);
  assert.equal(cyber.dimensions.research.value, 62);
  assert.equal(cyber.dimensions.capital.value, null);
  assert.equal(body.recorded_sectors, 1);
  assert.equal(body.sectors.find((s: any) => s.sector === 'DevTools').composite, null);
});

test('founder-lens, investor-lens and geography: no gap, score or composite without a live source', async () => {
  const db = fixture();
  const period = periodKey();
  for (const dim of ['composite', 'demand', 'supply', 'capital', 'sentiment']) {
    db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count) VALUES ('Fintech / DeFi','global',?,?,64,4)`).run(period, dim);
  }
  const env = envFor(db);
  const founder = (await get(env, '/market-intel/founder-lens')).body;
  assert.equal(founder.picks.length, 12);
  for (const p of founder.picks) {
    assert.equal(p.opportunity_gap, null, `${p.sector} gap from no live data`);
    assert.equal(p.demand, null); assert.equal(p.supply, null);
    assert.equal(p.reason, NO_LIVE_SOURCE_REASON);
  }
  const investor = (await get(env, '/market-intel/investor-lens')).body;
  for (const s of investor.ranked) { assert.equal(s.score, null); assert.equal(s.capital, null); }
  const geo = (await get(env, '/market-intel/geography')).body;
  assert.deepEqual(geo.geos[0].sectors, []);
  assert.equal(geo.geos[0].not_recorded.reason, NO_LIVE_SOURCE_REASON);
});

test('citations never return a stub row', async () => {
  const db = fixture();
  insertRow(db, { source_key: 'openalex', sector: 'DevTools', metric_value: 0.4, citation_url: 'https://openalex.org/W1' });
  insertRow(db, { source_key: 'arxiv', sector: 'DevTools', metric_value: 0.4, citation_url: STUB('arxiv') });
  insertRow(db, { source_key: 'reddit', sector: 'DevTools', metric_value: 0.4, citation_url: null });
  const env = envFor(db);
  for (const path of ['/market-intel/citations', '/market-intel/citations?sector=DevTools']) {
    const { body } = await get(env, path);
    assert.deepEqual(body.rows.map((r: any) => r.source_key), ['openalex'], `${path} returned a stub or uncited row`);
  }
});

/* ------------------------------------------------------------------ */
/* 4. Figures written into the code                                    */
/* ------------------------------------------------------------------ */

test('market-pulse, macro, private-rounds, benchmarks and competitive-intelligence say what they do not record', async () => {
  const env = envFor(fixture());
  await withoutNetwork(async () => {
    const pulse = (await get(env, '/market-intel/market-pulse')).body;
    assert.deepEqual(pulse.signals, []);
    assert.equal(pulse.signals_not_recorded.recorded, false);
    assert.ok(pulse.signals_not_recorded.reason.length > 10);
    assert.equal(pulse.total_sectors, null, 'a count of nothing is not 0');
    // The headline service catches each feed's failure itself and returns
    // what it got; with the network off that is nothing, and no headline is
    // invented in its place.
    assert.deepEqual(pulse.headlines, []);

    const macro = (await get(env, '/market-intel/macro')).body;
    assert.deepEqual(macro.sectors, []);
    assert.equal(macro.sectors_not_recorded.recorded, false);
    assert.equal(macro.exit_environment, null);
    assert.equal(macro.interest_rate_impact, null);
    assert.equal(macro.updated_at, undefined, 'the hardcoded 2026-03-27 stamp is back');
  });
  const rounds = (await get(env, '/market-intel/private-rounds')).body;
  assert.deepEqual(rounds.rounds, []);
  assert.equal(rounds.total, null);
  assert.equal(rounds.not_recorded.recorded, false);

  const bench = (await get(env, '/market-intel/studio-benchmarks')).body;
  assert.deepEqual(Object.keys(bench), ['not_recorded'], 'a benchmark figure is back');

  const ci = (await get(env, '/market-intel/competitive-intelligence')).body;
  assert.deepEqual(ci.high_conviction_plays, []);
  assert.deepEqual(ci.market_pulse, []);
  assert.equal(ci.studio_benchmarks, null);

  const exp = await get(env, '/market-intel/export');
  assert.equal(exp.status, 409);
  assert.equal(exp.body.error, 'not_recorded');

  const priv = (await get(env, '/private-data/market/private-signals')).body;
  assert.deepEqual(priv.signals, []);
  assert.equal(priv.studio_benchmarks, null);
  assert.equal(priv.global_conviction, null);
});

test('no hardcoded market figure is left in the route file', () => {
  const src = readFileSync(resolve(here, '../src/routes/market_intel.ts'), 'utf8');
  for (const name of ['MARKET_PULSE', 'MACRO_DATA', 'PRIVATE_ROUNDS', 'HIGH_CONVICTION', 'STUDIO_BENCHMARKS']) {
    assert.doesNotMatch(src, new RegExp(`\\bconst ${name}\\b`), `${name} is back`);
  }
  // The six named rounds and the multiples they came with.
  for (const literal of ["'$45B'", 'multiple: 22.4', "avg_time_to_inc_days: 11", "'Series C'"]) {
    assert.ok(!src.includes(literal), `${literal} is back in the route file`);
  }
  assert.doesNotMatch(src, /\?\?\s*50\b/, 'a `?? 50` default is back');
});

/* ------------------------------------------------------------------ */
/* 5. Every read carries the predicate                                 */
/* ------------------------------------------------------------------ */

function workerSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...workerSources(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('every SQL read of market_intel_rows or market_intel_indexes in the Worker filters to live data', () => {
  const root = resolve(here, '../src');
  const offenders: string[] = [];
  let reads = 0;
  for (const file of workerSources(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/`([^`]*?\bFROM\s+(market_intel_rows|market_intel_indexes)\b[^`]*)`/g)) {
      const sql = m[1];
      if (/^\s*(DELETE|INSERT|UPDATE)\b/i.test(sql)) continue;
      reads += 1;
      const need = m[2] === 'market_intel_rows' ? /\$\{liveRowSql\(\)\}/ : /\$\{liveIndexSql\(\)\}/;
      if (!need.test(sql)) offenders.push(`${file.slice(root.length + 1)}: ${sql.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  assert.ok(reads >= 6, `found only ${reads} reads — the sweep is not seeing the queries`);
  assert.deepEqual(offenders, [], 'a read of market intelligence can return a stub row or a stub-derived index');
});
