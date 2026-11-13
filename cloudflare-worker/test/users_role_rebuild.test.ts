/**
 * Task #7 — a member account upgrade must never silently wipe profile/billing data.
 *
 * `rebuildUsersRoleCheckForInvestor` (extracted from ensureInvestorSchema) rebuilds
 * the `users` table to relax the legacy role CHECK so 'investor' is accepted. The
 * original hardcoded-14-column version would have destroyed founder/investor/
 * subscription/PII/LinkedIn data and every index the first time it committed. This
 * pins the loss-free contract so a future edit can't silently reintroduce it.
 *
 * Uses a REAL in-memory SQLite (node:sqlite) so DROP/CREATE, CHECK constraints,
 * sqlite_master DDL and index replay behave exactly as in prod — a stub can't
 * prove a row/column/index actually survives a table rebuild. Most tests run
 * with FK enforcement OFF and assert data-level reference continuity (child
 * rows still JOIN back to the same parent ids); D1 DOES enforce foreign keys
 * (a prod rebuild died at commit with "FOREIGN KEY constraint failed"), so the
 * dedicated D1-parity test below runs with enableForeignKeyConstraints: true
 * to pin the deferred-FK behavior of the batch.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/users_role_rebuild.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  rebuildUsersRoleCheckForInvestor,
  rebuildUsersRoleCheckForAdvisor,
  rebuildUsersRoleCheckForExploring,
} from '../src/util/usersRoleRebuild.ts';

function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/**
 * Minimal D1-shaped adapter over node:sqlite. Unlike the no-op batch() in some
 * other tests, this batch() actually runs every statement inside ONE explicit
 * transaction (BEGIN/COMMIT, ROLLBACK on error), mirroring D1's implicit
 * single-transaction batch — required so `PRAGMA defer_foreign_keys = TRUE`
 * (the first statement) actually defers FK checks to commit.
 */
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const prepare = (sql: string) => {
    const api: any = {
      _sql: sql,
      _binds: [] as any[],
      bind(...a: any[]) { api._binds = coerce(a); return api; },
      async first<T = any>(): Promise<T | null> {
        return (db.prepare(sql).get(...api._binds) as T) ?? null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        return { results: db.prepare(sql).all(...api._binds) as T[] };
      },
      async run() {
        const r = db.prepare(sql).run(...api._binds);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((st) => {
          const r = db.prepare(st._sql).run(...(st._binds || []));
          return { meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/**
 * Seed a legacy-shaped DB: users with the OLD role CHECK (no 'investor'), extra
 * columns well beyond any 14-column base set (PII / billing / linkedin), a child
 * table with FK rows, and several user-defined indexes.
 */
function seedLegacy(opts: { enforceFKs?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: opts.enforceFKs === true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'founder' CHECK (role IN ('admin', 'founder', 'partner')),
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      -- "extra" columns beyond the legacy 14-col snapshot the old rebuild used:
      linkedin_url TEXT,
      linkedin_id TEXT,
      public_id TEXT,
      stripe_customer_id TEXT,
      subscription_tier TEXT,
      subscription_status TEXT,
      phone TEXT,
      avatar_url TEXT,
      investor_id INTEGER
    );
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_users_role ON users(role);
    CREATE INDEX idx_users_stripe ON users(stripe_customer_id);
    CREATE TABLE founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bio TEXT
    );
    CREATE TABLE limited_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      email TEXT
    );
  `);
  // Populate users + child FK rows with meaningful PII/billing values.
  db.exec(`
    INSERT INTO users (id, email, name, role, linkedin_url, public_id, stripe_customer_id, subscription_tier, subscription_status, phone)
    VALUES
      (1, 'founder@x.com', 'Fay Founder', 'founder', 'https://lnkd.in/fay', 'pub_fay', 'cus_fay', 'pro', 'active', '+1555'),
      (2, 'partner@x.com', 'Pat Partner', 'partner', 'https://lnkd.in/pat', 'pub_pat', 'cus_pat', 'enterprise', 'active', '+1666'),
      (3, 'admin@x.com',  'Ada Admin',   'admin',   NULL,                  'pub_ada', NULL,      NULL,        NULL,     NULL);
    INSERT INTO founders (id, user_id, bio) VALUES (10, 1, 'building things');
    INSERT INTO limited_partners (id, user_id, email) VALUES (20, 2, 'partner@x.com');
  `);
  return db;
}

/**
 * Prod regression (role-change 500): a VIEW over `users` (prod has
 * `partner_summary`) made `ALTER TABLE users_new RENAME TO users` fail with
 * "error in view partner_summary: no such table: main.users", rolling the
 * whole rebuild back — so the legacy CHECK survived every deploy and any
 * role change to investor/advisor/exploring 500'd at the UPDATE. Mirror that
 * shape here.
 */
function seedLegacyWithView(opts: { enforceFKs?: boolean } = {}) {
  const db = seedLegacy(opts);
  db.exec(`
    CREATE VIEW partner_summary AS
      SELECT u.id, u.email, u.name, u.role,
        (SELECT COUNT(*) FROM limited_partners lp WHERE lp.user_id = u.id) AS lp_count
      FROM users u WHERE u.role = 'partner';
    CREATE VIEW partner_summary_top AS
      SELECT * FROM partner_summary WHERE lp_count > 0;
  `);
  return db;
}

function colNames(db: InstanceType<typeof DatabaseSync>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(r => r.name);
}
function indexNames(db: InstanceType<typeof DatabaseSync>): string[] {
  return (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL"
  ).all() as { name: string }[]).map(r => r.name);
}

test('rebuild relaxes the role CHECK to accept investor WITHOUT losing any data, column, index, or FK', async () => {
  const db = seedLegacy();
  const env: any = { DB: makeD1(db) };

  const beforeCols = colNames(db, 'users').sort();
  const beforeIdx = indexNames(db).sort();
  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();

  const r = await rebuildUsersRoleCheckForInvestor(env);
  assert.equal(r.rebuilt, true, 'a legacy CHECK without investor must trigger a rebuild');

  // Every column survives.
  assert.deepEqual(colNames(db, 'users').sort(), beforeCols, 'no column may be dropped');
  // Every user-defined index survives.
  assert.deepEqual(indexNames(db).sort(), beforeIdx, 'every user index must be replayed');

  // Every row + every value survives, ids unchanged.
  const afterUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.deepEqual(afterUsers, beforeUsers, 'all rows, ids and PII/billing values must be identical');

  // Child FK references still resolve (founders + limited_partners join cleanly).
  const founderJoin = db.prepare(
    'SELECT u.email FROM founders f JOIN users u ON u.id = f.user_id WHERE f.id = 10'
  ).get() as { email: string };
  assert.equal(founderJoin.email, 'founder@x.com', 'founder FK must still resolve to the same user');
  const lpJoin = db.prepare(
    'SELECT u.name FROM limited_partners lp JOIN users u ON u.id = lp.user_id WHERE lp.id = 20'
  ).get() as { name: string };
  assert.equal(lpJoin.name, 'Pat Partner', 'limited_partner FK must still resolve to the same user');

  // The rebuilt table DDL itself must carry the relaxed CHECK — lock the exact
  // migration intent so a future change can't make the outcome pass by accident.
  const rebuiltDdl = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).get() as { sql: string }).sql;
  assert.match(rebuiltDdl, /CHECK/i, 'the role CHECK constraint must be preserved');
  assert.match(rebuiltDdl, /'investor'/, "the rebuilt CHECK must now include 'investor'");
  assert.match(rebuiltDdl, /'partner'/, "the rebuilt CHECK must still include the prior roles");

  // 'investor' is now an accepted role value (the whole point of the rebuild).
  db.prepare("UPDATE users SET role = 'investor' WHERE id = 2").run();
  const promoted = db.prepare('SELECT role FROM users WHERE id = 2').get() as { role: string };
  assert.equal(promoted.role, 'investor');

  // ...and the OLD invalid values are still rejected by the (preserved) CHECK.
  assert.throws(
    () => db.prepare("UPDATE users SET role = 'banana' WHERE id = 1").run(),
    /CHECK|constraint/i,
    'the CHECK must still reject roles outside the allowed set',
  );
});

test('rebuild is a no-op on a DB whose role CHECK already accepts investor', async () => {
  const db = seedLegacy();
  const env: any = { DB: makeD1(db) };

  // First run rebuilds.
  const first = await rebuildUsersRoleCheckForInvestor(env);
  assert.equal(first.rebuilt, true);

  // Second run must detect needsRebuild=false and do nothing.
  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  const second = await rebuildUsersRoleCheckForInvestor(env);
  assert.equal(second.rebuilt, false, 'second run must be a no-op once investor is accepted');
  const afterUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.deepEqual(afterUsers, beforeUsers, 'a no-op run must not touch any data');
});

test('rebuild relaxes the role CHECK to accept advisor WITHOUT losing any data, column, index, or FK', async () => {
  const db = seedLegacy();
  const env: any = { DB: makeD1(db) };

  const beforeCols = colNames(db, 'users').sort();
  const beforeIdx = indexNames(db).sort();
  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();

  const r = await rebuildUsersRoleCheckForAdvisor(env);
  assert.equal(r.rebuilt, true, 'a legacy CHECK without advisor must trigger a rebuild');

  // Every column survives.
  assert.deepEqual(colNames(db, 'users').sort(), beforeCols, 'no column may be dropped');
  // Every user-defined index survives.
  assert.deepEqual(indexNames(db).sort(), beforeIdx, 'every user index must be replayed');

  // Every row + every value survives, ids unchanged.
  const afterUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.deepEqual(afterUsers, beforeUsers, 'all rows, ids and PII/billing values must be identical');

  // Child FK references still resolve (founders + limited_partners join cleanly).
  const founderJoin = db.prepare(
    'SELECT u.email FROM founders f JOIN users u ON u.id = f.user_id WHERE f.id = 10'
  ).get() as { email: string };
  assert.equal(founderJoin.email, 'founder@x.com', 'founder FK must still resolve to the same user');
  const lpJoin = db.prepare(
    'SELECT u.name FROM limited_partners lp JOIN users u ON u.id = lp.user_id WHERE lp.id = 20'
  ).get() as { name: string };
  assert.equal(lpJoin.name, 'Pat Partner', 'limited_partner FK must still resolve to the same user');

  // The rebuilt table DDL itself must carry the relaxed CHECK — lock the exact
  // migration intent so a future change can't make the outcome pass by accident.
  const rebuiltDdl = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).get() as { sql: string }).sql;
  assert.match(rebuiltDdl, /CHECK/i, 'the role CHECK constraint must be preserved');
  assert.match(rebuiltDdl, /'advisor'/, "the rebuilt CHECK must now include 'advisor'");
  assert.match(rebuiltDdl, /'partner'/, "the rebuilt CHECK must still include the prior roles");

  // 'advisor' is now an accepted role value (the whole point of the rebuild).
  db.prepare("UPDATE users SET role = 'advisor' WHERE id = 2").run();
  const promoted = db.prepare('SELECT role FROM users WHERE id = 2').get() as { role: string };
  assert.equal(promoted.role, 'advisor');

  // ...and the OLD invalid values are still rejected by the (preserved) CHECK.
  assert.throws(
    () => db.prepare("UPDATE users SET role = 'banana' WHERE id = 1").run(),
    /CHECK|constraint/i,
    'the CHECK must still reject roles outside the allowed set',
  );
});

test('advisor rebuild is a no-op on a DB whose role CHECK already accepts advisor', async () => {
  const db = seedLegacy();
  const env: any = { DB: makeD1(db) };

  // First run rebuilds.
  const first = await rebuildUsersRoleCheckForAdvisor(env);
  assert.equal(first.rebuilt, true);

  // Second run must detect needsRebuild=false and do nothing.
  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  const second = await rebuildUsersRoleCheckForAdvisor(env);
  assert.equal(second.rebuilt, false, 'second run must be a no-op once advisor is accepted');
  const afterUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.deepEqual(afterUsers, beforeUsers, 'a no-op run must not touch any data');
});

test('rebuild succeeds with views over users — views survive byte-identical and still work (prod partner_summary regression)', async () => {
  const db = seedLegacyWithView();
  const env: any = { DB: makeD1(db) };

  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  const beforeViews = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name"
  ).all();
  const beforeSummary = db.prepare('SELECT * FROM partner_summary ORDER BY id').all();

  // This is the exact call that failed on prod with
  // "error in view partner_summary: no such table: main.users".
  const r = await rebuildUsersRoleCheckForExploring(env);
  assert.equal(r.rebuilt, true, 'the rebuild must not be aborted by views over users');

  // The CHECK now admits 'exploring'.
  const rebuiltDdl = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).get() as { sql: string }).sql;
  assert.match(rebuiltDdl, /'exploring'/, "the rebuilt CHECK must now include 'exploring'");
  db.prepare("UPDATE users SET role = 'exploring' WHERE id = 2").run();
  assert.equal((db.prepare('SELECT role FROM users WHERE id = 2').get() as { role: string }).role, 'exploring');
  db.prepare("UPDATE users SET role = 'partner' WHERE id = 2").run();

  // No data lost.
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), beforeUsers);

  // Views survive with byte-identical DDL (including the view-on-view chain)…
  const afterViews = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name"
  ).all();
  assert.deepEqual(afterViews, beforeViews, 'every view must be replayed byte-identical');

  // …and still SELECT correctly against the rebuilt table.
  assert.deepEqual(db.prepare('SELECT * FROM partner_summary ORDER BY id').all(), beforeSummary);
  db.prepare('SELECT * FROM partner_summary_top').all(); // view-on-view still parses + runs
});

test('rebuild succeeds with FK enforcement ON (D1 parity) — deferred violations resolved by the copy-back', async () => {
  // D1 DOES enforce foreign keys (the second prod failure was
  // "FOREIGN KEY constraint failed ... D1 DB was reset and rolled back"):
  // DROP TABLE users implicitly deletes every row, and each child row
  // (founders/limited_partners) becomes a deferred violation that only an
  // INSERT into a table literally named `users` can resolve before commit.
  // This test runs with enableForeignKeyConstraints: true so that exact
  // failure mode is reproduced locally — the old copy-into-users_new-then-
  // RENAME sequence fails this test; the snapshot → recreate → copy-back
  // sequence passes it.
  const db = seedLegacyWithView({ enforceFKs: true });
  const env: any = { DB: makeD1(db) };

  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();

  const r = await rebuildUsersRoleCheckForExploring(env);
  assert.equal(r.rebuilt, true, 'the rebuild must commit with FK enforcement on');

  // No data lost, ids unchanged, child FKs still resolve.
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), beforeUsers);
  const founderJoin = db.prepare(
    'SELECT u.email FROM founders f JOIN users u ON u.id = f.user_id WHERE f.id = 10'
  ).get() as { email: string };
  assert.equal(founderJoin.email, 'founder@x.com');

  // The temp snapshot table must not survive the rebuild.
  const tmp = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users_rebuild_tmp'"
  ).get();
  assert.equal(tmp, undefined, 'the temp snapshot table must be dropped');

  // The CHECK now admits 'exploring' and FK enforcement still works.
  db.prepare("UPDATE users SET role = 'exploring' WHERE id = 2").run();
  assert.equal((db.prepare('SELECT role FROM users WHERE id = 2').get() as { role: string }).role, 'exploring');
  assert.throws(
    () => db.prepare("INSERT INTO founders (user_id, bio) VALUES (999999, 'orphan')").run(),
    /FOREIGN KEY|constraint/i,
    'FK enforcement must still reject orphan child rows after the rebuild',
  );
});

test('advisor and investor rebuilds compose — both roles accepted, still loss-free', async () => {
  const db = seedLegacy();
  const env: any = { DB: makeD1(db) };

  const beforeUsers = db.prepare('SELECT * FROM users ORDER BY id').all();

  // Apply the investor rebuild first, then the advisor rebuild on top.
  assert.equal((await rebuildUsersRoleCheckForInvestor(env)).rebuilt, true);
  assert.equal((await rebuildUsersRoleCheckForAdvisor(env)).rebuilt, true);

  const rebuiltDdl = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).get() as { sql: string }).sql;
  assert.match(rebuiltDdl, /'advisor'/, "composed CHECK must include 'advisor'");
  assert.match(rebuiltDdl, /'investor'/, "composed CHECK must still include 'investor'");
  assert.match(rebuiltDdl, /'partner'/, "composed CHECK must still include 'partner'");

  // No data lost across two consecutive rebuilds.
  const afterUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.deepEqual(afterUsers, beforeUsers, 'two consecutive rebuilds must not touch any data');

  // Both new role values are now accepted.
  db.prepare("UPDATE users SET role = 'advisor' WHERE id = 1").run();
  db.prepare("UPDATE users SET role = 'investor' WHERE id = 2").run();
  const roles = db.prepare('SELECT role FROM users WHERE id IN (1,2) ORDER BY id').all() as { role: string }[];
  assert.deepEqual(roles.map(r => r.role), ['advisor', 'investor']);
});
