#!/usr/bin/env node
/**
 * `schema_baseline.sql` still describes the database it was dumped from.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE POINT OF THE WHOLE EXERCISE.
 * `cloudflare-worker/sql/schema.sql` was a production snapshot committed to the
 * repo with nothing asserting it stayed one. It drifted — someone edited five
 * `project_id` clauses to add an `ON DELETE CASCADE` that migration 039 never
 * applied — and a new database and production disagreed about five foreign keys
 * for four months with no test able to notice (DECISIONS D60).
 *
 * `schema_baseline.sql` replaced it and is EXACTLY THE SAME KIND OF ARTIFACT:
 * a production snapshot in the repo. Being freshly dumped makes it true today
 * and says nothing about tomorrow. The moment a migration lands on production,
 * the committed baseline is one migration behind, and the only thing that would
 * catch it is a test that runs the two side by side. That is this file.
 *
 * THE INVARIANT IS NOT "baseline == production". It is
 *
 *     baseline + every migration above the cutoff  ==  production
 *
 * and getting that wrong is the difference between a check that holds forever
 * and one that goes red the first time anyone ships a migration. A file that
 * demanded equality with production would fail on every schema change until
 * someone re-dumped it by hand, which is a chore nobody does twice — so it
 * would be switched off, and the drift it exists to catch would return. What is
 * checked here is the repo's whole schema story reproducing production, which
 * is exactly the property that was false for four months.
 *
 * WHAT IT COMPARES, and why by NAME rather than by count. The first gate anyone
 * wrote for the baseline was "the built database has 399 tables". A dump missing
 * two real tables while gaining back two that the engine creates on its own
 * still reports 399. So this builds the story for real, in the same SQLite
 * engine D1 is, and takes the set difference of object NAMES in both directions.
 *
 * AND COLUMNS (D359). Names alone let a column through: one added by hand, or
 * by a runtime `ALTER TABLE … ADD COLUMN`, changes no name, so this step stayed
 * green over it. On every table both sides have, it also compares the columns
 * and their declared types, both directions. Production's columns are read
 * from the `sql` the same query already returns, executed into a scratch
 * database, so there is no second round trip; a table whose DDL will not
 * execute fails the step as unreadable rather than passing uncompared.
 *
 * WHERE IT RUNS: the deploy workflow, AFTER the deploy step. A disagreement
 * here means the repo can no longer rebuild the database it operates — worth a
 * red workflow — but it does not make the worker that just shipped unsafe, so
 * it must not stand between a good build and production. Running it after the
 * deploy gets the alarm without holding the release, and it is not
 * `continue-on-error`: GOTCHAS already records what that does to the Semgrep
 * job, where a green check means only that the scan ran.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BASELINE_CUTOFF, migrationNumber } from './lib/migrationPlan.mjs';

const BASELINE = 'cloudflare-worker/sql/schema_baseline.sql';
const MIGRATIONS = 'cloudflare-worker/sql/migrations';

/**
 * Names D1 owns, on either side, in any environment.
 *
 * `_cf_KV` is Cloudflare's; local workerd refuses to let a file create it
 * (SQLITE_AUTH) and makes it itself, so it is present on production and absent
 * from any dump. `sqlite_%` covers `sqlite_sequence`, which SQLite creates the
 * moment an AUTOINCREMENT table exists, and `sqlite_autoindex_%`, which it
 * creates per UNIQUE constraint. None is anybody's schema and none belongs in a
 * comparison of one.
 */
const ENGINE_OWNED = /^(_cf_[A-Z]|sqlite_)/;

/**
 * The post-cutoff migrations, as this check applies them: every numbered file
 * above `BASELINE_CUTOFF`, in filename order, whole.
 *
 * EXPORTED SO THERE IS ONE LIST. `check-runtime-schema-declared.mjs` answers a
 * question about exactly the database this step builds — can a runtime
 * bootstrap create a name it lacks? — and a second copy of "which files, in
 * which order" is how the two would come to build different databases while
 * each reported success about its own.
 */
export function postCutoffMigrations(root = process.cwd()) {
  return readdirSync(resolve(root, MIGRATIONS))
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
    .sort()
    .map((name) => ({ name, sql: readFileSync(resolve(root, MIGRATIONS, name), 'utf8') }));
}

/**
 * The database the repo's schema story builds: the baseline, then each later
 * migration whole and in order, in the same SQLite engine D1 is.
 *
 * Returns the database rather than its names so a second reader can keep
 * working ON it — the runtime-schema guard executes the worker's own DDL
 * against exactly this build. `dqs` turns on double-quoted string literals,
 * which that guard wants as a deliberately permissive engine (a statement this
 * build refuses with them on is refused with them off too); this step leaves
 * them off, which is the stricter reading.
 */
export function buildFresh(sql, later = [], { dqs = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: dqs });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(sql);
  for (const migration of later) db.exec(migration);
  return db;
}

/** A database's schema-object names as `type:name`, engine-owned ones excluded. */
export function objectNames(db) {
  const rows = db.prepare(
    "SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger','view')",
  ).all();
  return new Set(
    rows.filter((r) => !ENGINE_OWNED.test(r.name)).map((r) => `${r.type}:${r.name}`),
  );
}

/** A declared column type as a comparison key: trimmed, one space, upper case. */
export const typeKey = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * A database's columns, keyed `table.column` in lower case (SQLite compares
 * both names case-insensitively), each with its declared type, NOT NULL and
 * default. Engine-owned tables are excluded, as they are from `objectNames`.
 *
 * One `pragma_table_info` join, so it costs one query however many tables
 * there are — the guards that call it stay fast (D359).
 */
export function columnsOf(db) {
  const rows = db.prepare(
    'SELECT m.name AS tbl, p.name AS col, p.type AS type, p."notnull" AS nn, p.dflt_value AS dflt '
    + "FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.name, p.cid",
  ).all();
  const out = new Map();
  for (const r of rows) {
    if (ENGINE_OWNED.test(r.tbl)) continue;
    const key = `${r.tbl.toLowerCase()}.${r.col.toLowerCase()}`;
    out.set(key, { key, table: r.tbl, column: r.col, type: typeKey(r.type), notnull: r.nn ? 1 : 0, dflt: r.dflt ?? null });
  }
  return out;
}

/**
 * The columns of the tables a set of `sqlite_master` rows describes, read by
 * executing each table's own DDL into a scratch database — production's rows
 * already carry `sql`, so this needs no second query and no pragma D1 might
 * refuse. A table whose DDL is missing or will not execute is returned in
 * `unreadable`, never dropped: a table this cannot read is a table whose
 * columns nobody compared.
 */
export function columnsFromDdl(rows) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const unreadable = [];
  for (const r of rows) {
    if (r.type !== 'table' || ENGINE_OWNED.test(r.name)) continue;
    if (!r.sql) { unreadable.push(`table:${r.name} — no DDL`); continue; }
    try {
      db.exec(String(r.sql));
    } catch (error) {
      unreadable.push(`table:${r.name} — ${String(error?.message || error)}`);
    }
  }
  return { columns: columnsOf(db), unreadable };
}

/**
 * The column difference between two `columnsOf` maps, over the tables BOTH
 * have — a table one side lacks entirely is already a name difference, and
 * listing its every column again would bury it.
 *
 *   missing — a column `live` has and `baseline` lacks (a hand-added column);
 *   extra   — a column `baseline` has and `live` lacks;
 *   retyped — a column both have whose declared type differs.
 */
export function compareColumns(baseline, live) {
  const tablesOf = (m) => new Set([...m.values()].map((c) => c.table.toLowerCase()));
  const lt = tablesOf(live);
  const bt = tablesOf(baseline);
  const shared = (c) => lt.has(c.table.toLowerCase()) && bt.has(c.table.toLowerCase());
  const byKey = (a, b) => a.key.localeCompare(b.key);
  const missing = [...live.values()].filter((c) => shared(c) && !baseline.has(c.key)).sort(byKey);
  const extra = [...baseline.values()].filter((c) => shared(c) && !live.has(c.key)).sort(byKey);
  const retyped = [...live.values()]
    .filter((c) => baseline.has(c.key) && baseline.get(c.key).type !== c.type)
    .map((c) => ({ key: c.key, baseline: baseline.get(c.key).type, live: c.type }))
    .sort(byKey);
  return { missing, extra, retyped, ok: !missing.length && !extra.length && !retyped.length };
}

/** A column as the statement that would add it, so a red run is a paste. */
export function addColumnDdl(c) {
  const type = c.type ? ` ${c.type}` : '';
  const nn = c.notnull ? ' NOT NULL' : '';
  const dflt = c.dflt != null ? ` DEFAULT ${c.dflt}` : '';
  return `ALTER TABLE ${c.table} ADD COLUMN ${c.column}${type}${nn}${dflt};`;
}

/**
 * Every object name the repo's schema story creates, by building it.
 *
 * `later` is the post-cutoff migrations, applied in order on top of the
 * baseline — the same set `migrations_fresh_build.test.ts` builds, and the
 * reason this stays true as migrations land instead of going stale on the
 * first one.
 */
export function baselineObjects(sql, later = []) {
  return objectNames(buildFresh(sql, later));
}

/**
 * The two-way difference, as the message a reader needs.
 *
 * Pure and exported so the drift suite can exercise it without a network or a
 * Cloudflare token — the guard's own logic is the part most worth testing, and
 * a checker nothing tests rots into a vacuous pass.
 */
export function compareObjects(baseline, live) {
  // FILTERS HERE TOO, not only in the two readers above. Both of them already
  // drop engine-owned names, so this is redundant on the real path — and that
  // is the point: it makes the exported decision correct on its own rather than
  // correct only while every caller remembers. A guard whose safety depends on
  // its callers is the shape that fails when a third caller arrives.
  const clean = (s) => new Set([...s].filter((n) => !ENGINE_OWNED.test(n.replace(/^\w+:/, ''))));
  const b = clean(baseline);
  const l = clean(live);
  const missing = [...l].filter((n) => !b.has(n)).sort();
  const extra = [...b].filter((n) => !l.has(n)).sort();
  return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

/** Pull the object names out of whatever shape `wrangler --json` returned. */
export function rowsFromWranglerJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`wrangler did not return JSON:\n${String(text).slice(0, 400)}`);
  }
  // wrangler has emitted both `[{results:[…]}]` and `{result:[{results:[…]}]}`
  // across versions, and an `{error:{text}}` object when it cannot authenticate.
  if (parsed?.error) throw new Error(parsed.error.text || JSON.stringify(parsed.error));
  const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed?.result?.[0]?.results);
  if (!Array.isArray(rows)) {
    throw new Error(`wrangler returned no result set:\n${String(text).slice(0, 400)}`);
  }
  return rows;
}

/**
 * The CREATE statement production holds for each object it has and the repo
 * does not, so the red run IS the migration to paste — not a list of names
 * someone must go back to production to look up (deploy runs 566-573: four
 * tables created by hand, and nothing in the log said what they were).
 *
 * Schema only: `sqlite_master.sql` is the object's DDL, never a row of data.
 * An object without DDL (D1 can report one) prints as such, not as blank.
 */
export function missingDdl(rows, missing) {
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.name}`, r.sql]));
  return missing.map((key) => {
    const sql = byKey.get(key);
    return sql ? `${String(sql).trim().replace(/;?$/, ';')}` : `-- ${key}: production returned no DDL for it`;
  });
}

// WHICH DATABASE THIS READS. Production by default, which is the only one the
// deploy workflow cares about. A branch database has the same schema and the
// same drift question, so the name and its config are overridable rather than
// literal — `DRIFT_D1_NAME=studioos-fr DRIFT_D1_CONFIG=../wrangler.branch.fr.toml`.
// Both must move together: naming a database a config does not declare asks
// wrangler to resolve it through the account instead.
const D1_NAME = process.env.DRIFT_D1_NAME || 'studioos-db';
const D1_CONFIG = process.env.DRIFT_D1_CONFIG || '../wrangler.toml';

function liveObjects() {
  let out;
  try {
    out = execFileSync('npx', [
      '--no-install', 'wrangler', 'd1', 'execute', D1_NAME,
      '--config', D1_CONFIG, '--remote', '--json',
      '--command',
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view')",
    ], { cwd: resolve(process.cwd(), 'cloudflare-worker'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // The token is the usual cause and the stack trace buries it. A guard that
    // dies unreadably is a guard people learn to skip.
    const detail = (error?.stdout || '') + (error?.stderr || '') || String(error?.message || error);
    console.error(
      '✖ check-baseline-drift: could not read production.\n' +
      '  This step needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; the deploy\n' +
      '  workflow supplies both. It cannot run from a checkout without them.\n\n' +
      `  wrangler said:\n${detail.split('\n').filter(Boolean).slice(-6).map((l) => `    ${l}`).join('\n')}`,
    );
    process.exit(2);
  }
  const rows = rowsFromWranglerJson(out).filter((r) => !ENGINE_OWNED.test(r.name));
  return { names: new Set(rows.map((r) => `${r.type}:${r.name}`)), rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const later = postCutoffMigrations().map((m) => m.sql);
  const fresh = buildFresh(readFileSync(resolve(process.cwd(), BASELINE), 'utf8'), later);
  const baseline = objectNames(fresh);
  const { names: live, rows: liveRows } = liveObjects();
  const { missing, extra, ok } = compareObjects(baseline, live);
  const baseCols = columnsOf(fresh);
  const { columns: liveCols, unreadable } = columnsFromDdl(liveRows);
  const cols = compareColumns(baseCols, liveCols);

  if (!ok || !cols.ok || unreadable.length) {
    console.error('✖ check-baseline-drift: the committed baseline no longer matches production.');
    if (missing.length) {
      console.error(`\n  On production, absent from ${BASELINE} (${missing.length}):`);
      for (const n of missing.slice(0, 40)) console.error(`    ${n}`);
      if (missing.length > 40) console.error(`    … and ${missing.length - 40} more`);
      console.error('\n  Their DDL on production — the body of the migration that declares them,');
      console.error('  if they are meant to exist (schema only, no rows):\n');
      for (const ddl of missingDdl(liveRows, missing.slice(0, 40))) {
        for (const line of ddl.split('\n')) console.error(`    ${line}`);
      }
    }
    if (extra.length) {
      console.error(`\n  In ${BASELINE}, absent from production (${extra.length}):`);
      for (const n of extra.slice(0, 40)) console.error(`    ${n}`);
      if (extra.length > 40) console.error(`    … and ${extra.length - 40} more`);
    }
    // COLUMNS, on the tables both sides have (D359). Comparing names alone let a
    // column added by hand, or by a runtime ALTER, through on every run.
    if (cols.missing.length) {
      console.error(`\n  Columns on production, absent from ${BASELINE} (${cols.missing.length}) —`);
      console.error('  as the statements that would declare them:\n');
      for (const c of cols.missing.slice(0, 40)) console.error(`    ${addColumnDdl(c)}`);
      if (cols.missing.length > 40) console.error(`    … and ${cols.missing.length - 40} more`);
    }
    if (cols.extra.length) {
      console.error(`\n  Columns in ${BASELINE}, absent from production (${cols.extra.length}):`);
      for (const c of cols.extra.slice(0, 40)) console.error(`    ${c.table}.${c.column} ${c.type}`);
      if (cols.extra.length > 40) console.error(`    … and ${cols.extra.length - 40} more`);
    }
    if (cols.retyped.length) {
      console.error(`\n  Columns whose declared type differs (${cols.retyped.length}):`);
      for (const c of cols.retyped.slice(0, 40)) console.error(`    ${c.key}: baseline ${c.baseline || '(none)'}, production ${c.live || '(none)'}`);
      if (cols.retyped.length > 40) console.error(`    … and ${cols.retyped.length - 40} more`);
    }
    if (unreadable.length) {
      console.error(`\n  Production tables whose columns could not be read, so were not compared (${unreadable.length}):`);
      for (const u of unreadable.slice(0, 40)) console.error(`    ${u}`);
    }
    console.error(
      '\nTHE DEPLOYED WORKER AND THE DATABASE ARE FINE. What has broken is the\n' +
      "repo's ability to rebuild the schema it operates: a new environment would\n" +
      'not come up matching production. Usual causes, in order of likelihood:\n' +
      '  · a runtime `CREATE … IF NOT EXISTS` or `ALTER TABLE … ADD COLUMN` in\n' +
      '    cloudflare-worker/src created an object or column no migration declares —\n' +
      '    the first request to reach it did (D235: admin_publications, 2026-09-24).\n' +
      '    Declare it in a new migration, copied from the runtime statement;\n' +
      '    check-runtime-schema-declared.mjs exists so this is caught before a merge\n' +
      '    rather than here, after a deploy;\n' +
      '  · something was applied to production by hand and never written down;\n' +
      '  · a migration above the cutoff does not do what production shows;\n' +
      "  · schema_baseline.sql was edited rather than re-dumped (that is exactly\n" +
      '    how schema.sql came to promise five cascades that never existed).\n' +
      'Re-dump the baseline the way its own header describes, or add the missing\n' +
      'migration — whichever the difference above says is actually true.',
    );
    process.exit(1);
  }

  console.log(
    `✓ check-baseline-drift: baseline + ${later.length} post-cutoff migration(s) `
    + `reproduces production exactly (${baseline.size} objects and ${baseCols.size} columns with their `
    + 'declared types, engine-owned names excluded on both sides).',
  );
}
