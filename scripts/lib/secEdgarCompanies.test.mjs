import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDGAR_LICENCE, EDGAR_SOURCE, EDGAR_URL, EDGAR_USER_AGENT, ROWS_PER_INSERT,
  migrationNumberFromOut, padCik, parseEdgar, renderMigration,
} from './secEdgarCompanies.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const sample = () => ({
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
    [1652044, 'Alphabet Inc.', 'GOOGL', 'Nasdaq'],
    [1652044, 'Alphabet Inc.', 'GOOG', 'Nasdaq'],
    [1652044, 'Alphabet Inc.', 'GOOG', 'Nasdaq'],
    [12345, "O'Reilly & Sons", 'ORLY', null],
    [0, 'No Cik Corp', 'NOPE', 'NYSE'],
    [777, '   ', 'BLNK', 'NYSE'],
    [778, 'Bad Ticker Co', 'x y', 'NYSE'],
    [779, 'Bell\u0007 Co', 'BELL', 'NYSE'],
    ['oops'],
  ],
});

test('one row per CIK: the first listing is the ticker, the rest are other listings, duplicates dropped', () => {
  const p = parseEdgar(sample());
  assert.equal(p.listings, 10);
  assert.deepEqual(p.rows.map((r) => r.cik), ['0000320193', '0001652044', '0000012345']);
  const alpha = p.rows[1];
  assert.deepEqual([alpha.ticker, alpha.exchange, alpha.other_listings], ['GOOGL', 'Nasdaq', [['GOOG', 'Nasdaq']]]);
  assert.equal(p.rows[2].exchange, null, 'an exchange EDGAR does not record stays null');
  assert.deepEqual(p.skipped.map((s) => s.reason),
    ['no valid CIK', 'no name', 'no valid ticker', 'no name', 'not four fields']);
});

test('a changed format throws rather than reading a column in the wrong place', () => {
  assert.throws(() => parseEdgar({ fields: ['cik', 'ticker', 'name', 'exchange'], data: [] }), /fields changed/);
  assert.throws(() => parseEdgar([]), /expected \{ fields, data \}/);
});

test('padCik: ten digits, or null', () => {
  assert.equal(padCik(320193), '0000320193');
  for (const bad of [0, -1, 1.5, '320193', 1e11]) assert.equal(padCik(bad), null);
});

test('the migration applies, twice, to unique rows that each cite EDGAR and its licence', () => {
  const sql = renderMigration(parseEdgar(sample()), '2026-10-06', '404_research_public_companies.sql');
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  db.exec(sql);
  const rows = db.prepare('SELECT * FROM research_public_companies ORDER BY cik').all();
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.cik)).size, rows.length, 'unique by CIK');
  for (const r of rows) {
    assert.deepEqual([r.source_name, r.source_url, r.licence, r.as_of], [EDGAR_SOURCE, EDGAR_URL, EDGAR_LICENCE, '2026-10-06']);
  }
  assert.equal(rows.find((r) => r.ticker === 'ORLY').name, "O'Reilly & Sons", 'a quote reaches the row as text');
  assert.equal(rows.find((r) => r.ticker === 'GOOGL').other_listings, '[["GOOG","Nasdaq"]]');
  assert.equal(rows.find((r) => r.ticker === 'AAPL').other_listings, null);
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['as_of', 'cik', 'exchange', 'licence', 'name', 'other_listings', 'source_name', 'source_url', 'ticker'],
    'nothing EDGAR does not record: no country, sector, size or people');
});

test('rows go in batches small enough for one D1 statement', () => {
  const data = Array.from({ length: ROWS_PER_INSERT * 2 + 1 }, (_, i) => [i + 1, `Co ${i}`, `T${i}`, 'NYSE']);
  const sql = renderMigration(parseEdgar({ fields: ['cik', 'name', 'ticker', 'exchange'], data }), '2026-10-06', '404_research_public_companies.sql');
  assert.equal(sql.match(/^INSERT OR IGNORE INTO/gm).length, 3);
  for (const stmt of sql.split(/;\n/)) assert.ok(stmt.length < 100_000, 'D1 caps a statement at 100 kB');
  assert.throws(() => renderMigration(parseEdgar(sample()), '6 Oct 2026', '404_research_public_companies.sql'), /YYYY-MM-DD/);
});

test('the header number is the leading digits of --out, not a fixed 404', () => {
  const parsed = parseEdgar(sample());
  const as412 = renderMigration(parsed, '2026-10-07', '/tmp/412_research_public_companies_edgar.sql');
  const as404 = renderMigration(parsed, '2026-10-07', '404_research_public_companies.sql');
  assert.match(as412, /^-- Migration 412: US public companies from SEC EDGAR/);
  assert.match(as404, /^-- Migration 404: US public companies from SEC EDGAR/);
  assert.equal(as412.replace('Migration 412', 'Migration 404'), as404, 'only the number changes');
  assert.equal(migrationNumberFromOut('cloudflare-worker/sql/migrations/412_research_public_companies_edgar.sql'), '412');
  assert.throws(() => migrationNumberFromOut('research_public_companies.sql'), /--out must be named/);
  assert.throws(() => renderMigration(parsed, '2026-10-07'), /--out must be named/);
});

test('migration 412 holds the rows: unique by CIK, each citing EDGAR, numbered 412', () => {
  const path = resolve(ROOT, 'cloudflare-worker/sql/migrations/412_research_public_companies_edgar.sql');
  const committed = readFileSync(path, 'utf8');
  assert.equal(migrationNumberFromOut(path), '412');
  assert.match(committed, /^-- Migration 412: US public companies from SEC EDGAR \(#1230, D595\)\./);
  assert.match(committed, /^-- 10434 listings in the file; 8016 companies \(one row per CIK\);/m);
  assert.match(committed, /^-- 0 listings skipped by the importer's checks\./m);
  const db = new DatabaseSync(':memory:');
  db.exec(committed);
  db.exec(committed);
  const rows = db.prepare('SELECT cik, source_name, source_url, licence, as_of FROM research_public_companies').all();
  assert.equal(rows.length, 8016, 'one row per CIK, and applying the file twice adds none');
  assert.equal(new Set(rows.map((r) => r.cik)).size, rows.length, 'unique by CIK');
  for (const r of rows) {
    assert.equal(r.source_name, EDGAR_SOURCE);
    assert.equal(r.source_url, EDGAR_URL);
    assert.equal(r.licence, EDGAR_LICENCE);
    assert.match(r.as_of, /^\d{4}-\d{2}-\d{2}$/);
  }
  const apple = db.prepare('SELECT name, ticker FROM research_public_companies WHERE cik = ?').get('0000320193');
  assert.equal(apple.name, 'Apple Inc.');
  assert.equal(apple.ticker, 'AAPL');
});

test('the User-Agent names the public contact in SECURITY.md, and the committed migration is the importer\'s output', () => {
  const security = readFileSync(resolve(ROOT, 'SECURITY.md'), 'utf8');
  const contact = EDGAR_USER_AGENT.match(/[\w.+-]+@[\w.-]+/)[0];
  assert.match(security, new RegExp(`\\*\\*Contact:\\*\\* \`${contact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
  const committed = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/404_research_public_companies.sql'), 'utf8');
  assert.match(committed, /^-- WRITTEN BY scripts\/import-sec-edgar\.mjs/m);
  const db = new DatabaseSync(':memory:');
  db.exec(committed);
  const bad = db.prepare(`SELECT COUNT(*) AS n FROM research_public_companies
    WHERE source_name <> ? OR source_url <> ? OR licence <> ? OR as_of NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)
    .get(EDGAR_SOURCE, EDGAR_URL, EDGAR_LICENCE);
  assert.equal(bad.n, 0, 'every committed row cites EDGAR, its URL, its licence and a date');
});
