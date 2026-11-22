/**
 * D7166 (#7166) — the fund directory, one row per vehicle, sizes in each
 * list's own currency.
 *
 * Part 1, migration 202611180052_7166 on real SQLite after 378, 406, 413 and 429:
 *   - Dawn Capital Opp (€75m) and Dawn Capital V (€582m) are two rows, each
 *     with its own reports;
 *   - Angular Ventures III is €121m, not a millionth of it, and no 2025–2026
 *     EuroTech row is stored under €1m;
 *   - every saved reference to a retired uid (a shortlisted fund, a raise
 *     prospect, a project subject) moves to the vehicle 378's row showed;
 *   - only the EuroTech list is replaced, and a replay changes nothing.
 * Part 2, the route: the US dollar list's sizes are shown in US dollars, and
 * `size_currency` scopes the size filter, bands and sort to one list; a
 * retired uid opens the vehicle it moved to; `source` names served lists only.
 * Part 3 (D7166 part 2, RFD-02's "Show them"): `size_band=none` answers the
 * matches a size filter leaves out, exactly the rows `size_not_comparable` counts.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_fund_vehicles_7166.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { EUR_SOURCE, LIST_CURRENCY, USD_SOURCE } from '../src/services/researchFundDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8');
const byPrefix = (p: string) => readdirSync(MIGRATIONS).find((f) => f.startsWith(p))!;
const M7166 = byPrefix('202611180052_7166_');
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const count = (db: DatabaseSync, sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as any).n);

function migrated() {
  // D1 does not enforce foreign keys inside a batch, so neither does this.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(read('378_research_fund_directory_rebuild.sql'));
  db.exec(read(byPrefix('406_')));
  db.exec(read('413_research_fund_source_terms_review.sql'));
  db.exec(read(byPrefix('429_')));
  // The columns that hold a directory uid, as their own migrations declare them.
  db.exec(`CREATE TABLE research_funds (uid TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, name TEXT, catalogue_uid TEXT);
    CREATE UNIQUE INDEX uq_research_funds_owner_catalogue ON research_funds (owner_user_id, catalogue_uid) WHERE catalogue_uid IS NOT NULL;
    CREATE TABLE raise_prospects (id INTEGER PRIMARY KEY, research_fund_uid TEXT);
    CREATE TABLE research_project_subjects (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, kind TEXT NOT NULL,
      directory_uid TEXT NOT NULL CHECK (length(directory_uid) BETWEEN 1 AND 64), UNIQUE (project_id, kind, directory_uid));`);
  db.exec(`INSERT INTO research_funds VALUES ('f1', 1, 'Dawn Capital', 'dawncapital'), ('f2', 1, 'By hand', NULL), ('f3', 2, 'Angular', 'angularventures');
    INSERT INTO raise_prospects VALUES (1, 'dawncapital'), (2, NULL);
    INSERT INTO research_project_subjects VALUES (1, 7, 'fund', 'dawncapital'), (2, 7, 'company', 'dawncapital');`);
  db.exec(read(M7166));
  return db;
}

const fund = (db: DatabaseSync, uid: string) => db.prepare('SELECT * FROM research_fund_directory WHERE uid = ?').get(uid) as any;

test('one row per vehicle: Dawn Capital Opp and Fund V are two rows, each with its own reports', () => {
  const db = migrated();
  const dawn = (db.prepare(`SELECT uid, fund_number, fund_size_cents FROM research_fund_directory WHERE name = 'Dawn Capital' ORDER BY uid`).all() as any[])
    .map((r) => [r.uid, r.fund_number, Number(r.fund_size_cents)]);
  assert.deepEqual(dawn, [
    ['dawncapital-iii', 'III', 190_000_000_00],
    ['dawncapital-iv', 'IV', 340_000_000_00],
    ['dawncapital-opp', 'Opp', 75_000_000_00],
    ['dawncapital-v', 'V', 582_000_000_00],
  ]);
  assert.equal(fund(db, 'dawncapital'), undefined, 'the manager-keyed row is gone');
  const periods = (uid: string) => (db.prepare('SELECT period FROM research_fund_directory_reports WHERE fund_uid = ? ORDER BY period').all(uid) as any[]).map((r) => r.period);
  assert.deepEqual(periods('dawncapital-v'), ['2023-Q3', '2023-Q4'], 'Fund V\'s history is its own, not Opp\'s or III\'s');
  assert.ok(!periods('dawncapital-opp').some((p: string) => p.startsWith('2018')), 'Fund III\'s 2018 report is not Opp\'s');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM research_fund_directory WHERE source_name = ?', EUR_SOURCE), 1364);
});

test('sizes: Angular Ventures III is €121m, and no 2025–2026 EuroTech row holds a millionth of its size', () => {
  const db = migrated();
  assert.equal(Number(fund(db, 'angularventures-iii').fund_size_cents), 121_000_000_00);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM research_fund_directory
    WHERE source_name = ? AND fund_year >= 2025 AND fund_size_cents BETWEEN 1 AND 99999999`, EUR_SOURCE), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM research_fund_directory_reports
    WHERE period >= '2025' AND fund_size_cents BETWEEN 1 AND 99999999`), 0);
});

test('a saved reference to a retired uid moves to the vehicle 378 showed; nothing else moves', () => {
  const db = migrated();
  assert.equal((db.prepare(`SELECT new_uid FROM research_fund_directory_uid_moves WHERE old_uid = 'dawncapital'`).get() as any).new_uid, 'dawncapital-opp');
  const saved = Object.fromEntries((db.prepare('SELECT uid, catalogue_uid FROM research_funds').all() as any[]).map((r) => [r.uid, r.catalogue_uid]));
  assert.deepEqual(saved, { f1: 'dawncapital-opp', f2: null, f3: 'angularventures-iii' });
  assert.deepEqual((db.prepare('SELECT research_fund_uid AS u FROM raise_prospects ORDER BY id').all() as any[]).map((r) => r.u), ['dawncapital-opp', null]);
  assert.deepEqual((db.prepare('SELECT directory_uid AS u FROM research_project_subjects ORDER BY id').all() as any[]).map((r) => r.u),
    ['dawncapital-opp', 'dawncapital'], 'a company subject is not a fund uid and does not move');
  // Every move lands on a row that exists, and no move starts from a live uid.
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM research_fund_directory_uid_moves WHERE new_uid NOT IN (SELECT uid FROM research_fund_directory)`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM research_fund_directory_uid_moves WHERE old_uid IN (SELECT uid FROM research_fund_directory)`), 0);
});

test('only the EuroTech list is replaced, and a replay changes nothing', () => {
  const db = migrated();
  const bySource = Object.fromEntries((db.prepare('SELECT source_name AS s, COUNT(*) AS n FROM research_fund_directory GROUP BY 1').all() as any[])
    .map((r) => [r.s, Number(r.n)]));
  assert.deepEqual(bySource, { [EUR_SOURCE]: 1364, [DEEP]: 1538, [USD_SOURCE]: 890 });
  const snap = () => JSON.stringify([
    db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all(),
    db.prepare('SELECT * FROM research_fund_directory_reports ORDER BY fund_uid, period').all(),
    db.prepare('SELECT * FROM research_funds ORDER BY uid').all(),
  ]);
  const before = snap();
  db.exec(read(M7166));
  assert.equal(snap(), before);
});

// ── Part 2: the route ───────────────────────────────────────────────────────
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 11;

function ddl(file: string): string {
  return read(file).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s)).map((s) => `${s};`).join('\n');
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  db.exec(read(byPrefix('406_')));
  db.exec(read('376_research_taxonomy.sql'));
  db.exec(ddl('229_research_market_directory.sql'));
  db.exec(ddl(M7166));
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fin', 'fin@axal.example')`).run(USER);
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, fund_number, fund_size_cents, fund_year, source_name, source_url, as_of)
    VALUES (?, ?, ?, ?, ?, ?, 'https://example.org/list', '2026-11-18')`);
  const m = 100_000_000; // one million, in cents
  ins.run('dawncapital-opp', 'Dawn Capital', 'Opp', 75 * m, 2023, EUR_SOURCE);
  ins.run('dawncapital-v', 'Dawn Capital', 'V', 582 * m, 2023, EUR_SOURCE);
  ins.run('aforeiv', 'Afore IV', 'IV', 185 * m, 2025, USD_SOURCE);
  ins.run('smallusd', 'Small USD I', 'I', 20 * m, 2024, USD_SOURCE);
  ins.run('nosize', 'No Size I', 'I', null, 2024, USD_SOURCE);
  ins.run('deepone', 'Deep One', null, 999 * m, 2023, DEEP);
  db.prepare(`INSERT INTO research_fund_directory_uid_moves (old_uid, new_uid, moved_on) VALUES ('dawncapital', 'dawncapital-opp', '2026-11-18')`).run();
  return db;
}

const app = new Hono<any>();
app.route('/api/research', research);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 500));

async function get(db: InstanceType<typeof DatabaseSync>, path: string) {
  const token = await new SignJWT({ user_id: USER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/research${path}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}
const uids = (b: any) => b.items.map((i: any) => i.uid);

test('each list is marked in its own currency; the US dollar list reads in US dollars', async () => {
  assert.deepEqual(LIST_CURRENCY, { [EUR_SOURCE]: 'EUR', [USD_SOURCE]: 'USD' });
  const { status, body } = await get(fixture(), '/fund-directory?limit=100');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.items.map((i: any) => [i.uid, i]));
  assert.deepEqual([by.aforeiv.fund_size_cents, by.aforeiv.size_currency], [185 * 100_000_000, 'USD']);
  assert.deepEqual([by['dawncapital-v'].fund_size_cents, by['dawncapital-v'].size_currency], [582 * 100_000_000, 'EUR']);
  assert.deepEqual([by.nosize.size_currency, by.nosize.size_reason], [null, 'Not recorded']);
  assert.deepEqual([by.deepone.fund_size_cents, by.deepone.size_currency], [null, null], 'a list in no known currency shows no size');
  assert.equal(body.size_currency, 'EUR');
  assert.equal(body.coverage.fields.size_usd, 2);
  assert.equal(body.sources.find((s: any) => s.name === USD_SOURCE).size_currency, 'USD');
});

test('size_currency scopes the size filter, the bands and the sort to one list', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?size_min=50000000')).body), ['dawncapital-opp', 'dawncapital-v'], 'euros by default');
  assert.deepEqual(uids((await get(db, '/fund-directory?size_currency=USD&size_min=50000000')).body), ['aforeiv'], 'US dollars on the USD list only');
  assert.deepEqual(uids((await get(db, '/fund-directory?size_currency=usd&sort=-size')).body).slice(0, 2), ['aforeiv', 'smallusd'],
    'the asked currency\'s sized rows sort first');
  const usd = (await get(db, '/fund-directory?size_currency=USD')).body;
  assert.equal(usd.facets.size_band.find((b: any) => b.value === '100-250').label, 'US$100–250M');
  assert.equal(usd.facets.size_band.find((b: any) => b.value === '100-250').count, 1);
  assert.equal(usd.facets.size_not_comparable, 4, 'the euro rows, the unsized row and the unknown currency sit in no US dollar band');
  assert.match(usd.size_basis, /US dollars/);
  const bad = await get(db, '/fund-directory?size_currency=GBP');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'size_currency');
});

test('a retired uid opens the vehicle it moved to; source names only the lists served', async () => {
  const db = fixture();
  const moved = await get(db, '/fund-directory/dawncapital');
  assert.equal(moved.status, 200);
  assert.equal(moved.body.item.uid, 'dawncapital-opp');
  assert.equal(moved.body.moved_from, 'dawncapital');
  assert.equal((await get(db, '/fund-directory/dawncapital-v')).body.moved_from, null);
  assert.equal((await get(db, '/fund-directory/nothing-here')).status, 404);
  db.prepare(`UPDATE research_fund_sources SET verdict = 'not allowed' WHERE source_name = ?`).run(DEEP);
  const list = (await get(db, '/fund-directory')).body;
  assert.doesNotMatch(list.source, /Deep Tech/);
  assert.match(list.source, /EuroTech/);
});

test('size_band=none answers the funds a size filter leaves out, and only those', async () => {
  const db = fixture();
  // Euros: the US dollar rows, the unsized row and the list in no known currency.
  const eur = (await get(db, '/fund-directory?size_band=none&limit=100')).body;
  assert.deepEqual(uids(eur).sort(), ['aforeiv', 'deepone', 'nosize', 'smallusd']);
  assert.equal(eur.total, (await get(db, '/fund-directory?size_min=50000000')).body.facets.size_not_comparable,
    'the rows shown are the ones the size filter said it left out');
  // US dollars: the euro rows, the unsized US dollar row and the unknown currency; never a sized US dollar row.
  const usd = (await get(db, '/fund-directory?size_band=none&size_currency=USD&limit=100')).body;
  assert.deepEqual(uids(usd).sort(), ['dawncapital-opp', 'dawncapital-v', 'deepone', 'nosize']);
  // It narrows with the other filters, as the line it answers counts them.
  assert.deepEqual(uids((await get(db, '/fund-directory?size_band=none&vintage=2024')).body).sort(), ['nosize', 'smallusd']);
  const mixed = await get(db, '/fund-directory?size_band=none&size_min=1');
  assert.equal(mixed.status, 400, 'none is a band, so it cannot be combined with from/to');
  assert.equal((await get(db, '/fund-directory?size_band=nothing')).status, 400);
});
