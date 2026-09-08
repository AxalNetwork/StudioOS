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
