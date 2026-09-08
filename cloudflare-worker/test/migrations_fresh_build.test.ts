/**
 * A new database starts from the production-derived baseline and then applies
 * every numbered migration newer than the baseline cutoff. No migration is
 * tolerated here: any failure means the fresh-build sequence is broken.
 *
 * The baseline must also retain production's `project_id` clauses on the five
 * tables migration 039 once tried to rebuild. Those clauses are the drift check
 * that caught the cascade divergence and remain part of the fresh-build contract.
 *
 * FIDELITY NOTE. `node:sqlite` is the same engine D1 is, so column shapes and
 * constraint text are faithful. It does NOT model D1's `--file` batch, which
 * runs as ONE implicit transaction — inside that, SQLite ignores
 * `PRAGMA foreign_keys`, and a rebuild that fills a scratch table and renames
 * it into place never clears the deferred-violation counter and dies at commit.
 * That class is caught only by the local workerd D1 that
 * `documentation/architecture/GOTCHAS.md` names as the reproduction:
 *   npx wrangler d1 execute studioos-db --config ../wrangler.toml \
 *     --local --persist-to <scratch> --file=…
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const MIGRATIONS = resolve(SQL, 'migrations');

/** The production-derived schema a new environment is provisioned from. */
function fromBaseline(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  return db;
}

const baseline = fromBaseline();

/** The `project_id` clause of a table's DDL, or '' if it has no such column. */
function projectIdClause(db: InstanceType<typeof DatabaseSync>, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  if (!row) return '';
  // These tables carry other foreign keys, so read the one column rather than
  // the whole DDL: a blanket "no CASCADE anywhere" would pass or fail for
  // reasons that have nothing to do with 039.
  return row.sql.split(/,\s*\n|,(?=\s)/).find((s) => /\bproject_id\b/.test(s)) || '';
}

const CASCADE_TABLES = [
  'deals', 'score_snapshots', 'documents', 'discovery_interviews', 'roadmap_okrs',
];

/**
 * WHY THE NEXT TEST NEEDS THE ONE AFTER IT.
 *
 * The post-cutoff set is EMPTY today: 221 migration files, highest numeric
 * prefix 219 (three prefixes repeat — 011, 068, 118), and the cutoff is 219. So
 * "builds without failures" currently iterates nothing and asserts `[] === []`.
 * It is a forward guard that starts doing work at migration 220, not a
 * statement about anything today, and a test that reads as strong while
 * checking nothing is worse than no test — this file replaced one that recorded
 * 55 real failures, so the contrast matters.
 *
 * `the cutoff explains the empty set` below is what keeps that honest: it makes
 * the emptiness a checked consequence of where the cutoff sits, rather than
 * something a broken filter could also produce.
 */
test('a baseline plus every post-cutoff migration builds without failures', () => {
  const db = fromBaseline();
  const failures: Array<[string, string]> = [];
  const newer = readdirSync(MIGRATIONS)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .filter((name) => migrationNumber(name) > BASELINE_CUTOFF)
    .sort();

  for (const name of newer) {
    try {
      db.exec(readFileSync(resolve(MIGRATIONS, name), 'utf8'));
    } catch (error) {
      failures.push([name, (error as Error).message]);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `fresh build failed for ${failures.length} migration(s):\n` +
      failures.map(([name, message]) => `  ${name}: ${message}`).join('\n'),
  );
});
test('the cutoff explains the empty set, rather than a filter that matches nothing', () => {
  const numbers = readdirSync(MIGRATIONS)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .map(migrationNumber);
  const highest = Math.max(...numbers);

  // THE DANGEROUS DIRECTION IS A CUTOFF THAT IS TOO HIGH. Every file at or
  // below it is recorded as already contained in the baseline and never run, so
  // a cutoff past the real files would silently mark migrations as applied that
  // the baseline does not carry — a fresh database missing them and a ledger
  // claiming otherwise. Too LOW is merely redundant work.
  assert.ok(
    BASELINE_CUTOFF <= highest,
    `BASELINE_CUTOFF ${BASELINE_CUTOFF} is past the highest migration ${highest} — `
    + 'bootstrap would mark files the baseline does not contain',
  );

  // And if nothing sorts above the cutoff, that must be because the cutoff is
  // at the top of the range, not because the filter stopped matching.
  const newer = readdirSync(MIGRATIONS)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .filter((name) => migrationNumber(name) > BASELINE_CUTOFF);
  if (newer.length === 0) {
    assert.equal(
      BASELINE_CUTOFF, highest,
      'no migration sorts above the cutoff, and the cutoff is not at the top either — '
      + 'the filter is matching nothing for the wrong reason',
    );
  }
});

test('the baseline contains what 039 landed', () => {
  const cols = baseline.prepare("SELECT name FROM pragma_table_info('projects')")
    .all() as Array<{ name: string }>;
  assert.ok(cols.some((c) => c.name === 'deleted_at'),
    'projects.deleted_at — the part of 039 that production has');
  assert.ok(
    baseline.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_projects_deleted_at'",
    ).get(),
    'and its index',
  );
});

test('the snapshot agrees with production about the five tables 039 never rebuilt', () => {
  // Read off live D1 on 2026-09-08 with `SELECT sql FROM sqlite_master`:
  //   deals / score_snapshots / documents  →  REFERENCES projects(id), no CASCADE
  //   discovery_interviews / roadmap_okrs  →  INTEGER NOT NULL, no REFERENCES
  // A cascade appearing on either side is the divergence this whole task is
  // about, and it would have been caught four months ago by this assertion.
  for (const table of CASCADE_TABLES) {
    const clause = projectIdClause(baseline, table);
    assert.notEqual(clause, '', `${table}.project_id must exist in the snapshot`);
    assert.doesNotMatch(clause, /ON\s+DELETE\s+CASCADE/i,
      `${table}.project_id has a cascade production does not have`);
  }
  for (const table of ['deals', 'score_snapshots', 'documents']) {
    assert.match(projectIdClause(baseline, table), /REFERENCES\s+projects\s*\(\s*id\s*\)/i,
      `${table}.project_id keeps the plain reference production has`);
  }
  for (const table of ['discovery_interviews', 'roadmap_okrs']) {
    assert.doesNotMatch(projectIdClause(baseline, table), /REFERENCES/i,
      `${table}.project_id has no reference at all on production`);
  }
});

test('039 no longer carries the rebuild it never performed', () => {
  const src = readFileSync(resolve(MIGRATIONS, '039_project_cascade.sql'), 'utf8');
  const code = src.replace(/^\s*--.*$/gm, '');
  for (const t of CASCADE_TABLES) {
    assert.equal(code.includes(`${t}_new`), false,
      `${t}_new is back — the rebuild was deleted deliberately, not mislaid`);
  }
  assert.doesNotMatch(code, /\bDROP\s+TABLE\b/i, '039 drops nothing');
  assert.doesNotMatch(code, /_migrations_applied/,
    'the marker table predates the schema_migrations ledger and is its job now');
  // The prose names those tables while explaining what did not happen, which is
  // exactly why the checks above are comment-stripped.
  assert.match(src, /never (ran|run)/i, 'the header has to say what did not happen');
});
