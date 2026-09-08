#!/usr/bin/env node
/**
 * Migration files must contain no transaction statements.
 *
 * D1's HTTP API rejects BEGIN / COMMIT / ROLLBACK / SAVEPOINT inside a
 * migration. Migration 200 shipped with them and failed the production deploy
 * at the migration step, which is worse than a failing test: `npm run deploy`
 * runs `predeploy` → `migrate-d1 --remote` → `wrangler deploy`, so the worker
 * does not ship at all and the failure surfaces as a red deploy rather than a
 * red check.
 *
 * THE RULE HAS BEEN WRITTEN DOWN SINCE THEN AND GUARDED BY NOTHING. Migrations
 * 214 and 215 both close with "(see `scripts/check-sql-migrations.mjs`)" — this
 * file, which did not exist. The citation was aspirational; the deploy that
 * failed once could fail the same way again. This is that file.
 *
 * It also checks the two other things the D1 HTTP path cannot do, both of which
 * fail at apply time rather than at review:
 *   · `PRAGMA` statements, which D1 ignores or rejects depending on the pragma
 *   · `ATTACH` / `DETACH`, which have no meaning against a D1 binding
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = 'cloudflare-worker/sql/migrations';

// Statement-leading only: `BEGIN` also opens a TRIGGER body, and a trigger is
// perfectly legal in a migration. Requiring the keyword to start a statement —
// at the beginning of a line, after optional whitespace — separates the two
// without needing a SQL parser.
const BANNED = [
  [/^\s*BEGIN\s*(TRANSACTION|DEFERRED|IMMEDIATE|EXCLUSIVE)?\s*;/im, 'BEGIN'],
  [/^\s*COMMIT\s*(TRANSACTION)?\s*;/im, 'COMMIT'],
  [/^\s*(ROLLBACK|END)\s*(TRANSACTION)?\s*;/im, 'ROLLBACK / END'],
  [/^\s*SAVEPOINT\s+/im, 'SAVEPOINT'],
  [/^\s*RELEASE\s+/im, 'RELEASE'],
  // Deny-by-default with exactly one carve-out. `defer_foreign_keys` is the one
  // pragma D1 both accepts and a table rebuild needs: a `--file` batch runs as
  // ONE implicit transaction, inside which SQLite ignores `PRAGMA foreign_keys`
  // entirely, so deferring the check to commit is the only way to drop and
  // recreate a table other tables reference. Migration 200 carries it and IS
  // APPLIED on production — live D1 has `service_offerings.owner_user_id`, no
  // `partner_id`, and the `service_offerings_orphans_pre200` table — which is
  // the evidence, not an argument. `frontend/test/migration_column_shapes.test.mjs`
  // asserts 200 keeps it, and bans `PRAGMA foreign_keys` for the same reason;
  // this line is what stops the two guards disagreeing.
  [/^\s*PRAGMA\s+(?!defer_foreign_keys\b)/im, 'PRAGMA'],
  [/^\s*(ATTACH|DETACH)\s+/im, 'ATTACH / DETACH'],
];

/** Strip `--` line comments and block comments so prose cannot trip the scan. */
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*--.*$/gm, '');

/**
 * The labels one migration's SQL trips, comments already stripped.
 *
 * EXPORTED SO THE CARVE-OUT CAN BE TESTED. The `defer_foreign_keys` exception
 * above widens what this file permits, and a widening that no test exercises is
 * a widening nobody notices: with no migration carrying any other pragma, the
 * predicate could be loosened to allow every one of them and the whole suite
 * would stay green. It escaped exactly that mutation before this function
 * existed. `frontend/test/migration_column_shapes.test.mjs` now calls it with
 * pragmas D1 does not honour and asserts each is still refused.
 */
export function bannedIn(sql) {
  const body = stripComments(sql);
  return BANNED.filter(([pattern]) => pattern.test(body)).map(([, label]) => label);
}

/**
 * THERE ARE NO EXEMPTIONS. There were two, named here rather than in a JSON
 * baseline file so they could be read and argued with, and the argument has now
 * been had — both are gone, which is the outcome an exemption list is supposed
 * to reach.
 *
 *   `039_project_cascade.sql` carried seven transaction blocks around a
 *   five-table CASCADE rebuild. The rebuild had never run — not on production,
 *   not anywhere — because the first transaction statement aborted the file in
 *   May 2026, and the two statements that DID land were applied by hand. The
 *   file now contains only those two, so there is nothing left to exempt.
 *   DECISIONS D60 has the measurement and the reasoning.
 *
 *   `200_service_offerings_shape.sql` needed only `PRAGMA defer_foreign_keys`,
 *   which the blanket PRAGMA ban above happened to catch. The ban now names the
 *   one pragma D1 honours, so 200 passes on its own terms with its SQL
 *   untouched — and it must keep that line: it drops and recreates a table
 *   other tables reference, and `frontend/test/migration_column_shapes.test.mjs`
 *   asserts the line is still there.
 *
 * A NEW migration gets no exemption either. That is the whole point of the
 * file: the rule was written into 214 and 215 — both closing with "(see
 * `scripts/check-sql-migrations.mjs`)" — and guarded by nothing, because this
 * script did not exist until they were written.
 */
// Guarded so `bannedIn` can be imported by a test without the scan running.
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readdirSync(resolve(process.cwd(), DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const offenders = [];
  for (const file of files) {
    const sql = readFileSync(resolve(process.cwd(), DIR, file), 'utf8');
    for (const label of bannedIn(sql)) offenders.push(`${DIR}/${file} — ${label}`);
  }

  if (offenders.length) {
    console.error('✖ check-sql-migrations:');
    for (const o of offenders) console.error(`  - ${o}`);
    console.error('\nD1\'s HTTP API rejects these inside a migration. Migration 200 shipped');
    console.error('with transaction statements and failed the production deploy at the');
    console.error('migration step — the worker never shipped. Remove them; the migration');
    console.error('ledger, not a transaction, is what makes a replay safe.');
    process.exit(1);
  }

  console.log(
    `✓ check-sql-migrations: all ${files.length} migrations carry no transaction`
    + ' statement and no pragma D1 ignores; no file is exempt.',
  );
}
