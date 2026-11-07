/**
 * #4568 R2-04 — runtime DDL against an up-to-date database, and the ratchet
 * that keeps blind ALTERs from growing.
 *
 *   · the cohort bootstrap, through the real cron tick and directly, on the
 *     migrated schema: repeated calls and fresh isolates (a new binding each)
 *     issue no ALTER and raise no error;
 *   · on a database missing the columns it adds them once, and the next fresh
 *     isolate issues none;
 *   · a genuine failure throws `cohort_schema_not_ready`, is not remembered as
 *     ready, and the next call tries again — never a quiet success;
 *   · two isolates starting together both succeed and add each column once;
 *   · the ratchet refuses a file that grows, a new blind file, and a stale
 *     entry, and the tree as it is passes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/runtime_ddl_4568.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { COHORT_SCHEMA, ensureCohortAppSchema, runCohortApplicationsTick } from '../src/services/cohortApplications.ts';
import { inventory, ratchet } from '../../scripts/lib/runtimeDdl.mjs';

afterAll(() => removeMigratedDatabases());
const ROOT = new URL('../../', import.meta.url).pathname;

/** A binding over `db` that records every statement it runs and every error, as a fresh isolate's binding would be. */
function isolate(db: DatabaseSync) {
  const base = d1Over(db);
  const log = { alters: [] as string[], errors: [] as string[], statements: 0 };
  const wrap = (sql: string, st: any) => {
    const track = (f: () => Promise<any>) => async () => {
      log.statements++;
      if (/^\s*ALTER\b/i.test(sql)) log.alters.push(sql);
      try { return await f(); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    };
    const api: any = { bind: (...a: unknown[]) => { st.bind(...a); return api; } };
    api.run = track(() => st.run()); api.all = track(() => st.all()); api.first = (c?: string) => track(() => st.first(c))();
    api.runSync = () => st.runSync();
    return api;
  };
  const DB = { prepare: (sql: string) => wrap(sql, base.prepare(sql)), batch: (s: any[]) => base.batch(s), exec: (s: string) => base.exec(s) };
  return { env: { DB, ENVIRONMENT: 'development' } as any, log };
}

test('#4568 R2-04: on an up-to-date database, the bootstrap and the cron tick issue no ALTER, across fresh isolates', async () => {
  const db = migratedDatabase();
  try {
    for (let k = 0; k < 3; k++) {
      const { env, log } = isolate(db);
      await ensureCohortAppSchema(env);
      await ensureCohortAppSchema(env); // the same isolate: remembered, nothing read
      // Mutation checked: the bootstrap back on blind ALTERs → four ALTERs and four duplicate-column errors here.
      assert.deepEqual(log.alters, [], `isolate ${k}: no ALTER against an up-to-date database`);
      assert.deepEqual(log.errors, [], `isolate ${k}: no error`);
    }
    // The real hot path: the cron tick, twice, each in a fresh isolate.
    for (let k = 0; k < 2; k++) {
      const { env, log } = isolate(db);
      await runCohortApplicationsTick(env, new Date('2026-11-07T12:00:00Z'));
      assert.deepEqual(log.alters, [], `tick ${k}: no ALTER`);
      assert.ok(!log.errors.some((e) => /duplicate column/i.test(e)), `tick ${k}: no duplicate-column error`);
      assert.ok(log.statements > 0, 'the tick did its work');
    }
  } finally { db.close(); }
});

test('#4568 R2-04: a database missing the columns gets them once; the next isolate issues none', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY, year INTEGER, month INTEGER)');
    const first = isolate(db);
    await ensureCohortAppSchema(first.env);
    assert.equal(first.log.alters.length, 4, 'all four columns were added');
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all('cohort_cycles').map((r: any) => r.name);
    for (const c of ['applications_open_at', 'applications_close_at', 'app_status', 'force_proceed']) assert.ok(cols.includes(c), c);
    for (const t of ['cohort_applicants', 'cohort_cycle_events', 'cohort_app_notification_ledger', 'cohort_settings']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t);
    }
    const next = isolate(db);
    await ensureCohortAppSchema(next.env);
    assert.deepEqual(next.log.alters, [], 'the next fresh isolate finds them and issues none');
  } finally { db.close(); }
});

test('#4568 R2-04: a genuine failure throws, is not remembered as ready, and is tried again', async () => {
  const db = new DatabaseSync(':memory:'); // no cohort_cycles at all: the ALTER fails with "no such table"
  try {
    const { env, log } = isolate(db);
    const errors: unknown[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a); };
    try {
      // Mutation checked: the old catch that logged and returned → this resolves and the assertion fails.
      await assert.rejects(ensureCohortAppSchema(env), /cohort_schema_not_ready/);
      const before = log.statements;
      await assert.rejects(ensureCohortAppSchema(env), /cohort_schema_not_ready/);
      assert.ok(log.statements > before, 'the second call tried again rather than trusting a failed bootstrap');
    } finally { console.error = orig; }
    // The log holds a code, never a value or the driver's message.
    assert.deepEqual(errors, [['[cohort-apps] schema_not_ready'], ['[cohort-apps] schema_not_ready']]);
    // Once the table exists, the same binding recovers.
    db.exec('CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY)');
    await ensureCohortAppSchema(env);
  } finally { db.close(); }
});

test('#4568 R2-04: two isolates starting together both succeed and add each column once', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY)');
    const a = isolate(db), b = isolate(db);
    await Promise.all([ensureCohortAppSchema(a.env), ensureCohortAppSchema(b.env)]);
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all('cohort_cycles').map((r: any) => r.name);
    assert.equal(cols.filter((c: string) => c === 'force_proceed').length, 1);
    assert.equal(cols.length, 5);
    // The loser of a race sees "duplicate column" and runSchemaBootstrap tolerates exactly that.
    for (const e of [...a.log.errors, ...b.log.errors]) assert.match(e, /duplicate column/i);
  } finally { db.close(); }
});

test('#4568 R2-04: the bootstrap is migration 157, column for column', () => {
  const m157 = readFileSync(new URL('../sql/migrations/157_cohort_applications.sql', import.meta.url), 'utf8');
  for (const s of COHORT_SCHEMA.filter((x) => /^ALTER/.test(x))) {
    const col = /ADD COLUMN (\w+)/.exec(s)![1];
    assert.match(m157, new RegExp(`ADD COLUMN ${col}\\b`), `${col} is declared by migration 157`);
  }
});

test('#4568 R2-04: the ratchet refuses growth, a new blind file and a stale entry; the tree passes', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  try {
    const inv = inventory({ root: ROOT, db });
    const baseline = JSON.parse(readFileSync(new URL('../../scripts/runtime-ddl-baseline.json', import.meta.url), 'utf8')).files;
    const now = ratchet(inv, baseline);
    assert.deepEqual([now.grown, now.shrunk], [[], []], 'the tree matches its baseline');
    const cohort = inv.files.find((f: any) => f.file.endsWith('services/cohortApplications.ts'));
    assert.equal(cohort.policy, 'asks_first');
    assert.equal(baseline['cloudflare-worker/src/services/cohortApplications.ts'], undefined, 'and is off the baseline');
    // Mutation checked: ratchet comparing with >= instead of > → every file reads as grown and the first assertion fails.
    const someFile = Object.keys(baseline)[0];
    const tight = { ...baseline, [someFile]: baseline[someFile] - 1 };
    assert.deepEqual(ratchet(inv, tight).grown.map((g: any) => g.file), [someFile], 'a file over its entry is refused');
    const { [someFile]: _drop, ...without } = baseline;
    assert.deepEqual(ratchet(inv, without).grown.map((g: any) => g.file), [someFile], 'a blind file not on record is refused');
    assert.deepEqual(ratchet(inv, { ...baseline, 'cloudflare-worker/src/gone.ts': 3 }).shrunk.map((s: any) => s.file), ['cloudflare-worker/src/gone.ts'], 'a stale entry must be lowered');
    assert.ok(inv.totals.blind_declared >= 300, 'most blind ALTERs are for columns a migration already declares');
  } finally { db.close(); }
});
