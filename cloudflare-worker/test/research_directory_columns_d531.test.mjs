/**
 * D531 — the 24 columns production's `research_company_directory` holds are
 * declared by migration 375, and production records 375 rather than runs it.
 *
 * Deploy run 37197266231 (2026-10-04) was the first with D359's column
 * comparison, and it found 24 columns on production that no repo file declared.
 * `PRODUCTION_ADDED` below is that run's list, exactly as it printed it (type,
 * and no NOT NULL or DEFAULT, because production has neither). It is a fixture
 * written from the log, not read from 375, so the two can disagree and this file
 * notices.
 *
 * What is held here:
 *   - the repo's schema story, built with `check-baseline-drift`'s own builder,
 *     now gives this table production's 37 columns, and lacks exactly these 24
 *     without 375;
 *   - 375 is only those 24 ADD COLUMNs, so recording it on production (where
 *     every one exists) is the same as running it there;
 *   - running it twice fails with "duplicate column" and changes nothing;
 *   - with the ledger row recorded the runner skips it, and `--verify-marked`
 *     can tell a production that has the columns from one that does not;
 *   - D531's command cites 375's real checksum;
 *   - nothing reads the columns yet. The first reader (D534) must render an
 *     absent value as "Not recorded", and must re-aim the last test to arrive.
 *
 * Run with:
 *   node --test cloudflare-worker/test/research_directory_columns_d531.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  buildFresh,
  columnsOf,
  compareColumns,
  postCutoffMigrations,
} from '../../scripts/check-baseline-drift.mjs';
import { checksum, planActions, verifyMarked } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const TABLE = 'research_company_directory';
const FILE = '375_research_company_directory_columns.sql';
const SQL_375 = read(`cloudflare-worker/sql/migrations/${FILE}`);
const SQL_228 = read('cloudflare-worker/sql/migrations/228_research_company_directory.sql');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

/** Deploy run 37197266231, "Columns on production, absent from schema_baseline.sql (24)". */
const PRODUCTION_ADDED = [
  ['competitor_status', 'TEXT'], ['diligence_status', 'TEXT'],
  ['employee_as_of', 'TEXT'], ['employee_count', 'INTEGER'], ['employee_growth_pct', 'REAL'],
  ['funding_currency', 'TEXT'], ['funding_total', 'REAL'],
  ['last_funding_amount', 'REAL'], ['last_funding_currency', 'TEXT'],
  ['last_funding_date', 'TEXT'], ['last_funding_type', 'TEXT'],
  ['market_share_as_of', 'TEXT'], ['market_share_pct', 'REAL'],
  ['metrics_confidence', 'TEXT'], ['metrics_evidence_json', 'TEXT'], ['metrics_source_name', 'TEXT'],
  ['metrics_source_url', 'TEXT'], ['metrics_updated_at', 'TEXT'],
  ['revenue', 'REAL'], ['revenue_as_of', 'TEXT'], ['revenue_currency', 'TEXT'],
  ['valuation', 'REAL'], ['valuation_as_of', 'TEXT'], ['valuation_currency', 'TEXT'],
];
const NAMES = PRODUCTION_ADDED.map(([c]) => c);

/** Migration 228's CREATE TABLE alone: the table as the repo first made it. */
// It ends at its own "\n);" — 228's default text holds "(Wikidata data);", so the first ");" is not the end.
const CREATE_228 = SQL_228.slice(SQL_228.indexOf('CREATE TABLE'), SQL_228.indexOf('\n);', SQL_228.indexOf('CREATE TABLE')) + 3);

/** This table's columns in a `columnsOf` map, and nothing else. */
const only = (cols) => new Map([...cols].filter(([, c]) => c.table.toLowerCase() === TABLE));

/** Production's table as the drift run describes it: 228's columns plus the 24, no defaults. */
function productionShape() {
  const db = new DatabaseSync(':memory:');
  db.exec(CREATE_228);
  for (const [c, t] of PRODUCTION_ADDED) db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${c} ${t};`);
  return db;
}

/** A database's live-schema probes, as `--verify-marked` takes them. */
const probesOf = (db) => ({
  tableExists: (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t),
  tableColumns: (t) => new Set(db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name.toLowerCase())),
});

test('D531: the repo now builds production\'s 37 columns for this table, and lacks exactly the 24 without 375', () => {
  // D531 compares the 2026-10-04 production snapshot. Migration 405 later adds
  // sic_codes, so keep that later column out of this historical comparison.
  const later = postCutoffMigrations(ROOT).filter((m) => m.name !== '405_research_company_directory_companies_house.sql');
  assert.ok(later.some((m) => m.name === FILE), '375 is not among the migrations above the cutoff');
  const prod = only(columnsOf(productionShape()));
  assert.equal(prod.size, 37, '228 declares 13 columns and production added 24');

  const fresh = only(columnsOf(buildFresh(BASELINE, later.map((m) => m.sql))));
  const diff = compareColumns(fresh, prod);
  assert.ok(diff.ok, `the fresh build disagrees with production: ${JSON.stringify(diff)}`);
  for (const [c, t] of PRODUCTION_ADDED) {
    const got = fresh.get(`${TABLE}.${c}`);
    assert.ok(got, `${c} is not built`);
    assert.equal(got.type, t, `${c} is built as ${got.type}, production holds ${t}`);
    assert.equal(got.notnull, 0, `${c} is NOT NULL on a fresh build; production's is nullable`);
    assert.equal(got.dflt, null, `${c} has a default on a fresh build; production's has none`);
  }

  const without = only(columnsOf(buildFresh(BASELINE, later.filter((m) => m.name !== FILE).map((m) => m.sql))));
  const before = compareColumns(without, prod);
  assert.deepEqual(before.missing.map((c) => c.column).sort(), [...NAMES].sort(),
    'without 375 the fresh build should lack exactly the 24 columns the drift run named');
  assert.deepEqual(before.extra, []);
  assert.deepEqual(before.retyped, []);
});

test('D531: 375 is only the 24 ADD COLUMNs, so recording it on production equals running it there', () => {
  const body = SQL_375.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const statements = body.split(';').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const added = statements.map((s) => {
    const m = /^ALTER TABLE research_company_directory ADD COLUMN (\w+) (\w+)$/.exec(s);
    assert.ok(m, `375 holds a statement that is not a bare ADD COLUMN on ${TABLE}: ${s}`);
    return [m[1], m[2]];
  });
  assert.deepEqual(added, PRODUCTION_ADDED, '375 must declare exactly production\'s 24 columns, as printed');
  // Under D1's 100-column cap with room to spare.
  assert.ok(13 + added.length < 100);
});

test('D531: on a table that already has the columns, 375 fails with "duplicate column" and changes nothing', () => {
  const db = productionShape();
  const before = db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${TABLE}')`).get().n;
  assert.throws(() => db.exec(SQL_375), /duplicate column/i);
  const after = db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${TABLE}')`).get().n;
  assert.equal(after, before);
  // And on the repo's own table it applies as written: the branch databases' case.
  const branch = new DatabaseSync(':memory:');
  branch.exec(CREATE_228);
  branch.exec(SQL_375);
  assert.equal(branch.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${TABLE}')`).get().n, 37);
});

test('D531: once production records 375 the runner skips it, and --verify-marked can tell whether the columns are there', () => {
  const file = { name: FILE, sql: SQL_375, checksum: checksum(SQL_375) };
  const ledger = new Map([[FILE, checksum(SQL_375)]]);
  const [action] = planActions([file], ledger, { mode: 'apply' });
  assert.equal(action.action, 'skip');
  assert.equal(action.changed, false);
  // Unrecorded, a normal deploy would run it — which is why the row goes first.
  assert.equal(planActions([file], new Map(), { mode: 'apply' })[0].action, 'apply');

  const ok = verifyMarked([file], ledger, probesOf(productionShape()));
  assert.deepEqual(ok.verified.map((f) => f.name), [FILE]);
  assert.deepEqual(ok.missing, []);

  const bare = new DatabaseSync(':memory:');
  bare.exec(CREATE_228);
  const gap = verifyMarked([file], ledger, probesOf(bare));
  assert.equal(gap.missing.length, 1);
  assert.equal(gap.missing[0].gaps.length, 24, 'every one of the 24 columns is named as missing');
});

test('D531: the decision\'s command records 375 under its real checksum', () => {
  const d531 = read('documentation/architecture/decisions/D531.md');
  assert.match(d531, /^## D531 — /);
  const sum = checksum(SQL_375);
  assert.ok(d531.includes(`VALUES ('${FILE}', '${sum}')`),
    `D531's INSERT does not carry 375's checksum (${sum}); a row with the wrong one is recorded and then reported as drift`);
  // The read-only check that follows the INSERT, as a command, not a mention.
  assert.ok(d531.includes('node scripts/migrate-d1.mjs --remote --verify-marked'), 'D531 no longer gives the --verify-marked command after the INSERT');
});

// RE-AIMED BY D533 (#1080, 2026-10-05). The first reader is the geography read
// in `routes/research_markets.ts` (`companiesWithMetrics`): headcount and the
// last round, for `/research/geographies/:code`. Its page prints an absent
// value as "Not recorded", never zero, and `frontend/test/
// research_markets_pages_d533.test.mjs` pins exactly that. So that one template
// is allowed, on the condition that the page pin stays.
// RE-AIMED BY D534 (#1079): `services/researchCompanyDirectory.ts` reads the
// columns too, and its tests (research_company_directory_d534.test.ts,
// research_companies_pages_d534.test.mjs) pin an absent value as Not recorded,
// never zero. Every other template is still held to reading none of the 24.
const FIRST_READER = 'cloudflare-worker/src/routes/research_markets.ts';
const FIRST_READER_PIN = 'frontend/test/research_markets_pages_d533.test.mjs';
const D534_READER = 'cloudflare-worker/src/services/researchCompanyDirectory.ts';

test('D531: only the D533 and D534 readers read the 24 columns, and they show an absent value as Not recorded', () => {
  const pin = read(FIRST_READER_PIN);
  assert.match(pin, /no headcount is Not recorded, never 0/, 'the first reader lost its Not-recorded pin');
  assert.match(pin, /Zeta Labs Not recorded Not recorded 4,000 Not recorded/, 'the first reader lost its no-round pin');
  assert.match(read(D534_READER), /status: 'not_recorded' as const, reason: 'Not recorded'/,
    'the D534 reader no longer marks an absent metric Not recorded');
  // Every SQL template in the Worker that names the table, read whole.
  const files = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(n)) files.push(p);
    }
  };
  walk(resolve(ROOT, 'cloudflare-worker/src'));
  const templates = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/`[^`]*research_company_directory[^`]*`/g)) {
      templates.push({ f, sql: m[0] });
    }
  }
  assert.ok(templates.length >= 2, 'the two directory reads in routes/research.ts were not found');
  let readers = 0;
  for (const { f, sql } of templates) {
    if (f === resolve(ROOT, D534_READER)) continue;
    if (f.endsWith(FIRST_READER) && /FROM research_company_directory/.test(sql) && /\bemployee_count\b/.test(sql)) {
      readers += 1;
      continue;
    }
    for (const c of NAMES) {
      assert.doesNotMatch(sql, new RegExp(`\\b${c}\\b`),
        `${f} reads ${TABLE}.${c}. A reader must render an absent value as "Not recorded", never zero; re-aim this pin with it`);
    }
  }
  assert.equal(readers, 1, 'exactly one template in the first reader may read the 24 columns');
});
