/**
 * The sweep that reports a breached HQ SLA (D143).
 *
 * WHY THIS IS A REAL SQLITE TEST AND NOT A SOURCE SCAN. The defect this guards
 * is a date-format defect: `hq_escalations` carries TWO timestamp shapes in one
 * row — `created_at`/`updated_at` default to `datetime('now')` while `due_at` is
 * written from JavaScript as ISO-8601 (`rpc/hqOps.ts`) — and a predicate that
 * compares the two reads correctly, lints clean, and is wrong only until a UTC
 * date rolls over. A SQL-text stub structurally cannot see that. D1 IS SQLite,
 * so `node:sqlite` runs the real statement with the real binds and lets the rows
 * decide, which is the argument `support_session_close_d122.test.ts` makes.
 *
 * THE SCHEMA IS THE MIGRATIONS THEMSELVES, EXECUTED IN ORDER. Rather than
 * hand-typing a CREATE TABLE that can drift from production, the fixture runs
 * `259_hq_escalations.sql` and then `267_hq_escalation_sla_claim.sql` off disk.
 * So this file also proves 267 applies to 259's output — a fixture narrower than
 * the thing it stands in for is how D142's freeze bug reached a green suite.
 *
 * ROWS ARE AGED IN THE WRITER'S OWN FORMAT. `due_at` is seeded as ISO-8601,
 * because that is what `escalate()` writes. Seeding it in SQL format and then
 * asserting the sweep works would prove only that the test and the fixture
 * agree — the shape that let a mutation escape on #588.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { reportBreachedEscalations, daysOverdue } from '../src/services/hqEscalationSla.ts';

const HQ_A = 3;
const HQ_B = 9;

const sqlFile = (name: string) =>
  readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', name), 'utf8');

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

/** Migration 259, then migration 267 — the real production sequence. */
function hqDb({ withClaimColumn = true, withSuperAdmins = true } = {}) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(sqlFile('259_hq_escalations.sql'));
  if (withClaimColumn) db.exec(sqlFile('267_hq_escalation_sla_claim.sql'));
  if (withSuperAdmins) {
    db.exec('CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO super_admins (user_id) VALUES (?), (?)').run(HQ_A, HQ_B);
  }
  return db;
}

/**
 * Seed an escalation whose `due_at` is `hours` from now, IN ISO-8601 — the shape
 * `escalate()` writes. Negative hours are overdue.
 */
function seed(
  db: InstanceType<typeof DatabaseSync>,
  { uid, hours, status = 'open', notifiedAt = null, dueAt }:
  { uid: string; hours?: number; status?: string; notifiedAt?: string | null; dueAt?: string | null },
): number {
  const iso = dueAt !== undefined
    ? dueAt
    : db.prepare(
      "SELECT replace(datetime('now', ? || ' hours'), ' ', 'T') || '.000Z' AS v",
    ).get(String(hours ?? 0)).v as string;
  const r = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, raised_by_name, status, due_at, sla_breach_notified_at)
     VALUES (?, 'fr', 'moderation', ?, 'Margot', ?, ?, ?)`,
  ).run(uid, `subject ${uid}`, status, iso, notifiedAt);
  return Number(r.lastInsertRowid);
}

function envOf(db: InstanceType<typeof DatabaseSync>) {
  return { DB: makeD1(db) } as any;
}

function recorder() {
  const sent: any[] = [];
  return { sent, notify: async (_e: any, a: any) => { sent.push(a); } };
}

test('THE FORMAT HAZARD, demonstrated rather than described: a bare comparison is wrong', () => {
  const db = hqDb();
  // Two fixed literals, no wall clock, so this cannot pass or fail by luck.
  // The ISO value is TWO HOURS EARLIER than the SQL value, so any correct
  // comparison says "yes, it is past".
  const iso = '2026-09-17T10:00:00.000Z';
  const sql = '2026-09-17 12:00:00';
  const bare = db.prepare('SELECT (? <= ?) AS hit').get(iso, sql).hit;
  const wrapped = db.prepare('SELECT (datetime(?) <= datetime(?)) AS hit').get(iso, sql).hit;
  // `T` (0x54) sorts after a space (0x20), so the ISO string compares GREATER
  // than the SQL one despite naming an earlier instant. This is the whole bug.
  assert.equal(Number(bare), 0, 'a bare string comparison must be wrong — if it is not, the hazard has changed');
  assert.equal(Number(wrapped), 1, 'wrapping both sides in datetime() must be right');
  db.close();
});

test('an escalation past its SLA is reported, stamped, and HQ is told', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_late', hours: -2 });
  const rec = recorder();

  const out = await reportBreachedEscalations(envOf(db), { notify: rec.notify });

  assert.equal(out.readable, true);
  assert.equal(out.breached, 1);
  assert.equal(out.reported, 1);
  // Two super admins hold the elevation, so one breach is two notifications.
  assert.equal(out.notified, 2);
  assert.deepEqual(rec.sent.map((n) => n.userId).sort(), [HQ_A, HQ_B]);
  assert.equal(rec.sent[0].category, 'compliance');
  assert.equal(rec.sent[0].link, '/hq');
  assert.equal(rec.sent[0].type, 'hq_escalation_sla_breached');
  assert.match(rec.sent[0].body, /fr/, 'the branch that raised it must be named');
  assert.equal(rec.sent[0].payload.escalation_uid, 'esc_late');

  const row = db.prepare('SELECT sla_breach_notified_at FROM hq_escalations WHERE uid = ?').get('esc_late') as any;
  assert.ok(row.sla_breach_notified_at, 'the claim must be stamped');
  db.close();
});

test('an escalation still inside its SLA is untouched', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_soon', hours: +6 });
  const rec = recorder();

  const out = await reportBreachedEscalations(envOf(db), { notify: rec.notify });

  assert.equal(out.breached, 0);
  assert.equal(out.reported, 0);
  assert.equal(rec.sent.length, 0);
  const row = db.prepare('SELECT sla_breach_notified_at FROM hq_escalations WHERE uid = ?').get('esc_soon') as any;
  assert.equal(row.sla_breach_notified_at, null);
  db.close();
});

test('sweeping twice reports nothing the second time — the claim, not luck', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_late', hours: -2 });
  const rec = recorder();

  const first = await reportBreachedEscalations(envOf(db), { notify: rec.notify });
  const second = await reportBreachedEscalations(envOf(db), { notify: rec.notify });

  assert.equal(first.reported, 1);
  assert.equal(second.breached, 0, 'the second pass must not even SELECT it');
  assert.equal(second.reported, 0);
  assert.equal(rec.sent.length, 2, 'two super admins, told once — never twice');
  db.close();
});

/**
 * A shim that stamps the row BEHIND THE SWEEP'S BACK, between its SELECT and its
 * UPDATE — which is exactly what a second isolate that got there first would
 * have done.
 *
 * WHY THIS EXISTS. The claim conjunct on the UPDATE (`AND
 * sla_breach_notified_at IS NULL`) is redundant in a single-threaded test,
 * because the SELECT has already filtered those rows out. It earns its place
 * only under concurrency, and a test that cannot interleave cannot see it: the
 * first draft of this suite let that mutation escape untouched. Modelling the
 * race is what makes the conjunct a guarded property rather than a hopeful line.
 */
function racingD1(db: InstanceType<typeof DatabaseSync>) {
  const base = makeD1(db);
  let raced = false;
  return {
    exec: base.exec,
    prepare(sql: string) {
      const api = base.prepare(sql);
      if (sql.includes('FROM hq_escalations') && !raced) {
        const origAll = api.all.bind(api);
        api.all = async () => {
          const r = await origAll();
          raced = true;
          db.prepare("UPDATE hq_escalations SET sla_breach_notified_at = '2026-01-01 00:00:00'").run();
          return r;
        };
      }
      return api;
    },
  };
}

test('a row claimed by another isolate mid-sweep is not claimed twice', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_late', hours: -2 });
  const rec = recorder();

  const out = await reportBreachedEscalations({ DB: racingD1(db) } as any, { notify: rec.notify });

  assert.equal(out.breached, 1, 'this pass did SELECT the row — the race is real, not skipped');
  assert.equal(out.reported, 0, 'but the other isolate owned it, so this pass must not');
  assert.equal(rec.sent.length, 0, 'and HQ must not be told the same breach twice');
  // The winner's stamp survives — the loser does not overwrite it.
  const row = db.prepare('SELECT sla_breach_notified_at FROM hq_escalations WHERE uid = ?').get('esc_late') as any;
  assert.equal(row.sla_breach_notified_at, '2026-01-01 00:00:00');
  db.close();
});

test('each WHERE conjunct on its own: an answered escalation and a null due_at are both skipped', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_answered', hours: -5, status: 'answered' });
  seed(db, { uid: 'esc_no_due', dueAt: null });
  seed(db, { uid: 'esc_already', hours: -5, notifiedAt: '2026-09-01 00:00:00' });
  const rec = recorder();

  const out = await reportBreachedEscalations(envOf(db), { notify: rec.notify });

  assert.equal(out.breached, 0, 'none of the three qualifies, and each for its own reason');
  assert.equal(rec.sent.length, 0);
  // The already-reported row keeps its ORIGINAL stamp — it is not re-stamped.
  const row = db.prepare('SELECT sla_breach_notified_at FROM hq_escalations WHERE uid = ?').get('esc_already') as any;
  assert.equal(row.sla_breach_notified_at, '2026-09-01 00:00:00');
  db.close();
});

test('a database without migration 267 reads UNREADABLE, never a cheerful zero', async () => {
  // The #204 lesson: a store that cannot be read has not said "nothing is due".
  const db = hqDb({ withClaimColumn: false });
  seed2(db, 'esc_late');
  const rec = recorder();

  const out = await reportBreachedEscalations(envOf(db), { notify: rec.notify });

  assert.equal(out.readable, false, 'a missing claim column must not read as "no SLA breached"');
  assert.equal(out.breached, 0);
  assert.equal(out.reported, 0);
  assert.equal(rec.sent.length, 0, 'and it must not act on what it could not read');
  db.close();
});

/** Seed without the 267 column, for the unreadable case above. */
function seed2(db: InstanceType<typeof DatabaseSync>, uid: string) {
  const iso = db.prepare(
    "SELECT replace(datetime('now', '-2 hours'), ' ', 'T') || '.000Z' AS v",
  ).get().v as string;
  db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at)
     VALUES (?, 'fr', 'moderation', 'subject', 'open', ?)`,
  ).run(uid, iso);
}

test('a send that fails does not un-claim the row', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_late', hours: -2 });

  const out = await reportBreachedEscalations(envOf(db), {
    notify: async () => { throw new Error('mailbox unreachable'); },
  });

  assert.equal(out.reported, 1, 'the row was still owned by this pass');
  assert.equal(out.notified, 0, 'and nothing was reported as sent');
  const row = db.prepare('SELECT sla_breach_notified_at FROM hq_escalations WHERE uid = ?').get('esc_late') as any;
  assert.ok(row.sla_breach_notified_at, 'the claim stands, so one dead mailbox cannot become a stream');
  db.close();
});

test('no super admin means the breach is still claimed, and nothing is sent', async () => {
  const db = hqDb({ withSuperAdmins: false });
  seed(db, { uid: 'esc_late', hours: -2 });
  const rec = recorder();

  const out = await reportBreachedEscalations(envOf(db), { notify: rec.notify });

  assert.equal(out.reported, 1);
  assert.equal(out.notified, 0);
  assert.equal(rec.sent.length, 0);
  db.close();
});

/*
 * The three structural assertions. Each guards a property that no behavioural
 * test above can see, because each is about how the sweep is WIRED rather than
 * what it does once called.
 */

test('the sweep never compares due_at bare against the clock', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/services/hqEscalationSla.ts'), 'utf8',
  );
  // Strip the docblock, which discusses the bad shape by name on purpose.
  const code = src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');
  assert.ok(
    code.includes('datetime(due_at) <= datetime('),
    'the comparison must wrap BOTH sides — `due_at` is ISO and the clock is not',
  );
  assert.ok(
    !/due_at\s*[<>]=?\s*(?:CURRENT_TIMESTAMP|datetime\('now)/.test(code),
    'a bare due_at comparison is the defect this whole file exists to prevent',
  );
});

test('due_at is on the timestamp guard\'s watch list', () => {
  // The guard has no allowlist by design: a column outside TTL_COLUMN is a
  // column nobody is watching. Its own header asks for the name to be added in
  // the same commit as the column, which is what D143 did.
  const guard = readFileSync(
    resolve(process.cwd(), 'scripts/check-timestamp-comparisons.mjs'), 'utf8',
  );
  const at = guard.indexOf('const TTL_COLUMN =');
  assert.ok(at > 0, 'the guard no longer declares TTL_COLUMN under that name');
  const line = guard.slice(at, guard.indexOf('\n', at));
  assert.ok(line.includes('due_at'), 'due_at fell off the watch list');
  assert.ok(line.includes('respond_by'), 'and respond_by must still be on it');
});

test('the cron block is not gated on hqCadences, and says why', () => {
  const idx = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  const at = idx.indexOf('reportBreachedEscalations');
  assert.ok(at > 0, 'the sweep is not wired into the scheduled handler at all');
  // Bounded to this block's own `if`, so a NEIGHBOURING block's gate cannot
  // satisfy or break the assertion.
  const before = idx.slice(Math.max(0, at - 400), at);
  const guardLine = before.slice(before.lastIndexOf('if ('));
  assert.ok(
    !guardLine.includes('hqCadences'),
    'hq_escalations is HQ\'s table and its predicate is the tier discriminator — '
    + 'a later tidy that folds this into the hqCadences group is the thing being caught',
  );
  assert.match(guardLine, /getUTCMinutes\(\) % \d+ === 0/, 'it must ride the existing wall-clock cadence');
});

test('daysOverdue reads both stored formats and never goes negative', () => {
  const now = Date.parse('2026-09-17T12:00:00.000Z');
  assert.equal(daysOverdue('2026-09-14T12:00:00.000Z', now), 3, 'ISO, the format escalate() writes');
  assert.equal(daysOverdue('2026-09-14 12:00:00', now), 3, 'SQL, in case a row is ever written that way');
  assert.equal(daysOverdue('2026-09-17T11:00:00.000Z', now), 0, 'under a day is zero, not a fraction');
  assert.equal(daysOverdue('2026-09-30T12:00:00.000Z', now), 0, 'a future deadline never reads as overdue');
  assert.equal(daysOverdue('not a date', now), 0, 'an unparseable stamp does not become NaN on screen');
});

test('the copy an HQ holder actually reads names the branch, the subject and the lateness', async () => {
  const db = hqDb();
  // A FIXED past deadline and a FIXED `now`, so the day count is deterministic
  // rather than a function of when CI happens to run. The deadline only gets
  // further into the past as time passes, so the SELECT keeps matching.
  seed(db, { uid: 'esc_late', dueAt: '2026-09-14T12:00:00.000Z' });
  const rec = recorder();

  await reportBreachedEscalations(envOf(db), {
    notify: rec.notify,
    now: Date.parse('2026-09-17T12:00:00.000Z'),
  });

  const body = rec.sent[0].body as string;
  assert.match(body, /^fr raised "subject esc_late"/, 'the branch and the subject lead');
  assert.match(body, /\(raised by Margot\)/, 'the person who raised it is named when known');
  assert.match(body, /3 days past its deadline/, 'the lateness is counted, not implied');
  assert.match(body, /still open and still waiting/, 'and it says the thing is not resolved');
  db.close();
});

test('lateness is singular at one day, and unnamed when the raiser is not recorded', async () => {
  const db = hqDb();
  seed(db, { uid: 'esc_one', dueAt: '2026-09-16T12:00:00.000Z' });
  db.prepare("UPDATE hq_escalations SET raised_by_name = NULL WHERE uid = 'esc_one'").run();
  const rec = recorder();

  await reportBreachedEscalations(envOf(db), {
    notify: rec.notify,
    now: Date.parse('2026-09-17T12:00:00.000Z'),
  });

  const body = rec.sent[0].body as string;
  assert.match(body, /1 day past its deadline/, 'one day, not "1 days"');
  assert.ok(!body.includes('raised by'), 'an unrecorded raiser is omitted, never rendered as null');
  db.close();
});
