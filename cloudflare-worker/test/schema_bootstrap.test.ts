/**
 * A FULL `users` TABLE MUST NOT 500 THE ROUTES THAT ONLY READ IT.
 *
 * `users` is at D1's hard 100-column limit (production, 2026-09-04:
 * `max(cid) + 1 = 100`). On a table at that limit SQLite reports
 *
 *     too many columns on sqlite_altertab_users
 *
 * for an `ALTER TABLE … ADD COLUMN` — and it reports it for a column that
 * ALREADY EXISTS just as much as for a new one, because `sqlite3AddColumn()`
 * enforces the column-count limit before it tests the name for a duplicate.
 * Verified against sqlite 3.45.1 with SQLITE_LIMIT_COLUMN set to 100: both
 * "brand_new" and an existing "c5" come back with the same message.
 *
 * That single fact broke two routers. `ensureInvestorPaywallSchema` and
 * `ensureTierSchema` were written to skip `duplicate column` and rethrow
 * everything else — correct while the table had room, and fatal once it
 * filled. `ensureInvestorPaywallSchema` runs from `introductions.use('*')`,
 * so EVERY `/api/introductions/*` request threw before reaching a handler:
 * the founder Network Introductions zone's "Internal server error", the
 * investor quota, credits, packs, accept and decline, all of them, for every
 * role. And because the throw happens before the `_migrated` flag is set, it
 * repeated on every request for the life of every isolate. `intro_propositions`
 * and `intro_credit_ledger` are both still empty in production, which is what
 * a read path that never ran looks like.
 *
 * These guards pin the fix: ask the table what it has before altering it, and
 * never dress a genuinely missing column up as success.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/schema_bootstrap.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runSchemaBootstrap, tableColumns } from '../src/util/schemaBootstrap.ts';

const CAP = (t = 'users') => `too many columns on sqlite_altertab_${t}`;

/**
 * A D1 stand-in. `columns` is what `pragma_table_info` reports; `fail` decides
 * what a statement throws. Every statement prepared is recorded, which is how
 * "skipped entirely" is asserted rather than assumed.
 */
function fakeDb(columns: Record<string, string[]>, fail: (sql: string) => string | null = () => null) {
  const ran: string[] = [];
  const pragmas: string[] = [];
  const DB = {
    prepare(sql: string) {
      const stmt = {
        _binds: [] as unknown[],
        bind(...a: unknown[]) { stmt._binds = a; return stmt; },
        async all() {
          if (/pragma_table_info/i.test(sql)) {
            const table = String(stmt._binds[0]);
            pragmas.push(table);
            return { results: (columns[table] || []).map((name) => ({ name })) };
          }
          ran.push(sql);
          const e = fail(sql);
          if (e) throw new Error(e);
          return { results: [] };
        },
        async run() {
          ran.push(sql);
          const e = fail(sql);
          if (e) throw new Error(e);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB } as any, ran, pragmas };
}

test('an ADD COLUMN whose column already exists is never sent', async () => {
  // The whole bug in one assertion. In production all eleven investor_*
  // columns are present, so the correct number of ALTERs to attempt is zero —
  // and an ALTER that is never attempted cannot raise the cap error.
  const { env, ran } = fakeDb({ users: ['id', 'investor_tier'] }, () => CAP());
  await runSchemaBootstrap(env, [
    `ALTER TABLE users ADD COLUMN investor_tier TEXT NOT NULL DEFAULT 'free'`,
  ]);
  assert.deepEqual(ran, [], 'nothing should reach the database');
});

test('an ADD COLUMN whose column is missing is still attempted', async () => {
  // The other half: skipping must be driven by the table, not by blanket
  // avoidance, or a cold database would never get its columns.
  const { env, ran } = fakeDb({ users: ['id'] });
  await runSchemaBootstrap(env, ['ALTER TABLE users ADD COLUMN fresh TEXT']);
  assert.equal(ran.length, 1);
  assert.match(ran[0], /ADD COLUMN fresh/);
});

test('a missing column on a full table throws, and says what to do instead', async () => {
  // This case must NOT be swallowed: the code after the bootstrap would read a
  // column that does not exist, and a quiet return would hand it a wrong
  // answer. It fails — but with the remedy, not the raw SQLite string.
  const { env } = fakeDb({ users: ['id'] }, () => CAP());
  await assert.rejects(
    () => runSchemaBootstrap(env, ['ALTER TABLE users ADD COLUMN fresh TEXT']),
    (e: Error) => {
      assert.match(e.message, /users\.fresh cannot be added/);
      assert.match(e.message, /100-column limit/);
      assert.match(e.message, /side table keyed by user_id/);
      assert.match(e.message, /super_admins/, 'name a real precedent, not an abstraction');
      return true;
    },
  );
});

test('a duplicate-column race is tolerated — another isolate got there first', async () => {
  // The read and the write are not atomic. Two cold isolates can both see the
  // column missing; the loser must not fail the request.
  const { env } = fakeDb({ users: ['id'] }, () => 'duplicate column name: fresh');
  await runSchemaBootstrap(env, ['ALTER TABLE users ADD COLUMN fresh TEXT']);
});

test('a failure that is neither of those is still a failure', async () => {
  // The point of the change is to stop misreading ONE error, not to stop
  // reporting errors.
  const { env } = fakeDb({ users: ['id'] }, () => 'no such table: users');
  await assert.rejects(() => runSchemaBootstrap(env, ['ALTER TABLE users ADD COLUMN fresh TEXT']),
    /no such table/);
});

test('CREATE statements always run, whatever the ALTERs did', async () => {
  // partnernet's real defect: its ALTER loop RETURNED on a non-duplicate
  // failure, abandoning the CREATE TABLEs for partner_relationships and
  // relationship_events that came after it — and never setting its migrated
  // flag, so it re-ran the same doomed statements on every request.
  const { env, ran } = fakeDb(
    { users: ['id', 'kyc_status'] },
    // Only an ALTER can hit the column cap; a CREATE is unaffected by it.
    (sql) => (/ALTER TABLE/i.test(sql) ? CAP() : null),
  );
  await runSchemaBootstrap(env, [
    `ALTER TABLE users ADD COLUMN kyc_status TEXT`,
    `CREATE TABLE IF NOT EXISTS partner_relationships (id INTEGER PRIMARY KEY)`,
  ]);
  assert.equal(ran.length, 1);
  assert.match(ran[0], /CREATE TABLE IF NOT EXISTS partner_relationships/);
});

test('the column read happens once per binding, not once per statement', async () => {
  // A bootstrap of eleven ALTERs must not cost eleven pragma round trips, and
  // a second bootstrap on the same isolate must cost none.
  const { env, pragmas } = fakeDb({ users: ['id', 'a', 'b', 'c'] });
  const alters = ['a', 'b', 'c'].map((n) => `ALTER TABLE users ADD COLUMN ${n} TEXT`);
  await runSchemaBootstrap(env, alters);
  await runSchemaBootstrap(env, alters);
  assert.deepEqual(pragmas, ['users']);
});

test('a cold pragma read is not cached, so the next call retries', async () => {
  // Caching an empty answer from a database that could not answer would make
  // every later ALTER look necessary forever.
  const columns: Record<string, string[]> = {};
  const { env, pragmas } = fakeDb(columns);
  assert.equal((await tableColumns(env, 'nothing_here')).size, 0);
  columns.nothing_here = ['id'];
  assert.equal((await tableColumns(env, 'nothing_here')).size, 1);
  assert.deepEqual(pragmas, ['nothing_here', 'nothing_here']);
});

test('the two bootstraps that used to rethrow now go through the helper', async () => {
  // The class guard. Both of these are mounted where a throw is fatal —
  // `ensureInvestorPaywallSchema` from `introductions.use('*')`, and
  // `ensureTierSchema` at the top of six payments handlers — so a hand-rolled
  // loop reappearing here is the outage coming back.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  for (const p of [
    'cloudflare-worker/src/middleware/requireInvestorTier.ts',
    'cloudflare-worker/src/middleware/requireTier.ts',
    'cloudflare-worker/src/routes/partnernet.ts',
  ]) {
    const src = read(p);
    assert.match(src, /runSchemaBootstrap\(env, /, `${p} must use the shared bootstrap`);
    assert.doesNotMatch(
      src,
      /if \(!\/duplicate column\/i\.test\(msg\)\) throw e;/,
      `${p} must not rethrow every non-duplicate error again`,
    );
  }
});
