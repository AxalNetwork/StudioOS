/**
 * What the board used to say — the store that made three chips possible, and the
 * one property that keeps it from becoming a heartbeat.
 *
 * A claim's verdict is derived on every request and stored nowhere, which is
 * right and stays. What was missing is the other kind of store: an append-only
 * record of what the derived value HAS BEEN. Without it `/validate/verdict`'s
 * `As of last week` and `Changed this month` and `/validate/hypotheses`'
 * `Recently moved` had nothing to stand on and were registered `unbuilt`,
 * which draws a disabled chip explained only by a hover title.
 *
 * THE ASSERTION THAT MATTERS MOST IS THE SECOND ONE. This is written from a
 * READ, so a board opened twice a day for a year must produce one row per claim
 * and not seven hundred. Everything else here is about the store being right;
 * that one is about it being affordable, which is the whole premise of putting
 * it on the read path at all.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/verdict_history.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ensureVerdictHistorySchema, recordVerdictChanges, loadVerdictHistory,
} from '../src/services/verdictHistory.ts';

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/255_hypothesis_verdict_history.sql'),
  'utf8',
);

/** A D1-shaped binding over an in-memory SQLite, with nothing pre-created. */
function makeEnv() {
  const db = new DatabaseSync(':memory:');
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  const DB = {
    async exec(sql: string) { db.exec(sql); return { count: 1, duration: 0 }; },
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
  return { env: { DB } as any, db };
}

const rows = (db: InstanceType<typeof DatabaseSync>): any[] =>
  db.prepare('SELECT * FROM hypothesis_verdict_history ORDER BY id').all() as any[];

const state = (id: number, verdict: string | null, lane: string) =>
  ({ hypothesis_id: id, verdict, lane });

test('a verdict change writes exactly one row, and the first observation counts as one', async () => {
  const { env, db } = makeEnv();

  assert.equal(await recordVerdictChanges(env, 1, [state(10, 'unproven', 'testing')]), 1,
    'a claim with no history yet must record its first observation');
  assert.equal(rows(db).length, 1);

  assert.equal(await recordVerdictChanges(env, 1, [state(10, 'validated', 'validated')]), 1);
  const all = rows(db);
  assert.equal(all.length, 2, 'the change was not recorded');
  assert.deepEqual(all.map((r) => [r.verdict, r.lane]),
    [['unproven', 'testing'], ['validated', 'validated']]);
});

test('an unchanged recompute writes nothing, which is what makes this safe on a read', async () => {
  // THE PREMISE OF THE WHOLE DESIGN. Every board read calls this. If an
  // unchanged pair wrote a row, a project whose board is opened twice a day for
  // a year would carry seven hundred rows per claim and `Changed this month`
  // would be true for everything, permanently.
  const { env, db } = makeEnv();
  await recordVerdictChanges(env, 1, [state(10, 'unproven', 'testing')]);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(await recordVerdictChanges(env, 1, [state(10, 'unproven', 'testing')]), 0,
      `read ${i + 2} wrote a row for an unchanged claim`);
  }
  assert.equal(rows(db).length, 1);
});

test('a lane move with an unchanged verdict is still a row', async () => {
  // This is the one `Recently moved` reads, and it is why the lane is stored
  // beside the verdict rather than the verdict alone. A claim leaves `none` for
  // `testing` the moment its first supporting interview lands — the board's
  // columns change and `verdictFor` returns the same answer throughout.
  const { env, db } = makeEnv();
  await recordVerdictChanges(env, 2, [state(20, 'unproven', 'none')]);
  assert.equal(await recordVerdictChanges(env, 2, [state(20, 'unproven', 'testing')]), 1,
    'the lane moved and nothing recorded it');
  assert.deepEqual(rows(db).map((r) => r.lane), ['none', 'testing']);
});

test('a withheld verdict is stored as NULL and does not re-write on every read', async () => {
  // `verdictFor` returns null when interviews touching a claim have no ICP fit
  // recorded — "we do not know yet", which is a different fact from "unproven"
  // and the distinction the helper exists to preserve. A comparison that treated
  // stored NULL and computed null as different would write a row on every single
  // board read for every such claim.
  const { env, db } = makeEnv();
  assert.equal(await recordVerdictChanges(env, 3, [state(30, null, 'unknown')]), 1);
  assert.equal(await recordVerdictChanges(env, 3, [state(30, null, 'unknown')]), 0,
    'a NULL verdict re-wrote itself — stored null and computed null must compare equal');
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].verdict, null);

  assert.equal(await recordVerdictChanges(env, 3, [state(30, 'unproven', 'testing')]), 1,
    'moving off "we do not know" is a change');
});

test('claims and projects do not bleed into each other', async () => {
  const { env, db } = makeEnv();
  await recordVerdictChanges(env, 4, [state(40, 'unproven', 'testing'), state(41, 'validated', 'validated')]);
  // Same verdict as claim 40, different claim: its own first observation.
  assert.equal(await recordVerdictChanges(env, 5, [state(50, 'unproven', 'testing')]), 1);
  assert.equal(rows(db).length, 3);

  const four = await loadVerdictHistory(env, 4);
  assert.deepEqual([...four.byClaim.keys()].sort(), [40, 41]);
  const five = await loadVerdictHistory(env, 5);
  assert.deepEqual([...five.byClaim.keys()], [50]);
});

test('the history comes back oldest-first, with the date the record starts', async () => {
  const { env } = makeEnv();
  const empty = await loadVerdictHistory(env, 6);
  assert.equal(empty.since, null,
    'an empty record must report null rather than a date, or the page cannot say the history has not started');

  await recordVerdictChanges(env, 6, [state(60, 'unproven', 'none')]);
  await recordVerdictChanges(env, 6, [state(60, 'unproven', 'testing')]);
  await recordVerdictChanges(env, 6, [state(60, 'validated', 'validated')]);

  const h = await loadVerdictHistory(env, 6);
  assert.deepEqual(h.byClaim.get(60)!.map((o) => o.lane), ['none', 'testing', 'validated'],
    'the order is what "as of" reads — a shuffled history answers the wrong verdict');
  assert.ok(h.since, 'the record has rows but reports no start date');
});

test('two databases in one isolate each get their own bootstrap', async () => {
  // THE #204 SHAPE, asserted directly. A module is instantiated once per
  // ISOLATE, not once per database, so a module-level `let ready = false` lets
  // the first binding to bootstrap mark the job done for every other binding the
  // same isolate goes on to serve — and the second one then writes into a table
  // that was never created. The readiness cache is a WeakMap keyed on the
  // binding for exactly this reason (D95).
  const a = makeEnv();
  const b = makeEnv();
  assert.equal(await ensureVerdictHistorySchema(a.env), true);
  assert.equal(await ensureVerdictHistorySchema(b.env), true);

  await recordVerdictChanges(a.env, 7, [state(70, 'validated', 'validated')]);
  await recordVerdictChanges(b.env, 7, [state(70, 'validated', 'validated')]);
  assert.equal(rows(a.db).length, 1, 'the first database lost its row');
  assert.equal(rows(b.db).length, 1,
    'the second database got no table — readiness was cached per isolate, not per binding');
});

test('migration 255 is D1-applicable and matches the runtime bootstrap', () => {
  // COMMENTS FIRST, THEN THE CHECK. The file's own header says "No BEGIN/COMMIT"
  // — explaining the rule it follows — so an assertion over the raw text fails a
  // migration for documenting the very thing it is being checked for. The same
  // lesson `frontend/test/_codeOnly.mjs` records: the line you want to keep is
  // usually the one that names the thing.
  const sql = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(sql, /\bBEGIN\b|\bCOMMIT\b/i,
    'D1 rejects transaction statements in a migration file (migration 200 learned this)');
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS hypothesis_verdict_history/);

  // Every column the migration declares must exist in the runtime bootstrap, or
  // a database that never ran the migration gets a table the code cannot use —
  // and one that did gets a different shape from one that did not.
  const block = MIGRATION.slice(
    MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS hypothesis_verdict_history'),
    MIGRATION.indexOf(');', MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS hypothesis_verdict_history')),
  );
  const cols = [...block.matchAll(/^\s{4}([a-z_]+)\s/gm)].map((m) => m[1]);
  assert.deepEqual(cols.sort(),
    ['hypothesis_id', 'id', 'lane', 'observed_at', 'project_id', 'verdict']);

  const svc = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/services/verdictHistory.ts'), 'utf8',
  );
  const boot = svc.slice(svc.indexOf('export async function ensureVerdictHistorySchema'),
    svc.indexOf('export type VerdictState'));
  for (const c of cols) assert.ok(boot.includes(c), `the runtime bootstrap is missing ${c}`);

  // And readiness is per binding, not per isolate.
  assert.match(svc, /const READY = new WeakMap<object, boolean>\(\)/);
  assert.match(svc, /const key = bindingKey\(env\)/,
    'readiness must be keyed on the binding — `scripts/check-schema-readiness.mjs` '
    + 'fails the module-boolean shape for the reason #203 found');
});
