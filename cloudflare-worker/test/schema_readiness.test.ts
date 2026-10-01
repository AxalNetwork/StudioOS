/**
 * A lazy schema bootstrap must remember its work PER DATABASE, not per module.
 *
 * WHAT THIS DEFENDS, and why a source-shape guard was not enough on its own.
 * `scripts/check-schema-readiness.mjs` bans the module-level `let ready = false`
 * by reading the text; it cannot tell whether the WeakMap that replaced it is
 * actually consulted with the right key, or whether the cache still caches at
 * all. A conversion that keyed every latch on a fresh object would pass that
 * guard and re-run ten statements on every request. So the behaviour is pinned
 * here, against the real bootstraps.
 *
 * THE BUG IN ONE SENTENCE (#203, then #204): a module is instantiated once per
 * ISOLATE and not once per DATABASE, so a boolean that means "some database
 * this isolate served is bootstrapped" is read at every call site as "THIS
 * database is bootstrapped" — and the second binding silently never gets its
 * DDL. Test 2 is that exact scenario, and it is the one that fails if anybody
 * puts the boolean back.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/schema_readiness.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindingKey } from '../src/util/schemaBootstrap.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import type { Env } from '../src/types.ts';

/** A D1 stub that records every statement it is handed. */
function makeRecorder(opts: { throwOnExec?: boolean } = {}) {
  const statements: string[] = [];
  return {
    statements,
    db: {
      async exec(sql: string) {
        if (opts.throwOnExec) throw new Error('D1 is cold');
        statements.push(sql);
        return { count: 1, duration: 0 };
      },
      prepare() { throw new Error('unused'); },
      batch() { throw new Error('unused'); },
      dump() { throw new Error('unused'); },
    },
  };
}

const envFor = (db: unknown): Env => ({ DB: db, ENVIRONMENT: 'development' } as unknown as Env);

test('bindingKey is the D1 binding itself, not a wrapper around it', () => {
  const { db } = makeRecorder();
  const env = envFor(db);
  // Identity matters: two callers reaching for the same binding must land on
  // the same WeakMap entry, and a key derived by wrapping or copying would
  // give every call a fresh object and a cache that never hits.
  assert.equal(bindingKey(env), db as unknown as object);
  assert.equal(bindingKey(env), bindingKey(envFor(db)));
  assert.notEqual(bindingKey(env), bindingKey(envFor(makeRecorder().db)));
});

test('two databases in one isolate each get their own bootstrap', async () => {
  // THE #204 SCENARIO. One module instance, two bindings. Under the old
  // `let _ready = false` the second call returned immediately and `second`
  // stayed empty — a SELECT against a table nothing had created.
  const first = makeRecorder();
  const second = makeRecorder();

  await ensureXSchema(envFor(first.db));
  await ensureXSchema(envFor(second.db));

  assert.ok(first.statements.length > 0, 'the first database never got its DDL');
  assert.ok(second.statements.length > 0,
    'the second database was told the bootstrap was already done — readiness is cached per module, not per binding');
  assert.deepEqual(second.statements, first.statements,
    'both databases must get the same statements');
});

test('one database is bootstrapped once, not on every call', async () => {
  // The other half. A cache keyed on something fresh per call would pass the
  // test above and re-run the whole DDL on every request.
  const only = makeRecorder();
  const env = envFor(only.db);

  await ensureXSchema(env);
  const afterFirst = only.statements.length;
  await ensureXSchema(env);
  await ensureXSchema(envFor(only.db)); // a different Env, the same binding

  assert.ok(afterFirst > 0);
  assert.equal(only.statements.length, afterFirst,
    'the bootstrap re-ran for a binding it had already done');
});

test('a bootstrap that fails does not latch, so the next request retries', async () => {
  // `ensureXSchema` sets its flag INSIDE the try, after the last statement, and
  // swallows the error. That ordering is the contract: a cold or contended D1
  // must not pin the isolate into "done" with nothing created.
  const cold = makeRecorder({ throwOnExec: true });
  await ensureXSchema(envFor(cold.db));
  assert.equal(cold.statements.length, 0);

  // The same binding, now answering. Nothing latched, so the work happens.
  const warm = makeRecorder();
  Object.assign(cold.db, { exec: warm.db.exec });
  await ensureXSchema(envFor(cold.db));
  assert.ok(warm.statements.length > 0, 'a failed bootstrap latched and never retried');
});

test('projectAccess keys its membership latch on the binding, not on env', async () => {
  // REGRESSION PIN FOR WHAT THE GUARD FOUND. `_membershipReady` was keyed on
  // `env` while its own comment said "keyed per-DB … mirrors routes/projects.ts"
  // — which keys on `env.DB`. Both halves are asserted, because keying on `env`
  // is wrong in both directions: it shares an entry between two bindings that
  // arrive with one env, and it misses entirely when each request brings a new
  // env object.
  const shared = makeRecorder();
  await ensureProjectMembershipSchema(envFor(shared.db));
  const once = shared.statements.length;
  assert.ok(once > 0);

  // A DIFFERENT env object, the same binding → no repeat.
  await ensureProjectMembershipSchema(envFor(shared.db));
  assert.equal(shared.statements.length, once,
    'a fresh env object missed the cache, so the bootstrap re-ran for a database it had already done');

  // The SAME env object shape, a different binding → it must run again.
  const other = makeRecorder();
  await ensureProjectMembershipSchema(envFor(other.db));
  assert.equal(other.statements.length, once,
    'the second database was skipped — the latch is keyed on something other than the binding');
});
