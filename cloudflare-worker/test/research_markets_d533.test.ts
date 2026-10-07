/**
 * D533 — Research · Markets and · Geographies routes (routes/research_markets.ts).
 *
 * Runs on real SQLite with the directory tables cut from their migrations
 * (228, 229, 365, 136) and migration 376 applied whole, so the route's own SQL
 * and the crosswalk decide every row that comes back. Mounted behind the same
 * auth-error mapping `index.ts` uses, so a missing token answers 401.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import researchMarkets, { indexSeries } from '../src/routes/research_markets.ts';
import { EUR_SOURCE } from '../src/services/researchFundDirectory.ts';
import { periodKey } from '../src/services/market_intel/scoring.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function migration(prefix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)) as string;
  return readFileSync(resolve(MIGRATIONS, file), 'utf8');
}
function tableFrom(prefix: string, table: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)
    && readFileSync(resolve(MIGRATIONS, f), 'utf8').includes(`CREATE TABLE IF NOT EXISTS ${table}`)) as string;
  assert.ok(file, `no migration ${prefix} declares ${table}`);
  const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `migration ${prefix} no longer declares ${table}`);
  // The statement ends at the first ");" that closes a line, not one inside a
  // quoted default ('CC0 (Wikidata data); ...').
  const end = sql.slice(start).search(/\);\s*(\n|$)/);
  return stripForeignKeys(sql.slice(start, start + end + 2));
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.prepare('INSERT INTO users (id, role) VALUES (1, ?)').run('founder');
  db.exec(tableFrom('228', 'research_company_directory'));
  db.exec(migration('375'));
  db.exec(tableFrom('229', 'research_market_directory'));
  db.exec(tableFrom('365', 'research_fund_directory'));
  db.exec(tableFrom('136', 'signals'));
  db.exec(tableFrom('136', 'signal_companies'));
  db.exec(migration('376'));
  db.exec(tableFrom('037', 'market_intel_rows'));
  db.exec(tableFrom('037', 'market_intel_indexes'));
  db.exec(migration('379'));
  db.exec(migration('404'));

  const m = db.prepare(`INSERT INTO research_market_directory (slug, name, company_count, source_name, source_boundary, as_of)
                        VALUES (?, ?, ?, 'Axal', 'supplied', '2026-09-30')`);
  m.run('fintech', 'FinTech', 900);
  m.run('autotech', 'AutoTech', 300);
  m.run('fashion', 'Fashion', 50);
  m.run('payments', 'Payments', 10);

  const c = db.prepare(`INSERT INTO research_company_directory (uid, name, website, country, sector, source_url, as_of)
                        VALUES (?, ?, 'https://x.example', ?, ?, 'https://wikidata.example', '2026-09-30')`);
  c.run('c1', 'Alpha Bank', 'United Kingdom', 'bank');
  c.run('c2', 'Beta Pay', 'United States', 'financial services');
  c.run('c3', 'Gamma Motors', 'Japan', 'automotive industry');
  c.run('c4', 'Delta Group', 'United Kingdom', 'conglomerate');
  c.run('c5', 'Epsilon Fin', 'Not recorded', 'fintech');

  const f = db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, sector_focus, fund_size_cents, source_name, source_url, as_of)
                        VALUES (?, ?, ?, ?, ?, ?, 'https://sheet.example', '2026-09-29')`);
  f.run('f1', 'Small Fin Fund', 'UK', 'Fintech · B2B', 1_000, EUR_SOURCE);
  f.run('f2', 'Big Fin Fund', 'Bay Area, Israel', 'Insurtech, Fintech', 9_000, EUR_SOURCE);
  f.run('f3', 'Generalist Fund', 'Germany', 'Generalist', 5_000, EUR_SOURCE);
  f.run('f4', 'Nowhere Fund', 'Global', 'Mobility', null, EUR_SOURCE);

  const s = db.prepare(`INSERT INTO signals (id, type, title, thesis, region, country, sector, niche, market_cap_band, tags, status, advisor_note, rank_score)
                        VALUES (?, 'x', ?, 't', 'r', ?, 'Financial Services', 'n', 'mid', ?, ?, 'SECRET ADVISOR NOTE', ?)`);
  s.run('s1', 'Payments rails', 'United Kingdom', '["payments","fintech"]', 'active', 2);
  s.run('s2', 'Archived fintech', 'United Kingdom', '["fintech"]', 'archived', 3);
  s.run('s3', 'Ops software', 'United States', '["vertical-saas"]', 'active', 1);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/research', researchMarkets as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function get(db: DatabaseSync, path: string, signedIn = true) {
  const headers: Record<string, string> = {};
  if (signedIn) {
    const tok = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${tok}`;
  }
  const res = await app.fetch(new Request(`http://x/api/research${path}`, { headers }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('every route is signed-in only', async () => {
  const db = freshDb();
  for (const p of ['/markets', '/markets/fintech', '/geographies', '/geographies/GB', '/listed-companies']) {
    assert.equal((await get(db, p, false)).status, 401, p);
  }
});

test('the market index: company counts from D1, supplied counts labelled apart, total and unmapped', async () => {
  const r = await get(freshDb(), '/markets');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4);
  const fin = r.body.items.find((i: any) => i.slug === 'fintech');
  assert.equal(fin.company_count, 3, 'bank, financial services and fintech all map to FinTech');
  assert.equal(fin.supplied_count, 900);
  assert.match(fin.supplied_label, /not independently verified/);
  assert.equal(fin.mi_sector, 'Fintech / DeFi');
  assert.equal(r.body.items.find((i: any) => i.slug === 'fashion').company_count, 0);
  assert.equal(r.body.companies_unmapped, 1, 'the conglomerate is counted as unmapped, not dropped');
});

test('the market index searches by a bound parameter, sorts and pages', async () => {
  const db = freshDb();
  const q = await get(db, '/markets?q=tech');
  assert.deepEqual(q.body.items.map((i: any) => i.slug), ['autotech', 'fintech']);
  assert.equal(q.body.total, 2);
  const inj = await get(db, `/markets?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(inj.status, 200);
  assert.equal(inj.body.total, 0, 'the search text reached the SQL as text');
  const sorted = await get(db, '/markets?sort=supplied_count&dir=desc');
  assert.deepEqual(sorted.body.items.map((i: any) => i.slug), ['fintech', 'autotech', 'fashion', 'payments']);
  const byCo = await get(db, '/markets?sort=company_count');
  assert.equal(byCo.body.items[0].slug, 'fintech');
  assert.equal(byCo.body.dir, 'desc');
  const page = await get(db, '/markets?limit=2&offset=2');
  assert.deepEqual(page.body.items.map((i: any) => i.slug), ['fintech', 'payments']);
  assert.equal(page.body.total, 4, 'total counts every match, not the page');
  const bad = await get(db, '/markets?sort=drop&limit=-5&offset=abc');
  assert.deepEqual([bad.body.sort, bad.body.limit, bad.body.offset], ['name', 1, 0]);
  assert.equal((await get(db, '/markets?limit=5000')).body.limit, 100);
});

test('one market: companies, companies by country, funds by size, signals, sub-markets', async () => {
  const r = await get(freshDb(), '/markets/fintech');
  assert.equal(r.status, 200);
  assert.equal(r.body.company_count, 3);
  assert.deepEqual(r.body.companies.map((c: any) => c.uid), ['c1', 'c2', 'c5']);
  assert.deepEqual(r.body.companies_by_country, [
    { code: null, name: null, count: 1 },
    { code: 'GB', name: 'United Kingdom', count: 1 },
    { code: 'US', name: 'United States', count: 1 },
  ].sort((a, b) => b.count - a.count || String(a.code ?? '').localeCompare(String(b.code ?? ''))));
  assert.deepEqual(r.body.funds.map((f: any) => f.uid), ['f2', 'f1'], 'largest fund first; the generalist is not here');
  assert.deepEqual(r.body.funds[0].country_codes, ['IL', 'US']);
  assert.deepEqual(r.body.signals.map((s: any) => s.id), ['s1'], 'archived signals and unmatched tags are left out');
  assert.deepEqual(r.body.sub_markets.fund_focus, [{ label: 'Fintech', count: 2 }]);
  assert.deepEqual(r.body.sub_markets.company_sectors.map((x: any) => x.label).sort(), ['bank', 'financial services', 'fintech']);
  assert.equal(r.body.sector.mi_sector, 'Fintech / DeFi');
});

test('a signal never carries advisor_note', async () => {
  const db = freshDb();
  for (const p of ['/markets/fintech', '/markets/payments', '/geographies/GB']) {
    const r = await get(db, p);
    assert.ok(!JSON.stringify(r.body).includes('SECRET ADVISOR NOTE'), p);
    for (const s of r.body.signals) assert.ok(!('advisor_note' in s), p);
  }
  assert.deepEqual((await get(db, '/markets/payments')).body.signals.map((s: any) => s.id), ['s1']);
});

test('an unknown market is 404, and a market with no sector says so', async () => {
  const db = freshDb();
  assert.equal((await get(db, '/markets/nope')).status, 404);
  const r = await get(db, '/markets/fashion');
  assert.equal(r.body.sector.mi_sector, null);
  assert.equal(r.body.company_count, 0);
  assert.deepEqual(r.body.companies, []);
});

test('geographies: counts per country, unmapped counted, multi-country HQs counted in each', async () => {
  const r = await get(freshDb(), '/geographies');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.items.map((i: any) => [i.code, i]));
  assert.deepEqual([by.GB.company_count, by.GB.fund_count], [2, 1]);
  assert.deepEqual([by.US.company_count, by.US.fund_count], [1, 1]);
  assert.equal(by.IL.fund_count, 1);
  assert.equal(by.FR, undefined, 'a country with nothing is hidden by default');
  assert.equal(r.body.companies_unmapped, 1);
  assert.equal(r.body.funds_unmapped, 1, '"Global" places no fund');
  assert.equal(r.body.total, r.body.items.length);
});

test('geographies filter by region and search, sort, page, and can list every country', async () => {
  const db = freshDb();
  const eu = await get(db, '/geographies?region=Europe');
  assert.deepEqual(eu.body.items.map((i: any) => i.code), ['DE', 'GB']);
  assert.deepEqual((await get(db, '/geographies?q=united')).body.items.map((i: any) => i.code), ['GB', 'US']);
  assert.equal((await get(db, '/geographies?q=jp')).body.items[0].code, 'JP');
  const top = await get(db, '/geographies?sort=company_count&limit=1');
  assert.deepEqual([top.body.items[0].code, top.body.total], ['GB', 5], 'GB, US, JP, IL, DE hold data');
  const all = await get(db, '/geographies?with_data=0&limit=100');
  assert.equal(all.body.total, 66);
});

test('one country: companies by market, funds headquartered there, its signals', async () => {
  const db = freshDb();
  const r = await get(db, '/geographies/gb');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.item, { code: 'GB', name: 'United Kingdom', region: 'Europe' });
  assert.deepEqual(r.body.companies_by_market, [
    { slug: null, name: null, count: 1 },
    { slug: 'fintech', name: 'FinTech', count: 1 },
  ]);
  assert.deepEqual(r.body.companies.map((c: any) => c.uid), ['c1', 'c4']);
  assert.deepEqual(r.body.funds.map((f: any) => f.uid), ['f1']);
  assert.deepEqual(r.body.signals.map((s: any) => s.id), ['s1']);
  const us = await get(db, '/geographies/US');
  assert.deepEqual(us.body.funds.map((f: any) => f.uid), ['f2']);
  assert.deepEqual(us.body.signals.map((s: any) => s.id), ['s3']);
});

test('an unknown or malformed country code is 404', async () => {
  const db = freshDb();
  for (const p of ['/geographies/ZZ', '/geographies/GBR', `/geographies/${encodeURIComponent("G'")}`]) {
    assert.equal((await get(db, p)).status, 404, p);
  }
});

// --- the market index: live rows only --------------------------------------------

function seedIndex(db: DatabaseSync) {
  const i = db.prepare(`INSERT INTO market_intel_indexes (sector, geo, period_key, dimension, value, delta_pct, source_count, basis)
                        VALUES ('Fintech / DeFi', 'global', ?, ?, ?, ?, ?, ?)`);
  i.run('2026-07', 'demand', 40, null, 2, 'live');
  i.run('2026-08', 'demand', 44.5, null, 2, 'live');
  i.run('2026-10', 'demand', 50, null, 1, 'live');         // September missing: no change
  i.run('2026-09', 'capital', 30, 7.5, 1, 'live');         // a written delta wins
  i.run('2026-09', 'supply', 50, null, 0, 'live');          // no source: the neutral 50 is not a reading
  i.run('2026-09', 'talent', 61, null, 3, null);            // pre-D538 stub index
  const r = db.prepare(`INSERT INTO market_intel_rows (source_key, sector, metric_key, metric_value, ts, citation_url)
                        VALUES (?, 'Fintech / DeFi', 'm', 0.5, ?, ?)`);
  r.run('fred', '2026-10-01T00:00:00Z', 'https://fred.stlouisfed.org/series/X');
  r.run('fred', '2026-10-02T00:00:00Z', 'https://fred.stlouisfed.org/series/Y');
  r.run('arxiv', '2026-09-01T00:00:00Z', 'https://arxiv.org/abs/1');
  r.run('reddit', '2026-10-03T00:00:00Z', 'https://axal.vc/market-intel/sources/reddit');  // stub
  r.run('oecd', '2026-10-03T00:00:00Z', null);                                              // uncited
}

test('a market with live index rows gets monthly series; stubs and sourceless points never appear', async () => {
  const db = freshDb();
  seedIndex(db);
  const r = await get(db, '/markets/fintech');
  const ix = r.body.index;
  assert.equal(ix.sector, 'Fintech / DeFi');
  assert.equal(ix.reason, null);
  assert.deepEqual(ix.series.demand.points.map((p: any) => [p.period, p.value, p.change, p.change_basis]), [
    ['2026-07', 40, null, null],
    ['2026-08', 44.5, 4.5, 'previous_month'],
    ['2026-10', 50, null, null],
  ]);
  assert.deepEqual(ix.series.capital.points.map((p: any) => [p.change, p.change_basis]), [[7.5, 'delta_pct']]);
  assert.equal(ix.series.supply.status, 'not_recorded', 'a 50 from no source is not a reading');
  assert.equal(ix.series.talent.status, 'not_recorded', 'an index from before D538 is a stub');
  assert.match(ix.series.talent.reason, /No live source/);
  assert.deepEqual(ix.source_mix.map((m: any) => [m.source_key, m.rows]), [['fred', 2], ['arxiv', 1]]);
});

test('a market with no live data, or no sector, says Not recorded and why', async () => {
  const db = freshDb();
  const none = (await get(db, '/markets/fintech')).body.index;
  assert.match(none.reason, /No live source/);
  for (const d of ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment']) {
    assert.deepEqual([none.series[d].status, none.series[d].points], ['not_recorded', []], d);
  }
  assert.deepEqual(none.source_mix, []);
  seedIndex(db);
  const fashion = (await get(db, '/markets/fashion')).body.index;
  assert.equal(fashion.sector, null);
  assert.match(fashion.reason, /no market-intelligence sector/);
  assert.equal(fashion.series.demand.status, 'not_recorded');
});

test('the series keeps the last six months and marks the current month as month to date', () => {
  const now = periodKey();
  const rows = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'].map((p, n) =>
    ({ period_key: p, dimension: 'research', value: n, delta_pct: null, source_count: 1 }));
  rows.push({ period_key: now, dimension: 'research', value: 9, delta_pct: null, source_count: 1 });
  const s: any = indexSeries(rows, now, 'r');
  assert.equal(s.research.points.length, 6);
  assert.equal(s.research.points.at(-1).month_to_date, true);
  assert.equal(s.research.points[0].month_to_date, false);
  const jan: any = indexSeries([{ period_key: '2026-01', dimension: 'demand', value: 5, delta_pct: null, source_count: 1 },
    { period_key: '2025-12', dimension: 'demand', value: 2, delta_pct: null, source_count: 1 }], now, 'r');
  assert.equal(jan.demand.points[1].change, 3, 'January follows December of the year before');
});

// --- the currency rule, the complete geography reads, listed companies --------------

test('funds follow the currency rule: only the EuroTech list carries a size, in euros', async () => {
  const db = freshDb();
  // A size from another list is a number in no known currency: it is not a size.
  db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, sector_focus, fund_size_cents, source_name, source_url, as_of)
              VALUES ('f5', 'Huge Other-List Fund', 'UK', 'Fintech', 99_000_000, 'Some other list', 'https://o.example', '2026-09-28')`).run();
  const r = await get(db, '/markets/fintech');
  const by = Object.fromEntries(r.body.funds.map((x: any) => [x.uid, x]));
  assert.deepEqual([by.f2.fund_size_cents, by.f2.size_currency], [9_000, 'EUR']);
  assert.deepEqual([by.f5.fund_size_cents, by.f5.size_currency], [null, null], 'a size in no known currency is not printed');
  assert.match(by.f5.size_reason, /no size in a known currency/);
  assert.deepEqual(r.body.funds.map((x: any) => x.uid), ['f2', 'f1', 'f5'], 'euro sizes rank; the other list follows, however large its number');
  const gb = await get(db, '/geographies/GB');
  assert.equal(gb.body.funds.find((x: any) => x.uid === 'f5').fund_size_cents, null);
});

function seedGeo(db: DatabaseSync) {
  const u = db.prepare(`UPDATE research_company_directory SET employee_count = ?, employee_as_of = ?,
    last_funding_amount = ?, last_funding_currency = ?, last_funding_date = ?, last_funding_type = ? WHERE uid = ?`);
  u.run(120, '2026-09-01', 5_000_000, 'GBP', '2026-03-01', 'Series A', 'c4');
  u.run(null, null, null, null, null, null, 'c1');
  db.prepare(`INSERT INTO research_company_directory (uid, name, website, country, sector, source_url, as_of, employee_count)
              VALUES ('c6', 'Zeta Labs', 'https://z.example', 'United Kingdom', NULL, 'https://wikidata.example', '2026-09-30', 4000)`).run();
  const f = db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, sector_focus, fund_size_cents, fund_year, eif_flag, eifo_flag, notable_lps, source_name, source_url, as_of)
                        VALUES (?, ?, 'London', ?, ?, ?, ?, ?, ?, ?, 'https://sheet.example', ?)`);
  f.run('g1', 'London Seed', 'Fintech, AI', 30_000_000_00, 2021, 1, 0, null, EUR_SOURCE, '2026-09-29');
  f.run('g2', 'London Growth', 'AI', 600_000_000_00, null, 0, 0, 'Pension funds', EUR_SOURCE, '2026-09-30');
  f.run('g3', 'London Other', '', 70_000_000_00, 2019, 0, 0, null, 'Some other list', '2026-09-27');
  const s = db.prepare(`INSERT INTO signals (id, type, title, thesis, region, country, sector, niche, market_cap_band, tags, status, rank_score, build_opportunity, confidence_score, updated_at)
                        VALUES (?, 'x', ?, 't', ?, ?, 'Technology', 'n', 'mid', '[]', 'active', ?, ?, 0.7, ?)`);
  db.exec(`UPDATE signals SET updated_at = '2026-09-01 00:00:00'`);
  s.run('r1', 'Europe-wide ops', 'Europe', 'Germany', 0.5, '{"headline":"Ops for EU SMBs"}', '2026-10-02 00:00:00');
  s.run('r2', 'Brazil rails', 'Latin America', 'Brazil', 0.4, 'not json', '2026-10-01 00:00:00');
}

test('one country: largest companies by headcount, with the last round; labels and the unlabelled counted', async () => {
  const db = freshDb();
  seedGeo(db);
  const r = await get(db, '/geographies/GB');
  assert.deepEqual(r.body.companies.map((c: any) => c.uid), ['c6', 'c4', 'c1'], 'headcount first; none follows, by name');
  const c4 = r.body.companies.find((c: any) => c.uid === 'c4');
  assert.deepEqual([c4.employee_count, c4.employee_as_of], [120, '2026-09-01']);
  assert.deepEqual(c4.last_round, { amount: 5_000_000, currency: 'GBP', date: '2026-03-01', type: 'Series A' });
  assert.equal(r.body.companies.find((c: any) => c.uid === 'c1').last_round, null, 'no round recorded is null, not zero');
  assert.deepEqual(r.body.companies_by_label, [{ label: 'bank', count: 1 }, { label: 'conglomerate', count: 1 }]);
  assert.equal(r.body.companies_without_label, 1);
  assert.deepEqual(r.body.totals, { companies: 6, funds: 7, signals: 4 });
  assert.deepEqual(r.body.as_of, { companies: '2026-09-30', funds: '2026-09-30', signals: '2026-10-02 00:00:00' });
  assert.equal(r.body.demand.status, 'not_recorded');
  assert.match(r.body.demand.reason, /global only/);
});

test('one country: funds with EIF and EIFO as known or unknown, and their aggregates in euros', async () => {
  const db = freshDb();
  seedGeo(db);
  const r = await get(db, '/geographies/GB');
  assert.deepEqual(r.body.funds.map((f: any) => f.uid), ['g2', 'g1', 'f1', 'g3']);
  const by = Object.fromEntries(r.body.funds.map((f: any) => [f.uid, f]));
  assert.deepEqual([by.g1.eif, by.g1.eifo], [true, null], 'EIF named; EIFO unknown when no LPs are listed');
  assert.deepEqual([by.g2.eif, by.g2.eifo], [false, false], 'with LPs named, an unflagged backer is a no');
  const a = r.body.fund_aggregates;
  assert.deepEqual([a.count, a.with_size, a.size_not_recorded, a.with_vintage, a.with_focus, a.no_focus], [4, 3, 1, 2, 3, 1]);
  assert.deepEqual(Object.fromEntries(a.size_bands.map((b: any) => [b.key, b.count])),
    { lt50: 2, '50to150': 0, '150to500': 0, gte500: 1 }, 'f1 (€10) and g1 (€30M) under €50M; g3 is not a euro size');
  assert.deepEqual(a.focus_keywords, [{ label: 'AI', count: 2 }, { label: 'B2B', count: 1 }, { label: 'Fintech', count: 2 }]
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label)));
  assert.equal(a.as_of, '2026-09-30');
});

test('one country: signals that name it first, then those that name only its region, each marked', async () => {
  const db = freshDb();
  seedGeo(db);
  const r = await get(db, '/geographies/GB');
  assert.deepEqual(r.body.signals.map((s: any) => [s.id, s.match]), [['s1', 'country'], ['r1', 'region']]);
  assert.equal(r.body.signals[1].build_headline, 'Ops for EU SMBs');
  assert.equal(r.body.signals[0].build_headline, null, 'no headline written is null');
  const br = await get(db, '/geographies/BR');
  assert.deepEqual(br.body.signals.map((s: any) => [s.id, s.match]), [['r2', 'country']]);
  assert.equal(br.body.signals[0].build_headline, null, 'unreadable JSON is no headline, not an error');
  for (const s of r.body.signals) assert.ok(!('advisor_note' in s));
});

function seedListed(db: DatabaseSync) {
  const l = db.prepare(`INSERT INTO signal_companies (symbol, name, exchange, country, region, sector, market_cap, market_cap_band, employee_band, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  l.run('NU', 'Nu Holdings', 'NYSE', 'Brazil', 'Latin America', 'Financial Services', 55e9, 'large', '5k-20k', '2026-10-01 00:00:00');
  l.run('TOST', 'Toast', 'NYSE', 'United States', 'North America', 'Technology', 22e9, 'large', '1k-5k', '2026-10-02 00:00:00');
  l.run('DLO', 'DLocal', 'NASDAQ', 'Uruguay', 'Latin America', 'Financial Services', 3e9, 'mid', '201-1k', '2026-09-30 00:00:00');
  l.run('ZZZ', 'Quiet Co', null, null, null, 'Technology', null, null, null, '2026-09-29 00:00:00');
}

test('listed companies: the bands as the source sets them, largest cap first, unknown cap last', async () => {
  const db = freshDb();
  seedListed(db);
  const r = await get(db, '/listed-companies');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: any) => i.symbol), ['NU', 'TOST', 'DLO', 'ZZZ']);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['country', 'country_code', 'employee_band', 'exchange', 'market_cap_band',
    'name', 'region', 'sector', 'source', 'symbol', 'updated_at']);
  assert.deepEqual([r.body.items[0].country_code, r.body.items[3].country_code], ['BR', null]);
  assert.deepEqual([r.body.total, r.body.sort, r.body.as_of], [4, '-market_cap', '2026-10-02 00:00:00']);
  assert.deepEqual((await get(db, '/listed-companies?sort=market_cap')).body.items.map((i: any) => i.symbol), ['DLO', 'TOST', 'NU', 'ZZZ']);
  assert.deepEqual((await get(db, '/listed-companies?sort=name')).body.items.map((i: any) => i.symbol), ['DLO', 'NU', 'ZZZ', 'TOST']);
  assert.deepEqual((await get(db, '/listed-companies?sort=-name')).body.items.map((i: any) => i.symbol), ['TOST', 'ZZZ', 'NU', 'DLO']);
  assert.equal((await get(db, '/listed-companies?sort=drop')).body.sort, '-market_cap');
});

test('listed companies: search, sector and country filter by bound parameters; paging keeps the total', async () => {
  const db = freshDb();
  seedListed(db);
  assert.deepEqual((await get(db, '/listed-companies?q=toa')).body.items.map((i: any) => i.symbol), ['TOST']);
  assert.deepEqual((await get(db, '/listed-companies?q=TOS')).body.items.map((i: any) => i.symbol), ['TOST'], 'a symbol prefix the name does not contain');
  const fs = await get(db, `/listed-companies?sector=${encodeURIComponent('Financial Services')}`);
  assert.deepEqual([fs.body.items.map((i: any) => i.symbol), fs.body.total], [['NU', 'DLO'], 2]);
  assert.deepEqual((await get(db, '/listed-companies?country=us')).body.items.map((i: any) => i.symbol), ['TOST']);
  const inj = await get(db, `/listed-companies?q=${encodeURIComponent("' OR 1=1 --")}&sector=${encodeURIComponent("x' OR '1'='1")}`);
  assert.deepEqual([inj.status, inj.body.total], [200, 0], 'the text reached the SQL as text');
  const page = await get(db, '/listed-companies?limit=2&offset=1');
  assert.deepEqual([page.body.items.map((i: any) => i.symbol), page.body.total], [['TOST', 'DLO'], 4]);
});

test('listed companies: a failed read is a 503 refusal, never an empty list', async () => {
  const db = freshDb();
  seedListed(db);
  db.exec('DROP TABLE signal_companies');
  const r = await get(db, '/listed-companies');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'listed_companies_unreadable');
  assert.equal('items' in r.body, false);
  assert.doesNotMatch(JSON.stringify(r.body), /no such table/);
});

// --- D595 (#1230): SEC EDGAR's companies on the Public tab ---------------------------

const EDGAR_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
function seedEdgar(db: DatabaseSync) {
  const e = db.prepare(`INSERT OR IGNORE INTO research_public_companies
    (cik, name, ticker, exchange, other_listings, source_name, source_url, licence, as_of)
    VALUES (?, ?, ?, ?, ?, 'SEC EDGAR', ?, 'US government work', ?)`);
  e.run('0000000003', 'Charlie Corp', 'CHAR', 'NYSE', null, EDGAR_URL, '2026-10-05');
  e.run('0000000001', 'Alpha Inc', 'ALPH', 'Nasdaq', '[["ALPHB","Nasdaq"]]', EDGAR_URL, '2026-10-06');
  e.run('0000000002', 'bravo holdings', 'BRAV', null, null, EDGAR_URL, '2026-10-06');
  e.run('0001691493', 'Nu Holdings Ltd.', 'NU', 'NYSE', null, EDGAR_URL, '2026-10-06');
  e.run('0000000001', 'Alpha Duplicate', 'ALPX', 'NYSE', null, EDGAR_URL, '2026-10-06');
}

test('listed companies: EDGAR rows follow the signal companies, labelled, carrying only what EDGAR records', async () => {
  const db = freshDb();
  seedListed(db);
  seedEdgar(db);
  const r = await get(db, '/listed-companies?limit=100');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: any) => [i.source, i.symbol]), [
    ['signal_companies', 'NU'], ['signal_companies', 'TOST'], ['signal_companies', 'DLO'], ['signal_companies', 'ZZZ'],
    ['sec_edgar', 'ALPH'], ['sec_edgar', 'BRAV'], ['sec_edgar', 'CHAR'], ['sec_edgar', 'NU'],
  ]);
  assert.equal(r.body.total, 8, 'one row per CIK: the duplicate CIK was ignored');
  const alpha = r.body.items[4];
  assert.deepEqual(Object.keys(alpha).sort(), ['as_of', 'cik', 'exchange', 'licence', 'name', 'other_listings', 'source', 'source_url', 'symbol'],
    'no band, country or sector EDGAR does not record');
  assert.deepEqual([alpha.cik, alpha.name, alpha.source_url], ['0000000001', 'Alpha Inc', EDGAR_URL]);
  assert.deepEqual(alpha.other_listings, [{ symbol: 'ALPHB', exchange: 'Nasdaq' }]);
  assert.equal(r.body.items[5].exchange, null, 'an exchange EDGAR does not record stays null');
  const [sig, edgar] = r.body.sources;
  assert.deepEqual([sig.key, sig.total, edgar.key, edgar.label, edgar.total, edgar.store_total, edgar.as_of, edgar.url],
    ['signal_companies', 4, 'sec_edgar', 'SEC EDGAR', 4, 4, '2026-10-06', EDGAR_URL]);
  assert.equal(edgar.also_signal_companies, 1, 'NU is in both stores, and the response says so');
  const desc = await get(db, '/listed-companies?sort=-name&source=sec_edgar');
  assert.deepEqual(desc.body.items.map((i: any) => i.symbol), ['NU', 'CHAR', 'BRAV', 'ALPH']);
});

test('listed companies: one list paged on the Worker across both stores, totals from the stores', async () => {
  const db = freshDb();
  seedListed(db);
  seedEdgar(db);
  const p1 = await get(db, '/listed-companies?limit=3&offset=0');
  const p2 = await get(db, '/listed-companies?limit=3&offset=3');
  const p3 = await get(db, '/listed-companies?limit=3&offset=6');
  assert.deepEqual(p1.body.items.map((i: any) => i.symbol), ['NU', 'TOST', 'DLO']);
  assert.deepEqual(p2.body.items.map((i: any) => [i.source, i.symbol]), [['signal_companies', 'ZZZ'], ['sec_edgar', 'ALPH'], ['sec_edgar', 'BRAV']]);
  assert.deepEqual(p3.body.items.map((i: any) => i.symbol), ['CHAR', 'NU']);
  for (const p of [p1, p2, p3]) assert.equal(p.body.total, 8);
  assert.deepEqual((await get(db, '/listed-companies?limit=3&offset=9')).body.items, []);
  const only = await get(db, '/listed-companies?source=sec_edgar&limit=2&offset=1');
  assert.deepEqual([only.body.items.map((i: any) => i.symbol), only.body.total, only.body.source], [['BRAV', 'CHAR'], 4, 'sec_edgar']);
  const sig = await get(db, '/listed-companies?source=signal_companies');
  assert.deepEqual([sig.body.total, sig.body.items.every((i: any) => i.source === 'signal_companies')], [4, true]);
  assert.equal((await get(db, '/listed-companies?source=drop')).body.total, 8, 'an unknown source is both');
});

test('listed companies: search reaches EDGAR by name or ticker prefix; sector and country leave EDGAR out', async () => {
  const db = freshDb();
  seedListed(db);
  seedEdgar(db);
  assert.deepEqual((await get(db, '/listed-companies?q=bravo')).body.items.map((i: any) => i.symbol), ['BRAV']);
  assert.deepEqual((await get(db, '/listed-companies?q=CHA')).body.items.map((i: any) => i.symbol), ['CHAR']);
  const nu = await get(db, '/listed-companies?q=Nu');
  assert.deepEqual(nu.body.items.map((i: any) => [i.source, i.symbol]), [['signal_companies', 'NU'], ['sec_edgar', 'NU']]);
  assert.equal(nu.body.sources[1].store_total, 4, 'the store total is the whole store, whatever the search');
  const fs = await get(db, `/listed-companies?sector=${encodeURIComponent('Financial Services')}`);
  assert.deepEqual([fs.body.total, fs.body.sources[1].total], [2, 0], 'EDGAR records no sector');
  assert.deepEqual((await get(db, '/listed-companies?country=US')).body.total, 1, 'EDGAR records no country');
  const inj = await get(db, `/listed-companies?source=sec_edgar&q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.deepEqual([inj.status, inj.body.total], [200, 0], 'the text reached the SQL as text');
});

test('listed companies: an unreadable EDGAR store is a 503 refusal, never zero', async () => {
  const db = freshDb();
  seedListed(db);
  db.exec('DROP TABLE research_public_companies');
  const r = await get(db, '/listed-companies');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'listed_companies_unreadable');
  assert.equal('items' in r.body, false);
  assert.equal('total' in r.body, false);
});

test('listed companies: an empty EDGAR store reads zero from the store, not a failure', async () => {
  const db = freshDb();
  seedListed(db);
  const r = await get(db, '/listed-companies');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.total, r.body.sources[1].total, r.body.sources[1].store_total, r.body.sources[1].as_of], [4, 0, 0, null]);
});

test('listed companies: migration 412\'s rows page and count from the store', async () => {
  const db = freshDb();
  db.exec(readFileSync(resolve(MIGRATIONS, '412_research_public_companies_edgar.sql'), 'utf8'));
  const n = (db.prepare('SELECT COUNT(*) AS n FROM research_public_companies').get() as { n: number }).n;
  const distinct = (db.prepare('SELECT COUNT(DISTINCT cik) AS n FROM research_public_companies').get() as { n: number }).n;
  assert.equal(n, 8016);
  assert.equal(distinct, n, 'unique by CIK');
  const page = await get(db, '/listed-companies?source=sec_edgar&sort=name&limit=50&offset=0');
  assert.equal(page.status, 200);
  assert.equal(page.body.items.length, 50);
  assert.equal(page.body.total, 8016);
  const edgar = page.body.sources.find((s: any) => s.key === 'sec_edgar');
  assert.deepEqual([edgar.total, edgar.store_total, edgar.label], [8016, 8016, 'SEC EDGAR']);
  assert.equal(page.body.items.every((i: any) => i.source === 'sec_edgar' && i.cik && !('market_cap_band' in i)), true);
  const next = await get(db, '/listed-companies?source=sec_edgar&sort=name&limit=50&offset=50');
  assert.equal(next.body.total, 8016);
  const seen = new Set(page.body.items.map((i: any) => i.cik));
  for (const item of next.body.items) assert.equal(seen.has(item.cik), false, item.cik);
  const apple = await get(db, '/listed-companies?source=sec_edgar&q=AAPL');
  const row = apple.body.items.find((i: any) => i.cik === '0000320193');
  assert.deepEqual([row?.symbol, row?.name, row?.source], ['AAPL', 'Apple Inc.', 'sec_edgar']);
  assert.equal(apple.body.sources.find((s: any) => s.key === 'sec_edgar').store_total, 8016, 'the store total is the whole store, whatever the search');
});
