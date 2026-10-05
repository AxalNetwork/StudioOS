/**
 * D535 (#1081), steps 2 and 3 — the fund directory on the server, on real SQLite.
 *
 * Tables from migration 365 (CREATE statements only, so the counts are the
 * test's own) and migration 376 (#1080's crosswalk, whole). Pins: the
 * sign-in gate; each filter, the sort, paging and `total`; a `q` with quotes,
 * `%` and `_` stays bound and literal; sizes only in a known currency; EIF and
 * EIFO unknown without LP text; refused filters; and errors reported, never
 * swallowed, on both endpoints.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_directory_d535.test.ts
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
import { EUR_SOURCE, likeLiteral, parseDirectoryQuery, DirectoryQueryError } from '../src/services/researchFundDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 11;
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';

function ddl(file: string): string {
  return readFileSync(resolve(here, `../sql/migrations/${file}`), 'utf8')
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
    .map((s) => `${s};`).join('\n');
}

type Fund = { uid: string; name: string; hq?: string | null; size_eur_m?: number | null; year?: number | null;
  focus?: string | null; lps?: string | null; eif?: number; eifo?: number; source?: string };

function fixture(funds: Fund[] = FUNDS) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  db.exec(readFileSync(resolve(here, '../sql/migrations/376_research_taxonomy.sql'), 'utf8'));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fin', 'fin@axal.example')`).run(USER);
  const ins = db.prepare(
    `INSERT INTO research_fund_directory (uid, name, hq, fund_size_cents, fund_year, sector_focus, notable_lps,
       eif_flag, eifo_flag, source_name, source_url, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'https://example.org/sheet', '2026-10-04')`,
  );
  for (const f of funds) {
    ins.run(f.uid, f.name, f.hq ?? null, f.size_eur_m == null ? null : f.size_eur_m * 1_000_000 * 100, f.year ?? null,
      f.focus ?? null, f.lps ?? null, f.eif ?? 0, f.eifo ?? 0, f.source ?? EUR_SOURCE);
  }
  return db;
}

const FUNDS: Fund[] = [
  { uid: 'alpha', name: 'Alpha Ventures', hq: 'Berlin', size_eur_m: 50, year: 2021, focus: 'Fintech · AI', lps: 'EIF', eif: 1 },
  { uid: 'beta', name: 'Beta Capital', hq: 'Germany', size_eur_m: 300, year: 2024, focus: 'Robotics', lps: 'Family offices' },
  { uid: 'gamma', name: 'Gamma Partners', hq: 'London', size_eur_m: 120, year: 2019, focus: 'Fintech', eifo: 1, lps: 'EIFO' },
  { uid: 'delta', name: 'Delta 100% Growth', hq: 'Bay Area, Israel', size_eur_m: 10, year: 2025, focus: 'Healthtech' },
  { uid: 'eps', name: 'Eps_ilon Fund', hq: 'Paris', size_eur_m: null, year: null, focus: null },
  // A list with no size in a known currency, even when the column holds a number.
  { uid: 'zeta', name: "Zeta's Deep Tech", hq: 'Berlin', size_eur_m: 999, year: 2023, focus: 'Deep Tech', source: DEEP },
];

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

test('both endpoints are signed-in only', async () => {
  const db = fixture();
  assert.equal((await get(db, '/fund-directory', false)).status, 401);
  assert.equal((await get(db, '/fund-directory/alpha', false)).status, 401);
});

test('paging: 25 by default, a total of every match, offset, and name order', async () => {
  const many: Fund[] = Array.from({ length: 30 }, (_, k) => ({ uid: `f${String(k).padStart(2, '0')}`, name: `Fund ${String(k).padStart(2, '0')}` }));
  const db = fixture(many);
  const first = await get(db, '/fund-directory');
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.total, first.body.limit, first.body.offset, first.body.items.length], [30, 25, 0, 25]);
  assert.equal(first.body.items[0].uid, 'f00');
  const second = await get(db, '/fund-directory?offset=25');
  assert.deepEqual(uids(second.body), ['f25', 'f26', 'f27', 'f28', 'f29']);
  assert.equal(second.body.total, 30);
  assert.equal((await get(db, '/fund-directory?limit=100')).body.items.length, 30);
  assert.equal((await get(db, '/fund-directory?limit=101')).status, 400, 'limit is 100 at most');
  assert.equal((await get(db, '/fund-directory?limit=0')).status, 400);
});

test('q matches the name, and quotes, % and _ stay bound and literal', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?q=beta')).body), ['beta']);
  assert.deepEqual(uids((await get(db, `/fund-directory?q=${encodeURIComponent('100%')}`)).body), ['delta'], '% is a literal');
  assert.deepEqual(uids((await get(db, `/fund-directory?q=${encodeURIComponent('s_i')}`)).body), ['eps'], '_ is a literal');
  assert.deepEqual(uids((await get(db, `/fund-directory?q=${encodeURIComponent('%')}`)).body), ['delta'], 'a lone % is not a wildcard');
  const quote = await get(db, `/fund-directory?q=${encodeURIComponent("Zeta's")}`);
  assert.equal(quote.status, 200);
  assert.deepEqual(uids(quote.body), ['zeta']);
  const inj = await get(db, `/fund-directory?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.deepEqual([inj.status, inj.body.total], [200, 0]);
  assert.equal(likeLiteral('a%b_c\\d'), 'a\\%b\\_c\\\\d');
});

test('hq_country goes through the crosswalk: every HQ string naming the country', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?hq_country=DE')).body), ['alpha', 'beta', 'zeta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?hq_country=il')).body), ['delta'], '"Bay Area, Israel" names Israel');
  assert.deepEqual(uids((await get(db, '/fund-directory?hq_country=US')).body), ['delta'], 'and the US');
  assert.equal((await get(db, '/fund-directory?hq_country=JP')).body.total, 0);
  assert.equal((await get(db, '/fund-directory?hq_country=DEU')).status, 400);
});

test('focus is a market slug, through the crosswalk', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?focus=fintech')).body), ['alpha', 'gamma']);
  assert.deepEqual(uids((await get(db, '/fund-directory?focus=ai')).body), ['alpha']);
  assert.deepEqual(uids((await get(db, '/fund-directory?focus=deeptech')).body), ['zeta']);
  assert.equal((await get(db, `/fund-directory?focus=${encodeURIComponent("x' OR 1")}`)).status, 400);
});

test('size filters compare euros, on the EuroTech list only', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?size_min=100000000')).body), ['beta', 'gamma'], 'zeta has no size in a known currency');
  assert.deepEqual(uids((await get(db, '/fund-directory?size_max=60000000')).body), ['alpha', 'delta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?size_min=50000000&size_max=120000000')).body), ['alpha', 'gamma']);
  assert.equal((await get(db, '/fund-directory?size_min=9&size_max=1')).status, 400);
  assert.equal((await get(db, '/fund-directory?size_min=-1')).status, 400);
});

test('sort: name, size and vintage, either way; rows with no euro size or no vintage go last', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?sort=size')).body), ['delta', 'alpha', 'gamma', 'beta', 'eps', 'zeta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?sort=-size')).body).slice(0, 4), ['beta', 'gamma', 'alpha', 'delta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?sort=vintage')).body), ['gamma', 'alpha', 'zeta', 'beta', 'delta', 'eps']);
  assert.deepEqual(uids((await get(db, '/fund-directory?sort=-vintage')).body).slice(0, 2), ['delta', 'beta']);
  assert.deepEqual(uids((await get(db, '/fund-directory?sort=-name')).body)[0], 'zeta');
  assert.equal((await get(db, '/fund-directory?sort=fund_size_cents')).status, 400, 'sort is an allow-list');
});

test('vintage_from and vintage_to are inclusive', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?vintage_from=2021&vintage_to=2024')).body), ['alpha', 'beta', 'zeta']);
  assert.equal((await get(db, '/fund-directory?vintage_from=2025&vintage_to=2020')).status, 400);
});

test('eif and eifo: 1 is backed; 0 is not backed only where the row records its LPs', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?eif=1')).body), ['alpha']);
  assert.deepEqual(uids((await get(db, '/fund-directory?eifo=1')).body), ['gamma']);
  assert.deepEqual(uids((await get(db, '/fund-directory?eif=0')).body), ['beta', 'gamma'], 'a 0 flag with no LP text is unknown');
  const all = (await get(db, '/fund-directory')).body.items;
  const by = (u: string) => all.find((i: any) => i.uid === u);
  assert.deepEqual([by('alpha').eif, by('beta').eif, by('delta').eif], [true, false, null]);
  assert.equal((await get(db, '/fund-directory?eif=maybe')).status, 400);
});

test('a size is shown only with its currency; otherwise "Not recorded" with the reason', async () => {
  const db = fixture();
  const all = (await get(db, '/fund-directory')).body;
  const by = (u: string) => all.items.find((i: any) => i.uid === u);
  assert.deepEqual([by('beta').fund_size_cents, by('beta').size_currency], [300_000_000_00, 'EUR']);
  assert.deepEqual([by('zeta').fund_size_cents, by('zeta').size_currency], [null, null], 'a number in an unknown currency is not shown');
  assert.match(by('zeta').size_reason, /no size in a known currency/);
  assert.equal(by('eps').size_reason, 'Not recorded');
  assert.match(all.size_basis, /euros/);
});

test('stage is refused, not silently ignored', async () => {
  const r = await get(fixture(), '/fund-directory?stage=seed');
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'stage');
  assert.match(r.body.detail, /not recorded/);
});

test('parseDirectoryQuery names the bad field', () => {
  assert.throws(() => parseDirectoryQuery((k) => ({ offset: '1.5' } as any)[k]), (e: any) => e instanceof DirectoryQueryError && e.field === 'offset');
});

test('a directory that cannot be read is "Unreadable" with 503, never an empty list', async () => {
  const db = fixture();
  db.exec('DROP TABLE research_fund_directory_reports');
  db.exec('DROP TABLE research_fund_directory');
  const r = await get(db, '/fund-directory');
  assert.equal(r.status, 503);
  assert.equal(r.body.detail, 'Unreadable');
  assert.equal(r.body.items, undefined);
  assert.equal((await get(db, '/fund-directory/alpha')).status, 503);
});

test('the fund page: 404 for no fund; its reports, or "unreadable" on their own when they cannot be read', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO research_fund_directory_reports (fund_uid, period, report_date, fund_size_cents, source_url)
              VALUES ('alpha', '2025-Q4', '2025-12-31', 5000000000, 'https://example.org/sheet')`).run();
  assert.equal((await get(db, '/fund-directory/nope')).status, 404);
  const ok = await get(db, '/fund-directory/alpha');
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.item.uid, ok.body.item.size_currency, ok.body.reports_status, ok.body.reports.length], ['alpha', 'EUR', 'ok', 1]);
  db.exec('DROP TABLE research_fund_directory_reports');
  const broken = await get(db, '/fund-directory/alpha');
  assert.equal(broken.status, 200, 'the fund still reads');
  assert.deepEqual([broken.body.reports_status, broken.body.reports_reason], ['unreadable', 'Unreadable']);
});
