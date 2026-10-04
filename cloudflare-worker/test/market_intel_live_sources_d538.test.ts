/**
 * D538 (#1078), steps 2 to 4 — production stores no stub, the keyless sources
 * are live, and the composite read says how fresh it is.
 *
 * Step 1 (market_intel_live_rows_d538.test.ts) hid the 237,372 stub rows
 * production holds. This file pins, on real SQLite:
 *
 *   1. that outside development (`MI_STUB_ROWS` not "on") a source that is
 *      off, out of quota, failing, or a draft whose fetchLive answers with stub
 *      rows stores nothing, and the run says why;
 *   2. that development keeps its stubs;
 *   3. that each connector flipped live parses a recorded provider response
 *      into cited, live rows. The responses are written to each provider's
 *      documented shape: this sandbox cannot reach the providers, so none was
 *      captured from the network;
 *   4. that wrangler.toml flips exactly those six live, in both var tables,
 *      and declares MI_STUB_ROWS "off" in both;
 *   5. that the index records its month-on-month change, and the composite
 *      read says when its live data starts, how much of the window it covers,
 *      that the month is month to date, and how many monthly points exist.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/market_intel_live_sources_d538.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import marketIntel from '../src/routes/market_intel.ts';
import {
  runSourcesByCadence, runFreeConnectors, recomputeIndexes, stubRowsEnabled,
  deltaPct, previousPeriodKey, SECTORS,
} from '../src/services/market_intel/aggregator.ts';
import { isLiveRow, STUB_CITATION_PREFIX, LIVE_INDEX_BASIS } from '../src/services/market_intel/liveRows.ts';
import { periodKey, WINDOW_DAYS } from '../src/services/market_intel/scoring.ts';
import { listSources } from '../src/services/market_intel/registry.ts';
import '../src/services/market_intel/sources/index.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const DAY = 86_400_000;

/** The six keyless connectors D538 flips live. */
const LIVE_KEYS = ['openalex', 'crossref', 'arxiv', 'world_bank', 'oecd', 'eurostat'];

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, timezone TEXT DEFAULT 'UTC',
                                digest_frequency TEXT DEFAULT 'weekly');
  `);
  db.exec(readFileSync(resolve(here, '../sql/migrations/030_market_intel.sql'), 'utf8'));
  db.exec(readFileSync(resolve(here, '../sql/migrations/379_market_intel_index_basis.sql'), 'utf8'));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Ada', 'ada@axal.example')`).run(ADMIN);
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

/** An env with no MI_* settings: production's behaviour unless a test adds some. */
function envFor(db: InstanceType<typeof DatabaseSync>, extra: Record<string, string> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db), RATE_LIMITS: kv(), ...extra };
}

const rowCount = (db: InstanceType<typeof DatabaseSync>) =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM market_intel_rows').get() as any).n);

/* ------------------------------------------------------------------ */
/* Recorded responses, one per provider, in each API's documented shape */
/* ------------------------------------------------------------------ */

const RESPONSES: Array<{ host: string; body: (url: URL) => string; type?: string }> = [
  {
    host: 'api.openalex.org',
    body: () => JSON.stringify({
      meta: { count: 1500, db_response_time_ms: 41, page: 1, per_page: 1 },
      results: [{ id: 'https://openalex.org/W4400000001', display_name: 'A recorded work' }],
    }),
  },
  {
    host: 'api.crossref.org',
    body: () => JSON.stringify({
      status: 'ok', 'message-type': 'work-list',
      message: { 'total-results': 800, items: [{ DOI: '10.1000/recorded.2026.1' }] },
    }),
  },
  {
    host: 'export.arxiv.org',
    type: 'application/atom+xml',
    body: () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <title type="html">ArXiv Query</title>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">150</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/2610.00001v1</id>
    <title>A recorded preprint</title>
  </entry>
</feed>`,
  },
  {
    host: 'api.worldbank.org',
    body: () => JSON.stringify([
      { page: 1, pages: 1, per_page: 1, total: 1, lastupdated: '2026-07-01' },
      [{ indicator: { id: 'NE.GDI.TOTL.ZS', value: 'Gross capital formation (% of GDP)' },
         country: { id: '1W', value: 'World' }, countryiso3code: 'WLD', date: '2025', value: 25, unit: '', obs_status: '', decimal: 1 }],
    ]),
  },
  {
    host: 'sdmx.oecd.org',
    body: () => JSON.stringify({
      meta: { schema: 'https://raw.githubusercontent.com/sdmx-twg/sdmx-json/master/data-message/tools/schemas/2.0.0/sdmx-json-data-schema.json' },
      data: { dataSets: [{ action: 'Information', observations: { '0:0:0:0:0:0:0': [2.7] } }] },
    }),
  },
  {
    host: 'ec.europa.eu',
    body: () => JSON.stringify({
      version: '2.0', class: 'dataset', label: 'Gross domestic expenditure on R&D (GERD)',
      value: { '0': 2.2, '1': 2.24, '2': 2.4 },
      id: ['freq', 'unit', 'sectperf', 'geo', 'time'],
    }),
  },
];

/** Serve the recorded responses; anything else is a test failure, not a network call. */
function withRecorded<T>(fn: (requested: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    requested.push(url.toString());
    const r = RESPONSES.find((x) => x.host === url.hostname);
    if (!r) throw new Error(`unrecorded host ${url.hostname}`);
    return new Response(r.body(url), { status: 200, headers: { 'Content-Type': r.type ?? 'application/json' } });
  }) as any;
  return fn(requested).finally(() => { globalThis.fetch = real; });
}

function withFetch<T>(impl: () => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl as any;
  return fn().finally(() => { globalThis.fetch = real; });
}

/** Capture console.info so the run's own record of why can be read. */
async function captureInfo<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const real = console.info;
  const lines: string[] = [];
  console.info = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { return { result: await fn(), lines }; } finally { console.info = real; }
}

const sourceByKey = (k: string) => listSources().find((s) => s.key === k)!;

/* ------------------------------------------------------------------ */
/* 1. Production stores no stub                                        */
/* ------------------------------------------------------------------ */

test('stubRowsEnabled is on for MI_STUB_ROWS = "on" only', () => {
  assert.equal(stubRowsEnabled({ MI_STUB_ROWS: 'on' } as any), true);
  assert.equal(stubRowsEnabled({ MI_STUB_ROWS: 'ON' } as any), true);
  for (const v of [undefined, '', 'off', 'true', '1', 'yes']) {
    assert.equal(stubRowsEnabled({ MI_STUB_ROWS: v } as any), false, `MI_STUB_ROWS=${v} must not write stubs`);
  }
});

test('production: a source that is off stores nothing, and the run says it was off', async () => {
  const db = fixture();
  const { result: r, lines } = await captureInfo(() => runSourcesByCadence(envFor(db) as any, 'daily'));
  assert.ok(r.scanned > 0);
  assert.equal(rowCount(db), 0, 'a source that is off wrote rows');
  assert.equal(r.inserted, 0);
  assert.equal(r.skipped, r.scanned);
  assert.ok(r.details.every((d) => d.mode === 'skipped' && d.reason === 'flag_off'));
  assert.equal(r.skip_reasons.flag_off, r.scanned);
  assert.ok(lines.some((l) => new RegExp(`stored nothing for ${r.scanned} source\\(s\\): flag_off:${r.scanned}`).test(l)), lines.join('\n'));
});

test('production: a live source whose provider fails stores nothing, counts as failed and logs why', async () => {
  const db = fixture();
  const env = envFor(db, { MI_FLAG_OPENALEX: 'live' });
  const { result: r, lines } = await captureInfo(() =>
    withFetch(async () => new Response('down', { status: 503 }), () => runSourcesByCadence(env as any, 'daily')));
  const d = r.details.find((x) => x.source === 'openalex')!;
  assert.deepEqual([d.mode, d.reason, d.inserted], ['skipped', 'fetch_failed', 0]);
  assert.match(d.error!, /http_503/);
  assert.equal(r.failed, 1);
  assert.equal(rowCount(db), 0, 'a failed live fetch was filled in with stub rows');
  assert.ok(lines.some((l) => /openalex=fetch_failed\(live_fetch_failed .*http_503/.test(l)), lines.join('\n'));
  const q = db.prepare(`SELECT errors FROM market_intel_quota WHERE source_key = 'openalex'`).get() as any;
  assert.equal(q?.errors, 1, 'the failure was not recorded in the quota ledger');
});

test('production: a live source out of quota stores nothing and says so', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO market_intel_quota (source_key, day, calls, errors, cap) VALUES ('openalex', ?, 5, 0, 5)`)
    .run(new Date().toISOString().slice(0, 10));
  const r = await withRecorded(() => runSourcesByCadence(envFor(db, { MI_FLAG_OPENALEX: 'live' }) as any, 'daily'));
  const d = r.details.find((x) => x.source === 'openalex')!;
  assert.deepEqual([d.mode, d.reason, d.inserted], ['skipped', 'quota_exhausted', 0]);
  assert.equal(rowCount(db), 0);
});

test('production: a draft connector flipped live, whose fetchLive answers with stubs, stores nothing', async () => {
  const db = fixture();
  const r = await runSourcesByCadence(envFor(db, { MI_FLAG_NEWS_GDELT: 'live' }) as any, 'hourly');
  const d = r.details.find((x) => x.source === 'news_gdelt')!;
  assert.deepEqual([d.mode, d.reason, d.inserted], ['skipped', 'no_live_rows', 0]);
  assert.equal(rowCount(db), 0, 'stub rows were stored as if they were live');
});

test('production: a live source that answers stores its cited rows and nothing else', async () => {
  const db = fixture();
  const r = await withRecorded(() => runFreeConnectors(envFor(db, { MI_FLAG_OPENALEX: 'live' }) as any, 'daily'));
  const d = r.details.find((x) => x.source === 'openalex')!;
  assert.deepEqual([d.mode, d.inserted], ['live', SECTORS.length]);
  const rows = db.prepare('SELECT source_key, citation_url FROM market_intel_rows').all() as any[];
  assert.equal(rows.length, SECTORS.length, 'only the live source wrote, and only its own rows');
  assert.ok(rows.every((x) => x.source_key === 'openalex' && isLiveRow(x)));
});

/* ------------------------------------------------------------------ */
/* 2. Development keeps its stubs                                      */
/* ------------------------------------------------------------------ */

test('development (MI_STUB_ROWS = "on"): an off source writes its stub, a failed live one degrades to it', async () => {
  const db = fixture();
  const env = envFor(db, { MI_STUB_ROWS: 'on', MI_FLAG_OPENALEX: 'live' });
  const r = await withFetch(async () => new Response('down', { status: 503 }), () => runSourcesByCadence(env as any, 'daily'));
  assert.ok(r.inserted > 0);
  assert.equal(r.skipped, 0, 'development skipped a source');
  assert.equal(r.details.find((x) => x.source === 'openalex')!.mode, 'degraded');
  assert.ok(r.details.filter((x) => x.source !== 'openalex').every((x) => x.mode === 'stub'));
  const live = (db.prepare('SELECT citation_url FROM market_intel_rows').all() as any[]).filter(isLiveRow);
  assert.equal(live.length, 0, 'every development row is a stub the read side hides');
});

/* ------------------------------------------------------------------ */
/* 3. Each live connector parses a recorded response                   */
/* ------------------------------------------------------------------ */

const EXPECT: Record<string, { citation: RegExp; metric_value: number; raw: number; host: string }> = {
  openalex:   { citation: /^https:\/\/openalex\.org\/W4400000001$/, metric_value: 0.5, raw: 1500, host: 'api.openalex.org' },
  crossref:   { citation: /^https:\/\/doi\.org\/10\.1000\/recorded\.2026\.1$/, metric_value: 0.5, raw: 800, host: 'api.crossref.org' },
  arxiv:      { citation: /^http:\/\/arxiv\.org\/abs\/2610\.00001v1$/, metric_value: 0.5, raw: 150, host: 'export.arxiv.org' },
  world_bank: { citation: /^https:\/\/data\.worldbank\.org\/indicator\/NE\.GDI\.TOTL\.ZS$/, metric_value: 0.5, raw: 25, host: 'api.worldbank.org' },
  oecd:       { citation: /^https:\/\/data-explorer\.oecd\.org\//, metric_value: 0.45, raw: 2.7, host: 'sdmx.oecd.org' },
  eurostat:   { citation: /^https:\/\/ec\.europa\.eu\/eurostat\/databrowser\/view\/rd_e_gerdtot\/$/, metric_value: 0.4, raw: 2.4, host: 'ec.europa.eu' },
};

for (const key of LIVE_KEYS) {
  test(`${key}: fetchLive parses a recorded provider response into one cited live row per sector`, async () => {
    const src = sourceByKey(key);
    const e = EXPECT[key];
    const { rows, requested } = await withRecorded(async (requested) => ({
      rows: await src.fetchLive!({ MI_CONTACT_EMAIL: 'market-intel@axal.vc' } as any, { sectors: SECTORS.slice() }),
      requested,
    }));
    assert.equal(rows.length, SECTORS.length);
    assert.deepEqual(rows.map((r) => r.sector).sort(), SECTORS.slice().sort());
    for (const r of rows) {
      assert.equal(r.source_key, key);
      assert.match(r.citation_url!, e.citation);
      assert.ok(isLiveRow(r), `${key} cited the stub page`);
      assert.ok(!r.citation_url!.startsWith(STUB_CITATION_PREFIX));
      assert.equal(r.raw_value, e.raw);
      assert.ok(Math.abs(r.metric_value - e.metric_value) < 1e-9, `${key} metric ${r.metric_value} ≠ ${e.metric_value}`);
    }
    assert.ok(requested.length > 0 && requested.every((u) => new URL(u).hostname === e.host), requested.join('\n'));
  });
}

test('a provider answer with nothing to cite yields no row, and a connector with no row at all fails', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ meta: { count: 0 }, results: [] }), { status: 200 })) as any;
  try {
    await assert.rejects(() => sourceByKey('openalex').fetchLive!({} as any, { sectors: SECTORS.slice() }), /live_fetch_failed/);
  } finally { globalThis.fetch = real; }
});

/* ------------------------------------------------------------------ */
/* 4. wrangler.toml                                                    */
/* ------------------------------------------------------------------ */

/** The `KEY = "value"` lines of one TOML table, up to the next table header. */
function tomlTable(toml: string, header: string): Record<string, string> {
  const start = toml.indexOf(`\n${header}\n`);
  assert.ok(start >= 0, `${header} missing from wrangler.toml`);
  const rest = toml.slice(start + header.length + 2);
  const end = rest.search(/^\[/m);
  const out: Record<string, string> = {};
  for (const line of (end >= 0 ? rest.slice(0, end) : rest).split('\n')) {
    const m = /^([A-Z0-9_]+)\s*=\s*"([^"]*)"/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test('wrangler.toml: exactly the six keyless connectors are live, and MI_STUB_ROWS is off, in both var tables', () => {
  const toml = readFileSync(resolve(here, '../../wrangler.toml'), 'utf8');
  const want = LIVE_KEYS.map((k) => `MI_FLAG_${k.toUpperCase()}`).sort();
  for (const header of ['[vars]', '[env.production.vars]']) {
    const vars = tomlTable(toml, header);
    const live = Object.entries(vars).filter(([k, v]) => k.startsWith('MI_FLAG_') && v === 'live').map(([k]) => k).sort();
    assert.deepEqual(live, want, `${header} live flags`);
    assert.equal(vars.MI_STUB_ROWS, 'off', `${header} must declare MI_STUB_ROWS = "off"`);
  }
});

test('every connector wrangler.toml flips live needs no key and answers with live rows only', async () => {
  const toml = readFileSync(resolve(here, '../../wrangler.toml'), 'utf8');
  const vars = tomlTable(toml, '[env.production.vars]');
  const flagged = listSources().filter((s) => vars[`MI_FLAG_${s.key.toUpperCase()}`] === 'live');
  assert.equal(flagged.length, LIVE_KEYS.length);
  for (const src of flagged) {
    const code = readFileSync(resolve(here, `../src/services/market_intel/sources/${src.key}.ts`), 'utf8');
    assert.doesNotMatch(code, /optEnv\(env, '[A-Z_]*(?:KEY|TOKEN)'\)/, `${src.key} reads a key`);
    const rows = await withRecorded(() => src.fetchLive!({} as any, { sectors: SECTORS.slice() }));
    assert.ok(rows.length > 0 && rows.every(isLiveRow), `${src.key} answered with stub rows`);
  }
});

/* ------------------------------------------------------------------ */
/* 5. Month-on-month change and the composite read's freshness         */
/* ------------------------------------------------------------------ */

test('deltaPct and previousPeriodKey: a change only from a live previous value above zero', () => {
  assert.equal(previousPeriodKey('2026-10'), '2026-09');
  assert.equal(previousPeriodKey('2026-01'), '2025-12');
  assert.equal(deltaPct(55, 50), 10);
  assert.equal(deltaPct(45, 50), -10);
  assert.equal(deltaPct(50, undefined), null);
  assert.equal(deltaPct(50, 0), null, 'a change from zero is not a number');
});

function insertLiveRow(db: InstanceType<typeof DatabaseSync>, sector: string, ageDays: number, value = 0.6) {
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url)
     VALUES ('openalex', ?, 'global', 'research', ?, 'count', ?, 'https://openalex.org/W1')`,
  ).run(sector, value, new Date(Date.now() - ageDays * DAY).toISOString());
}

test('recomputeIndexes writes delta_pct from last month\'s live value, and null where there is none', async () => {
  const db = fixture();
  const prev = previousPeriodKey(periodKey());
  const [a, b, c] = SECTORS;
  insertLiveRow(db, a, 1);
  insertLiveRow(db, b, 1);
  insertLiveRow(db, c, 1);
  // Last month: a live research value for A, a stub-derived one (no basis) for B, nothing for C.
  db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count, basis) VALUES (?, 'global', ?, 'research', 40, 1, ?)`).run(a, prev, LIVE_INDEX_BASIS);
  db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count, basis) VALUES (?, 'global', ?, 'research', 40, 1, NULL)`).run(b, prev);
  await recomputeIndexes(envFor(db) as any);
  const cur = (s: string) => db.prepare(
    `SELECT value, delta_pct FROM market_intel_indexes WHERE sector = ? AND period_key = ? AND dimension = 'research'`,
  ).get(s, periodKey()) as any;
  assert.ok(cur(a).value > 0);
  assert.equal(cur(a).delta_pct, deltaPct(cur(a).value, 40), 'A has a live previous month');
  assert.notEqual(cur(a).delta_pct, null);
  assert.equal(cur(b).delta_pct, null, 'a stub-derived previous month is not a baseline');
  assert.equal(cur(c).delta_pct, null, 'no previous month, no change');
});

const app = new Hono<any>();
app.route('/market-intel', marketIntel);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, (err?.status as any) || 500));

async function getCompass(env: ReturnType<typeof envFor>) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/market-intel/sector-compass', { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

test('sector-compass: live since the first live day, the window it covers, month to date, and the monthly points', async () => {
  const db = fixture();
  insertLiveRow(db, SECTORS[0], 5);
  insertLiveRow(db, SECTORS[0], 2);
  // A stub row older than the first live one must not move "live since".
  db.prepare(
    `INSERT INTO market_intel_rows (source_key, sector, geo, metric_key, metric_value, unit, ts, citation_url)
     VALUES ('openalex', ?, 'global', 'research', 0.5, 'index', ?, ?)`,
  ).run(SECTORS[0], new Date(Date.now() - 20 * DAY).toISOString(), `${STUB_CITATION_PREFIX}openalex`);
  // Two earlier live months and one stub-derived month in the index history.
  for (const [p, basis] of [['2026-07', LIVE_INDEX_BASIS], ['2026-08', LIVE_INDEX_BASIS], ['2026-06', null]] as const) {
    db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, source_count, basis) VALUES (?, 'global', ?, 'composite', 50, 1, ?)`).run(SECTORS[1], p, basis);
  }
  const { status, body } = await getCompass(envFor(db));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.period_status, 'month_to_date');
  assert.match(body.history_note, /month to date/);
  assert.match(body.delta_note, /previous month/);
  const f = body.freshness;
  assert.equal(f.live_since, new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10));
  assert.equal(f.live_since_exact, true);
  assert.equal(f.window_days, WINDOW_DAYS);
  assert.equal(f.days_covered, 5);
  assert.equal(f.window_full, false);
  assert.equal(f.first_full_index_in_days, WINDOW_DAYS - 5);
  // The cold read computed this month (live), plus July and August.
  assert.equal(f.monthly_points, 3, 'the stub-derived June counts as no point');
  const s0 = body.sectors.find((s: any) => s.sector === SECTORS[0]);
  assert.ok('composite_delta_pct' in s0);
  assert.equal(s0.composite_delta_pct, null, 'no live previous month for this sector');
});

test('sector-compass: with no live data at all, live since is not recorded, with the reason, never a date or zero', async () => {
  const db = fixture();
  const { body } = await getCompass(envFor(db));
  assert.equal(body.freshness.live_since, null);
  assert.equal(body.freshness.live_since_reason, 'No live source has reported yet');
  assert.equal(body.freshness.first_full_index_in_days, null);
  assert.equal(body.freshness.monthly_points, 0);
});
