/**
 * D4675 (#4675) — the data-subject request lifecycle under concurrency,
 * retry and interruption, and the deadline arithmetic at calendar edges.
 *
 * Run against real SQLite through `d1Over`, whose batch is one transaction
 * like D1's (a failed statement rolls the whole batch back), with migration
 * 272 and the close-key migration read off disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import {
  closeDsrRequest, requestErasure, cancelErasure, loadOpenDsrRequestIds,
  dsrDaysLeft, dsrDeadlineIso, dsrDeadlineMs, dsrOverdue, dsrStampMs, DSR_CLOCK_RULE, DSR_CLOSE_KEY_RE,
} from '../src/services/dsrRequests';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const M272 = read('cloudflare-worker/sql/migrations/272_dsr_requests.sql');
const MKEY = read('cloudflare-worker/sql/migrations/202611072219_dsr_close_key.sql');

const SUBJECT = 1, HQ_A = 2, HQ_B = 3;

function fresh(withLedger = true) {
  const db = new DatabaseSync(':memory:');
  // Narrowed to the columns these paths touch; `users` is at D1's column cap.
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, deletion_requested_at TEXT)`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
             user_id INTEGER, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL,
             action TEXT NOT NULL, viewed_user_id INTEGER, filters_json TEXT, exported_at TEXT DEFAULT (datetime('now')))`);
  if (withLedger) { db.exec(M272); db.exec(MKEY); }
  db.exec(`INSERT INTO users (id, email, name) VALUES (1, 'subject@example.test', 'A Subject'),
             (2, 'hq-a@example.test', 'HQ A'), (3, 'hq-b@example.test', 'HQ B')`);
  return { db, env: { DB: d1Over(db) } as any };
}

const flagOf = (db: any) => (db.prepare('SELECT deletion_requested_at AS t FROM users WHERE id = 1').get() as any).t;
const ledger = (db: any) => db.prepare('SELECT * FROM dsr_requests WHERE user_id = 1 ORDER BY id').all() as any[];
const notices = (db: any) => (db.prepare(
  "SELECT details FROM activity_logs WHERE action = 'account_deletion_request_closed' AND user_id = 1",
).all() as any[]).map((r) => r.details as string);
const audits = (db: any) => db.prepare("SELECT * FROM admin_audit_log WHERE action = 'dsr_request_closed'").all() as any[];
const actorRows = (db: any) => db.prepare("SELECT * FROM activity_logs WHERE action = 'dsr_request_closed'").all() as any[];

/** The subject asks at a fixed receipt stamp, through the real request path. */
async function asksAt(db: any, env: any, at: string) {
  db.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = 1 AND deletion_requested_at IS NULL').run(at);
  await requestErasure(env, SUBJECT);
}

/** What HQ's list shows for the subject: the stamp and the ledger row a close names. */
async function reviewed(env: any, db: any) {
  const open = (await loadOpenDsrRequestIds(env))?.get(SUBJECT);
  const flag = flagOf(db);
  return { requestedAt: flag, requestId: open && open.requested_at === flag ? open.id : null };
}

let seq = 0;
const key = () => `k4675-${String(++seq).padStart(12, '0')}`;
const close = (env: any, actor: number, outcome: 'fulfilled' | 'denied', review: { requestedAt: string; requestId: number | null }, closeKey = key()) =>
  closeDsrRequest(env, {
    userId: SUBJECT, actorUserId: actor, actorEmail: `hq-${actor}@example.test`, outcome,
    reason: `reason from operator ${actor}`, ...review, closeKey,
  });

// ------------------------------------------------------------ the exact request

test('a close lands on the reviewed request, with its notice and BOTH audit rows in the same unit', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const r = await close(env, HQ_A, 'denied', await reviewed(env, db));
  assert.equal(r.status, 'closed');
  assert.equal(r.status === 'closed' && r.replayed, false);
  assert.equal(ledger(db)[0].outcome, 'denied');
  assert.equal(flagOf(db), null);
  assert.equal(notices(db).length, 1);
  assert.equal(audits(db).length, 1, 'the governance row is missing');
  assert.equal(audits(db)[0].viewed_user_id, SUBJECT, 'the audit row does not name the subject');
  assert.equal(JSON.parse(audits(db)[0].filters_json).requested_at, '2026-10-01 09:00:00',
    'the audit row does not name which request was closed');
  assert.equal(actorRows(db).length, 1, 'the hashed-actor row is missing');
});

test('a review of an OLD request does not close the NEW one the subject made after withdrawing', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const old = await reviewed(env, db);
  await cancelErasure(env, SUBJECT);
  await asksAt(db, env, '2026-10-02 10:00:00');

  const r = await close(env, HQ_A, 'denied', old);
  assert.equal(r.status, 'stale');
  assert.equal(r.status === 'stale' && r.current_requested_at, '2026-10-02 10:00:00');
  assert.equal(flagOf(db), '2026-10-02 10:00:00', 'the new request was closed on a review of the old one');
  const open = ledger(db).filter((x) => x.outcome === null);
  assert.equal(open.length, 1);
  assert.equal(open[0].requested_at, '2026-10-02 10:00:00');
  assert.equal(notices(db).length, 0, 'the subject was told about a close that did not happen');
  assert.equal(audits(db).length, 0, 'an audit row records a close that did not happen');
  assert.equal(actorRows(db).length, 0);
});

test('a stale ledger id is refused even when the stamp matches', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  const r = await close(env, HQ_A, 'fulfilled', { ...rv, requestId: Number(rv.requestId) + 100 });
  assert.equal(r.status, 'stale');
  assert.equal(flagOf(db), '2026-10-01 09:00:00');
  assert.equal(audits(db).length, 0);
});

// ------------------------------------------------------------ concurrent transitions

test('two operators closing the same request: one is recorded, the other is told so — never two outcomes', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  const [a, b] = await Promise.all([close(env, HQ_A, 'fulfilled', rv), close(env, HQ_B, 'denied', rv)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['closed', 'not_open'], `both or neither were recorded: ${statuses}`);
  const won = a.status === 'closed' ? 'fulfilled' : 'denied';
  const lost = a.status === 'closed' ? b : a;
  assert.equal(lost.status === 'not_open' && lost.last?.outcome, won, 'the loser is not told what was recorded');
  assert.equal(ledger(db).length, 1);
  assert.equal(notices(db).length, 1, 'the subject was told twice');
  assert.equal(audits(db).length, 1, 'two audit rows for one request');
});

test('the subject withdraws while HQ closes — in either order, one outcome and no false notice', async () => {
  for (const hqFirst of [true, false]) {
    const { db, env } = fresh();
    await asksAt(db, env, '2026-10-01 09:00:00');
    const rv = await reviewed(env, db);
    let r: any, c: any;
    if (hqFirst) { r = await close(env, HQ_A, 'denied', rv); c = await cancelErasure(env, SUBJECT); }
    else { c = await cancelErasure(env, SUBJECT); r = await close(env, HQ_A, 'denied', rv); }
    const rows = ledger(db);
    assert.equal(rows.length, 1);
    assert.equal(flagOf(db), null);
    if (hqFirst) {
      assert.equal(r.status, 'closed');
      assert.equal(c.cancelled, false, 'a cancel after the close claimed to cancel');
      assert.equal(rows[0].outcome, 'denied', 'the withdrawal overwrote HQ\'s decision');
      assert.equal(notices(db).length, 1);
    } else {
      assert.equal(c.cancelled, true);
      assert.equal(r.status, 'not_open');
      assert.equal(r.last?.outcome, 'withdrawn');
      assert.equal(rows[0].outcome, 'withdrawn', 'HQ recorded a decision on a withdrawn request');
      assert.equal(notices(db).length, 0, 'the subject was told of a decision on a request they withdrew');
      assert.equal(audits(db).length, 0);
    }
  }
});

// ------------------------------------------------------------ retry and idempotency

test('a retry with the same key is the same act: recorded once, answered as already on record', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  const k = key();
  const first = await close(env, HQ_A, 'fulfilled', rv, k);
  const again = await close(env, HQ_A, 'fulfilled', rv, k);
  assert.equal(first.status, 'closed');
  assert.equal(again.status, 'closed', 'a retry of a recorded close read as a refusal');
  assert.equal(again.status === 'closed' && again.replayed, true);
  assert.equal(notices(db).length, 1);
  assert.equal(audits(db).length, 1);
  assert.equal(actorRows(db).length, 1);
});

test('identical retries racing each other still record once', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  const k = key();
  const out = await Promise.all([close(env, HQ_A, 'denied', rv, k), close(env, HQ_A, 'denied', rv, k)]);
  assert.deepEqual(out.map((o) => o.status), ['closed', 'closed']);
  assert.equal(notices(db).length, 1);
  assert.equal(audits(db).length, 1);
});

test('a key reused for a different close is refused and writes nothing', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  const k = key();
  await close(env, HQ_A, 'denied', rv, k);
  await asksAt(db, env, '2026-10-05 09:00:00');
  const r = await close(env, HQ_A, 'fulfilled', await reviewed(env, db), k);
  assert.equal(r.status, 'key_conflict');
  assert.equal(flagOf(db), '2026-10-05 09:00:00');
  assert.equal(audits(db).length, 1);
});

// ------------------------------------------------------------ interruption and partial completion

test('when the audit row cannot be written, NOTHING moves — the decision never lands without its record', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  db.exec('DROP TABLE admin_audit_log');
  await assert.rejects(() => close(env, HQ_A, 'denied', rv));
  assert.equal(flagOf(db), '2026-10-01 09:00:00', 'the flag cleared without its audit row');
  assert.equal(ledger(db)[0].outcome, null, 'the outcome landed without its audit row');
  assert.equal(notices(db).length, 0);
});

test('a write whose result cannot be read back is UNCONFIRMED, and the retry reconciles it', async () => {
  const { db, env } = fresh();
  await asksAt(db, env, '2026-10-01 09:00:00');
  const rv = await reviewed(env, db);
  // The batch commits; every read after it fails, as a dropped connection would.
  let committed = false;
  const flaky = {
    DB: {
      prepare: (sql: string) => {
        const s = env.DB.prepare(sql);
        if (committed && /^\s*SELECT/i.test(sql)) {
          const fail = { bind: () => fail, first: async () => { throw new Error('connection lost'); }, all: async () => { throw new Error('connection lost'); } };
          return fail as any;
        }
        return s;
      },
      batch: async (stmts: any[]) => { const out = await env.DB.batch(stmts); committed = true; return out; },
    },
  } as any;
  const k = key();
  const r = await close(flaky, HQ_A, 'fulfilled', rv, k);
  assert.equal(r.status, 'unconfirmed', 'an unknown result was reported as success or failure');
  assert.equal(ledger(db)[0].outcome, 'fulfilled', 'fixture: the batch should have committed');
  const again = await close(env, HQ_A, 'fulfilled', rv, k);
  assert.equal(again.status === 'closed' && again.replayed, true, 'the retry did not find the committed close');
  assert.equal(notices(db).length, 1);
  assert.equal(audits(db).length, 1);
});

// ------------------------------------------------------------ the subject's own two writes

test('a cancel that finds nothing open changes nothing and says so', async () => {
  const { db, env } = fresh();
  const c = await cancelErasure(env, SUBJECT);
  assert.equal(c.cancelled, false);
  assert.equal(ledger(db).length, 0);
});

test('an open ledger row the flag no longer backs is recorded as the withdrawal it was, and the next ask opens cleanly', async () => {
  const { db, env } = fresh();
  // The shape a cancel left before D4675 when its ledger write failed:
  // the flag cleared, the ledger row still open.
  db.prepare("INSERT INTO dsr_requests (user_id, requested_at) VALUES (1, '2026-09-01 09:00:00')").run();
  await asksAt(db, env, '2026-10-03 09:00:00');
  const rows = ledger(db);
  assert.equal(rows.length, 2, 'the new request was swallowed by the stale open row');
  assert.equal(rows[0].outcome, 'withdrawn');
  assert.equal(rows[0].closed_by_user_id, null, 'the repair named an operator');
  assert.equal(rows[1].outcome, null);
  assert.equal(rows[1].requested_at, '2026-10-03 09:00:00', 'the ledger clock is not the flag\'s clock');
  const r = await close(env, HQ_A, 'denied', await reviewed(env, db));
  assert.equal(r.status, 'closed');
  assert.equal(ledger(db)[1].outcome, 'denied');
});

test('without a ledger the member can still ask and cancel — the flag alone moves', async () => {
  const { db, env } = fresh(false);
  const saved = console.warn; console.warn = () => {};
  try {
    const a = await requestErasure(env, SUBJECT);
    assert.equal(a.ledger, false);
    assert.ok(flagOf(db), 'a member could not ask because HQ\'s ledger is behind');
    const c = await cancelErasure(env, SUBJECT);
    assert.deepEqual(c, { cancelled: true, ledger: false });
    assert.equal(flagOf(db), null);
  } finally { console.warn = saved; }
});

test('asking writes the flag and the ledger row together, keeping the first receipt stamp', async () => {
  const { db, env } = fresh();
  assert.deepEqual(await requestErasure(env, SUBJECT), { ledger: true });
  const first = flagOf(db);
  assert.ok(first);
  await requestErasure(env, SUBJECT);
  assert.equal(flagOf(db), first, 'asking again moved the clock');
  assert.equal(ledger(db).length, 1);
  assert.equal(ledger(db)[0].requested_at, first);
});

test('a close key is a narrow token', () => {
  assert.ok(DSR_CLOSE_KEY_RE.test('op_0123456789abcdef0123456789abcdef'));
  for (const bad of ['', 'short', 'x'.repeat(101), 'has space in it 0123', "quote'0123456789abc"]) {
    assert.equal(DSR_CLOSE_KEY_RE.test(bad), false, bad);
  }
});

// ------------------------------------------------------------ the clock at calendar edges (UTC)

const at = (s: string) => dsrStampMs(s);

test('the stored stamp is read as UTC, whatever zone the process runs in', () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York', 'Europe/London', 'Australia/Sydney']) {
      process.env.TZ = tz;
      assert.equal(at('2026-03-08 06:30:00'), Date.UTC(2026, 2, 8, 6, 30, 0), `read in local time under ${tz}`);
      assert.equal(dsrDeadlineIso(at('2026-03-08 06:30:00')), '2026-04-08T23:59:59.999Z', tz);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
  assert.ok(Number.isNaN(at(null)) && Number.isNaN(at('')) && Number.isNaN(at('not a date')));
  assert.equal(dsrDeadlineIso(NaN), null, 'an unknown receipt has no deadline, not one at the epoch');
});

test('the deadline is one calendar month from receipt, to the end of that UTC day', () => {
  // D4675 part 2, the owner's decision on #4675 (Q1 = B). Until then it was
  // 30 spans of 24 hours; every row below changed with it.
  assert.equal(DSR_CLOCK_RULE, 'calendar_month');
  const cases: Array<[string, string, string]> = [
    ['2026-01-15 00:00:00', '2026-02-15T23:59:59.999Z', 'the same day next month'],
    ['2026-01-31 10:00:00', '2026-02-28T23:59:59.999Z', 'a 28-day February has no 31st: its last day'],
    ['2028-01-31 10:00:00', '2028-02-29T23:59:59.999Z', 'a leap February: the 29th'],
    ['2028-01-30 23:59:59', '2028-02-29T23:59:59.999Z', 'the 30th clamps to the 29th too'],
    ['2028-02-29 00:00:00', '2028-03-29T23:59:59.999Z', 'from a leap day'],
    ['2026-03-01 12:00:00', '2026-04-01T23:59:59.999Z', 'March has 31 days: this one runs past 30 × 24h'],
    ['2026-03-31 08:00:00', '2026-04-30T23:59:59.999Z', 'April has no 31st'],
    ['2026-08-31 08:00:00', '2026-09-30T23:59:59.999Z', 'September has no 31st'],
    ['2026-03-07 02:30:00', '2026-04-07T23:59:59.999Z', 'the US spring change (8 March) moves nothing in UTC'],
    ['2026-10-20 00:30:00', '2026-11-20T23:59:59.999Z', 'nor do the EU and US autumn changes'],
    ['2026-12-15 18:00:00', '2027-01-15T23:59:59.999Z', 'over the year end'],
    ['2026-12-31 23:59:59', '2027-01-31T23:59:59.999Z', 'the last second of the year'],
    ['2027-11-30 00:00:01', '2027-12-30T23:59:59.999Z', 'into December'],
  ];
  for (const [received, deadline, why] of cases) assert.equal(dsrDeadlineIso(at(received)), deadline, why);
});

test('never later than a calendar month, never shorter than 28 days, always the end of a UTC day', () => {
  // A sweep over two years of receipts, every 7 hours, so every day of every
  // month and both leap and common Februaries are crossed.
  const day = 86400000;
  for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2029, 0, 1); t += 7 * 3600000) {
    const end = dsrDeadlineMs(t)!;
    const r = new Date(t);
    const sameDateNextMonth = Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate() + 1) - 1;
    assert.ok(end <= sameDateNextMonth, `past a calendar month for ${r.toISOString()}`);
    assert.ok(end - t >= 28 * day, `shorter than 28 days for ${r.toISOString()}`);
    assert.equal(new Date(end).toISOString().slice(11), '23:59:59.999Z', `not the end of a UTC day for ${r.toISOString()}`);
    assert.ok(new Date(end).getUTCMonth() === (r.getUTCMonth() + 1) % 12, `due in the wrong month for ${r.toISOString()}`);
  }
});

test('overdue from the deadline instant: the due day reads 0, the next instant is overdue', () => {
  // Q2 = B. Before part 2 the count read 0 for the WHOLE DAY AFTER the
  // deadline ("0d left" while it had run out); that window is gone.
  const r = at('2026-01-31 10:00:00'); // due by the end of 28 February
  const deadline = Date.parse(String(dsrDeadlineIso(r)));
  assert.equal(dsrDaysLeft(r, r), 28);
  assert.equal(dsrDaysLeft(r, Date.parse('2026-02-27T23:59:59.999Z')), 1, 'the day before the due day');
  assert.equal(dsrDaysLeft(r, Date.parse('2026-02-28T00:00:00.000Z')), 0, 'the due day: due today');
  assert.equal(dsrDaysLeft(r, deadline), 0, 'the deadline instant itself is still the due day');
  assert.equal(dsrOverdue(r, deadline), false, 'not overdue AT the deadline');
  assert.equal(dsrDaysLeft(r, deadline + 1), -1, 'one millisecond after: overdue, no grace day');
  assert.equal(dsrOverdue(r, deadline + 1), true);
  assert.equal(dsrOverdue(NaN, deadline), null, 'an unknown receipt is not on time and not overdue');

  // The two readings are one fact: a reader that tests `days_left < 0` and one
  // that reads `overdue` can never disagree, at any instant.
  for (let now = r; now < r + 62 * 86400000; now += 3 * 3600000 + 17) {
    assert.equal(dsrDaysLeft(r, now)! < 0, dsrOverdue(r, now), new Date(now).toISOString());
  }
});
