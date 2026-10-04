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

import researchMarkets from '../src/routes/research_markets.ts';
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
  db.exec(tableFrom('229', 'research_market_directory'));
  db.exec(tableFrom('365', 'research_fund_directory'));
  db.exec(tableFrom('136', 'signals'));
  db.exec(migration('376'));

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
                        VALUES (?, ?, ?, ?, ?, 'EuroTech', 'https://sheet.example', '2026-09-29')`);
  f.run('f1', 'Small Fin Fund', 'UK', 'Fintech · B2B', 1_000);
  f.run('f2', 'Big Fin Fund', 'Bay Area, Israel', 'Insurtech, Fintech', 9_000);
  f.run('f3', 'Generalist Fund', 'Germany', 'Generalist', 5_000);
  f.run('f4', 'Nowhere Fund', 'Global', 'Mobility', null);

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
  for (const p of ['/markets', '/markets/fintech', '/geographies', '/geographies/GB']) {
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
