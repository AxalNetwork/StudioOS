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
  [/^\s*PRAGMA\s+/im, 'PRAGMA'],
  [/^\s*(ATTACH|DETACH)\s+/im, 'ATTACH / DETACH'],
];

/** Strip `--` line comments and block comments so prose cannot trip the scan. */
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*--.*$/gm, '');

/**
 * Two migrations that already carry these statements, named here rather than in
 * a JSON baseline file — a baseline suppresses a finding and this repo has been
 * burned by one (`api-drift-baseline.json`). An exemption with its reason
 * written beside it can be read and argued with.
 *
 * Both are LONG APPLIED on production, and the migration ledger means neither
 * re-runs there. The risk they carry is only to a database provisioned from
 * scratch, where the run would stop at 039 — real, but a different change from
 * this one: 039 is a 222-line seven-transaction table rebuild (the SQLite
 * recreate-to-add-CASCADE pattern) and rewriting it safely is its own review.
 *
 * NEW migrations get no exemption. That is the whole point of the file: the
 * rule has been written into 214 and 215 — both closing with "(see
 * `scripts/check-sql-migrations.mjs`)" — and guarded by nothing, because this
 * script did not exist until now.
 */
const PRE_EXISTING = new Set([
  '039_project_cascade.sql',
  '200_service_offerings_shape.sql',
]);

const files = readdirSync(resolve(process.cwd(), DIR))
  .filter((f) => f.endsWith('.sql'))
  .sort();

const offenders = [];
for (const file of files) {
  if (PRE_EXISTING.has(file)) continue;
  const sql = stripComments(readFileSync(resolve(process.cwd(), DIR, file), 'utf8'));
  for (const [pattern, label] of BANNED) {
    if (pattern.test(sql)) offenders.push(`${DIR}/${file} — ${label}`);
  }
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
  `✓ check-sql-migrations: ${files.length - PRE_EXISTING.size} migrations carry no transaction`
  + ` statement; ${PRE_EXISTING.size} pre-existing files exempt by name.`,
);
