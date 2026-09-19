/**
 * D168 — HQ could watch a statutory clock and could not stop it.
 *
 * THE DEFECT. `users.deletion_requested_at` was written only by the subject
 * (routes/settings.ts request and cancel), read by
 * `GET /admin/security/overview` against a GDPR Art. 12(3) 30-day clock, and
 * rendered by SecurityPage in amber with an overdue count — while
 * admin_security.ts declared four handlers, none of which could act on one.
 * The only way a row left HQ's list was the subject cancelling.
 *
 * WHY THESE ASSERTIONS RUN THE REAL WRITES RATHER THAN SCANNING FOR THEM.
 * A source scan can show the words `UPDATE users SET deletion_requested_at`
 * are present. It cannot show that a close actually CLEARS the flag, that the
 * derived row carries the ORIGINAL clock rather than a fresh one, that a
 * second request after a denial opens a NEW row instead of being swallowed by
 * the unique index, or that an unreadable ledger reports itself instead of
 * reading as "nobody ever asked" — and those four are the whole claim. So the
 * writes run against a real node:sqlite database built from MIGRATION 271
 * ITSELF, sliced off disk: a hand-written fixture that omitted the CHECK or
 * the partial unique index would be testing a shape production does not have,
 * which is the failure D139 found in the contract fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  HQ_DSR_OUTCOMES,
  isHqDsrOutcome,
  openDsrRequest,
  withdrawDsrRequest,
  closeDsrRequest,
  loadDsrHistory,
  dsrDaysLeft,
  DSR_CLOCK_DAYS,
} from '../src/services/dsrRequests';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const SECURITY = read('cloudflare-worker/src/routes/admin_security.ts');
const SETTINGS = read('cloudflare-worker/src/routes/settings.ts');
const SERVICE = read('cloudflare-worker/src/services/dsrRequests.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/271_dsr_requests.sql');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const d1: any = {
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
    // SEQUENTIALLY, AND THAT IS NOT AN IMPLEMENTATION DETAIL. The close depends
    // on statement 1 (derive the open row) having run before statement 2 closes
    // it. A shim that returned the statements unexecuted — or ran them
    // concurrently — would let a reordering bug pass.
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return d1;
}

/** The real 271, so the CHECK and the partial unique index are the ones that ship. */
function fresh(withLedger = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  // Narrowed to the columns this code path touches, and named as narrowed:
  // `users` is at D1's 100-column cap and reproducing it here would be a
  // second definition of it.
  db.exec(`CREATE TABLE users (
             id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT DEFAULT 'founder',
             is_active INTEGER DEFAULT 1, deletion_requested_at TEXT)`);
  db.exec(`CREATE TABLE activity_logs (
             id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
             user_id INTEGER, created_at TEXT DEFAULT (datetime('now')))`);
  if (withLedger) db.exec(MIGRATION);
  db.exec(`INSERT INTO users (id, email, name) VALUES
             (1, 'subject@example.com', 'A Subject'),
             (2, 'hq@axal.vc', 'HQ Holder'),
             (3, 'other@example.com', 'Another Subject')`);
  return { db, env: { DB: makeD1(db) } as any };
}
/**
 * The close route's OWN text, bounded at both ends.
 *
 * A fixed-width window is what the first draft used and it silently cut the
 * handler in half — the erasure-claim assertion below was reading a slice that
 * stopped mid-sentence, so it failed on correct code. Worse in the other
 * direction: a window too WIDE is satisfied by a neighbouring route, which is
 * the D147/D161/D167 class. So this ends at whichever comes first, the next
 * route registration or the export.
 */
function closeRouteSource(): string {
  const at = SECURITY.indexOf("r.post('/dsr/:userId/close'");
  assert.ok(at > 0, 'the close route is gone');
  const rest = SECURITY.slice(at + 1);
  const ends = [rest.indexOf('\nr.post('), rest.indexOf('\nr.get('), rest.indexOf('\nexport default')]
    .filter((i) => i >= 0);
  assert.ok(ends.length > 0, 'the close route has no end — the bound would run to EOF');
  return rest.slice(0, Math.min(...ends));
}

const requestedAtOf = (db: any, id: number) =>
  (db.prepare('SELECT deletion_requested_at AS t FROM users WHERE id = ?').get(id) as any).t;
const rowsFor = (db: any, id: number) =>
  db.prepare('SELECT * FROM dsr_requests WHERE user_id = ? ORDER BY id').all(id) as any[];

/** What the subject's own request handler does, so the tests start where it leaves off. */
async function subjectRequests(db: any, env: any, id: number, at?: string) {
  db.prepare(
    at
      ? 'UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, ?) WHERE id = ?'
      : "UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, datetime('now')) WHERE id = ?",
  ).run(...(at ? [at, id] : [id]));
  await openDsrRequest(env, id);
}

test('closing as fulfilled records the decision, stops the clock, and tells the subject', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);

  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'fulfilled', reason: 'purged on 2026-09-19, DSR-14' });

  const rows = rowsFor(db, 1);
  assert.equal(rows.length, 1, 'closing must not open a second row');
  assert.equal(rows[0].outcome, 'fulfilled');
  assert.equal(rows[0].closed_by_user_id, 2, 'the operator who closed it is not recorded');
  assert.match(String(rows[0].close_reason), /DSR-14/);
  assert.ok(rows[0].closed_at, 'closed_at is unset, so the record has no date');

  // THE DEFECT, ASSERTED DIRECTLY: before D168 nothing could clear this, so
  // the request stayed on HQ's amber list with its clock running forever.
  assert.equal(requestedAtOf(db, 1), null,
    'the open flag was not cleared — the request is still on HQ\'s list with the clock running');

  // Addressed to the SUBJECT (user_id = 1), which is what routes/activity.ts
  // GET /recent reads for a person's own feed. Written to the operator it
  // would reach nobody who needs it.
  const note = db.prepare(
    "SELECT * FROM activity_logs WHERE action = 'account_deletion_request_closed' AND user_id = 1",
  ).get() as any;
  assert.ok(note, 'the subject is never told the outcome');
  assert.match(String(note.details), /fulfilled/);
});

test('closing as denied is recorded, and the subject can then ask again', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'denied', reason: 'open legal hold, DSR-15' });

  assert.equal(rowsFor(db, 1)[0].outcome, 'denied');
  assert.equal(requestedAtOf(db, 1), null);

  // A SECOND REQUEST AFTER A DENIAL IS A NEW REQUEST WITH A NEW CLOCK. The
  // partial unique index is on OPEN rows only, so this must not be swallowed
  // as a duplicate — a subject refused once keeps the right to ask again, and
  // an index that blocked it would silently remove that right.
  await subjectRequests(db, env, 1);
  const rows = rowsFor(db, 1);
  assert.equal(rows.length, 2, 'a second request after a denial did not open a new row');
  assert.equal(rows.filter((r) => r.outcome === null).length, 1, 'there must be exactly one open row');
});

test('asking twice while one is open is a no-op, not a second clock', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1, '2026-09-01 09:00:00');
  await subjectRequests(db, env, 1, '2026-09-10 09:00:00');

  const rows = rowsFor(db, 1);
  assert.equal(rows.length, 1, 'a second ask while one was open started a second clock');
  assert.equal(rows[0].requested_at, '2026-09-01 09:00:00',
    'the clock moved — the statutory deadline runs from the FIRST receipt');
  assert.equal(requestedAtOf(db, 1), '2026-09-01 09:00:00');
});

test('a request made before migration 271 is derived on close, carrying its ORIGINAL clock', async () => {
  const { db, env } = fresh();
  // The migration-day case: a timestamp on `users`, no ledger row. Nothing is
  // backfilled — the close carries the fact the database already holds, which
  // is what makes it different from the backfill D136 refused.
  db.prepare("UPDATE users SET deletion_requested_at = '2026-08-02 11:30:00' WHERE id = 1").run();
  assert.equal(rowsFor(db, 1).length, 0, 'fixture is wrong: there should be no ledger row yet');

  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'fulfilled', reason: 'legacy request, DSR-09' });

  const rows = rowsFor(db, 1);
  assert.equal(rows.length, 1, 'the close did not derive the missing row, so the decision has no record');
  assert.equal(rows[0].requested_at, '2026-08-02 11:30:00',
    'the derived row reset the clock to now — the statutory deadline ran from August, not from the close');
  assert.equal(rows[0].outcome, 'fulfilled');
  assert.equal(requestedAtOf(db, 1), null);
});

test('a withdrawal is the subject\'s own act and names no operator', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  await withdrawDsrRequest(env, 1);

  const row = rowsFor(db, 1)[0];
  assert.equal(row.outcome, 'withdrawn');
  assert.equal(row.closed_by_user_id, null,
    'a withdrawal named an operator, which records an act nobody performed');
  // And HQ may not write it: the whole point of the split.
  assert.equal(isHqDsrOutcome('withdrawn'), false);
  assert.deepEqual([...HQ_DSR_OUTCOMES], ['fulfilled', 'denied']);
});

test('the history reports how often each subject asked — and its own failure', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1, '2026-07-01 09:00:00');
  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'denied', reason: 'first refusal' });
  await subjectRequests(db, env, 1, '2026-08-01 09:00:00');
  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'fulfilled', reason: 'second, granted' });

  const h = await loadDsrHistory(env);
  assert.equal(h.available, true);
  if (!h.available) return;
  assert.equal(h.byUser.get(1)?.prior, 2, 'the count of earlier requests is wrong');
  // The LAST outcome, not an arbitrary one — SQLite's min/max bare-column rule.
  assert.equal(h.byUser.get(1)?.outcome, 'fulfilled',
    'the outcome reported is not the one from the most recent close');
  assert.equal(h.byUser.get(3), undefined, 'a subject who never asked must not appear');
});

test('an UNREADABLE ledger says so — it does not report that nobody ever asked', async () => {
  // #204's lesson, on a screen where it changes a decision: a third request
  // read as a first is a different judgement from a third read as a third.
  const { env } = fresh(false); // migration 271 not applied
  const h = await loadDsrHistory(env);
  assert.equal(h.available, false, 'a missing ledger read as an empty one');
  if (h.available) return;
  assert.match(h.reason, /not zero/i, 'the reason does not say the counts are unknown rather than zero');
  assert.match(h.reason, /271/, 'the reason does not name the migration that creates the table');
});

test('NOTHING moves when the ledger cannot be written', async () => {
  // Clearing the flag with no record is strictly worse than failing: the
  // request would vanish from HQ's list with nothing saying what was decided.
  const { db, env } = fresh(false);
  db.prepare("UPDATE users SET deletion_requested_at = '2026-08-02 11:30:00' WHERE id = 1").run();

  await assert.rejects(
    () => closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'denied', reason: 'should not land' }),
    'the close succeeded against a database with no ledger',
  );
  assert.equal(requestedAtOf(db, 1), '2026-08-02 11:30:00',
    'the open flag was cleared even though the record could not be written');
});

test('the route is behind the write bar, and its audit row names the subject', () => {
  const handler = closeRouteSource();

  // The same bar as force-reauth: TOTP, a recent step-up, then the elevation.
  assert.match(handler, /requireSuperAdminWriteBar\(c\)/,
    'the close route no longer runs behind the super-admin write bar');
  assert.match(handler, /code: 'reason_required'/, 'the reason floor is gone');
  assert.match(handler, /code: 'user_not_found'/, 'an absent target is no longer refused');
  assert.match(handler, /code: 'no_open_request'/, 'closing a request that is not open is no longer refused');

  // D159's rule: `target_user_id` is the key logAdminAction reads for
  // `viewed_user_id`. Spelt `user_id` the governance feed shows a blank Target
  // against a statutory act.
  assert.match(handler, /target_user_id: uid/,
    'the audit row no longer names the subject — the governance feed would show a blank Target');
});

test('"fulfilled" never claims the platform deleted anything', () => {
  // The one thing this PR must not imply. There is no erasure path anywhere in
  // the codebase, so an outcome or a message that read as a deletion would be
  // a false statement in a compliance record.
  const handler = closeRouteSource();
  assert.match(handler, /does not itself erase anything|records that the manual act/i,
    'the fulfilled response no longer says the platform erases nothing');
  assert.match(SERVICE, /decision record/i,
    'the service no longer states that an outcome is a decision record rather than a deletion');
});

test('the member\'s own two handlers write the ledger, best-effort', () => {
  // Best-effort is the point: a member must be able to request and to cancel
  // whatever state HQ's ledger is in, so neither may throw into their path.
  for (const [fn, label] of [['openDsrRequest', 'request'], ['withdrawDsrRequest', 'cancel']] as const) {
    const at = SETTINGS.indexOf(`await ${fn}(c.env, user.id)`);
    assert.ok(at > 0, `the ${label} handler no longer writes the ledger`);
    const around = SETTINGS.slice(Math.max(0, at - 200), at + 200);
    assert.match(around, /try \{/, `the ${label} handler's ledger write is not best-effort`);
    assert.match(around, /catch/, `the ${label} handler's ledger write has no catch`);
  }
});

test('migration 271 enforces one OPEN request per subject, and admits three outcomes', () => {
  // The partial index is what makes "ask twice" a no-op rather than a rule the
  // handlers each have to remember, and the CHECK is wider than what HQ may
  // write on purpose.
  assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS uq_dsr_requests_open[\s\S]{0,120}WHERE outcome IS NULL/,
    'the one-open-request-per-subject index is gone');
  assert.match(MIGRATION, /'fulfilled', 'denied', 'withdrawn'/, 'the outcome CHECK changed');
  assert.doesNotMatch(MIGRATION, /BEGIN;|COMMIT;/, 'D1 rejects transaction statements in a migration (#26)');
});

test('the statutory clock counts DOWN from receipt, and an unknown stamp is not zero', () => {
  // THIS ARITHMETIC HAD NEVER BEEN TESTED. It has driven the amber zone, the
  // red "Nd overdue" and the "inside deadline pressure" headline since the
  // Security page shipped. Inverting the subtraction turns every overdue
  // request into one with weeks left — on the one screen where that is a
  // compliance failure rather than a wrong number.
  const day = 86400000;
  const now = Date.parse('2026-09-19T12:00:00Z');

  assert.equal(dsrDaysLeft(now, now), 30, 'a request made today does not have the full window');
  assert.equal(dsrDaysLeft(now - 10 * day, now), 20);
  assert.equal(dsrDaysLeft(now - 30 * day, now), 0, 'the deadline day itself must read 0, not 1 or -1');
  assert.equal(dsrDaysLeft(now - 44 * day, now), -14, 'an overdue request must count NEGATIVE, not stop at 0');

  // The 14-day amber threshold the page reads (`days_left <= 14`), pinned from
  // BOTH SIDES OF ITS ACTUAL EDGE. The first draft of this put the edge a day
  // out — 15 days elapsed leaves 15, which is outside; 16 elapsed leaves 14,
  // which is inside. A one-sided assertion would not have caught that, and
  // getting the boundary wrong here is the whole failure mode.
  assert.equal(dsrDaysLeft(now - 15 * day, now), 15, 'the boundary moved');
  assert.ok(dsrDaysLeft(now - 15 * day, now)! > 14, '15 days in is not yet inside deadline pressure');
  assert.ok(dsrDaysLeft(now - 16 * day, now)! <= 14, '16 days in must be inside deadline pressure');

  // null, never 0 — an unknown clock is not a clock at its deadline.
  assert.equal(dsrDaysLeft(NaN, now), null);
  assert.equal(dsrDaysLeft(dsrParseFixture('not a date'), now), null);
});

/** Mirrors admin_security.ts's `parseSqlTs` so the null path is reached the same way. */
function dsrParseFixture(s: string): number {
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
}

test('the clock constant is defined once, and the route reads it from there', () => {
  assert.equal(DSR_CLOCK_DAYS, 30);
  // A second copy in the route is how the payload's `clock_days` and the
  // arithmetic behind `days_left` come to disagree.
  assert.doesNotMatch(SECURITY, /const DSR_CLOCK_DAYS\s*=/,
    'DSR_CLOCK_DAYS is declared in the route again — one of the two copies will drift');
  assert.match(SECURITY, /dsrDaysLeft\(parseSqlTs\(u\.deletion_requested_at\), now\)/,
    'the route no longer computes days_left through the tested helper');
});
