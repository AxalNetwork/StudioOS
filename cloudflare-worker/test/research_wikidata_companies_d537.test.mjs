/**
 * D537 (#1229) — the Wikidata importer that writes migration 403, and what any
 * file it writes must be.
 *
 * The importer (`scripts/import-wikidata-companies.mjs`) is pure functions plus
 * one fetch loop. These tests drive the functions on SPARQL-shaped fixtures, so
 * they hold without the network:
 *   - the query selects on website (P856), country (P17) and an industry (P452),
 *     drops dissolved items (P576), and refuses an id that is not a Q-id;
 *   - only industries whose label the crosswalk maps are kept;
 *   - a row takes https first, the crosswalk's country name by ISO code, the
 *     earliest year, skips an item in two countries, and carries no figure;
 *   - selection is round-robin across industries, capped, and skips
 *     migration 228's companies and duplicates;
 *   - the file it writes parses, every row cites its Wikidata entity under the
 *     CC0 line, a quote in a name survives, and applying it twice adds nothing;
 *   - the list route's `total` and `coverage` are the table's own counts.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_wikidata_companies_d537.test.mjs
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
  canonicalCountries, collectCompanies, companyQuery, crosswalkKeys, existingUids, industryLabelCandidates,
  industryQuery, insertLine, parseIndustries, selectRows, sparqlString, toMigration, toRow,
} from '../../scripts/import-wikidata-companies.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const ENTITY = (q) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` });
const LIT = (v) => ({ type: 'literal', value: String(v) });
const CANON = canonicalCountries(ROOT);
const AS_OF = '2026-10-06';
/** Migration 228's licence default, read from the file: every directory row reads the same line. */
const LICENCE_228 = /source_license TEXT NOT NULL DEFAULT '([^']+)'/.exec(read('cloudflare-worker/sql/migrations/228_research_company_directory.sql'))[1];

/** One SPARQL row of `companyQuery`'s shape. */
const b = (q, name, { website, country = 'Q183', countryLabel = 'Germany', cc = 'DE', inception, links = 10 } = {}) => ({
  item: ENTITY(q), name: LIT(name), website: LIT(website ?? `https://${q.toLowerCase()}.example`),
  country: ENTITY(country), countryLabel: LIT(countryLabel), ...(cc ? { cc: LIT(cc) } : {}),
  ...(inception ? { inception: LIT(inception) } : {}), links: LIT(links),
});
const SOFTWARE = { qid: 'Q638608', label: 'software industry', key: 'software industry' };
const BANKS = { qid: 'Q22687', label: 'bank', key: 'bank' };
const rowOf = (bindings, industry = SOFTWARE) => toRow(collectCompanies(bindings)[0], industry, { canonical: CANON, asOf: AS_OF });

test('D537: the query selects on website, country and a crosswalk industry, drops dissolved items, and refuses a non-Q-id', () => {
  const q = companyQuery('Q638608', 1600);
  assert.match(q, /\?item wdt:P452 wd:Q638608 ;/);
  assert.match(q, /wdt:P856 \?website ;/);
  assert.match(q, /wdt:P17 \?country ;/);
  assert.match(q, /FILTER NOT EXISTS \{ \?item wdt:P576 \?dissolved \}/);
  assert.match(q, /OPTIONAL \{ \?item wdt:P571 \?inception \}/);
  assert.match(q, /FILTER\(LANG\(\?name\) = "en"\)/);
  assert.match(q, /ORDER BY DESC\(\?links\) \?item\s+LIMIT 1600$/);
  for (const bad of ['P452', 'Q0', 'q42', 'Q42 } DELETE', '']) assert.throws(() => companyQuery(bad, 10), /not a Wikidata item id/, bad);
  assert.throws(() => companyQuery('Q42', 0), /row limit/);

  // Every crosswalk key is looked up, a multi-word one with hyphens too, quotes escaped.
  const labels = industryLabelCandidates();
  for (const k of Object.keys(COMPANY_SECTOR_RULES)) assert.ok(labels.includes(k), `${k} is not looked up`);
  assert.ok(labels.includes('e-commerce'), 'the hyphenated form of "e commerce" is not looked up');
  assert.match(industryQuery(['bank', 'say "hi"']), /VALUES \?label \{ "bank"@en "say \\"hi\\""@en \}/);
  assert.equal(sparqlString('a\\b\nc'), '"a\\\\b c"');
  assert.match(industryQuery(['bank']), /FILTER EXISTS \{ \?any wdt:P452 \?ind \}/);
});

test('D537: only industries whose label the crosswalk maps are kept, once each', () => {
  const kept = parseIndustries([
    { ind: ENTITY('Q484847'), label: LIT('e-commerce') },
    { ind: ENTITY('Q22687'), label: LIT('bank') },
    { ind: ENTITY('Q22687'), label: LIT('bank') },
    { ind: ENTITY('Q274393'), label: LIT('bakery') },
    { ind: LIT('not an entity'), label: LIT('bank') },
  ]);
  assert.deepEqual(kept.map((i) => [i.qid, i.key]), [['Q22687', 'bank'], ['Q484847', 'e commerce']]);
  for (const i of kept) assert.ok(mapCompanySector(i.label).targets.length === 1, `${i.label} does not map to a market`);
  assert.deepEqual(crosswalkKeys(), Object.keys(COMPANY_SECTOR_RULES).sort());
});

test('D537: a row takes https first, the crosswalk country by ISO code, the earliest year, and nothing it was not given', () => {
  const r = rowOf([
    b('Q100', 'Acme', { website: 'http://acme.example', inception: '2004-05-01T00:00:00Z' }),
    b('Q100', 'Acme', { website: 'https://www.acme.example/en', inception: '1998-01-01T00:00:00Z' }),
    b('Q100', 'Acme', { website: 'https://acme.example' }),
  ]);
  assert.deepEqual(r, {
    uid: 'q100', name: 'Acme', website: 'https://acme.example', country: 'Germany', founded_year: 1998,
    sector: 'software industry', source_name: 'Wikidata', source_url: 'https://www.wikidata.org/wiki/Q100',
    source_license: LICENCE_228, as_of: AS_OF, links: 10,
  });
  for (const k of ['funding_total', 'revenue', 'employee_count', 'valuation', 'last_funding_amount']) assert.ok(!(k in r), `${k} was set`);

  // The country is named as migration 376 names it, so the crosswalk maps it.
  const us = rowOf([b('Q101', 'Beta', { country: 'Q30', countryLabel: 'United States of America', cc: 'US' })]);
  assert.equal(us.country, CANON.get('US'));
  assert.equal(mapCompanyCountry(us.country).targets[0], 'US');
  // A country 376 lacks keeps Wikidata's label.
  assert.equal(rowOf([b('Q102', 'Gamma', { country: 'Q298', countryLabel: 'Chile', cc: 'XX' })]).country, 'Chile');
  // Two different countries: skipped, not guessed.
  assert.equal(rowOf([b('Q103', 'Delta'), b('Q103', 'Delta', { country: 'Q142', countryLabel: 'France', cc: 'FR' })]), null);
  // No year outside 1000..the pull's year; no year at all is null, not zero.
  assert.equal(rowOf([b('Q104', 'Eps', { inception: '2031-01-01T00:00:00Z' })]).founded_year, null);
  assert.equal(rowOf([b('Q105', 'Zeta')]).founded_year, null);
  // A website that is not http(s), and a blank name, drop the row.
  assert.equal(rowOf([b('Q106', 'Eta', { website: 'ftp://eta.example' })]), null);
  assert.equal(rowOf([b('Q107', '  ')]), null);
  // Control characters do not reach a name.
  assert.equal(rowOf([b('Q108', 'Theta\nCo\u0007')]).name, 'Theta Co');
});

test('D537: selection is round-robin across industries, capped, and skips 228\'s companies and duplicates', () => {
  const r = (uid, sector) => ({ uid, sector });
  const lists = [
    { industry: BANKS, rows: [r('q1', 'bank'), r('q2', 'bank'), r('q3', 'bank'), r('q4', 'bank')] },
    { industry: SOFTWARE, rows: [r('q2', 'software industry'), r('q9', 'software industry'), r('q10', 'software industry')] },
  ];
  // Pass 1: banks q1, software q2. Pass 2: banks skips q2 (taken) for q3, software q9. Pass 3: q4, q10.
  assert.deepEqual(selectRows(lists, 10).map((x) => x.uid), ['q1', 'q2', 'q3', 'q9', 'q4', 'q10']);
  assert.deepEqual(selectRows(lists, 3).map((x) => x.uid), ['q1', 'q2', 'q3']);
  assert.deepEqual(selectRows(lists, 10, new Set(['q1', 'q9'])).map((x) => x.uid), ['q2', 'q10', 'q3', 'q4']);
  // 228's own uids are what is excluded: all 300, as the file writes them.
  const old = existingUids(ROOT);
  assert.equal(old.size, 300);
  assert.ok(old.has('q138639208'));
});

/** A database with the directory table as migrations 228 and 375 make it, and no rows. */
function emptyDirectory() {
  const db = new DatabaseSync(':memory:');
  const create228 = read('cloudflare-worker/sql/migrations/228_research_company_directory.sql').split(/\nINSERT OR IGNORE/)[0];
  db.exec(create228);
  db.exec(read('cloudflare-worker/sql/migrations/375_research_company_directory_columns.sql'));
  return db;
}
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM research_company_directory').get().n;

function fixtureMigration() {
  const rows = [
    rowOf([b('Q201', "O'Brien & Sons", { inception: '1950-01-01T00:00:00Z' })]),
    rowOf([b('Q202', 'Bank of Somewhere', { country: 'Q142', countryLabel: 'France', cc: 'FR' })], BANKS),
    rowOf([b('Q203', 'No Year GmbH')]),
  ];
  return { rows, sql: toMigration(rows, { asOf: AS_OF, cap: 3000, perIndustry: 400, industries: 2 }) };
}

test('D537: the file parses, every row cites its entity under the CC0 line, a quote survives, and a second run adds nothing', () => {
  const { rows, sql } = fixtureMigration();
  assert.match(sql, /^-- 403 — 3 more Research directory companies from Wikidata/);
  assert.match(sql, /GENERATED by scripts\/import-wikidata-companies\.mjs/);
  assert.equal(sql.split('\n').filter((l) => l.startsWith('INSERT OR IGNORE INTO research_company_directory')).length, 3);
  const db = emptyDirectory();
  db.exec(sql);
  assert.equal(count(db), 3);
  db.exec(sql);
  assert.equal(count(db), 3, 'applying the file twice added rows');
  for (const r of db.prepare('SELECT * FROM research_company_directory ORDER BY uid').all()) {
    assert.match(r.uid, /^q[1-9]\d*$/);
    assert.ok(r.name && r.website && r.country && r.sector);
    assert.equal(r.source_name, 'Wikidata');
    assert.equal(r.source_url, `https://www.wikidata.org/wiki/${r.uid.toUpperCase()}`);
    assert.equal(r.source_license, LICENCE_228);
    assert.equal(r.as_of, AS_OF);
    for (const k of ['funding_total', 'revenue', 'employee_count', 'valuation', 'metrics_source_url']) assert.equal(r[k], null, `${r.uid}.${k}`);
  }
  assert.equal(db.prepare("SELECT name FROM research_company_directory WHERE uid = 'q201'").get().name, "O'Brien & Sons");
  assert.equal(db.prepare("SELECT founded_year FROM research_company_directory WHERE uid = 'q201'").get().founded_year, 1950);
  assert.equal(db.prepare("SELECT founded_year FROM research_company_directory WHERE uid = 'q203'").get().founded_year, null);
  assert.equal(insertLine(rows[0]).includes("'O''Brien & Sons'"), true);
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

test('D537: the list route\'s total and coverage are the table\'s own counts, before and after an import', async () => {
  const db = emptyDirectory();
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (11, 'founder', 'Fin', 'fin@axal.example')`).run();
  db.exec(read('cloudflare-worker/sql/migrations/376_research_taxonomy.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/228_research_company_directory.sql'));
  const before = await directory(db, '/company-directory?limit=1');
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.total, 300);
  assert.equal(before.body.coverage.of, 300);

  db.exec(fixtureMigration().sql);
  const after = await directory(db, '/company-directory?limit=1');
  assert.equal(after.body.total, count(db));
  assert.equal(after.body.coverage.of, count(db));
  assert.equal(after.body.coverage.of, 303);
  assert.equal(after.body.coverage.fields.website, count(db));
  assert.equal(after.body.coverage.fields.funding, db.prepare('SELECT COUNT(*) AS n FROM research_company_directory WHERE funding_total IS NOT NULL').get().n);
  const facetSum = after.body.facets.sector_labels.reduce((s, f) => s + f.count, 0) + after.body.facets.sector_none;
  assert.equal(facetSum, count(db), 'the sector facets do not add up to the table');
  const filtered = await directory(db, '/company-directory?country=France&limit=1');
  assert.equal(filtered.body.total, db.prepare("SELECT COUNT(*) AS n FROM research_company_directory WHERE country = 'France'").get().n);
});
