/**
 * The sweep that closes a branch's HQ-support audit rows (D122).
 *
 * WHY THIS IS A REAL SQLITE TEST AND NOT A SOURCE SCAN. The defect being fixed
 * is a date-format defect — an `UPDATE` whose predicate reads correctly and
 * compares two different text shapes — and a SQL-text stub cannot see one. D1
 * IS SQLite, so `node:sqlite` runs the real statement with the real binds and
 * lets the rows decide. That is the same argument `support_session_d120.test.ts`
 * makes, where it caught the ISO-vs-`datetime()` mismatch while the code that
 * became D120 was still being written.
 *
 * THE TABLE COMES FROM THE BASELINE, VERBATIM. `impersonation_sessions` has
 * three identical definitions — migration 156, `schema_baseline.sql`, and the
 * runtime bootstrap in `services/cohortTiming.ts`. Slicing the baseline (the
 * `ddl()` helper this borrows from `admin_impersonation_session.test.ts`) means
 * a fixture that drifts from production fails loudly here rather than passing
 * against a shape nothing runs. `started_at TEXT NOT NULL DEFAULT (datetime('now'))`
 * is the column that makes the arithmetic exact, so a fixture that got its type
 * or default wrong would invalidate every assertion below.
 *
 * ROWS ARE AGED IN THE WRITER'S OWN FORMAT. Every fixture row sets `started_at`
 * with `datetime('now', '-N minutes')` — SQL format, which is what the column's
 * default produces. Writing an ISO string here and then asserting the sweep
 * works would prove nothing except that the test and the fixture agree; that
 * shape is exactly how a mutation escaped on #588.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeExpiredSupportSessions } from '../src/util/supportSessionSweep.ts';
import { SUPPORT_SESSION_MINUTES } from '../src/rpc/branchOps.ts';

const TARGET = 41;
const HQ_ADMIN = 7;

/** Verbatim from the baseline; a literal search, never a built regex. */
const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
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
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

function branchDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(ddl('impersonation_sessions'));
  return db;
}

/**
 * Insert a session aged `agedMinutes` in the ledger, in SQL format — the shape
 * the column's own default writes.
 */
function seed(
  db: InstanceType<typeof DatabaseSync>,
  { adminId, context, agedMinutes, endedAt = null }:
  { adminId: number; context: string; agedMinutes: number; endedAt?: string | null },
): number {
  const r = db.prepare(
    `INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at)
     VALUES (?, ?, ?, datetime('now', '-' || ? || ' minutes'), ?)`,
  ).run(adminId, TARGET, context, agedMinutes, endedAt);
  return Number(r.lastInsertRowid);
}

const SUPPORT_CTX = 'hq_support:T. Okafor|cap table export failure, ticket #4192';
const row = (db: InstanceType<typeof DatabaseSync>, id: number): any =>
  db.prepare('SELECT * FROM impersonation_sessions WHERE id = ?').get(id);

test('a spent support session is stamped, at the instant the token died', async () => {
  const db = branchDb();
  const id = seed(db, { adminId: 0, context: SUPPORT_CTX, agedMinutes: SUPPORT_SESSION_MINUTES + 1 });

  const r = await closeExpiredSupportSessions({ DB: makeD1(db) } as any);
  assert.equal(r.closed, 1);
  assert.equal(r.unreadable, false);

  const after = row(db, id);
  assert.ok(after.ended_at, 'the row was not stamped at all');
  // THE POINT OF THE WHOLE FIX. `ended_at` is `started_at + 30 minutes`, not
  // the moment the sweep happened to run — the session stopped working at its
  // expiry, and an audit row that records when we noticed instead of when it
  // happened is off by however long the cadence is.
  const expected = db.prepare(
    `SELECT datetime(started_at, '+' || ? || ' minutes') AS e FROM impersonation_sessions WHERE id = ?`,
  ).get(SUPPORT_SESSION_MINUTES, id) as any;
  assert.equal(after.ended_at, expected.e, 'ended_at is not the computed expiry');
  // And it is in the column's own format, so the next reader comparing it
  // against datetime('now') gets an answer that means what it reads as.
  assert.match(after.ended_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('a session still inside its window is left alone', async () => {
  const db = branchDb();
  const id = seed(db, { adminId: 0, context: SUPPORT_CTX, agedMinutes: SUPPORT_SESSION_MINUTES - 1 });

  const r = await closeExpiredSupportSessions({ DB: makeD1(db) } as any);
  assert.equal(r.closed, 0);
  assert.equal(row(db, id).ended_at, null, 'a live session was closed early');
});

test('an ordinary impersonation is never touched, because it can be extended', async () => {
  // The reason the sweep is not simply "close anything past thirty minutes".
  // `POST /api/admin/impersonate-sessions/:id/extend` grants a fresh window and
  // writes only an activity_logs row, so for an HQ session `started_at + 30` is
  // not the expiry — stamping it would put a time on the record that is false,
  // which is worse than the null it replaced.
  const db = branchDb();
  const hq = seed(db, { adminId: HQ_ADMIN, context: 'reviewing the cap table export', agedMinutes: 600 });
  // Belt and braces, and each conjunct is load-bearing on its own: a row with a
  // real admin id but a support-shaped context, and a row with admin_user_id 0
  // but an ordinary context, are both out of scope.
  const shapedCtx = seed(db, { adminId: HQ_ADMIN, context: SUPPORT_CTX, agedMinutes: 600 });
  const shapedId = seed(db, { adminId: 0, context: 'reviewing the cap table export', agedMinutes: 600 });

  const r = await closeExpiredSupportSessions({ DB: makeD1(db) } as any);
  assert.equal(r.closed, 0, 'the sweep reached a row that is not a branch support session');
  for (const id of [hq, shapedCtx, shapedId]) {
    assert.equal(row(db, id).ended_at, null, `row ${id} was stamped and should not have been`);
  }
});

test('a session already closed is not re-stamped', async () => {
  const db = branchDb();
  const id = seed(db, {
    adminId: 0, context: SUPPORT_CTX, agedMinutes: 600, endedAt: '2026-09-16 09:00:00',
  });

  const r = await closeExpiredSupportSessions({ DB: makeD1(db) } as any);
  assert.equal(r.closed, 0);
  assert.equal(row(db, id).ended_at, '2026-09-16 09:00:00', 'an existing end time was overwritten');
});

test('sweeping twice closes nothing the second time', async () => {
  // Idempotency is the `ended_at IS NULL` conjunct, not a scheduled_jobs_audit
  // claim — the same shape every other minute-cadence sweep in the handler uses.
  const db = branchDb();
  seed(db, { adminId: 0, context: SUPPORT_CTX, agedMinutes: 90 });

  assert.equal((await closeExpiredSupportSessions({ DB: makeD1(db) } as any)).closed, 1);
  assert.equal((await closeExpiredSupportSessions({ DB: makeD1(db) } as any)).closed, 0);
});

test('HQ reads no live impersonation once the row is closed', async () => {
  // The user-visible claim being fixed. admin_security.ts counts
  // `WHERE ended_at IS NULL` and SecurityPage turns the `Impersonations live`
  // stat red whenever that is non-zero, so before this sweep every branch
  // support session ever opened incremented it permanently.
  const db = branchDb();
  seed(db, { adminId: 0, context: SUPPORT_CTX, agedMinutes: 45 });
  const live = () => (db.prepare(
    'SELECT COUNT(*) AS n FROM impersonation_sessions WHERE ended_at IS NULL',
  ).get() as any).n;

  assert.equal(live(), 1, 'the fixture did not reproduce the reported state');
  await closeExpiredSupportSessions({ DB: makeD1(db) } as any);
  assert.equal(live(), 0);
});

test('a missing table reads as unreadable, not as no sessions', async () => {
  // impersonation_sessions is runtime-bootstrapped as well as migrated, so a
  // deployment can genuinely reach this code before the table exists. Returning
  // a cheerful `closed: 0` would be indistinguishable from a quiet branch —
  // the #204 lesson, one layer up.
  const db = new DatabaseSync(':memory:');
  const r = await closeExpiredSupportSessions({ DB: makeD1(db) } as any);
  assert.equal(r.unreadable, true);
  assert.equal(r.closed, 0);
});
