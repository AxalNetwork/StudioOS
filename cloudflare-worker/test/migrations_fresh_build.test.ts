/**
 * What a database built from scratch actually gets — and the thing nobody
 * checks, which is that `schema.sql` and production still agree.
 *
 * THE FIRST VERSION OF THIS FILE ASSERTED SOMETHING FALSE, so the correction is
 * the header. It applied `schema.sql` and then every numbered migration in
 * order and expected all of them to succeed. **55 of 221 fail**, and the reason
 * is not that 55 migrations are broken: `schema.sql` is a CURRENT-STATE
 * SNAPSHOT, not the original base the deltas were written against. It already
 * carries the columns those migrations add, so they land on a database that has
 * moved past them — 11 fail `duplicate column name`, 41 fail `no such table`
 * (their tables come from the other seed files under `sql/`, or from a
 * migration that itself could not apply), and 3 fail for a mix of the same.
 *
 * That is why `scripts/migrate-d1.mjs --baseline` exists and what it does:
 * against a database provisioned from `schema.sql` it RECORDS the
 * non-idempotent files without executing them. So a "fresh D1 build" does not
 * replay 039 — it gets 039's effect from the snapshot and marks the file
 * applied. Trimming 039 therefore costs a new environment nothing, which is a
 * claim this file checks rather than asserts.
 *
 * THE REPO CANNOT CURRENTLY BUILD A DATABASE PURELY FROM ITS MIGRATIONS. That
 * is a real gap, it is bigger than the file this test was written beside, and
 * closing it means reconstructing the base schema the deltas assume — separate
 * work, deliberately not attempted here. What IS pinned below is the property
 * that matters today: the snapshot every new environment is built from still
 * matches production, on exactly the tables migration 039 once tried to change.
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

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const MIGRATIONS = resolve(SQL, 'migrations');

/** The snapshot a new environment is provisioned from, and nothing else. */
function fromSnapshot(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema.sql'), 'utf8'));
  return db;
}

const snapshot = fromSnapshot();

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

test('a new environment gets what 039 landed, from the snapshot', () => {
  // The two statements applied by hand on 2026-05-11 are in `schema.sql`, which
  // is why cutting the rest of 039 changes nothing for a database built today.
  const cols = snapshot.prepare("SELECT name FROM pragma_table_info('projects')")
    .all() as Array<{ name: string }>;
  assert.ok(cols.some((c) => c.name === 'deleted_at'),
    'projects.deleted_at — the half of 039 that actually applied');
  assert.ok(
    snapshot.prepare(
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
    const clause = projectIdClause(snapshot, table);
    assert.notEqual(clause, '', `${table}.project_id must exist in the snapshot`);
    assert.doesNotMatch(clause, /ON\s+DELETE\s+CASCADE/i,
      `${table}.project_id has a cascade production does not have`);
  }
  for (const table of ['deals', 'score_snapshots', 'documents']) {
    assert.match(projectIdClause(snapshot, table), /REFERENCES\s+projects\s*\(\s*id\s*\)/i,
      `${table}.project_id keeps the plain reference production has`);
  }
  for (const table of ['discovery_interviews', 'roadmap_okrs']) {
    assert.doesNotMatch(projectIdClause(snapshot, table), /REFERENCES/i,
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

/**
 * The applicability ledger.
 *
 * Replaying a migration on top of the snapshot mostly fails for a reason that
 * is not a defect — the snapshot is already past it. Those are counted, not
 * named, because the count moves whenever a migration is added and a moving
 * number is not a guard. What IS named is the residue: a migration that fails
 * for some OTHER reason is a migration that references something nothing
 * creates, and that is worth failing a build over.
 */
const OTHER_ON_RECORD: Record<string, string> = {
  // Both are the snapshot being past the migration, showing up as a missing
  // column rather than a duplicate one: 051 reads `referral_code` and 200 reads
  // `service_offerings.partner_id`, and the snapshot has moved past both.
  '051_referral_legacy_code.sql': 'no such column: referral_code',
  '200_service_offerings_shape.sql': 'no such column: partner_id',
  // A genuine fragility, recorded rather than fixed here: 110 quotes a string
  // with DOUBLE quotes ("Coach's Lens"), which SQLite reads as an identifier
  // unless the double-quoted-string-literal fallback is on. D1's SQLite has it
  // on — 110 is applied on production — so this is latent, not broken, and
  // turning it into single quotes is a change to an applied file, which is its
  // own review.
  '110_assessment_tracks.sql': 'no such column: "Coach\'s Lens"',
};

test('no migration fails for a reason other than the snapshot being past it', () => {
  const db = fromSnapshot();
  const other: Array<[string, string]> = [];
  let expected = 0;
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort()) {
    try {
      db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      const msg = (e as Error).message;
      if (/duplicate column name|no such table|already exists/.test(msg)) expected += 1;
      else other.push([f, msg]);
    }
  }
  assert.ok(expected > 0, 'the snapshot really is ahead of the deltas — if this is 0, the premise changed');
  assert.deepEqual(
    other.map(([f]) => f).sort(), Object.keys(OTHER_ON_RECORD).sort(),
    'a migration fails for a new reason — it references something nothing creates',
  );
  for (const [f, msg] of other) {
    assert.ok(msg.startsWith(OTHER_ON_RECORD[f].slice(0, 24)),
      `${f} now fails differently: ${msg}`);
  }
});
