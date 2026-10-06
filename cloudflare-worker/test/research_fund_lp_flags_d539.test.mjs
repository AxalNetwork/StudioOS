/**
 * D539 (#1084) — migration 380 recomputes the EIF and EIFO flags from each
 * EuroTech fund's notable LPs, by whole name, never by substring.
 *
 * Run on a database built from the baseline and every migration before 380,
 * as production builds it, plus fixture rows. What is pinned:
 *
 *   - the issue's table: "EIFO" is EIFO only; "European Investment Fund
 *     (EIF), CDP" is EIF only; "EIF, EIFO" is both; "Seifert Capital" and
 *     "EIFFEL" are neither; empty is neither;
 *   - an EIFO-only fund flagged EIF loses its EIF flag, and every other row
 *     (every other column, and every other source) stays as it was;
 *   - a second run changes nothing.
 *
 * `scripts/test_fund_lp_flags.py` checks the importers' matcher against this
 * same SQL over every row of the spreadsheet.
 *
 * Run:
 *   node --test cloudflare-worker/test/research_fund_lp_flags_d539.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const SQL_380 = readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith('380_'))), 'utf8');
const EURO = 'EuroTech VC Funds (public spreadsheet)';
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';

function builtBefore380() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 380)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const DB = builtBefore380();

const FIXTURES = [
  // [uid, notable_lps, eif_flag, eifo_flag, source] as stored before 380.
  ['t-eifo-only', 'EIFO', 1, 1, EURO],
  ['t-eif-named', 'European Investment Fund (EIF), CDP', 0, 0, EURO],
  ['t-both', 'EIF, EIFO', 0, 0, EURO],
  ['t-seifert', 'Seifert Capital', 1, 0, EURO],
  ['t-eiffel', 'EIFFEL', 1, 1, EURO],
  ['t-empty', null, 1, 1, EURO],
  ['t-denmark', 'Denmark’s Export and Investment Fund (EIFO)', 1, 0, EURO],
  ['t-lowercase', 'european investment fund', 0, 0, EURO],
  // Another source's flags are not this migration's to touch.
  ['t-deep', 'EIFO', 1, 1, DEEP],
];

function withFixtures() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(DB.prepare(`SELECT sql FROM sqlite_master WHERE name = 'research_fund_directory'`).get().sql);
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, website, notable_lps, eif_flag, eifo_flag, source_name, source_url, as_of)
                          VALUES (?, ?, 'https://example.test', ?, ?, ?, ?, 'https://example.test/src', '2026-10-04')`);
  for (const [uid, lps, eif, eifo, src] of FIXTURES) ins.run(uid, uid, lps, eif, eifo, src);
  return db;
}

const rows = (db) => db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all();
const flags = (db, uid) => {
  const r = db.prepare('SELECT eif_flag, eifo_flag FROM research_fund_directory WHERE uid = ?').get(uid);
  return [r.eif_flag, r.eifo_flag];
};
const apply = (db) => Number(db.prepare(SQL_380.replace(/^\s*--.*$/gm, '').trim().replace(/;\s*$/, '')).run().changes);

test('380 sets both flags from the LPs by whole name, as the issue\'s table says', () => {
  const db = withFixtures();
  apply(db);
  assert.deepEqual(flags(db, 't-eifo-only'), [0, 1], '"EIFO" is EIFO only');
  assert.deepEqual(flags(db, 't-eif-named'), [1, 0], '"European Investment Fund (EIF), CDP" is EIF only');
  assert.deepEqual(flags(db, 't-both'), [1, 1], '"EIF, EIFO" is both');
  assert.deepEqual(flags(db, 't-seifert'), [0, 0], '"Seifert Capital" is neither');
  assert.deepEqual(flags(db, 't-eiffel'), [0, 0], '"EIFFEL" is neither');
  assert.deepEqual(flags(db, 't-empty'), [0, 0], 'no LPs name neither');
  assert.deepEqual(flags(db, 't-denmark'), [0, 1], 'EIFO\'s full name, with the spreadsheet\'s curly apostrophe');
  assert.deepEqual(flags(db, 't-lowercase'), [1, 0], 'the EIF\'s full name, in any case');
});

test('only the EuroTech rows\' two flags change, and a second run changes nothing', () => {
  const db = withFixtures();
  const before = rows(db);
  const changed = apply(db);
  const after = rows(db);
  assert.equal(after.length, before.length);
  const diffs = [];
  for (let i = 0; i < before.length; i += 1) {
    for (const col of Object.keys(before[i])) {
      if (before[i][col] !== after[i][col]) diffs.push(`${before[i].uid}.${col}`);
    }
  }
  assert.ok(diffs.every((d) => /\.(eif_flag|eifo_flag)$/.test(d)), `380 touched another column: ${diffs.join(', ')}`);
  assert.ok(!diffs.some((d) => d.startsWith('t-deep.')), 'another source\'s flags changed');
  assert.deepEqual(flags(db, 't-deep'), [1, 1]);
  // Every EuroTech fixture is stored wrong on purpose; the Deep Tech row is left alone.
  assert.equal(changed, 8, 'not every wrongly stored EuroTech row changed, or another row did');
  assert.equal(apply(db), 0, 'a second run changed rows');
});

test('on the database the migrations build, 380 applies and leaves only whole-name flags', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(DB.prepare(`SELECT sql FROM sqlite_master WHERE name = 'research_fund_directory'`).get().sql);
  const src = DB.prepare(`SELECT * FROM research_fund_directory`).all();
  assert.ok(src.length > 1000, `expected the built directory, found ${src.length} rows`);
  const cols = Object.keys(src[0]);
  const ins = db.prepare(`INSERT INTO research_fund_directory (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  for (const r of src) ins.run(...cols.map((c) => r[c]));
  const changed = apply(db);
  assert.ok(changed > 0, 'nothing changed on the built directory');
  // No EIFO-only fund keeps an EIF flag.
  const wrong = db.prepare(`SELECT COUNT(*) AS n FROM research_fund_directory WHERE source_name = ? AND eif_flag = 1
                              AND (' ' || COALESCE(notable_lps, '') || ' ') NOT GLOB '*[^A-Za-z]EIF[^A-Za-z]*'
                              AND COALESCE(notable_lps, '') NOT LIKE '%European Investment Fund%'`).get(EURO);
  assert.equal(wrong.n, 0, 'a fund whose LPs name no EIF kept its EIF flag');
  assert.equal(apply(db), 0, 'a second run changed rows');
  console.log(`# 380 on the built directory: ${changed} EuroTech rows change`);
});
