#!/usr/bin/env node
/**
 * Fails the build when a migration DECLARES a table or column that a freshly
 * provisioned database does not have.
 *
 * WHY THIS EXISTS. A migration below `BASELINE_CUTOFF` is never executed on a
 * new database. `migrate-d1.mjs --bootstrap` loads `schema_baseline.sql` and
 * then MARKS every file ≤ the cutoff as applied without running a statement of
 * it (`lib/migrationPlan.mjs`, mode 'bootstrap'). That is correct — those files
 * are not replayable, because `CREATE TABLE users`, `projects`, `deals` and
 * `documents` live only in `sql/historical/schema.sql` and in no numbered
 * migration, so replaying the numbered set from empty fails 83 times with
 * `no such table`.
 *
 * The consequence nobody was checking: a migration below the cutoff whose
 * effect is ABSENT from the baseline is silently absent from every database
 * for ever. The baseline is a dump of production, so what the baseline lacks,
 * production lacks, and the migration's own ledger row says it was applied.
 *
 * IT HAS HAPPENED AT LEAST FOUR TIMES, and two of the four were found by hand
 * and repaired without leaving a check behind:
 *
 *   1. `042_advisor_field_sources.sql` declares eighteen columns over five
 *      tables. Four landed (partner_profiles, via D187's migration 275); three
 *      were misdirected (see 2); ELEVEN were still missing when this file was
 *      written, every one with a live reader — `services/advisor/writeRouter.ts`
 *      reads all eleven, and `runway_months` alone is also read by
 *      `services/scoring.ts`, `services/decks/autofill.ts`, `decks/methods.ts`,
 *      `decks/axalSpinoutDemoDay.ts`, `services/saasMetrics.ts`,
 *      `services/exploringSchema.ts` and four routes. Migration 276 lands them.
 *
 *   2. `182_advisor_topics_calendar.sql:6-10` quotes 042's three `mentors`
 *      ALTERs and states: "There is no `CREATE TABLE mentors` anywhere in this
 *      repository." It repairs them onto `advisors`. Confirmed: `mentors` is
 *      absent from a fresh build AND from production, and has zero readers.
 *      A COMMENT, not a check — which is why 042's other eleven went on
 *      missing for months.
 *
 *   3. `src/auth.ts:394` carries the same discovery in prose: "we prefer the
 *      SESSION-scoped deadline … because the `users.recovery_step_up_due_at`
 *      column is unapplied/broken in prod (060)." Again a comment, again no
 *      check, and `routes/auth_recover.ts:292` still runs an UPDATE against
 *      that column.
 *
 *   4. `028_partner_deals.sql` declared eighteen `partner_profiles` columns
 *      that a `CREATE TABLE IF NOT EXISTS` could not add to a table that
 *      already existed in another shape. That cost twenty-six partners a
 *      chat that told them to accept an invitation that did not exist (D187).
 *
 * WHY NOT `check-baseline-drift.mjs`. That guard answers a different question —
 * "does baseline + post-cutoff still match PRODUCTION, by object name" — needs
 * `CLOUDFLARE_API_TOKEN`, exits 2 without one, runs only in the deploy workflow
 * AFTER the deploy, and never looks at a column. This one is pure: no network,
 * no token, so it sits in `test:guards` and fails a PR BEFORE it merges.
 * `scripts/README.md`'s own rule is that "a check that cannot run inside the
 * suite must never sit in the suite reporting success" — so they stay separate.
 *
 * WHY NOT "replay every migration and diff". That was the shape this was filed
 * as twice, and it cannot be built: replaying all 278 files from empty produces
 * 385 failed statements against the fresh build's 16, and reports 114 tables
 * "missing" that are only missing because the replay failed to create them. The
 * question here is STATIC — what does the file say it declares — so no replay
 * is needed and none is done.
 *
 * `sql/historical/` is excluded, on the precedent of check-sqlite-columns.mjs,
 * check-sqlite-tables.mjs and check-sqlite-table-collisions.mjs, each of which
 * records the false negative its omission caused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { splitStatements } from '../cloudflare-worker/test/_baseline.mjs';
import {
  BASELINE_CUTOFF,
  migrationNumber,
  compareMigrations,
} from './lib/migrationPlan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'cloudflare-worker', 'sql');
const MIGRATIONS_DIR = path.join(SQL_DIR, 'migrations');
const BASELINE_SQL = path.join(SQL_DIR, 'schema_baseline.sql');
const BASELINE = path.join(ROOT, 'scripts', 'migration-declarations-baseline.json');

/** A column-list entry that is a table constraint, not a column. */
const CONSTRAINT_HEAD =
  /^\s*(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i;

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d+_.*\.sql$/.test(n))
    .sort(compareMigrations);
}

/**
 * The database a `migrate-d1 --bootstrap` produces: the baseline, then every
 * migration ABOVE the cutoff. Statement-level and error-tolerant — a failing
 * statement is `migrations_fresh_build.test.ts`'s to report, not this guard's,
 * and swallowing it here keeps one broken statement from hiding a whole file's
 * worth of real declarations.
 *
 * `enableDoubleQuotedStringLiterals` is required: the baseline writes
 * `CREATE TABLE "advisors"`, and `110_assessment_tracks.sql` carries a
 * double-quoted string literal that SQLite otherwise reads as a column name.
 */
export function freshBuild() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(fs.readFileSync(BASELINE_SQL, 'utf8'));
  for (const name of migrationFiles().filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* see docblock */ }
    }
  }
  const tables = new Map();
  for (const r of db.prepare(
    "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ?",
  ).all('table', 'sqlite_%')) {
    tables.set(
      r.name.toLowerCase(),
      new Set(db.prepare('SELECT name FROM pragma_table_info(?)').all(r.name).map((c) => c.name.toLowerCase())),
    );
  }
  return tables;
}

/**
 * Split a CREATE TABLE body on TOP-LEVEL commas and return the column names.
 *
 * Depth-aware because a column can carry `DECIMAL(10,2)` or a CHECK with its
 * own parentheses. CORRECTED AFTER A MUTATION ESCAPED: this docblock used to
 * say a naive split "would read `2)` as a column", and that is FALSE — the
 * name pattern below requires an identifier start, so the `2)` fragment is
 * dropped whatever the split does. Measured over every `CREATE TABLE` in the
 * baseline and all the migrations, 788 statements, a comma-splitting-everything
 * version returns THE SAME ANSWER on every one of them.
 *
 * What actually keeps a constraint out of the column list is the pair below:
 * `CONSTRAINT_HEAD`, which drops `CHECK (price > 0)` before it can be read as
 * a column named `check`, and the `[A-Za-z_]`-anchored name pattern, which
 * drops every fragment a nested comma can produce. The depth walk stays
 * because it is the correct parse of a column list and the two filters are
 * what a later widening of the name pattern would quietly remove — but it is
 * belt-and-braces today, and saying otherwise would claim a guard that is not
 * guarding.
 */
export function createTableColumns(stmt) {
  const open = stmt.indexOf('(');
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < stmt.length; i += 1) {
    if (stmt[i] === '(') depth += 1;
    else if (stmt[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];

  const parts = [];
  let buf = '';
  depth = 0;
  for (const ch of stmt.slice(open + 1, end)) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);

  const cols = [];
  for (const part of parts) {
    if (CONSTRAINT_HEAD.test(part)) continue;
    const m = /^\s*[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s+\S/.exec(part);
    if (m) cols.push(m[1].toLowerCase());
  }
  return cols;
}

/**
 * What one migration says it leaves behind.
 *
 * Statements are read IN ORDER so the rebuild idiom resolves — a file doing
 * `CREATE t_new … DROP t … ALTER t_new RENAME TO t` declares `t`, with
 * `t_new`'s columns, and never declares `t_new`. That is the same resolution
 * `migrationPlan.mjs`'s `expectedEffects` performs, and the test asserts the
 * two agree on the table set for every migration in the tree, so this cannot
 * drift away from it silently.
 *
 * `ADD COLUMN IF NOT EXISTS` is handled explicitly. SQLite has no such form —
 * seven migrations say so in their own comments — but
 * `080_brand_kit_expansion.sql:5-7` uses it anyway, and a parser that took the
 * next word would report a column literally named `IF`.
 */
export function declarationsFor(sql) {
  /** @type {Map<string, Set<string>>} */
  const tables = new Map();
  /** @type {Array<{ table: string, column: string }>} */
  const alters = [];

  for (const stmt of splitStatements(sql)) {
    const create = /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(stmt);
    if (create) {
      const t = create[1].toLowerCase();
      // `CREATE TABLE x AS SELECT …` has no column list of its own.
      if (!tables.has(t)) tables.set(t, new Set());
      for (const c of createTableColumns(stmt)) tables.get(t).add(c);
      continue;
    }

    const drop = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(stmt);
    if (drop) { tables.delete(drop[1].toLowerCase()); continue; }

    const rename = /^\s*ALTER\s+TABLE\s+[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s+RENAME\s+TO\s+[`"[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(stmt);
    if (rename) {
      const from = rename[1].toLowerCase();
      const to = rename[2].toLowerCase();
      if (tables.has(from)) { tables.set(to, tables.get(from)); tables.delete(from); }
      for (const a of alters) if (a.table === from) a.table = to;
      continue;
    }

    const add = /^\s*ALTER\s+TABLE\s+[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(stmt);
    if (add) {
      const t = add[1].toLowerCase();
      const c = add[2].toLowerCase();
      if (tables.has(t)) tables.get(t).add(c);
      else alters.push({ table: t, column: c });
      continue;
    }
  }

  return { tables, alters };
}

/**
 * Every finding, keyed the way the ledger keys it.
 *
 * Three kinds, and the third is the one a table-and-column comparison misses:
 *   table:<name>        a migration CREATEs it; a fresh build does not have it
 *   <table>.<column>    declared on a table the build HAS, and absent from it
 *   alter-orphan:<t>.<c>  an ALTER … ADD COLUMN whose table exists NOWHERE —
 *                       not in the build, and created by no migration. Guarding
 *                       on "the table exists" silently drops these, which is
 *                       how 042's three `mentors` ALTERs produced no finding at
 *                       all in the first draft of this check.
 */
export function findings(build = freshBuild()) {
  /** @type {Map<string, string>} */
  const declaredTables = new Map();
  /** @type {Array<{ key: string, kind: string, where: string }>} */
  const raw = [];
  const alterSeen = [];

  for (const name of migrationFiles()) {
    const { tables, alters } = declarationsFor(
      fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'),
    );
    for (const [t, cols] of tables) {
      if (!declaredTables.has(t)) declaredTables.set(t, name);
      if (!build.has(t)) continue; // reported once as a missing TABLE, below
      for (const c of cols) {
        if (!build.get(t).has(c)) raw.push({ key: `${t}.${c}`, kind: 'column', where: name });
      }
    }
    for (const a of alters) {
      alterSeen.push({ ...a, where: name });
      if (build.has(a.table) && !build.get(a.table).has(a.column)) {
        raw.push({ key: `${a.table}.${a.column}`, kind: 'column', where: name });
      }
    }
  }

  for (const [t, where] of declaredTables) {
    if (!build.has(t)) raw.push({ key: `table:${t}`, kind: 'table', where });
  }
  for (const a of alterSeen) {
    if (!build.has(a.table) && !declaredTables.has(a.table)) {
      raw.push({ key: `alter-orphan:${a.table}.${a.column}`, kind: 'alter-orphan', where: a.where });
    }
  }

  const out = new Map();
  for (const f of raw) {
    if (!out.has(f.key)) out.set(f.key, { kind: f.kind, where: new Set() });
    out.get(f.key).where.add(f.where);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findings();
  const ledger = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).declarations ?? {};

  const added = [...found.keys()].filter((k) => !(k in ledger)).sort();
  const resolved = Object.keys(ledger).filter((k) => !found.has(k)).sort();

  if (added.length) {
    console.error('✖ check-migration-declarations: a migration declares this, and a fresh build does not have it:\n');
    for (const k of added) {
      console.error(`  ${k}`);
      for (const w of [...found.get(k).where].sort()) console.error(`      declared by ${w}`);
    }
    console.error('\nA migration below the cutoff is MARKED, never run, on a new database, so');
    console.error('its effect reaches a database only if the baseline already carries it. The');
    console.error('baseline is a dump of production — so what is listed above is absent from');
    console.error('production too, while its ledger row says the migration was applied.');
    console.error('\nEither add the table or column in a NEW migration above the cutoff, point');
    console.error('the readers at what does exist, or — if the declaration is genuinely dead —');
    console.error('record it in scripts/migration-declarations-baseline.json with a reason');
    console.error('saying what reads it today and what happens when the read misses.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-migration-declarations: ledger entries that now exist:\n');
    for (const k of resolved) console.error(`  ${k}`);
    console.error('\nDelete them from scripts/migration-declarations-baseline.json — a ledger of');
    console.error('known gaps is only worth reading if every line in it is still true.');
    process.exit(1);
  }

  const n = Object.keys(ledger).length;
  const kinds = { table: 0, column: 0, 'alter-orphan': 0 };
  for (const v of found.values()) kinds[v.kind] += 1;
  console.log(
    `✓ check-migration-declarations: every migration's declarations reach a fresh build `
    + `(${n} known gap${n === 1 ? '' : 's'} on record — `
    + `${kinds.table} table${kinds.table === 1 ? '' : 's'}, ${kinds.column} column${kinds.column === 1 ? '' : 's'}, `
    + `${kinds['alter-orphan']} ALTER${kinds['alter-orphan'] === 1 ? '' : 's'} on a table that exists nowhere).`,
  );
}
