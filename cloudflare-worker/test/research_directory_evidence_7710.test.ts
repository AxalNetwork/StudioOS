/**
 * D7710 (#7710) — the Markets directory's evidence: what names the market leads, inherited sector
 * sources sit beside it over the index window, every date names its basis, a source in both sets
 * counts once, and the facets add up. Real SQLite, the route's own SQL, a pinned clock.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import researchMarkets, { DATE_BASES, NO_SOURCE_REASON, windowStart } from '../src/routes/research_markets.ts';
import { WINDOW_DAYS } from '../src/services/market_intel/scoring.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const NOW = Date.UTC(2026, 10, 20, 0, 0, 0); // 20 Nov 2026: the window starts 21 Oct
const SECTOR = 'Fintech / DeFi';

const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)) as string), 'utf8');
function tableFrom(prefix: string, table: string): string {
  const name = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)
    && readFileSync(resolve(MIGRATIONS, f), 'utf8').includes(`CREATE TABLE IF NOT EXISTS ${table}`)) as string;
  const sql = readFileSync(resolve(MIGRATIONS, name), 'utf8');
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  const end = sql.slice(start).search(/\);\s*(\n|$)/);
  return stripForeignKeys(sql.slice(start, start + end + 2));
}

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  d.prepare('INSERT INTO users (id, role) VALUES (1, ?)').run('founder');
  d.exec(tableFrom('228', 'research_company_directory'));
  d.exec(file('375'));
  d.exec(tableFrom('229', 'research_market_directory'));
  d.exec(tableFrom('136', 'signals'));
  d.exec(tableFrom('136', 'signal_evidence'));
  d.exec(file('376'));
  d.exec(tableFrom('037', 'market_intel_rows'));
  d.exec(tableFrom('037', 'market_intel_indexes'));
  d.exec(file('379'));
  d.exec(file('202611191833_7707'));
  d.exec(file('202611220337_7708'));
  const m = d.prepare(`INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of)
                       VALUES (?, ?, 10, 'Axal', 'supplied', '2026-09-30')`);
  m.run('fintech', 'FinTech'); m.run('payments', 'Payments'); m.run('autotech', 'AutoTech');
  const s = d.prepare(`INSERT INTO signals (id, type, title, thesis, region, country, sector, niche, market_cap_band, tags, status, rank_score)
                       VALUES (?, 'x', 't', 't', 'r', 'UK', 'Financial Services', 'n', 'mid', ?, 'active', 1)`);
  s.run('s1', '["payments"]');
  return d;
}
/** A live, cited market-intelligence row for the FinTech sector. */
function mi(d: DatabaseSync, key: string, ts: string, extra: { period?: string; periodEnd?: string; retrieved?: string; metric?: string } = {}) {
  d.prepare(`INSERT INTO market_intel_rows (source_key, sector, metric_key, metric_value, ts, citation_url, observed_period, observed_period_end, retrieved_at)
             VALUES (?, ?, ?, 1, ?, 'https://example.org/x', ?, ?, ?)`)
    .run(key, SECTOR, extra.metric ?? 'm', ts, extra.period ?? null, extra.periodEnd ?? null, extra.retrieved ?? null);
}
const evidence = (d: DatabaseSync, key: string, at: string) =>
  d.prepare(`INSERT INTO signal_evidence (signal_id, kind, title, source_key, observed_at) VALUES ('s1', 'news', 't', ?, ?)`).run(key, at);

const app = new Hono();
app.route('/api/research', researchMarkets as any);
async function markets(d: DatabaseSync, query = '') {
  const tok = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/research/markets${query}`, { headers: { Authorization: `Bearer ${tok}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(d) } as any);
  assert.equal(res.status, 200);
  return await res.json() as any;
}
const bySlug = (body: any) => Object.fromEntries(body.items.map((i: any) => [i.slug, i]));

test('a market with only inherited sources reads none named, with no fresh band, and its inherited count beside it', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const d = db();
    mi(d, 'fred', '2026-11-18T00:00:00Z');
    mi(d, 'oecd', '2026-11-19T00:00:00Z');
    const body = await markets(d);
    const fin = bySlug(body).fintech;
    assert.deepEqual(fin.source_count, { status: 'not_recorded', value: null, reason: NO_SOURCE_REASON });
    assert.equal(fin.newest_source_at.status, 'not_recorded');
    assert.equal(fin.sources_by_kind.market_intel.count, 2, 'the inherited count is shown');
    assert.equal(body.facets.fresh.options.find((o: any) => o.value === 'none').count, 3, 'no band for inherited sources');
    assert.deepEqual(body.summary.fresh, { 30: 0, 90: 0, older: 0, none: 3 });
  } finally { mock.timers.reset(); }
});

test('fetching an annual sector figure again moves no band and no newest date', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const d = db();
    evidence(d, 'gdelt', '2026-11-01 09:00:00');
    mi(d, 'worldbank', '2026-11-01T00:00:00Z', { period: '2024', periodEnd: '2024-12-31', retrieved: '2026-11-01T00:00:00Z' });
    const before = bySlug(await markets(d)).payments;
    mi(d, 'worldbank', '2026-11-19T06:00:00Z', { period: '2024', periodEnd: '2024-12-31', retrieved: '2026-11-19T06:00:00Z' });
    const after = bySlug(await markets(d)).payments;
    for (const m of [before, after]) {
      assert.deepEqual(m.sources_by_kind.market_intel, { count: 1, newest: { status: 'recorded', value: '2024-12-31' }, basis: 'period_measured' });
      assert.deepEqual([m.newest_source_at.value, m.newest_source_basis], ['2026-11-01 09:00:00', 'reported']);
    }
    assert.equal(after.sources.find((s: any) => s.key === 'worldbank').rows, 1, 'one observation, fetched twice');
  } finally { mock.timers.reset(); }
});

test('the sector set is read over the index window: an older retrieval is outside it', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const d = db();
    assert.equal(windowStart(NOW), new Date(NOW - WINDOW_DAYS * 86_400_000).toISOString());
    mi(d, 'fred', '2026-10-20T23:59:59Z');   // one second before the window
    mi(d, 'arxiv', '2026-10-21T00:00:00Z');  // the window's first instant
    const body = await markets(d);
    assert.deepEqual(bySlug(body).fintech.sources.map((s: any) => s.key), ['arxiv']);
    assert.deepEqual(body.sector_window, { start: '2026-10-21T00:00:00.000Z', end: '2026-11-20T00:00:00.000Z', days: WINDOW_DAYS });
  } finally { mock.timers.reset(); }
});

test('every date in the payload names its basis', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const d = db();
    evidence(d, 'gdelt', '2026-11-10 09:00:00');
    mi(d, 'fred', '2026-11-18T00:00:00Z');
    mi(d, 'worldbank', '2026-11-18T00:00:00Z', { period: '2024', periodEnd: '2024-12-31', retrieved: '2026-11-18T00:00:00Z' });
    const body = await markets(d);
    let dates = 0;
    for (const m of body.items) {
      if (m.newest_source_at.status === 'recorded') { dates += 1; assert.ok(DATE_BASES.includes(m.newest_source_basis), m.slug); }
      else assert.equal(m.newest_source_basis, null, m.slug);
      for (const k of ['market_intel', 'signal_evidence']) {
        const kind = m.sources_by_kind[k];
        if (kind.newest.status === 'recorded') { dates += 1; assert.ok(DATE_BASES.includes(kind.basis), `${m.slug} ${k}`); }
        else assert.equal(kind.basis, null, `${m.slug} ${k}`);
      }
      for (const s of m.sources) if (s.newest) { dates += 1; assert.ok(DATE_BASES.includes(s.basis), `${m.slug} ${s.key}`); }
    }
    for (const s of body.summary.by_sector) {
      if (s.newest_sector_source.status === 'recorded') { dates += 1; assert.ok(DATE_BASES.includes(s.newest_sector_basis), s.sector); }
    }
    assert.ok(dates >= 8, 'the fixture dates something of every kind');
    // A period measured outranks a retrieval date in the same kind: fred's later fetch does not become the date.
    assert.deepEqual(bySlug(body).payments.sources_by_kind.market_intel,
      { count: 2, newest: { status: 'recorded', value: '2024-12-31' }, basis: 'period_measured' });
  } finally { mock.timers.reset(); }
});

test('the same source key in both sets counts once in the distinct total', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const d = db();
    evidence(d, 'gdelt', '2026-11-10 09:00:00');
    evidence(d, 'hn', '2026-11-11 09:00:00');
    mi(d, 'gdelt', '2026-11-18T00:00:00Z');
    mi(d, 'fred', '2026-11-18T00:00:00Z');
    const pay = bySlug(await markets(d)).payments;
    assert.equal(pay.sources_by_kind.market_intel.count + pay.sources_by_kind.signal_evidence.count, 4);
    assert.deepEqual(pay.distinct_source_count, { status: 'recorded', value: 3 }, 'gdelt is one source');
    assert.deepEqual(pay.source_count, { status: 'recorded', value: 2 }, 'the headline is the named evidence');
  } finally { mock.timers.reset(); }
});

test('facet counts add up to the total, with and without filters', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    const d = db();
    evidence(d, 'gdelt', '2026-11-10 09:00:00');
    mi(d, 'fred', '2026-11-18T00:00:00Z');
    for (const q of ['', '?src=named', '?fresh=none', '?src=sector']) {
      const body = await markets(d, q);
      for (const facet of ['fresh', 'src'] as const) {
        const sum = body.facets[facet].options.reduce((n: number, o: any) => n + o.count, 0);
        assert.equal(sum, body.facets[facet].total, `${facet} ${q}`);
      }
      const bands = Object.values(body.summary.fresh).reduce((n: number, v: any) => n + v, 0);
      assert.equal(bands, body.total, `summary bands ${q}`);
    }
  } finally { mock.timers.reset(); }
});
