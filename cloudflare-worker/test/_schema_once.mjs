/**
 * D4133 (#4133) — the test database schema, built once per run instead of once
 * per file.
 *
 * WHY. About 180 worker test files each built a SQLite database from
 * `sql/schema_baseline.sql` plus every migration above `BASELINE_CUTOFF`:
 * 4–10 s per build on CI, 37 s on a slow box, and the bulk of the worker
 * suite's time (D4130 has the profile). The schema is the same bytes in every
 * one of them, so it is built once and copied.
 *
 * HOW.
 *   · `schemaKey(opts)` is a sha256 of this file's BUILD version, the baseline
 *     and every selected migration's name and bytes. A changed migration is a
 *     new key and so a fresh build; nothing is ever served stale.
 *   · `schemaPath(opts)` builds `<tmpdir>/studioos-schema-<key>.sqlite` once.
 *     The first process to take `<file>.lock` (O_EXCL) builds into a private
 *     temp file and renames it into place, which is atomic, so a reader sees
 *     either no file or a complete one. Every other process waits for the
 *     file; a lock older than LOCK_STALE_MS is taken over, and a process that
 *     waits past it builds its own copy rather than fail.
 *   · `loadSchema(db, opts)` fills an EMPTY database handle (in memory or on
 *     disk, with whatever options the test opened it with) from that file:
 *     every table in creation order, its rows, then indexes, views and
 *     triggers (after the rows, so a copy fires no trigger), and
 *     `sqlite_sequence`. The test keeps its own handle and its own copy; a test
 *     that alters its schema afterwards alters only its copy.
 *   · `copySchemaTo(dest, opts)` is the file form, for tests that copy a seed
 *     file per case.
 *
 * `opts.below` builds only the migrations numbered below it, for the tests
 * that need the schema as it stood before a later migration; each bound is its
 * own key and file.
 *
 * `cloudflare-worker/test/schema_once_d4133.test.ts` holds a loaded database
 * to a fresh build (every `sqlite_schema` row and every table's rows), shows a
 * changed migration changes the key, and races two first calls.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

/** Bump when the build or the load below changes, so an old cached file is never reused. */
export const BUILD = 1;  // the load changing does not change a built file, so only a build change bumps this
export const SCHEMA_OPTIONS = Object.freeze({ enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
const SQL = fileURLToPath(new URL('../sql/', import.meta.url));
const LOCK_STALE_MS = 10 * 60 * 1000;

/** The baseline's text and the selected migrations, in the order the ledger runner applies them. */
export function schemaInputs({ below = Infinity, sqlDir = SQL } = {}) {
  const baseline = readFileSync(join(sqlDir, 'schema_baseline.sql'), 'utf8');
  const migrations = readdirSync(join(sqlDir, 'migrations'))
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF && migrationNumber(n) < below)
    .sort(compareMigrations)
    .map((name) => ({ name, sql: readFileSync(join(sqlDir, 'migrations', name), 'utf8') }));
  return { baseline, migrations };
}

/** The cache key: this file's build version, the baseline and every selected migration, by name and bytes. */
export function schemaKey(opts = {}) {
  const { baseline, migrations } = schemaInputs(opts);
  const h = createHash('sha256').update(`build ${BUILD}\0below ${opts.below ?? 'all'}\0`).update(baseline);
  for (const m of migrations) h.update(`\0${m.name}\0`).update(m.sql);
  return h.digest('hex').slice(0, 32);
}

/** A fresh build at `path`: the baseline, then every selected migration. */
export function buildSchema(path, opts = {}) {
  const { baseline, migrations } = schemaInputs(opts);
  const db = new DatabaseSync(path, SCHEMA_OPTIONS);
  try {
    db.exec(baseline);
    for (const m of migrations) db.exec(m.sql);
  } finally { db.close(); }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The cached schema file for this run, built once across every test process. */
export function schemaPath(opts = {}) {
  const dir = opts.cacheDir ?? tmpdir();
  const file = join(dir, `studioos-schema-${schemaKey(opts)}.sqlite`);
  if (existsSync(file)) return file;
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    let fd = null;
    try { fd = openSync(lock, 'wx'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (fd !== null) {
      closeSync(fd);
      try {
        if (!existsSync(file)) {
          const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
          try { buildSchema(tmp, opts); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
        }
        return file;
      } finally { rmSync(lock, { force: true }); }
    }
    if (existsSync(file)) return file;
    // Someone else is building. Take the lock over if it has gone stale; past the deadline, build privately.
    try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true }); } catch { /* it just went away */ }
    if (Date.now() > deadline) {
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      try { buildSchema(tmp, opts); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
      return file;
    }
    sleep(100);
  }
}

/** Copy the cached schema file to `dest`, for tests that copy a seed per case. */
export function copySchemaTo(dest, opts = {}) {
  copyFileSync(schemaPath(opts), dest);
  return dest;
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Fill an empty database handle with the cached schema and its rows: tables in
 * creation order, then their rows, then indexes, views and triggers, then
 * `sqlite_sequence`. The handle keeps the options the test opened it with.
 */
export function loadSchema(db, opts = {}) {
  const path = schemaPath(opts);
  const alias = `schema_once_${process.pid}`;
  db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(path);
  try {
    const objects = db.prepare(`SELECT type, name, sql FROM ${alias}.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`).all();
    const tables = objects.filter((o) => o.type === 'table');
    for (const t of tables) db.exec(t.sql);
    for (const t of tables) db.exec(`INSERT INTO main.${q(t.name)} SELECT * FROM ${alias}.${q(t.name)}`);
    for (const type of ['index', 'view', 'trigger']) for (const o of objects.filter((x) => x.type === type)) db.exec(o.sql);
    const hasSeq = db.prepare(`SELECT 1 FROM ${alias}.sqlite_master WHERE name = 'sqlite_sequence'`).get();
    // The row copy leaves a `seq 0` for every AUTOINCREMENT table it touched; the build's own sequence is the truth.
    if (hasSeq) db.exec(`DELETE FROM main.sqlite_sequence; INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM ${alias}.sqlite_sequence`);
  } finally {
    db.exec(`DETACH DATABASE ${alias}`);
  }
  return db;
}
