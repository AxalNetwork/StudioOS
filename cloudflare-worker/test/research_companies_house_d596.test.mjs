/**
 * D596 (#1231) — the Companies House importer that writes migration 405, and
 * what any file it writes must be.
 *
 * Fixtures are shaped like the bulk file's CSV, so these hold without the
 * network:
 *   - the reviewed SIC table maps only to keys of the crosswalk;
 *   - the importer reads no address column, and a row carries no personal data;
 *   - only active, UK-origin, non-dormant limited companies in a mapped SIC
 *     code are kept; the founded year is the incorporation year;
 *   - selection is oldest first, round-robin across sectors, capped, one per
 *     company number;
 *   - the file applies twice to the same rows, every row cites Companies House,
 *     its page and the OGL line, the company number is unique, and no officer
 *     or address column exists;
 *   - a UK company the directory already holds by name is not added again;
 *   - the directory's facets and country filter count the new rows.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_companies_house_d596.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { COMPANY_SECTOR_RULES, mapCompanySector, mapCompanyCountry } from '../src/services/researchTaxonomy.ts';
import { d1Over } from './_d1_sqlite.mjs';
import {
  COLUMNS, OGL, PAGE, SIC_SECTORS, SOURCE, headerIndex, insertLine, nameKey, parseCsvLine, selectRows, sicCode,
  toMigration, toRow,
} from '../../scripts/import-companies-house.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const AS_OF = '2026-10-06';

// The bulk file's header, in its own order, with its leading spaces.
const HEADER = ['CompanyName', ' CompanyNumber', 'RegAddress.CareOf', 'RegAddress.POBox', 'RegAddress.AddressLine1',
  ' RegAddress.AddressLine2', 'RegAddress.PostTown', 'RegAddress.County', 'RegAddress.Country', 'RegAddress.PostCode',
  'CompanyCategory', 'CompanyStatus', 'CountryOfOrigin', 'DissolutionDate', 'IncorporationDate',
  'Accounts.AccountRefDay', 'Accounts.AccountRefMonth', 'Accounts.NextDueDate', 'Accounts.LastMadeUpDate',
  'Accounts.AccountCategory', 'SICCode.SicText_1', 'SICCode.SicText_2', 'SICCode.SicText_3', 'SICCode.SicText_4', 'URI'];
const IDX = headerIndex(HEADER);

function rec(over = {}) {
  const v = {
    name: 'ACME SOFTWARE LIMITED', number: '01234567', careOf: 'JANE DOE', line1: '1 SECRET STREET', town: 'LONDON',
    postcode: 'N1 1AA', category: 'Private Limited Company', status: 'Active', origin: 'United Kingdom',
    incorporated: '15/03/1999', accounts: 'FULL', sic1: '62012 - Business and domestic software development',
    sic2: '', ...over,
  };
  return [v.name, v.number, v.careOf, '', v.line1, '', v.town, '', 'ENGLAND', v.postcode, v.category, v.status,
    v.origin, '', v.incorporated, '31', '12', '', '', v.accounts, v.sic1, v.sic2, '', '',
    `http://business.data.gov.uk/id/company/${v.number}`];
}

const PERSONAL = /address|officer|psc|significant|postcode|post_code|care_of|careof|person|director|birth/i;

test('D596: every SIC code maps to a key of the crosswalk, and so to a taxonomy market', () => {
  const keys = new Set(Object.keys(COMPANY_SECTOR_RULES));
  assert.ok(Object.keys(SIC_SECTORS).length >= 40, 'the reviewed table shrank');
  for (const [code, label] of Object.entries(SIC_SECTORS)) {
    assert.match(code, /^\d{5}$/, code);
    assert.ok(keys.has(label), `${code} → ${label} is not a crosswalk key`);
    assert.equal(mapCompanySector(label).targets.length, 1, `${label} reaches no market`);
  }
});

test('D596: the importer reads no address column, and a row carries no personal data', () => {
  const named = JSON.stringify(COLUMNS);
  assert.doesNotMatch(named, /RegAddress/, 'an address column is named');
  const row = toRow(rec(), IDX, { asOf: AS_OF });
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), ['founded_year', 'incorporated', 'name', 'number', 'sector', 'sic_codes', 'uid']);
  assert.doesNotMatch(JSON.stringify(row), /JANE DOE|SECRET STREET|N1 1AA|LONDON|ENGLAND/);
  assert.throws(() => headerIndex(HEADER.filter((h) => h !== 'CountryOfOrigin')), /no CountryOfOrigin column/);
});

test('D596: the CSV reader keeps a quoted comma and a doubled quote, and the header is trimmed', () => {
  assert.deepEqual(parseCsvLine('"A, B ""C"" LTD",01234567,,x'), ['A, B "C" LTD', '01234567', '', 'x']);
  assert.equal(IDX.number, 1, 'the leading space in " CompanyNumber" is trimmed');
  assert.equal(sicCode('62012 - Business and domestic software development'), '62012');
  assert.equal(sicCode('None Supplied'), null);
});

test('D596: only active, UK-origin, non-dormant limited companies in a mapped SIC code are kept', () => {
  const keep = toRow(rec({ sic1: '70100 - Activities of head offices', sic2: '64191 - Banks' }), IDX, { asOf: AS_OF });
  assert.deepEqual([keep.uid, keep.sector, keep.sic_codes, keep.founded_year], ['ch-01234567', 'bank', '70100,64191', 1999],
    'the first mapped code sets the sector; every code is kept');
  assert.equal(toRow(rec({ number: 'SC123456' }), IDX, { asOf: AS_OF }).uid, 'ch-sc123456');
  const out = [
    { status: 'Dissolved' }, { status: 'Liquidation' }, { origin: 'Ireland' }, { accounts: 'DORMANT' },
    { category: 'Limited Liability Partnership' }, { sic1: '70100 - Activities of head offices' }, { sic1: 'None Supplied' },
    { number: '123' }, { name: '' },
  ];
  for (const o of out) assert.equal(toRow(rec(o), IDX, { asOf: AS_OF }), null, JSON.stringify(o));
  assert.equal(toRow(rec({ incorporated: '' }), IDX, { asOf: AS_OF }).founded_year, null, 'no date is no year, not a guess');
  assert.equal(toRow(rec({ incorporated: '01/01/2031' }), IDX, { asOf: AS_OF }).founded_year, null, 'a year after the pull is not kept');
});

test('D596: selection is oldest first per sector, round-robin across sectors, capped, one row per company number', () => {
  const r = (n, sic, inc) => toRow(rec({ number: n, sic1: sic, incorporated: inc }), IDX, { asOf: AS_OF });
  const sw = '62012 - Business and domestic software development';
  const bank = '64191 - Banks';
  const rows = [r('00000003', sw, '01/01/2000'), r('00000001', sw, '01/01/1990'), r('00000002', bank, '01/01/1995'),
    r('00000004', bank, '01/01/1980'), r('00000005', sw, '01/01/1970'), r('00000005', sw, '01/01/1970')];
  assert.deepEqual(selectRows(rows, 10).map((x) => x.number), ['00000004', '00000005', '00000002', '00000001', '00000003']);
  assert.deepEqual(selectRows(rows, 3).map((x) => x.number), ['00000004', '00000005', '00000002']);
});

/** The directory table as migrations 228 and 375 make it, with no rows. */
function emptyDirectory() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('cloudflare-worker/sql/migrations/228_research_company_directory.sql').split(/\nINSERT OR IGNORE/)[0]);
  db.exec(read('cloudflare-worker/sql/migrations/375_research_company_directory_columns.sql'));
  return db;
}
const count = (db, where = '1 = 1') => db.prepare(`SELECT COUNT(*) AS n FROM research_company_directory WHERE ${where}`).get().n;

function fixture() {
  const rows = selectRows([
    toRow(rec({ name: "O'NEILL & SONS LIMITED", number: '00000011' }), IDX, { asOf: AS_OF }),
    toRow(rec({ name: 'TESCO PLC', number: '00445790', sic1: '47110 - Retail sale in non-specialised stores with food, beverages or tobacco predominating' }), IDX, { asOf: AS_OF }),
    toRow(rec({ name: 'NORTHERN BANK LIMITED', number: 'NI000001', sic1: '64191 - Banks', incorporated: '' }), IDX, { asOf: AS_OF }),
  ], 3000);
  return { rows, sql: toMigration(rows, { asOf: AS_OF, cap: 3000, read: 3, kept: 3 }) };
}

test('D596: the file applies once to unique rows that each cite Companies House, the company page and the OGL', () => {
  const { sql } = fixture();
  assert.match(sql, /^-- 405 — 3 UK companies for the Research directory from Companies House/);
  assert.match(sql, /GENERATED by scripts\/import-companies-house\.mjs/);
  const db = emptyDirectory();
  db.exec(sql);
  assert.equal(count(db), 3);
  const body = sql.split('\n').filter((l) => l.startsWith('INSERT OR IGNORE')).join('\n');
  db.exec(body);
  assert.equal(count(db), 3, 'applying the rows twice added rows');
  const rows = db.prepare('SELECT * FROM research_company_directory ORDER BY uid').all();
  assert.equal(new Set(rows.map((r) => r.uid)).size, rows.length, 'a company number is unique');
  for (const r of rows) {
    assert.match(r.uid, /^ch-[a-z0-9]{8}$/);
    assert.equal(r.source_name, SOURCE);
    assert.equal(r.source_url, PAGE(r.uid.slice(3).toUpperCase()));
    assert.equal(r.source_license, OGL);
    assert.equal(r.source_license, 'Contains public sector information licensed under the Open Government Licence v3.0.');
    assert.equal(r.as_of, AS_OF);
    assert.equal(r.country, 'United Kingdom');
    assert.equal(r.website, '', 'the register records no website, and none is invented');
    for (const k of ['funding_total', 'revenue', 'employee_count', 'valuation', 'last_funding_amount']) assert.equal(r[k], null, `${r.uid}.${k}`);
  }
  assert.equal(db.prepare("SELECT name FROM research_company_directory WHERE uid = 'ch-00000011'").get().name, "O'NEILL & SONS LIMITED");
  assert.equal(db.prepare("SELECT founded_year FROM research_company_directory WHERE uid = 'ch-ni000001'").get().founded_year, null);
  assert.equal(db.prepare("SELECT sic_codes FROM research_company_directory WHERE uid = 'ch-00445790'").get().sic_codes, '47110');
  const cols = db.prepare('PRAGMA table_info(research_company_directory)').all().map((c) => c.name);
  assert.deepEqual(cols.filter((c) => PERSONAL.test(c)), [], 'an officer or address column exists');
});

test('D596: one company, one row — a UK company the directory holds by name is not added again', () => {
  const db = emptyDirectory();
  const w = db.prepare(`INSERT INTO research_company_directory (uid, name, website, country, source_url, as_of)
                        VALUES (?, ?, 'https://x.example', ?, 'https://www.wikidata.org/wiki/Q1', '2026-10-06')`);
  w.run('q487494', 'Tesco', 'United Kingdom');
  w.run('q9', "O'Neill & Sons", 'Ireland');
  db.exec(fixture().sql);
  assert.equal(count(db, "name = 'TESCO PLC'"), 0, 'Tesco is in the directory once, as its Wikidata row');
  assert.equal(count(db, "uid = 'ch-00000011'"), 1, 'a same-named company in another country is a different company');
  assert.equal(nameKey('TESCO PLC'), 'tesco');
  assert.equal(nameKey('Acme  Holdings Ltd.'), 'acme holdings');
  assert.equal(nameKey('ROLLS-ROYCE PUBLIC LIMITED COMPANY'), 'rolls-royce');
  assert.ok(insertLine(fixture().rows[0], AS_OF).includes("d.country = 'United Kingdom'"));
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const app = new Hono();
app.route('/api/research', research);
app.onError((err, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 500));

async function directory(db, path) {
  const token = await new SignJWT({ user_id: 11, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/research${path}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
  return { status: res.status, body: await res.json() };
}

test('D596: the directory\'s facets and country filter count the Companies House rows from the table', async () => {
  const db = emptyDirectory();
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (11, 'founder', 'Fin', 'fin@axal.example')`).run();
  db.exec(read('cloudflare-worker/sql/migrations/376_research_taxonomy.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/228_research_company_directory.sql'));
  const before = await directory(db, '/company-directory?limit=1');
  const ukBefore = before.body.facets.countries.find((f) => f.code === 'GB')?.count ?? 0;

  db.exec(fixture().sql);
  const after = await directory(db, '/company-directory?limit=100&country_code=GB');
  assert.equal(after.status, 200, JSON.stringify(after.body));
  assert.equal(after.body.coverage.of, count(db));
  assert.equal(after.body.coverage.of, before.body.coverage.of + 3);
  assert.equal(after.body.coverage.fields.website, before.body.coverage.fields.website, 'an empty website is counted as none');
  const uk = after.body.facets.countries.find((f) => f.code === 'GB');
  assert.equal(uk.count, ukBefore + 3);
  assert.equal(after.body.total, count(db, "country = 'United Kingdom'"));
  const ch = after.body.items.filter((i) => i.source_name === SOURCE);
  assert.deepEqual(ch.map((i) => i.uid).sort(), ['ch-00000011', 'ch-00445790', 'ch-ni000001']);
  assert.equal(mapCompanyCountry('United Kingdom').targets[0], 'GB');
  const bank = after.body.facets.sector_labels.find((f) => f.label === 'bank');
  assert.ok(bank && bank.count >= 1, 'the sector facet counts the new bank');
  const filtered = await directory(db, '/company-directory?sector_label=bank&limit=100');
  assert.ok(filtered.body.items.some((i) => i.uid === 'ch-ni000001'));
});
