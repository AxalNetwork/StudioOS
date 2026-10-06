/** D547 — real SQLite over the declared directory and MI migrations. */
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

import researchSectors, { sectorPeriods } from '../src/routes/research_sectors.ts';
import { EUR_SOURCE } from '../src/services/researchFundDirectory.ts';
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
  db.exec(migration('376'));
  db.exec(tableFrom('037', 'market_intel_rows'));
  db.exec(tableFrom('037', 'market_intel_indexes'));
  db.exec(migration('379'));

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
  db.prepare('UPDATE research_fund_directory SET source_name = ? WHERE uid = ?').run(EUR_SOURCE, 'f1');
  db.prepare('UPDATE signals SET build_opportunity = ?, why_now = ?, confidence_score = ? WHERE id = ?').run('{"headline":"Payment reconciliation","wedge":"Reconcile","icp":"Treasurers","risks":"Integration"}', 'New rails', 82, 's1');
  return db;
}


const app = new Hono();
app.route('/api/research', researchSectors as any);
app.onError((err: any, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function get(db: DatabaseSync, path: string, signedIn = true, wrap?: (binding: any) => any) {
  const headers: Record<string, string> = {};
  if (signedIn) headers.Authorization = `Bearer ${await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const binding = d1Over(db);
  const res = await app.fetch(new Request(`http://test/api/research${path}`, { headers }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: wrap ? wrap(binding) : binding } as any);
  return { status: res.status, body: await res.json() as any };
}
function seedIndex(db: DatabaseSync) {
  const periods = sectorPeriods();
  const insert = db.prepare(`INSERT INTO market_intel_indexes
    (sector, period_key, dimension, value, delta_pct, source_count, computed_at, basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run('Fintech / DeFi', periods.at(-1), 'research', 62, 4, 2, '2026-10-05T09:00:00Z', 'live');
  insert.run('Fintech / DeFi', periods.at(-3), 'research', 50, null, 1, '2026-08-31T09:00:00Z', 'live');
  insert.run('Fintech / DeFi', periods.at(-2), 'research', 99, 20, 2, '2026-09-30T09:00:00Z', 'stub');
  insert.run('Fintech / DeFi', periods.at(-1), 'capital', 99, null, 2, '2026-10-05T09:00:00Z', null);
  insert.run('Fintech / DeFi', periods.at(-1), 'supply', 88, null, 0, '2026-10-05T09:00:00Z', 'live');
  insert.run('Cybersecurity', periods.at(-1), 'research', 91, null, 2, '2026-10-05T09:00:00Z', 'live');
  const row = db.prepare(`INSERT INTO market_intel_rows (sector, source_key, metric_key, metric_value, ts, citation_url)
    VALUES ('Fintech / DeFi', ?, 'research', 0.5, ?, ?)`);
  row.run('openalex', `${periods.at(-1)}-02T09:00:00Z`, 'https://api.openalex.org/works');
  row.run('openalex', `${periods.at(-1)}-03T09:00:00Z`, 'https://api.openalex.org/works');
  row.run('crossref', `${periods.at(-1)}-04T09:00:00Z`, 'https://api.crossref.org/works');
  row.run('openalex', `${periods.at(-1)}-05T09:00:00Z`, 'https://axal.vc/market-intel/sources/openalex');
  row.run('arxiv', `${periods.at(-1)}-05T09:00:00Z`, '');
  return periods;
}

test('both sector routes require sign-in before touching directory data', async () => {
  const db = freshDb();
  for (const path of ['/sectors', '/sectors/fintech-defi']) assert.equal((await get(db, path, false)).status, 401);
});
test('the index returns all twelve sectors and counts through the crosswalk, without double-counting funds', async () => {
  const r = await get(freshDb(), '/sectors');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 12);
  const fin = r.body.items.find((s: any) => s.slug === 'fintech-defi');
  assert.equal(fin.name, 'Fintech / DeFi');
  assert.equal(fin.company_count, 3);
  assert.equal(fin.fund_count, 2);
  assert.deepEqual(Object.keys(fin.dimensions), ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment']);
});
test('live series keep twelve months and their gaps; missing and stub indexes are null, never fifty or zero', async () => {
  const db = freshDb(); const periods = seedIndex(db);
  assert.equal(periods.length, 12);
  const r = await get(db, '/sectors/fintech-defi');
  const d = r.body.dimensions.research;
  assert.equal(d.value, 62); assert.equal(d.change, 4); assert.equal(d.basis, 'live');
  assert.equal(d.computed_at, '2026-10-05T09:00:00Z');
  assert.deepEqual(d.points.map((p: any) => p.period), periods);
  assert.deepEqual(d.points.slice(-3).map((p: any) => p.value), [50, null, 62]);
  assert.equal(d.points.at(-1).month_to_date, true);
  assert.match(d.points.at(-2).reason, /No live source/);
  assert.equal(r.body.dimensions.capital.value, null);
  assert.equal(r.body.dimensions.supply.value, null);
});
test('source mix counts only cited live rows, with recorded names, shares and the month behind each point', async () => {
  const db = freshDb(); seedIndex(db);
  const mix = (await get(db, '/sectors/fintech-defi')).body.dimensions.research.points.at(-1).source_mix;
  assert.deepEqual(mix.map((s: any) => [s.source_key, s.rows, s.share]), [['openalex', 2, 2 / 3], ['crossref', 1, 1 / 3]]);
  assert.equal(mix[0].name, 'OpenAlex research velocity');
  assert.ok(mix.every((s: any) => s.name && s.latest));
});
test('sub-markets, countries and signals use mappings, not the raw broad-sector label', async () => {
  const r = await get(freshDb(), '/sectors/fintech-defi');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.companies.map((c: any) => c.uid), ['c1', 'c2', 'c5']);
  assert.deepEqual(r.body.companies_by_country.map((c: any) => [c.code, c.count]).sort(), [[null, 1], ['GB', 1], ['US', 1]].sort());
  assert.equal(r.body.companies_by_country.find((c: any) => c.code === 'GB').name, 'United Kingdom');
  assert.equal(r.body.sub_markets.find((m: any) => m.slug === 'fintech').company_count, 3);
  assert.deepEqual(r.body.signals.map((s: any) => s.id), ['s1']);
  assert.equal(r.body.signals[0].why_now, 'New rails');
  assert.equal(r.body.signals[0].confidence_score, 82);
  assert.match(r.body.signals[0].build_opportunity, /Payment reconciliation/);
});
test('fund sizes only total and sort where currency is known', async () => {
  const r = await get(freshDb(), '/sectors/fintech-defi');
  assert.deepEqual(r.body.funds.map((f: any) => f.uid), ['f1', 'f2']);
  assert.equal(r.body.funds[0].size_currency, 'EUR');
  assert.equal(r.body.funds[1].fund_size_cents, null);
  assert.match(r.body.funds[1].size_reason, /known currency/);
  assert.deepEqual(r.body.fund_sizes, { currency: 'EUR', comparable_count: 1, total_cents: 1000, reason: null });
  const empty = await get(freshDb(), '/sectors/quantum-infrastructure');
  assert.equal(empty.body.fund_sizes.total_cents, null);
  assert.match(empty.body.fund_sizes.reason, /No fund size/);
  assert.equal(empty.body.company_count, 0, 'zero here is a successful directory count');
});
test('no advisor note is read or returned; SQL binds sector values and rejects a slug injection', async () => {
  const queries: { sql: string; binds: unknown[] }[] = [];
  const r = await get(freshDb(), '/sectors/fintech-defi', true, (binding) => ({ ...binding,
    prepare(sql: string) {
      const stmt = binding.prepare(sql);
      return { ...stmt, bind(...binds: unknown[]) { queries.push({ sql, binds }); return stmt.bind(...binds); } };
    },
  }));
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('SECRET ADVISOR NOTE'));
  assert.ok(!('advisor_note' in r.body.signals[0]));
  const selection = queries.filter((q) => q.sql.includes('market_intel_'));
  assert.equal(selection.length, 2);
  assert.ok(selection.every((q) => !q.sql.includes('Fintech / DeFi') && q.binds.includes('Fintech / DeFi')));
  const bad = await get(freshDb(), `/sectors/${encodeURIComponent("fintech-defi' OR 1=1 --")}`);
  assert.equal(bad.status, 404);
});
test('every failed sector read is 503 Unreadable rather than a successful empty or zero answer', async () => {
  for (const table of ['research_market_directory', 'research_market_sectors', 'research_taxonomy_overrides',
    'research_company_directory', 'research_fund_directory', 'research_countries', 'market_intel_indexes', 'market_intel_rows', 'signals']) {
    const wrap = (binding: any) => ({ ...binding, prepare(sql: string) {
      if (sql.includes(`FROM ${table}`)) throw new Error('simulated read failure');
      return binding.prepare(sql);
    } });
    for (const path of table === 'signals' ? ['/sectors/fintech-defi'] : ['/sectors', '/sectors/fintech-defi']) {
      const r = await get(freshDb(), path, true, wrap);
      assert.equal(r.status, 503, `${table}: ${path}`);
      assert.equal(r.body.error, 'sector_unreadable');
      assert.equal(r.body.message, 'Unreadable');
    }
  }
});
