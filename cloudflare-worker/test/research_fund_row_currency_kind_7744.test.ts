/**
 * D7744 (#7744) — a catalogue row carries its own size currency and record kind.
 *
 * Part 1, migration 202611270508_7744 on real SQLite after every fund
 * migration main holds (378, 406, 413, 429, 7166, 7167, 7326, 7325, 7585):
 *   - per list and for both tables, rows with a size equal rows given a
 *     currency (EuroTech 1,327 rows and 2,310 report rows in euros, Shai
 *     Goldman 886 in US dollars); EuroTech and Shai Goldman rows are vehicles,
 *     the three manager lists' rows managers, the Deep Tech rows NULL;
 *   - nothing lost: every row and report row shows the size and currency the
 *     old list-name rule (EuroTech EUR, Shai Goldman USD) showed;
 *   - the insert triggers: a re-import by INSERT OR REPLACE that names no new
 *     column keeps the row's currency and kind; a row of each pending manager
 *     list inserted after the migration is a manager; an unlisted list stays
 *     NULL; a fifth kind or a currency that is not three capitals is refused.
 * Part 2, the reads, over fixtures: a third list's GBP size is served, filtered,
 *   banded and sorted in GBP and counted under no other currency; a size with
 *   no currency is counted and printed nowhere; two lists in EUR filter and
 *   sort together; `kind` filters and its counts sum to the total; a value
 *   that is not three letters is a 400; Markets and Overview serve no
 *   non-euro size; the profile and the comparison cell keep each size.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_fund_row_currency_kind_7744.test.ts
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
import { EUR_SOURCE, USD_SOURCE, euroSizeCents, getFund, presentFund, type DirectoryRow } from '../src/services/researchFundDirectory.ts';
import { fundAggregates } from '../src/routes/research_markets.ts';
import { readFundAggregates } from '../src/routes/research_overview.ts';
import { fundCells } from '../src/routes/research_project_comparisons.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8');
const byPrefix = (p: string) => readdirSync(MIGRATIONS).find((f) => f.startsWith(p))!;
const M7744 = read(byPrefix('202611270508_7744_'));
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const M7326 = 'Axal VC curated global fund directory';
const PR7337 = 'Axal VC — verified fund manager websites';
const PR7586 = 'Axal VC verified global fund managers (2026-11-19)';
const GBP_LIST = 'Synthetic sterling list';
const EUR_LIST_2 = 'Synthetic second euro list';
const UNLISTED = 'Synthetic list with no recorded currency';

// ── Part 1: the migration on main's fund migrations ─────────────────────────

let built: DatabaseSync | null = null;
function freshBuild(): DatabaseSync {
  if (built) return built;
  // D1 does not enforce foreign keys inside a batch, so neither does this.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE research_funds (uid TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, name TEXT, catalogue_uid TEXT);
    CREATE TABLE raise_prospects (id INTEGER PRIMARY KEY, research_fund_uid TEXT);
    CREATE TABLE research_project_subjects (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, kind TEXT NOT NULL, directory_uid TEXT NOT NULL);`);
  for (const p of ['376_', '378_', '406_', '413_', '429_', '202611180052_7166_', '202611180053_7167_',
    '202611181335_7326_', '202611181350_7325_', '202611190015_7585_']) db.exec(read(byPrefix(p)));
  db.exec(M7744);
  built = db;
  return db;
}

const all = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
const count = (db: DatabaseSync, sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as any).n);

test('fresh build: per list and for both tables, rows with a size equal rows given a currency', () => {
  const db = freshBuild();
  const rows = all(db, `SELECT source_name AS s, SUM(fund_size_cents IS NOT NULL) AS sized,
      SUM(fund_size_currency IS NOT NULL) AS stamped, GROUP_CONCAT(DISTINCT fund_size_currency) AS c
    FROM research_fund_directory GROUP BY source_name ORDER BY source_name`);
  const by = Object.fromEntries(rows.map((r) => [r.s, [Number(r.sized), Number(r.stamped), r.c ?? null]]));
  assert.deepEqual(by[EUR_SOURCE], [1327, 1327, 'EUR']);
  assert.deepEqual(by[USD_SOURCE], [886, 886, 'USD']);
  assert.deepEqual(by[DEEP], [0, 0, null]);
  for (const list of [M7326, PR7337, PR7586]) assert.deepEqual(by[list], [0, 0, null], `${list} records no size`);
  // Report rows: each with a size takes its fund's list currency.
  const reports = all(db, `SELECT d.source_name AS s, SUM(r.fund_size_cents IS NOT NULL) AS sized,
      SUM(r.fund_size_currency IS NOT NULL) AS stamped, GROUP_CONCAT(DISTINCT r.fund_size_currency) AS c
    FROM research_fund_directory_reports r JOIN research_fund_directory d ON d.uid = r.fund_uid GROUP BY d.source_name`);
  assert.deepEqual(reports.map((r) => [r.s, Number(r.sized), Number(r.stamped), r.c]), [[EUR_SOURCE, 2310, 2310, 'EUR']]);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM research_fund_directory WHERE fund_size_cents IS NULL AND fund_size_currency IS NOT NULL`), 0,
    'a currency is set only where a size is present');
});

test('fresh build: EuroTech and Shai Goldman rows are vehicles, the three manager lists managers, Deep Tech NULL', () => {
  const db = freshBuild();
  const kinds = Object.fromEntries(all(db, `SELECT source_name AS s, GROUP_CONCAT(DISTINCT COALESCE(record_kind, 'NULL')) AS k
    FROM research_fund_directory GROUP BY source_name`).map((r) => [r.s, r.k]));
  assert.deepEqual(kinds, {
    [EUR_SOURCE]: 'vehicle', [USD_SOURCE]: 'vehicle', [DEEP]: 'NULL',
    [M7326]: 'manager', [PR7337]: 'manager', [PR7586]: 'manager',
  });
  assert.deepEqual(all(db, `SELECT source_name FROM research_fund_list_defaults ORDER BY source_name`).map((r) => r.source_name),
    [M7326, PR7586, PR7337, EUR_SOURCE, USD_SOURCE].sort(), 'the Deep Tech mapping is not listed');
});

test('nothing lost: every row and report shows the size and currency the old list-name rule showed', () => {
  const db = freshBuild();
  const OLD: Record<string, string> = { [EUR_SOURCE]: 'EUR', [USD_SOURCE]: 'USD' };
  const rows = all(db, 'SELECT * FROM research_fund_directory') as DirectoryRow[];
  let shown = 0;
  for (const r of rows) {
    const before = OLD[r.source_name] && r.fund_size_cents != null ? [r.fund_size_cents, OLD[r.source_name]] : [null, null];
    const now = presentFund(r);
    assert.deepEqual([now.fund_size_cents, now.size_currency], before, r.uid);
    if (before[0] != null) shown += 1;
  }
  assert.equal(shown, 1327 + 886);
  const reports = all(db, `SELECT r.fund_size_cents, r.fund_size_currency, d.source_name FROM research_fund_directory_reports r
    JOIN research_fund_directory d ON d.uid = r.fund_uid WHERE r.fund_size_cents IS NOT NULL`);
  assert.ok(reports.length > 0);
  for (const x of reports) assert.equal(x.fund_size_currency, OLD[x.source_name]);
});

test('triggers: a re-import that names no new column keeps the currency and kind', () => {
  const db = freshBuild();
  const uid = (all(db, `SELECT uid FROM research_fund_directory WHERE source_name = ? AND fund_size_cents IS NOT NULL ORDER BY uid LIMIT 1`, EUR_SOURCE))[0].uid;
  // The import script's statement, as scripts/import-research-funds.py writes it.
  db.prepare(`INSERT OR REPLACE INTO research_fund_directory (uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of)
    SELECT uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of
      FROM research_fund_directory WHERE uid = ?`).run(uid);
  const row = db.prepare('SELECT fund_size_currency, record_kind FROM research_fund_directory WHERE uid = ?').get(uid) as any;
  assert.deepEqual([row.fund_size_currency, row.record_kind], ['EUR', 'vehicle']);
  db.prepare(`INSERT OR REPLACE INTO research_fund_directory_reports (fund_uid, period, report_date, fund_size_cents, source_url)
    VALUES (?, '2099-Q1', '2099-01-01', 123400000000, 'https://example.org/r')`).run(uid);
  assert.equal((db.prepare(`SELECT fund_size_currency AS c FROM research_fund_directory_reports WHERE fund_uid = ? AND period = '2099-Q1'`).get(uid) as any).c, 'EUR');
  db.prepare(`DELETE FROM research_fund_directory_reports WHERE fund_uid = ? AND period = '2099-Q1'`).run(uid);
});

test('triggers: a pending manager list row inserted after the migration is a manager; an unlisted list stays NULL', () => {
  const db = freshBuild();
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, fund_size_cents, source_name, source_url, as_of)
    VALUES (?, ?, ?, ?, 'https://example.org', '2026-11-27')`);
  ins.run('later-7337', 'Later Manager A', null, PR7337);
  ins.run('later-7586', 'Later Manager B', null, PR7586);
  ins.run('later-7326', 'Later Manager C', null, M7326);
  ins.run('later-unlisted', 'Unlisted Fund', 5_000_000_00, UNLISTED);
  ins.run('later-eur-nosize', 'Euro No Size', null, EUR_SOURCE);
  const got = Object.fromEntries(all(db, `SELECT uid, record_kind, fund_size_currency FROM research_fund_directory WHERE uid LIKE 'later-%'`)
    .map((r) => [r.uid, [r.record_kind, r.fund_size_currency]]));
  assert.deepEqual(got, {
    'later-7337': ['manager', null], 'later-7586': ['manager', null], 'later-7326': ['manager', null],
    'later-unlisted': [null, null], 'later-eur-nosize': ['vehicle', null],
  });
  // A row that writes its own values keeps them.
  db.prepare(`INSERT INTO research_fund_directory (uid, name, fund_size_cents, fund_size_currency, record_kind, source_name, source_url, as_of)
    VALUES ('later-own', 'Own', 1, 'GBP', 'accelerator', ?, 'https://example.org', '2026-11-27')`).run(EUR_SOURCE);
  assert.deepEqual(Object.values(db.prepare(`SELECT fund_size_currency, record_kind FROM research_fund_directory WHERE uid = 'later-own'`).get() as any),
    ['GBP', 'accelerator']);
  db.exec(`DELETE FROM research_fund_directory WHERE uid LIKE 'later-%'`);
});

test('triggers refuse a fifth kind and a currency that is not three capitals, on insert and update', () => {
  const db = freshBuild();
  const ins = (kind: string | null, ccy: string | null) => () => db.prepare(`INSERT INTO research_fund_directory
    (uid, name, fund_size_cents, fund_size_currency, record_kind, source_name, source_url, as_of)
    VALUES ('bad', 'Bad', 1, ?, ?, 'x', 'https://example.org', '2026-11-27')`).run(ccy, kind);
  assert.throws(ins('fund', 'EUR'), /record_kind must be/);
  assert.throws(ins('vehicle', 'eur'), /three capital letters/);
  assert.throws(ins('vehicle', 'EURO'), /three capital letters/);
  assert.throws(ins('vehicle', 'E1R'), /three capital letters/);
  const uid = (all(db, `SELECT uid FROM research_fund_directory WHERE source_name = ? LIMIT 1`, EUR_SOURCE))[0].uid;
  assert.throws(() => db.prepare(`UPDATE research_fund_directory SET record_kind = 'investor' WHERE uid = ?`).run(uid), /record_kind must be/);
  assert.throws(() => db.prepare(`UPDATE research_fund_directory SET fund_size_currency = 'US' WHERE uid = ?`).run(uid), /three capital letters/);
  assert.throws(() => db.prepare(`UPDATE research_fund_directory_reports SET fund_size_currency = 'usd' WHERE fund_uid = ?`).run(uid), /three capital letters/);
  assert.throws(() => db.prepare(`INSERT INTO research_fund_list_defaults VALUES ('x', 'fund', NULL, 'b', '2026-11-27')`).run(), /record_kind must be/);
  for (const k of ['vehicle', 'manager', 'accelerator', 'resource', null]) {
    ins(k, 'CHF')();
    db.exec(`DELETE FROM research_fund_directory WHERE uid = 'bad'`);
  }
});

// ── Part 2: the reads ───────────────────────────────────────────────────────

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 11;
const M = 100_000_000; // one million, in cents

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
  db.exec(ddl(byPrefix('202611180052_7166_')));
  db.exec(read(byPrefix('202611180053_7167_')));
  // D7748: the fund read's fields come from the statement store (D7743), which it reads once.
  db.exec(read(byPrefix('202611191932_7743_')));
  db.exec(M7744);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fin', 'fin@axal.example')`).run(USER);
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, fund_number, fund_size_cents, fund_size_currency, fund_year, source_name, source_url, as_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'https://example.org/list', '2026-11-18')`);
  // The two listed lists name no currency: the trigger stamps it, as a re-import would leave it.
  ins.run('eu-big', 'Euro Big', 'V', 582 * M, null, 2023, EUR_SOURCE);
  ins.run('eu-small', 'Euro Small', 'I', 30 * M, null, 2022, EUR_SOURCE);
  ins.run('us-afore', 'Afore IV', 'IV', 185 * M, null, 2025, USD_SOURCE);
  // A third list in pounds, a second euro list, and a list with a size in no recorded currency.
  ins.run('gb-one', 'Sterling One', 'I', 120 * M, 'GBP', 2024, GBP_LIST);
  ins.run('eu2-mid', 'Second Euro Mid', 'II', 75 * M, 'EUR', 2024, EUR_LIST_2);
  ins.run('nocur', 'No Currency', null, 777 * M, null, 2024, UNLISTED);
  ins.run('mgr', 'A Manager', null, null, null, null, PR7337);
  db.prepare(`INSERT INTO research_fund_directory_reports (fund_uid, period, report_date, fund_size_cents, source_url, vehicle_label)
    VALUES ('eu-big', '2023-Q4', '2023-12-01', ${580 * M}, 'https://example.org/r', 'V'), ('gb-one', '2024-Q2', '2024-05-01', ${110 * M}, 'https://example.org/r', 'I'),
      ('gb-one', '2024-Q3', '2024-08-01', ${105 * M}, 'https://example.org/r', 'I')`).run();
  // The Q2 report records its currency; the Q3 one records none, so its size is never shown.
  db.exec(`UPDATE research_fund_directory_reports SET fund_size_currency = 'GBP' WHERE fund_uid = 'gb-one' AND period = '2024-Q2'`);
  db.prepare(`INSERT INTO research_fund_vehicle_facts (fund_uid, field, value_text, source_name, imported_on)
    VALUES ('eu-big', 'manager_name', 'Euro Manager', ?, '2026-11-18'), ('eu-small', 'manager_name', 'Euro Manager', ?, '2026-11-18')`).run(EUR_SOURCE, EUR_SOURCE);
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

test('a third list\'s GBP size is served in GBP, matched by filter, bands and sort, and counted under no other currency', async () => {
  const db = fixture();
  const { body } = await get(db, '/fund-directory?limit=100');
  const by = Object.fromEntries(body.items.map((i: any) => [i.uid, i]));
  assert.deepEqual([by['gb-one'].fund_size_cents, by['gb-one'].size_currency], [120 * M, 'GBP']);
  assert.deepEqual(body.size_currencies, ['EUR', 'GBP', 'USD'], 'the currencies served sized rows hold');
  assert.deepEqual(body.coverage.fields.size_by_currency, { EUR: 3, GBP: 1, USD: 1 });
  assert.deepEqual([body.coverage.fields.size_eur, body.coverage.fields.size_usd], [3, 1]);
  assert.deepEqual(body.sources.find((s: any) => s.name === GBP_LIST).size_currencies, ['GBP']);
  assert.equal(body.sources.find((s: any) => s.name === GBP_LIST).size_currency, 'GBP');
  const gbp = (await get(db, '/fund-directory?size_currency=GBP&size_min=100000000')).body;
  assert.deepEqual(uids(gbp), ['gb-one']);
  assert.equal(gbp.facets.size_band.find((b: any) => b.value === '100-250').label, '£100–250M');
  assert.equal(gbp.facets.size_band.find((b: any) => b.value === '100-250').count, 1);
  assert.equal(gbp.facets.size_not_comparable, 6, 'every row but the sterling one sits in no GBP band');
  assert.deepEqual(uids((await get(db, '/fund-directory?size_currency=gbp&sort=-size')).body)[0], 'gb-one');
  assert.match(gbp.size_basis, /pounds sterling/);
  assert.doesNotMatch(gbp.size_basis, /euros|EuroTech|Shai/);
  // Never under euros or US dollars.
  assert.ok(!uids((await get(db, '/fund-directory?size_min=1')).body).includes('gb-one'));
  assert.ok(!uids((await get(db, '/fund-directory?size_currency=USD&size_min=1')).body).includes('gb-one'));
  // A code no served row holds matches no size, and is not an error.
  const chf = await get(db, '/fund-directory?size_currency=CHF&size_min=1');
  assert.deepEqual([chf.status, chf.body.total], [200, 0]);
});

test('a size with no currency is counted in size_unknown_currency, and its amount is in no answer', async () => {
  const db = fixture();
  const list = (await get(db, '/fund-directory?limit=100')).body;
  assert.equal(list.coverage.fields.size_unknown_currency, 1);
  const row = list.items.find((i: any) => i.uid === 'nocur');
  assert.deepEqual([row.fund_size_cents, row.size_currency, row.size_reason], [null, null, 'Not recorded: this list records no size in a known currency']);
  for (const ccy of ['EUR', 'USD', 'GBP']) {
    const b = (await get(db, `/fund-directory?size_currency=${ccy}&sort=-size&limit=100`)).body;
    assert.ok(!JSON.stringify(b).includes(String(777 * M)), `${ccy}: the amount is printed nowhere`);
  }
  const one = (await get(db, '/fund-directory/nocur')).body;
  assert.ok(!JSON.stringify(one).includes(String(777 * M)));
});

test('two lists in EUR are filtered and sorted together', async () => {
  const db = fixture();
  assert.deepEqual(uids((await get(db, '/fund-directory?size_min=50000000&sort=-size')).body), ['eu-big', 'eu2-mid']);
  assert.deepEqual(uids((await get(db, '/fund-directory?sort=size')).body).slice(0, 3), ['eu-small', 'eu2-mid', 'eu-big']);
  assert.equal((await get(db, '/fund-directory?size_band=50-100')).body.items[0].uid, 'eu2-mid');
});

test('kind: manager returns only managers, none only unrecorded rows, and the counts sum to the total', async () => {
  const db = fixture();
  const whole = (await get(db, '/fund-directory?limit=100')).body;
  const facet = Object.fromEntries(whole.facets.kind.map((k: any) => [k.value, k.count]));
  assert.deepEqual(facet, { vehicle: 3, manager: 1, accelerator: 0, resource: 0, none: 3 });
  assert.equal(Object.values(facet).reduce((t: number, n: any) => t + n, 0), whole.total);
  assert.equal(whole.coverage.kinds.reduce((t: number, k: any) => t + k.count, 0), whole.coverage.total);
  assert.deepEqual(uids((await get(db, '/fund-directory?kind=manager')).body), ['mgr']);
  assert.deepEqual(uids((await get(db, '/fund-directory?kind=none')).body).sort(), ['eu2-mid', 'gb-one', 'nocur']);
  const item = whole.items.find((i: any) => i.uid === 'gb-one');
  assert.deepEqual([item.record_kind, item.record_kind_reason], [null, 'Kind not recorded']);
  assert.equal(whole.items.find((i: any) => i.uid === 'eu-big').record_kind, 'vehicle');
  assert.equal((await get(db, '/fund-directory/mgr')).body.item.record_kind, 'manager');
  assert.equal((await get(db, '/fund-directory?kind=fund')).status, 400);
});

test('a size_currency that is not three letters is a 400', async () => {
  const db = fixture();
  for (const v of ['EU', 'EURO', '12A', 'E-R']) {
    const r = await get(db, `/fund-directory?size_currency=${v}`);
    assert.equal(r.status, 400, v);
    assert.equal(r.body.field, 'size_currency');
  }
});

test('the fund read, its reports, profile and comparison cell keep each size in its own currency', async () => {
  const db = fixture();
  const eu = (await get(db, '/fund-directory/eu-big')).body;
  assert.deepEqual([eu.item.fund_size_cents, eu.item.size_currency], [582 * M, 'EUR']);
  assert.deepEqual(eu.reports.map((r: any) => [r.fund_size_cents, r.size_currency]), [[580 * M, 'EUR']]);
  assert.deepEqual(eu.history.vehicles.map((v: any) => [v.uid, v.fund_size_cents, v.size_currency]),
    [['eu-big', 582 * M, 'EUR'], ['eu-small', 30 * M, 'EUR']]);
  assert.deepEqual(eu.history.observations.map((o: any) => [o.fund_size_cents, o.size_currency]), [[582 * M, 'EUR'], [580 * M, 'EUR']],
    'the vehicle\'s own size, then its labelled report');
  const us = (await get(db, '/fund-directory/us-afore')).body;
  assert.deepEqual([us.item.fund_size_cents, us.item.size_currency], [185 * M, 'USD']);
  const gb = (await get(db, '/fund-directory/gb-one')).body;
  assert.deepEqual(gb.reports.map((r: any) => [r.fund_size_cents, r.size_currency]), [[110 * M, 'GBP'], [null, null]], 'a report row shows its own currency');
  assert.deepEqual(gb.history.observations.map((o: any) => [o.fund_size_cents, o.size_currency]), [[120 * M, 'GBP'], [110 * M, 'GBP']],
    'the profile\'s history takes each report row\'s own currency, and leaves out one with none');
  const env = { DB: d1Over(db) } as any;
  const row = (await getFund(env, 'gb-one'))!.item!;
  assert.equal(row.size_currency, 'GBP');
  const raw = db.prepare(`SELECT * FROM research_fund_directory WHERE uid = 'gb-one'`).get() as DirectoryRow;
  const cell = fundCells(raw).size as any;
  assert.deepEqual([cell.value, cell.currency], [120 * M, 'GBP']);
  const usRaw = db.prepare(`SELECT * FROM research_fund_directory WHERE uid = 'us-afore'`).get() as DirectoryRow;
  assert.deepEqual([(fundCells(usRaw).size as any).value, (fundCells(usRaw).size as any).currency], [185 * M, 'USD']);
});

test('Markets and Overview serve euro sizes only, chosen by the row\'s currency', async () => {
  const db = fixture();
  const rows = db.prepare(`SELECT * FROM research_fund_directory`).all() as any[];
  assert.deepEqual(rows.filter((r) => euroSizeCents(r) != null).map((r) => r.uid).sort(), ['eu-big', 'eu-small', 'eu2-mid']);
  const agg = fundAggregates(rows);
  assert.equal(agg.with_size, 3, 'the US dollar, sterling and unrecorded sizes are not euros');
  const overview = await readFundAggregates({ DB: d1Over(db) } as any);
  assert.equal([...overview.bands.values()].reduce((t, n) => t + n, 0), 3);
});
