/**
 * D534 (#1079), the Worker half — the company directory on the server, and
 * one company with its evidence and peers, on real SQLite.
 *
 * Tables: migration 228 (CREATE statements only, so the rows are the test's
 * own), 375's 24 columns, and 370's four evidence tables. Pins: the sign-in
 * gate; each filter, the sort, paging and `total`; a `q` with quotes, `%` and
 * `_` stays bound and literal; MarketSectorProfile's `sector` call; refused
 * values; metrics with source and as-of or Not recorded; the evidence key;
 * peers; and failed reads reported, never swallowed.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_company_directory_d534.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { likeLiteral, parseCompanyQuery, CompanyQueryError, PEER_LIMIT } from '../src/services/researchCompanyDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 11;

const migration = (file: string) => readFileSync(resolve(here, `../sql/migrations/${file}`), 'utf8');
function creates(file: string): string {
  return migration(file)
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
    .map((s) => `${s};`).join('\n');
}

type Co = { uid: string; name: string; website?: string; country?: string | null; year?: number | null; sector?: string | null;
  funding?: number | null; fundingCur?: string | null; revenue?: number | null; revenueCur?: string | null; revenueAsOf?: string | null;
  employees?: number | null; employeesAsOf?: string | null };

const COS: Co[] = [
  { uid: 'acme', name: 'Acme Robotics', website: 'https://acme.example', country: 'Germany', year: 2015, sector: 'robotics', funding: 50_000_000, fundingCur: 'USD', employees: 120, employeesAsOf: '2026-06-01' },
  { uid: 'bolt', name: 'Bolt Motors', website: 'https://bolt.example', country: 'France', year: 2019, sector: 'automotive industry', funding: 9_000_000, fundingCur: 'USD' },
  { uid: 'cog', name: 'Cog Works', website: 'https://cog.example', country: 'Germany', year: 2008, sector: 'Robotics', revenue: 4_000_000, revenueCur: 'EUR', revenueAsOf: '2025-12-31' },
  { uid: 'dyn', name: '100% Dynamo', website: 'https://dynamo.example', country: 'Spain', year: 2021, sector: 'robotics' },
  { uid: 'eta', name: "Eta's E_Labs", website: 'https://e-labs.example', country: 'Germany', year: null, sector: null },
  { uid: 'fin', name: 'Finch Software', website: 'https://finch.example', country: 'France', year: 2012, sector: 'software industry', funding: 120_000_000, fundingCur: 'USD' },
];

function fixture(cos: Co[] = COS) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.exec(creates('228_research_company_directory.sql'));
  db.exec(migration('375_research_company_directory_columns.sql'));
  db.exec(creates('370_company_research_tables.sql'));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fin', 'fin@axal.example')`).run(USER);
  const ins = db.prepare(
    `INSERT INTO research_company_directory (uid, name, website, country, founded_year, sector, source_url, as_of,
       funding_total, funding_currency, revenue, revenue_currency, revenue_as_of, employee_count, employee_as_of,
       metrics_source_name, metrics_source_url, metrics_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'https://www.wikidata.org/wiki/Q1', '2026-10-04', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of cos) {
    const anyMetric = c.funding != null || c.revenue != null || c.employees != null;
    ins.run(c.uid, c.name, c.website ?? `https://${c.uid}.example`, c.country ?? null, c.year ?? null, c.sector ?? null,
      c.funding ?? null, c.fundingCur ?? null, c.revenue ?? null, c.revenueCur ?? null, c.revenueAsOf ?? null,
      c.employees ?? null, c.employeesAsOf ?? null,
      anyMetric ? 'Company filings' : null, anyMetric ? 'https://filings.example/x' : null, anyMetric ? '2026-09-30' : null);
  }
  return db;
}

const app = new Hono<any>();
app.route('/api/research', research);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  return c.json({ detail: msg }, msg === 'Unauthorized' ? 401 : 500);
});

async function get(db: InstanceType<typeof DatabaseSync>, path: string, auth = true) {
  const headers: Record<string, string> = {};
  if (auth) {
    const token = await new SignJWT({ user_id: USER, role: 'founder' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(`/api/research${path}`, { headers }, { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}
const uids = (b: any) => b.items.map((i: any) => i.uid);
const idOf = (db: InstanceType<typeof DatabaseSync>, uid: string) =>
  (db.prepare('SELECT id FROM research_company_directory WHERE uid = ?').get(uid) as any).id as number;

test('both endpoints are signed-in only', async () => {
  const db = fixture();
  assert.equal((await get(db, '/company-directory', false)).status, 401);
  assert.equal((await get(db, '/company-directory/acme', false)).status, 401);
});

test('paging: 25 by default, a total of every match, offset, and name order', async () => {
  const many: Co[] = Array.from({ length: 30 }, (_, k) => ({ uid: `c${String(k).padStart(2, '0')}`, name: `Company ${String(k).padStart(2, '0')}` }));
  const db = fixture(many);
  const first = await get(db, '/company-directory');
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.total, first.body.limit, first.body.offset, first.body.items.length], [30, 25, 0, 25]);
  assert.equal(first.body.items[0].uid, 'c00');
  const second = await get(db, '/company-directory?offset=25');
  assert.deepEqual(uids(second.body), ['c25', 'c26', 'c27', 'c28', 'c29']);
  assert.equal(second.body.total, 30);
  assert.equal((await get(db, '/company-directory?limit=100')).body.items.length, 30);
  assert.equal((await get(db, '/company-directory?limit=101')).status, 400, 'limit is 100 at most');
  assert.equal((await get(db, '/company-directory?limit=0')).status, 400);
  assert.equal((await get(db, '/company-directory?offset=-1')).status, 400);
});

test('the current response fields are kept', async () => {
  const r = await get(fixture(), '/company-directory?limit=1');
  assert.deepEqual(Object.keys(r.body.items[0]).sort(),
    ['as_of', 'country', 'founded_year', 'name', 'sector', 'source_license', 'source_name', 'source_url', 'uid', 'website']);
  for (const k of ['requested_sector', 'matched_terms', 'source', 'source_boundary']) assert.ok(k in r.body, `${k} is gone`);
});

test('q matches name or website case-insensitively, and quotes, % and _ stay bound and literal', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/company-directory?q=ACME')).body), ['acme'], 'case-insensitive on the name');
  assert.deepEqual(uids((await get(db, '/company-directory?q=finch.example')).body), ['fin'], 'matches the website');
  assert.deepEqual(uids((await get(db, `/company-directory?q=${encodeURIComponent('100%')}`)).body), ['dyn'], '% is a literal');
  assert.deepEqual(uids((await get(db, `/company-directory?q=${encodeURIComponent('E_L')}`)).body), ['eta'], '_ is a literal');
  assert.deepEqual(uids((await get(db, `/company-directory?q=${encodeURIComponent('%')}`)).body), ['dyn'], 'a lone % is not a wildcard');
  const quote = await get(db, `/company-directory?q=${encodeURIComponent("Eta's")}`);
  assert.deepEqual([quote.status, uids(quote.body)], [200, ['eta']]);
  const inj = await get(db, `/company-directory?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.deepEqual([inj.status, inj.body.total], [200, 0]);
  assert.equal(likeLiteral('a%b_c\\d'), 'a\\%b\\_c\\\\d');
});

test('country, founded_from and founded_to filter, and a reversed range is refused', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/company-directory?country=Germany')).body), ['acme', 'cog', 'eta']);
  assert.deepEqual(uids((await get(db, '/company-directory?founded_from=2012&founded_to=2019')).body), ['acme', 'bolt', 'fin']);
  assert.deepEqual(uids((await get(db, '/company-directory?founded_from=2019')).body), ['dyn', 'bolt'], 'inclusive; name order puts "100% Dynamo" first');
  assert.deepEqual(uids((await get(db, '/company-directory?founded_to=2008')).body), ['cog']);
  assert.equal((await get(db, '/company-directory?founded_from=2020&founded_to=2010')).status, 400);
  assert.equal((await get(db, '/company-directory?founded_from=abc')).status, 400);
});

test('has= keeps only companies with the metric recorded, and combines', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/company-directory?has=funding')).body), ['acme', 'bolt', 'fin']);
  assert.deepEqual(uids((await get(db, '/company-directory?has=revenue')).body), ['cog']);
  assert.deepEqual(uids((await get(db, '/company-directory?has=headcount')).body), ['acme']);
  assert.deepEqual(uids((await get(db, '/company-directory?has=funding,headcount')).body), ['acme']);
  const bad = await get(db, '/company-directory?has=valuation');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'has');
});

test('sort by name, founded or funding, either direction, with unknown values last', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/company-directory?sort=-name')).body), ['fin', 'eta', 'cog', 'bolt', 'acme', 'dyn']);
  assert.deepEqual(uids((await get(db, '/company-directory?sort=founded')).body), ['cog', 'fin', 'acme', 'bolt', 'dyn', 'eta']);
  assert.deepEqual(uids((await get(db, '/company-directory?sort=-founded')).body), ['dyn', 'bolt', 'acme', 'fin', 'cog', 'eta']);
  const funding = uids((await get(db, '/company-directory?sort=-funding')).body);
  assert.deepEqual(funding.slice(0, 3), ['fin', 'acme', 'bolt'], 'largest funding first');
  assert.deepEqual(uids((await get(db, '/company-directory?sort=funding')).body).slice(0, 3), ['bolt', 'acme', 'fin']);
  assert.deepEqual(funding.slice(3), ['dyn', 'cog', 'eta'], 'no recorded funding sorts after, by name');
  assert.equal((await get(db, '/company-directory?sort=revenue')).status, 400, 'revenue mixes currencies, so it is not a sort');
});

test('funding is ranked within one currency, never across', async () => {
  const db = fixture([
    { uid: 'usd1', name: 'A', funding: 10, fundingCur: 'USD' },
    { uid: 'eur1', name: 'B', funding: 5, fundingCur: 'EUR' }, // smallest, so only currency grouping puts it first
    { uid: 'usd2', name: 'C', funding: 20, fundingCur: 'USD' },
  ]);
  assert.deepEqual(uids((await get(db, '/company-directory?sort=-funding')).body), ['eur1', 'usd2', 'usd1']);
});

test("MarketSectorProfile's sector call still works: aliases, a total, and a limit it can set", async () => {
  const db = fixture();
  const r = await get(db, '/company-directory?sector=robotics&limit=24');
  assert.equal(r.status, 200);
  assert.deepEqual(uids(r.body), ['dyn', 'acme', 'cog'], 'case-insensitive on the sector label');
  assert.equal(r.body.total, 3);
  assert.equal(r.body.requested_sector, 'robotics');
  assert.deepEqual(r.body.matched_terms, ['robotics']);
  const auto = await get(db, '/company-directory?sector=autotech');
  assert.deepEqual(uids(auto.body), ['bolt'], 'autotech goes through its alias, "automotive industry"');
  assert.deepEqual(uids((await get(db, '/company-directory?sector=software')).body), ['fin']);
});

test('a failed list read is Unreadable, never an empty directory', async () => {
  const db = fixture();
  db.exec('DROP TABLE research_company_directory');
  const r = await get(db, '/company-directory');
  assert.equal(r.status, 503);
  assert.equal(r.body.detail, 'Unreadable');
});

test('the company: each metric with its source and as-of date, or Not recorded', async () => {
  const db = fixture();
  const acme = await get(db, '/company-directory/acme');
  assert.equal(acme.status, 200);
  assert.equal(acme.body.item.name, 'Acme Robotics');
  const m = acme.body.metrics;
  assert.deepEqual([m.funding_total.value, m.funding_total.currency, m.funding_total.status, m.funding_total.source_name, m.funding_total.as_of],
    [50_000_000, 'USD', 'recorded', 'Company filings', '2026-09-30']);
  assert.deepEqual([m.headcount.value, m.headcount.as_of], [120, '2026-06-01'], 'headcount carries its own as-of');
  assert.deepEqual([m.revenue.value, m.revenue.status, m.revenue.reason], [null, 'not_recorded', 'Not recorded'], 'never a zero');
  assert.equal((await get(db, '/company-directory/nope')).status, 404);
});

test('evidence from the 370 tables is matched on company_id = research_company_directory.id', async () => {
  const db = fixture();
  const acme = idOf(db, 'acme');
  const cog = idOf(db, 'cog');
  db.prepare(`INSERT INTO company_financials (company_id, period, metric_type, revenue, revenue_currency, source_url, source_name)
              VALUES (?, '2025', 'annual', 3000000, 'EUR', 'https://x.example/a', 'Registry')`).run(acme);
  db.prepare(`INSERT INTO company_financials (company_id, period, metric_type, revenue, source_url, source_name)
              VALUES (?, '2025', 'annual', 1, 'https://x.example/b', 'Registry')`).run(cog);
  db.prepare(`INSERT INTO company_employment_history (company_id, observed_date, employee_count, source, source_url)
              VALUES (?, '2026-01-01', 110, 'LinkedIn', 'https://x.example/c')`).run(acme);
  db.prepare(`INSERT INTO company_sources (company_id, field_name, source_name, source_type, source_url)
              VALUES (?, 'website', 'Wikidata', 'registry', 'https://x.example/d')`).run(acme);
  const r = (await get(db, '/company-directory/acme')).body;
  assert.equal(r.evidence_key, 'company_id = research_company_directory.id');
  assert.deepEqual(r.financials.rows.map((x: any) => x.revenue), [3000000], "another company's row is not acme's");
  assert.deepEqual(r.employment.rows.map((x: any) => x.employee_count), [110]);
  assert.deepEqual(r.sources.rows.map((x: any) => x.field_name), ['website']);
  assert.deepEqual([r.funding_rounds.status, r.funding_rounds.rows], ['ok', []]);
});

test('peers: same sector, same country first, never the company itself, capped', async () => {
  const many: Co[] = [
    { uid: 'self', name: 'Self', country: 'Germany', sector: 'Robotics' },
    { uid: 'p-fr', name: 'Alpha FR', country: 'France', sector: 'robotics' },
    { uid: 'p-de', name: 'Zulu DE', country: 'Germany', sector: 'robotics ' },
    { uid: 'other', name: 'Other', country: 'Germany', sector: 'software' },
    ...Array.from({ length: 10 }, (_, k) => ({ uid: `x${k}`, name: `X ${k}`, country: 'Italy', sector: 'robotics' })),
  ];
  const r = (await get(fixture(many), '/company-directory/self')).body;
  assert.equal(r.peers.status, 'ok');
  const ids = r.peers.rows.map((p: any) => p.uid);
  assert.equal(ids.length, PEER_LIMIT);
  assert.equal(ids[0], 'p-de', 'the same country comes first');
  assert.ok(!ids.includes('self') && !ids.includes('other'));
  const none = (await get(fixture(), '/company-directory/eta')).body;
  assert.deepEqual([none.peers.status, none.peers.rows], ['not_recorded', []], 'no sector: peers are Not recorded, not none');
});

test('a failed evidence read is reported on its own, and a failed company read is Unreadable', async () => {
  const db = fixture();
  db.exec('DROP TABLE company_financials');
  const r = await get(db, '/company-directory/acme');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.financials.status, r.body.financials.reason], ['unreadable', 'Unreadable']);
  assert.equal(r.body.employment.status, 'ok');
  db.exec('DROP TABLE research_company_directory');
  const gone = await get(db, '/company-directory/acme');
  assert.deepEqual([gone.status, gone.body.detail], [503, 'Unreadable']);
});

test('parseCompanyQuery refuses with a field and a sentence this file wrote', () => {
  assert.throws(() => parseCompanyQuery((k) => ({ sort: 'size' } as any)[k]), (e: any) => e instanceof CompanyQueryError && e.field === 'sort');
  const q = parseCompanyQuery(() => undefined);
  assert.deepEqual([q.limit, q.offset, q.sort, q.has], [25, 0, 'name', []]);
});
