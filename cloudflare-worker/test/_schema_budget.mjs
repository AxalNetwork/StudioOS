/**
 * D8467 (#8467) — a Worker test file may replay the migration chain twice at most.
 *
 * WHY. One full build of the schema is the baseline and then every migration
 * above `BASELINE_CUTOFF`: 768 files and about 35 s on CI on 2026-11-24. A test
 * file that does that inside a per-test fixture pays it once per test. The 24
 * files #8437 lists were each doing exactly that, and together they were close
 * to half of all Worker test time. `_schema_once.mjs` (D4133) has built the
 * schema once per run since 2026; nothing stopped a new file from copying the
 * old pattern from its neighbour, so the list grew back.
 *
 * WHAT. `_ts-loader.mjs` imports this file, so it is loaded into every Worker
 * test process. It counts the whole migration files (above the cutoff, matched
 * by their exact text) that the process hands to `DatabaseSync.prototype.exec`.
 * Two chains' worth is allowed: one build of the schema, and as much again
 * for cuts of it or for re-running a migration to test that it replays
 * safely. Every call past that throws, and says to build once and copy (`freshSchema()`, `loadSchema(db)`, `openSchema()`, or
 * `{ below: N }` for the schema before migration N).
 *
 *   · The shared helper's own build (`_schema_once.mjs`) is not counted: which
 *     process happens to build the cache must not decide who is over budget.
 *   · A test's own SQL is never counted. A statement that happens to be as long
 *     as a migration file is compared with that file's text.
 *   · Counting is by files executed, never by time, so the answer is the same
 *     on every machine.
 *   · `scripts/test-schema-replays.txt` lists the files that were over budget
 *     when the rule arrived. A listed file is not stopped. A listed file that
 *     has since been fixed is tolerated, so the PR that fixes one does not
 *     touch the list.
 *   · `SCHEMA_REPLAY_REPORT=<file>` appends one JSON line per test process
 *     (`{ file, replayed, chain }`) and stops nothing: the census.
 *
 * What it does not see: a file that applies the migrations statement by
 * statement, or through `prepare`. Those builders are few and deliberate
 * (`sub_cutoff_restores_d190`, `user_column_cap_d189`); the copied pattern this
 * rule exists for is `db.exec(readFileSync(migration))` in a loop.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): `_schema_budget.mjs` (D8467) is what
 * keeps that true. `_ts-loader.mjs` imports it, so every Worker test process counts the whole
 * migration files it executes; two chains' worth is allowed (one build of the schema, and as much
 * again for cuts or for re-running a migration) and each one past that throws, naming the file and
 * the helper to call instead. The shared build is not counted. `scripts/test-schema-replays.txt`
 * lists the files that were over when the rule arrived; a file leaves that list by being fixed,
 * and a new file is added only when it is about the build itself. `SCHEMA_REPLAY_REPORT=<file>`
 * turns the refusal off and writes each file's count, one JSON line per test file.
 */
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SQL_DIR = fileURLToPath(new URL('../sql/', import.meta.url));
export const LIST = 'scripts/test-schema-replays.txt';
/** How many chains' worth of whole migration files one test file may execute. */
export const CHAINS = 2;
const TEST_FILE = /^cloudflare-worker\/test\/[^/]+\.test\.(?:ts|mjs)$/;
const installed = Symbol.for('studioos.schemaReplayBudget');

/** The migrations a full build applies, keyed by size in bytes; their text is read only when a size matches. */
export function chain(sqlDir = SQL_DIR) {
  const dir = join(sqlDir, 'migrations');
  const bySize = new Map();
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (!/^\d+_.*\.sql$/.test(name) || migrationNumber(name) <= BASELINE_CUTOFF) continue;
    const size = statSync(join(dir, name)).size;
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(name);
    count += 1;
  }
  const texts = new Map();
  const text = (name) => {
    if (!texts.has(name)) texts.set(name, readFileSync(join(dir, name), 'utf8'));
    return texts.get(name);
  };
  /** Is this SQL the whole text of a migration above the cutoff? */
  const isMigration = (sql) => {
    const names = bySize.get(Buffer.byteLength(sql));
    return names !== undefined && names.some((name) => text(name) === sql);
  };
  return { count, isMigration };
}

/** The listed files: one repo-relative path per line; `#` starts a comment. */
export function parseList(source) {
  return source.split('\n').map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean);
}

/** The test file this process is running, repo-relative with forward slashes, or null. */
export function testFileOf(argv, root = ROOT) {
  for (const arg of argv.slice(1)) {
    if (!/\.test\.(?:ts|mjs)$/.test(arg)) continue;
    const file = relative(root, resolve(arg)).split('\\').join('/');
    if (TEST_FILE.test(file)) return file;
  }
  return null;
}

export function overBudgetMessage({ file, replayed, count }) {
  return `${file} has executed ${replayed} whole migration files in this process; one build of the schema is ${count}. `
    + `A Worker test file may execute ${CHAINS} builds' worth (D8467). Build the schema once and give each test its own copy: `
    + "`freshSchema()`, `loadSchema(db)` or `openSchema()` from './_schema_once.mjs', with `{ below: N }` for the schema before migration N. "
    + `If this file is about the build itself, add it to ${LIST} with the reason.`;
}

/**
 * The counter. `note(sql)` is called with every string a test process executes. It returns true for each
 * whole migration file past `CHAINS` chains' worth, unless the file is listed; `listed` is asked once, then.
 */
export function replayBudget({ count, isMigration, shared, listed }) {
  let replayed = 0;
  let allowed = null;
  return {
    get replayed() { return replayed; },
    note(sql) {
      if (typeof sql !== 'string' || !isMigration(sql) || shared()) return false;
      replayed += 1;
      if (replayed <= count * CHAINS) return false;
      if (allowed === null) allowed = listed();
      return !allowed;
    },
  };
}

/** Was this call made by the shared build in `_schema_once.mjs`? Asked only for a whole migration file. */
const fromSharedBuild = () => /[\\/]_schema_once\.mjs[:)]/.test(new Error().stack);

/**
 * Wrap `Database.prototype.exec` for the test file this process runs. Does nothing outside a Worker test
 * file, and nothing the second time. Returns the budget, or null when it was not installed.
 */
export function install({ Database = DatabaseSync, argv = process.argv, env = process.env, root = ROOT, sqlDir = SQL_DIR, proc = process, log = console.error } = {}) {
  const file = testFileOf(argv, root);
  if (!file || Database.prototype[installed]) return null;
  const report = env.SCHEMA_REPLAY_REPORT || '';
  let count = 0;
  let counter = null;
  let over = false;
  // Read the migrations directory only once this process executes SQL at all.
  const budget = () => {
    if (!counter) {
      const read = chain(sqlDir);
      count = read.count;
      counter = replayBudget({ count, isMigration: read.isMigration, shared: fromSharedBuild, listed: () => parseList(readFileSync(join(root, LIST), 'utf8')).includes(file) });
    }
    return counter;
  };
  const exec = Database.prototype.exec;
  Database.prototype.exec = function execWithinBudget(sql, ...rest) {
    if (budget().note(sql) && !report) {
      over = true;
      throw new Error(overBudgetMessage({ file, replayed: counter.replayed, count }));
    }
    return exec.call(this, sql, ...rest);
  };
  Object.defineProperty(Database.prototype, installed, { value: true });
  proc.on('exit', () => {
    if (report && counter) appendFileSync(report, `${JSON.stringify({ file, replayed: counter.replayed, chain: count })}\n`);
    // A fixture that catches every error would swallow the throw above; the file still fails.
    if (over && !proc.exitCode) {
      log(`✖ ${overBudgetMessage({ file, replayed: counter.replayed, count })}`);
      proc.exitCode = 1;
    }
  });
  return { get replayed() { return counter ? counter.replayed : 0; } };
}

install();
